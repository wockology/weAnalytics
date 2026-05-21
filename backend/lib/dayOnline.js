const { db } = require('../db');

function bucketKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:00:00`;
}

function buildDayOnline(serverId, now = new Date()) {
  const endHour = new Date(now);
  endHour.setUTCMinutes(0, 0, 0);
  const startHour = new Date(endHour.getTime() - 23 * 3600000);
  const since = startHour.toISOString().slice(0, 19).replace('T', ' ');

  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00:00', joined_at) AS bucket,
      COUNT(*) AS total,
      COUNT(DISTINCT CASE WHEN player_uuid IS NOT NULL THEN player_uuid END) AS unique_count
    FROM events
    WHERE server_id = ? AND joined_at >= ?
    GROUP BY bucket
    ORDER BY bucket
  `).all(serverId, since);

  const byBucket = {};
  rows.forEach(r => {
    byBucket[r.bucket] = {
      total:  r.total || 0,
      unique: r.unique_count || 0,
    };
  });

  const hours = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(startHour.getTime() + i * 3600000);
    const key = bucketKey(d);
    hours.push({
      bucket: key,
      label:  `${String(d.getUTCHours()).padStart(2, '0')}:00`,
      hour:   d.getUTCHours(),
      total:  byBucket[key]?.total  || 0,
      unique: byBucket[key]?.unique || 0,
      is_now: i === 23,
    });
  }

  const dayTotal = hours.reduce((sum, row) => sum + row.total, 0);
  const dayUnique = db.prepare(`
    SELECT COUNT(DISTINCT player_uuid) AS cnt
    FROM events
    WHERE server_id = ? AND joined_at >= ? AND player_uuid IS NOT NULL
  `).get(serverId, since).cnt;

  let peakIndex = 0;
  let peakTotal = 0;
  hours.forEach((row, i) => {
    if (row.total > peakTotal) {
      peakTotal = row.total;
      peakIndex = i;
    }
  });

  const last = hours[hours.length - 1] || { total: 0, unique: 0 };

  return {
    hours,
    window_start: startHour.toISOString(),
    window_end:   now.toISOString(),
    day_total:     dayTotal,
    day_unique:    dayUnique,
    peak_index:    peakIndex,
    peak_hour:     hours[peakIndex]?.hour ?? 0,
    peak_label:    hours[peakIndex]?.label ?? '—',
    peak_total:    peakTotal,
    current_total: last.total,
    current_unique: last.unique,
  };
}

module.exports = { buildDayOnline };
