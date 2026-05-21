const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../db');
const auth    = require('../middleware/auth');
const { mergeSubdomainRows, normalizeSubdomain } = require('../lib/subdomain');
const { getServerForUser } = require('../lib/serverAccess');

const router = express.Router();
router.use(auth);

function generateApiKey() {
  return 'wea_live_' + crypto.randomBytes(18).toString('hex');
}

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function periodSince(period, now) {
  const today = localDateStr(now);
  if (period === 'day') return `${today} 00:00:00`;
  const toSql = d => d.toISOString().slice(0, 19).replace('T', ' ');
  if (period === 'week') return toSql(new Date(now - 7 * 86400000));
  if (period === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return `${localDateStr(monthStart)} 00:00:00`;
  }
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return `${localDateStr(yearStart)} 00:00:00`;
}

function buildPeriodStats(serverId, period, now, today) {
  const since = periodSince(period, now);
  const total = db
    .prepare('SELECT COUNT(*) AS cnt FROM events WHERE server_id = ? AND joined_at >= ?')
    .get(serverId, since).cnt;

  const unique = period === 'day'
    ? db.prepare(`
        SELECT COUNT(DISTINCT player_uuid) AS cnt
        FROM events
        WHERE server_id = ? AND date(joined_at) = ? AND player_uuid IS NOT NULL
      `).get(serverId, today).cnt
    : db.prepare(`
        SELECT COUNT(DISTINCT player_uuid) AS cnt
        FROM events
        WHERE server_id = ? AND joined_at >= ? AND player_uuid IS NOT NULL
      `).get(serverId, since).cnt;

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

  return { total, unique, subdomains, donated };
}

router.get('/', (req, res) => {
  const servers = db
    .prepare('SELECT id, name, api_key, created_at FROM servers WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.userId);
  res.json(servers);
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Введите название' });

  const existing = db
    .prepare('SELECT id FROM servers WHERE user_id = ? LIMIT 1')
    .get(req.user.userId);
  if (existing) return res.status(409).json({ error: 'Доступен только один сервер' });

  const apiKey = generateApiKey();
  const result = db
    .prepare('INSERT INTO servers (user_id, name, api_key) VALUES (?, ?, ?)')
    .run(req.user.userId, name.trim(), apiKey);

  res.json({ id: result.lastInsertRowid, name: name.trim(), api_key: apiKey });
});

router.get('/:id/stats', (req, res) => {
  const server = getServerForUser(req.params.id, req.user.userId);
  if (!server) return res.status(404).json({ error: 'Сервер не найден' });

  const now   = new Date();
  const toSql = d => d.toISOString().slice(0, 19).replace('T', ' ');

  const today     = localDateStr(now);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const since     = `${localDateStr(yearStart)} 00:00:00`;
  const weekAgo   = toSql(new Date(now - 7 * 86400000));

  const subdomains = db.prepare(`
    SELECT
      subdomain,
      COUNT(CASE WHEN date(joined_at) = ?         THEN 1 END) AS today,
      COUNT(CASE WHEN joined_at      >= ?          THEN 1 END) AS week,
      COUNT(*)                                                  AS total,
      MAX(joined_at)                                            AS last_seen
    FROM events
    WHERE server_id = ?
    GROUP BY subdomain
    ORDER BY total DESC
  `).all(today, weekAgo, server.id);

  const periods = {
    day:   buildPeriodStats(server.id, 'day',   now, today),
    week:  buildPeriodStats(server.id, 'week',  now, today),
    month: buildPeriodStats(server.id, 'month', now, today),
    year:  buildPeriodStats(server.id, 'year',  now, today),
  };

  const days = Math.floor((now - yearStart) / 86400000) + 1;
  const timelineRaw = db.prepare(`
    SELECT date(joined_at) AS day, subdomain, COUNT(*) AS cnt
    FROM events
    WHERE server_id = ? AND joined_at >= ?
    GROUP BY day, subdomain
    ORDER BY day ASC
  `).all(server.id, since);

  const dayList = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(yearStart);
    d.setDate(d.getDate() + i);
    dayList.push(localDateStr(d));
  }

  const dayTotals = {};
  timelineRaw.forEach(r => {
    dayTotals[r.day] = (dayTotals[r.day] || 0) + r.cnt;
  });

  const uniqueRaw = db.prepare(`
    SELECT date(joined_at) AS day, COUNT(DISTINCT player_uuid) AS cnt
    FROM events
    WHERE server_id = ? AND joined_at >= ? AND player_uuid IS NOT NULL
    GROUP BY day
  `).all(server.id, since);

  const uniqueByDay = {};
  uniqueRaw.forEach(r => {
    uniqueByDay[r.day] = r.cnt;
  });

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

  // Donation stats per subdomain for the selected period
  const donationRows = db.prepare(`
    SELECT subdomain, SUM(amount) AS donated, COUNT(*) AS donate_count
    FROM donations
    WHERE server_id = ? AND donated_at >= ?
    GROUP BY subdomain
  `).all(server.id, since);

  const donateBySubdomain = {};
  donationRows.forEach(r => {
    const key = normalizeSubdomain(r.subdomain);
    if (!key) return;
    const prev = donateBySubdomain[key] || { donated: 0, donate_count: 0 };
    prev.donated += r.donated || 0;
    prev.donate_count += r.donate_count || 0;
    donateBySubdomain[key] = prev;
  });

  const subdomainsWithDonations = subdomains.map(s => {
    const key = normalizeSubdomain(s.subdomain);
    return {
      ...s,
      subdomain: key,
      donated:      donateBySubdomain[key]?.donated      ?? 0,
      donate_count: donateBySubdomain[key]?.donate_count ?? 0,
    };
  });

  Object.keys(donateBySubdomain).forEach(key => {
    if (subdomainsWithDonations.some(s => s.subdomain === key)) return;
    const d = donateBySubdomain[key];
    subdomainsWithDonations.push({
      subdomain:    key,
      today:        0,
      week:         0,
      total:        0,
      last_seen:    null,
      donated:      d.donated || 0,
      donate_count: d.donate_count || 0,
    });
  });

  const mergedSubdomains = mergeSubdomainRows(subdomainsWithDonations);

  res.json({
    server: { id: server.id, name: server.name },
    stats: { periods },
    subdomains: mergedSubdomains,
    timeline,
    timeline_keys: [...topSubs, ...(timeline.some(r => r.other > 0) ? ['other'] : [])],
  });
});

router.delete('/:id', (req, res) => {
  const server = db
    .prepare('SELECT id FROM servers WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);

  if (!server) return res.status(404).json({ error: 'Сервер не найден' });

  db.prepare('DELETE FROM servers WHERE id = ?').run(server.id);
  res.json({ ok: true });
});

module.exports = router;
