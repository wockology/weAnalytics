const { db } = require('../db');

function parseDbTime(value) {
  if (!value) return NaN;
  const s = String(value).trim();
  if (!s) return NaN;
  return new Date(s.includes('T') ? s : s.replace(' ', 'T')).getTime();
}

function emptyBuckets() {
  return { under_1h: 0, under_24h: 0, under_7d: 0, under_30d: 0, over_30d: 0 };
}

function bucketKey(seconds) {
  if (seconds < 3600) return 'under_1h';
  if (seconds < 86400) return 'under_24h';
  if (seconds < 7 * 86400) return 'under_7d';
  if (seconds < 30 * 86400) return 'under_30d';
  return 'over_30d';
}

/**
 * Time from first join (events.player_name) to first donation (donations.player).
 * Only donors with a matching join in events; first_donate can be filtered by `since`.
 */
function buildDonateTiming(serverId, since = null) {
  const joinRows = db.prepare(`
    SELECT LOWER(TRIM(player_name)) AS player_key, MIN(joined_at) AS first_join
    FROM events
    WHERE server_id = ? AND player_name IS NOT NULL AND TRIM(player_name) != ''
    GROUP BY LOWER(TRIM(player_name))
  `).all(serverId);

  const joinMap = new Map(joinRows.map(r => [r.player_key, r.first_join]));

  const donors = db.prepare(`
    SELECT
      LOWER(TRIM(player)) AS player_key,
      MIN(player) AS player,
      MIN(donated_at) AS first_donate
    FROM donations
    WHERE server_id = ? AND player IS NOT NULL AND TRIM(player) != ''
    GROUP BY LOWER(TRIM(player))
  `).all(serverId);

  const players = [];
  let unmatched = 0;

  for (const d of donors) {
    if (since && String(d.first_donate) < String(since)) continue;

    const firstJoin = joinMap.get(d.player_key);
    if (!firstJoin) {
      unmatched += 1;
      continue;
    }
    const joinMs = parseDbTime(firstJoin);
    const donateMs = parseDbTime(d.first_donate);
    if (!Number.isFinite(joinMs) || !Number.isFinite(donateMs)) continue;

    const seconds = Math.max(0, Math.floor((donateMs - joinMs) / 1000));
    players.push({
      player:       d.player,
      seconds,
      first_join:   firstJoin,
      first_donate: d.first_donate,
    });
  }

  if (!players.length) {
    return {
      matched:          0,
      unmatched_donors: unmatched,
      median_seconds:   null,
      avg_seconds:      null,
      buckets:          emptyBuckets(),
      fastest:          [],
    };
  }

  const sortedSec = players.map(p => p.seconds).sort((a, b) => a - b);
  const mid = Math.floor(sortedSec.length / 2);
  const median = sortedSec.length % 2
    ? sortedSec[mid]
    : Math.round((sortedSec[mid - 1] + sortedSec[mid]) / 2);
  const avg = Math.round(sortedSec.reduce((a, b) => a + b, 0) / sortedSec.length);

  const buckets = emptyBuckets();
  sortedSec.forEach(s => {
    buckets[bucketKey(s)] += 1;
  });

  const fastest = [...players]
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, 6)
    .map(p => ({
      player:       p.player,
      seconds:      p.seconds,
      first_donate: p.first_donate,
    }));

  return {
    matched:          players.length,
    unmatched_donors: unmatched,
    median_seconds:   median,
    avg_seconds:      avg,
    buckets,
    fastest,
  };
}

module.exports = { buildDonateTiming };
