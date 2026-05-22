const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../db');
const auth    = require('../middleware/auth');
const { mergeSubdomainRows, normalizeSubdomain } = require('../lib/subdomain');
const { getServerAccess, isServerOwner } = require('../lib/serverAccess');
const { maskStatsForPartner } = require('../lib/partnerMask');
const { buildDonateTiming } = require('../lib/donateTiming');
const { buildDonateProducts } = require('../lib/donateProducts');
const { getPublicOrigin, buildDonateCallbackUrl } = require('../lib/callbackUrl');
const { buildPeriodInsights } = require('../lib/insights');
const { buildDayOnline } = require('../lib/dayOnline');
const { toUtcIso, utcDateStr, periodSinceUtc } = require('../lib/datetime');
const {
  countUniquePlayers,
  uniqueCountsBySubdomain,
  uniqueCountsByDay,
  deleteForServer,
} = require('../lib/playerAttribution');
const { buildPeriodEngagement } = require('../lib/sessionStats');
const {
  emptyDonationsByPeriod,
  buildSubdomainDonationsByPeriod,
} = require('../lib/subdomainDonations');

const router = express.Router();
router.use(auth);

function generateApiKey() {
  return 'wea_live_' + crypto.randomBytes(18).toString('hex');
}

function generateWebhookSecret() {
  return 'wea_hook_' + crypto.randomBytes(18).toString('hex');
}

function buildPeriodStats(serverId, period, now, todayUtc) {
  const since = periodSinceUtc(period, now);
  const total = db
    .prepare('SELECT COUNT(*) AS cnt FROM events WHERE server_id = ? AND joined_at >= ?')
    .get(serverId, since).cnt;

  const unique = period === 'day'
    ? countUniquePlayers(serverId, { day: todayUtc })
    : countUniquePlayers(serverId, { since });

  const subdomains = db
    .prepare(`
      SELECT COUNT(DISTINCT subdomain) AS cnt
      FROM events
      WHERE server_id = ? AND joined_at >= ?
    `)
    .get(serverId, since).cnt;

  const donated = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS sum FROM donations WHERE server_id = ? AND donated_at >= ?')
    .get(serverId, since).sum;

  const engagement = buildPeriodEngagement(serverId, period, since, todayUtc);

  return { total, unique, subdomains, donated, ...engagement };
}

router.get('/', (req, res) => {
  const origin = getPublicOrigin(req);

  const owned = db.prepare(`
    SELECT id, name, api_key, webhook_secret, created_at
    FROM servers
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.user.userId).map(s => ({
    id:              s.id,
    name:            s.name,
    role:            'owner',
    api_key:         s.api_key,
    webhook_secret:  s.webhook_secret,
    callback_url:    buildDonateCallbackUrl(origin, s.webhook_secret, { includeToken: true }),
    created_at:      s.created_at,
    permissions: {
      can_view_revenue:          true,
      can_view_donate_analytics: true,
      can_view_integrations:     true,
    },
  }));

  const partnered = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.created_at,
      sp.can_view_revenue,
      sp.can_view_donate_analytics,
      sp.can_view_integrations,
      u.username AS owner_username
    FROM server_partners sp
    JOIN servers s ON s.id = sp.server_id
    JOIN users u ON u.id = s.user_id
    WHERE sp.partner_user_id = ?
    ORDER BY sp.created_at DESC
  `).all(req.user.userId).map(s => {
    const row = {
      id:              s.id,
      name:            s.name,
      role:            'partner',
      owner_username:  s.owner_username,
      created_at:      s.created_at,
      permissions: {
        can_view_revenue:          !!s.can_view_revenue,
        can_view_donate_analytics: !!s.can_view_donate_analytics,
        can_view_integrations:     !!s.can_view_integrations,
      },
    };
    if (s.can_view_integrations) {
      row.callback_url = buildDonateCallbackUrl(origin, null);
    }
    return row;
  });

  res.json([...owned, ...partnered]);
});

