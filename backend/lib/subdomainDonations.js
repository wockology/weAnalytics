const { db } = require('../db');
const { periodSinceUtc } = require('./datetime');
const { normalizeSubdomain } = require('./subdomain');

const DONATION_PERIOD_KEYS = ['day', 'week', 'month', 'year', 'all'];

function emptyDonationsByPeriod() {
  return Object.fromEntries(
    DONATION_PERIOD_KEYS.map(key => [key, { amount: 0, count: 0 }])
  );
}

function buildSubdomainDonationsByPeriod(serverId, now = new Date()) {
  const sinceDay   = periodSinceUtc('day', now);
  const sinceWeek  = periodSinceUtc('week', now);
  const sinceMonth = periodSinceUtc('month', now);
  const sinceYear  = periodSinceUtc('year', now);

  const rows = db.prepare(`
    SELECT
      LOWER(TRIM(subdomain)) AS subdomain,
      SUM(CASE WHEN donated_at >= ? THEN amount ELSE 0 END) AS amount_day,
      SUM(CASE WHEN donated_at >= ? THEN amount ELSE 0 END) AS amount_week,
      SUM(CASE WHEN donated_at >= ? THEN amount ELSE 0 END) AS amount_month,
      SUM(CASE WHEN donated_at >= ? THEN amount ELSE 0 END) AS amount_year,
      SUM(amount) AS amount_all,
      SUM(CASE WHEN donated_at >= ? THEN 1 ELSE 0 END) AS count_day,
      SUM(CASE WHEN donated_at >= ? THEN 1 ELSE 0 END) AS count_week,
      SUM(CASE WHEN donated_at >= ? THEN 1 ELSE 0 END) AS count_month,
      SUM(CASE WHEN donated_at >= ? THEN 1 ELSE 0 END) AS count_year,
      COUNT(*) AS count_all
    FROM donations
    WHERE server_id = ?
    GROUP BY LOWER(TRIM(subdomain))
  `).all(
    sinceDay, sinceWeek, sinceMonth, sinceYear,
    sinceDay, sinceWeek, sinceMonth, sinceYear,
    serverId
  );

  const map = new Map();
  for (const row of rows) {
    const key = normalizeSubdomain(row.subdomain);
    if (!key) continue;
    map.set(key, {
      day:   { amount: row.amount_day   || 0, count: row.count_day   || 0 },
      week:  { amount: row.amount_week  || 0, count: row.count_week  || 0 },
      month: { amount: row.amount_month || 0, count: row.count_month || 0 },
      year:  { amount: row.amount_year  || 0, count: row.count_year  || 0 },
      all:   { amount: row.amount_all   || 0, count: row.count_all   || 0 },
    });
  }
  return map;
}

module.exports = {
  DONATION_PERIOD_KEYS,
  emptyDonationsByPeriod,
  buildSubdomainDonationsByPeriod,
};
