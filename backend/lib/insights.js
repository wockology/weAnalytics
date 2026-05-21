const { db } = require('../db');
const { buildDonateProducts } = require('./donateProducts');
const { utcDateStr, periodSinceUtc } = require('./datetime');
const { normalizeSubdomain } = require('./subdomain');

function sqlRange(period, now = new Date()) {
  const t = now.getTime();

  if (period === 'day') {
    const today = utcDateStr(now);
    const yesterday = utcDateStr(new Date(t - 86400000));
    return {
      current:  { mode: 'day', day: today },
      previous: { mode: 'day', day: yesterday },
    };
  }

  if (period === 'week') {
    const currentSince = periodSinceUtc('week', now);
    const prevAnchor = new Date(t - 7 * 86400000);
    return {
      current:  { mode: 'since', since: currentSince },
      previous: { mode: 'range', since: periodSinceUtc('week', prevAnchor), until: currentSince },
    };
  }

  if (period === 'month') {
    const currentSince = periodSinceUtc('month', now);
    const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return {
      current:  { mode: 'since', since: currentSince },
      previous: {
        mode: 'range',
        since: prevMonthStart.toISOString().slice(0, 19).replace('T', ' '),
        until: prevMonthEnd.toISOString().slice(0, 19).replace('T', ' '),
      },
    };
  }

  const currentSince = periodSinceUtc('year', now);
  const prevYearStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
  const prevYearUntil = new Date(Date.UTC(
    now.getUTCFullYear() - 1,
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds()
  ));
  return {
    current:  { mode: 'since', since: currentSince },
    previous: {
      mode: 'range',
      since: prevYearStart.toISOString().slice(0, 19).replace('T', ' '),
      until: prevYearUntil.toISOString().slice(0, 19).replace('T', ' '),
    },
  };
}

function countEvents(serverId, window) {
  if (window.mode === 'day') {
    return db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM events
      WHERE server_id = ? AND date(joined_at) = ?
    `).get(serverId, window.day).cnt;
  }
  if (window.mode === 'since') {
    return db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM events
      WHERE server_id = ? AND joined_at >= ?
    `).get(serverId, window.since).cnt;
  }
  return db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM events
    WHERE server_id = ? AND joined_at >= ? AND joined_at < ?
  `).get(serverId, window.since, window.until).cnt;
}

function topSubdomain(serverId, window) {
  let row;
  if (window.mode === 'day') {
    row = db.prepare(`
      SELECT LOWER(TRIM(subdomain)) AS subdomain, COUNT(*) AS cnt
      FROM events
      WHERE server_id = ? AND date(joined_at) = ?
      GROUP BY LOWER(TRIM(subdomain))
      ORDER BY cnt DESC
      LIMIT 1
    `).get(serverId, window.day);
  } else if (window.mode === 'since') {
    row = db.prepare(`
      SELECT LOWER(TRIM(subdomain)) AS subdomain, COUNT(*) AS cnt
      FROM events
      WHERE server_id = ? AND joined_at >= ?
      GROUP BY LOWER(TRIM(subdomain))
      ORDER BY cnt DESC
      LIMIT 1
    `).get(serverId, window.since);
  } else {
    row = db.prepare(`
      SELECT LOWER(TRIM(subdomain)) AS subdomain, COUNT(*) AS cnt
      FROM events
      WHERE server_id = ? AND joined_at >= ? AND joined_at < ?
      GROUP BY LOWER(TRIM(subdomain))
      ORDER BY cnt DESC
      LIMIT 1
    `).get(serverId, window.since, window.until);
  }

  if (!row?.cnt) return null;
  const subdomain = normalizeSubdomain(row.subdomain);
  if (!subdomain) return null;
  return { subdomain, count: row.cnt };
}

function changePct(current, previous) {
  if (!previous) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function buildPeriodInsights(serverId, period, now = new Date()) {
  const range = sqlRange(period, now);
  const currentTotal = countEvents(serverId, range.current);
  const previousTotal = countEvents(serverId, range.previous);
  const top = topSubdomain(serverId, range.current);
  const since = period === 'day'
    ? `${range.current.day} 00:00:00`
    : range.current.since;
  const products = buildDonateProducts(serverId, since);

  return {
    top_subdomain: top,
    avg_check:     products.avg_check,
    donation_count: products.donation_count,
    current_total:  currentTotal,
    previous_total: previousTotal,
    change_pct:     changePct(currentTotal, previousTotal),
  };
}

module.exports = { buildPeriodInsights, sqlRange };