router.use('/:id/partners', require('./partners'));

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Введите название' });

  const existing = db
    .prepare('SELECT id FROM servers WHERE user_id = ? LIMIT 1')
    .get(req.user.userId);
  if (existing) return res.status(409).json({ error: 'Доступен только один сервер' });

  const apiKey = generateApiKey();
  const webhookSecret = generateWebhookSecret();
  const result = db
    .prepare('INSERT INTO servers (user_id, name, api_key, webhook_secret) VALUES (?, ?, ?, ?)')
    .run(req.user.userId, name.trim(), apiKey, webhookSecret);

  res.json({
    id: result.lastInsertRowid,
    name: name.trim(),
    api_key: apiKey,
    webhook_secret: webhookSecret,
  });
});

router.get('/:id/stats', (req, res) => {
  const access = getServerAccess(req.params.id, req.user.userId);
  if (!access) return res.status(404).json({ error: 'Сервер не найден' });

  const server = access.server;

  const now       = new Date();
  const todayUtc  = utcDateStr(now);
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const since     = yearStart.toISOString().slice(0, 19).replace('T', ' ');
  const weekAgo   = periodSinceUtc('week', now);

  const joinStats = db.prepare(`
    SELECT
      LOWER(TRIM(subdomain)) AS subdomain,
      COUNT(CASE WHEN date(joined_at) = ? THEN 1 END) AS today,
      COUNT(CASE WHEN joined_at >= ? THEN 1 END) AS week,
      COUNT(*) AS total,
      MAX(joined_at) AS last_seen
    FROM events
    WHERE server_id = ?
    GROUP BY LOWER(TRIM(subdomain))
    ORDER BY total DESC
  `).all(todayUtc, weekAgo, server.id);

  const uniqueBySubdomain = uniqueCountsBySubdomain(server.id, todayUtc, weekAgo);
  const subdomains = joinStats.map(row => {
    const key = normalizeSubdomain(row.subdomain);
    const unique = uniqueBySubdomain.get(key) || {
      today_unique: 0,
      week_unique: 0,
      total_unique: 0,
    };
    return {
      subdomain: key,
      today: row.today || 0,
      week: row.week || 0,
      total: row.total || 0,
      today_unique: unique.today_unique,
      week_unique: unique.week_unique,
      total_unique: unique.total_unique,
      last_seen: row.last_seen,
    };
  });

  for (const [subdomain, unique] of uniqueBySubdomain.entries()) {
    if (subdomains.some(row => row.subdomain === subdomain)) continue;
    subdomains.push({
      subdomain,
      today: 0,
      week: 0,
      total: 0,
      today_unique: unique.today_unique,
      week_unique: unique.week_unique,
      total_unique: unique.total_unique,
      last_seen: null,
    });
  }

  subdomains.sort((a, b) => b.total - a.total || b.total_unique - a.total_unique);

  const periods = {
    day:   {
      ...buildPeriodStats(server.id, 'day',   now, todayUtc),
      donate_timing:   buildDonateTiming(server.id, periodSinceUtc('day',   now)),
      donate_products: buildDonateProducts(server.id, periodSinceUtc('day',   now)),
      insights:        buildPeriodInsights(server.id, 'day',   now),
    },
    week:  {
      ...buildPeriodStats(server.id, 'week',  now, todayUtc),
      donate_timing:   buildDonateTiming(server.id, periodSinceUtc('week',  now)),
      donate_products: buildDonateProducts(server.id, periodSinceUtc('week',  now)),
      insights:        buildPeriodInsights(server.id, 'week',  now),
    },
    month: {
      ...buildPeriodStats(server.id, 'month', now, todayUtc),
      donate_timing:   buildDonateTiming(server.id, periodSinceUtc('month', now)),
      donate_products: buildDonateProducts(server.id, periodSinceUtc('month', now)),
      insights:        buildPeriodInsights(server.id, 'month', now),
    },
    year:  {
      ...buildPeriodStats(server.id, 'year',  now, todayUtc),
      donate_timing:   buildDonateTiming(server.id, periodSinceUtc('year',  now)),
      donate_products: buildDonateProducts(server.id, periodSinceUtc('year',  now)),
      insights:        buildPeriodInsights(server.id, 'year',  now),
    },
  };

  const days = Math.floor((now.getTime() - yearStart.getTime()) / 86400000) + 1;
  const timelineRaw = db.prepare(`
    SELECT date(joined_at) AS day, subdomain, COUNT(*) AS cnt
    FROM events
    WHERE server_id = ? AND joined_at >= ?
    GROUP BY day, subdomain
    ORDER BY day ASC
  `).all(server.id, since);

  const dayList = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(yearStart.getTime() + i * 86400000);
    dayList.push(utcDateStr(d));
  }

  const dayTotals = {};
  timelineRaw.forEach(r => {
    dayTotals[r.day] = (dayTotals[r.day] || 0) + r.cnt;
  });

  const uniqueByDay = uniqueCountsByDay(server.id, since);

  const topSubs = subdomains.slice(0, 5).map(s => s.subdomain);
  const timeline = dayList.map(day => {
    const row = {
      day,
      total:  dayTotals[day] || 0,
      unique: uniqueByDay[day] || 0,
    };
    topSubs.forEach(sub => { row[sub] = 0; });
    row.other = 0;
    timelineRaw
      .filter(r => r.day === day)
      .forEach(r => {
        if (topSubs.includes(r.subdomain)) row[r.subdomain] += r.cnt;
        else row.other += r.cnt;
      });
    return row;
  });

  const donateBySubdomain = buildSubdomainDonationsByPeriod(server.id, now);

  const subdomainsWithDonations = subdomains.map(s => {
    const key = normalizeSubdomain(s.subdomain);
    return {
      ...s,
      subdomain: key,
      last_seen: toUtcIso(s.last_seen),
      donations: donateBySubdomain.get(key) || emptyDonationsByPeriod(),
    };
  });

  for (const [key, donations] of donateBySubdomain.entries()) {
    if (subdomainsWithDonations.some(s => s.subdomain === key)) continue;
    subdomainsWithDonations.push({
      subdomain:     key,
      today:         0,
      week:          0,
      total:         0,
      today_unique:  0,
      week_unique:   0,
      total_unique:  0,
      last_seen:     null,
      donations,
    });
  }

  const mergedSubdomains = mergeSubdomainRows(subdomainsWithDonations);

  let payload = {
    server: { id: server.id, name: server.name },
    stats: { periods },
    day_online: buildDayOnline(server.id, now),
    subdomains: mergedSubdomains,
    timeline,
    timeline_keys: [...topSubs, ...(timeline.some(r => r.other > 0) ? ['other'] : [])],
    access: {
      role: access.role,
      permissions: access.permissions,
      owner_username: access.owner_username || undefined,
    },
  };

  if (access.role === 'partner') {
    payload = maskStatsForPartner(payload, access.permissions);
    payload.access = {
      role: access.role,
      permissions: access.permissions,
      owner_username: access.owner_username || undefined,
    };
  }

  res.json(payload);
});

router.delete('/:id', (req, res) => {
  if (!isServerOwner(req.params.id, req.user.userId)) {
    return res.status(403).json({ error: 'Только владелец сервера' });
  }

  const server = db
    .prepare('SELECT id FROM servers WHERE id = ?')
    .get(req.params.id);

  if (!server) return res.status(404).json({ error: 'Сервер не найден' });

  db.prepare('DELETE FROM server_partners WHERE server_id = ?').run(server.id);

  db.prepare('DELETE FROM events WHERE server_id = ?').run(server.id);
  deleteForServer(server.id);
  db.prepare('DELETE FROM donations WHERE server_id = ?').run(server.id);
  db.prepare('DELETE FROM donate_config WHERE server_id = ?').run(server.id);
  db.prepare('DELETE FROM servers WHERE id = ?').run(server.id);
  res.json({ ok: true });
});

module.exports = router;
