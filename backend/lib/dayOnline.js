const { db } = require('../db');

function buildDayOnline(serverId, todayUtc) {
  const rows = db.prepare(`
    SELECT
      CAST(strftime('%H', joined_at) AS INTEGER) AS hour,
      COUNT(*) AS total,
      COUNT(DISTINCT CASE WHEN player_uuid IS NOT NULL THEN player_uuid END) AS unique_count
    FROM events
    WHERE server_id = ? AND date(joined_at) = ?
    GROUP BY hour
    ORDER BY hour
  `).all(serverId, todayUtc);

  const byHour = {};
  rows.forEach(r => {
    byHour[r.hour] = {
      total:  r.total || 0,
      unique: r.unique_count || 0,
    };
  });

  const hours = [];
  for (let h = 0; h < 24; h++) {
    hours.push({
      hour:   h,
      total:  byHour[h]?.total  || 0,
      unique: byHour[h]?.unique || 0,
    });
  }

  const dayTotal = hours.reduce((sum, row) => sum + row.total, 0);
  const dayUnique = db.prepare(`
    SELECT COUNT(DISTINCT player_uuid) AS cnt
    FROM events
    WHERE server_id = ? AND date(joined_at) = ? AND player_uuid IS NOT NULL
  `).get(serverId, todayUtc).cnt;

  let peakHour = 0;
  let peakTotal = 0;
  hours.forEach(row => {
    if (row.total > peakTotal) {
      peakTotal = row.total;
      peakHour = row.hour;
    }
  });

  const currentHourUtc = new Date().getUTCHours();
  const currentHourRow = hours[currentHourUtc] || { total: 0, unique: 0 };

  return {
    date:          todayUtc,
    hours,
    day_total:     dayTotal,
    day_unique:    dayUnique,
    peak_hour:     peakHour,
    peak_total:    peakTotal,
    current_hour:  currentHourUtc,
    current_total: currentHourRow.total,
    current_unique: currentHourRow.unique,
  };
}

module.exports = { buildDayOnline };
