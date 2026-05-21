const { db } = require('../db');

const RACE_WINDOW_SEC = 2 * 3600;

function parseDbTime(value) {
  if (!value) return NaN;
  const s = String(value).trim();
  if (!s) return NaN;
  const iso = s.includes('T')
    ? (s.endsWith('Z') ? s : `${s}Z`)
    : `${s.replace(' ', 'T')}Z`;
  return new Date(iso).getTime();
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

function findRefJoin(serverId, playerKey, firstDonate) {
  const joinBefore = db.prepare(`
    SELECT MAX(joined_at) AS ref_join
    FROM events
    WHERE server_id = ?
      AND player_name IS NOT NULL
      AND TRIM(player_name) != ''
      AND LOWER(TRIM(player_name)) = ?
      AND joined_at <= ?
  `).get(serverId, playerKey, firstDonate)?.ref_join;

  if (joinBefore) return { ref_join: joinBefore, mode: 'before' };

  const joinAfter = db.prepare(`
    SELECT MIN(joined_at) AS ref_join
    FROM events
    WHERE server_id = ?
      AND player_name IS NOT NULL
      AND TRIM(player_name) != ''
      AND LOWER(TRIM(player_name)) = ?
      AND joined_at > ?
  `).get(serverId, playerKey, firstDonate)?.ref_join;

  if (joinAfter) {
    const donateMs = parseDbTime(firstDonate);
    const joinMs   = parseDbTime(joinAfter);
    if (Number.isFinite(donateMs) && Number.isFinite(joinMs)) {
      const gapSec = (joinMs - donateMs) / 1000;
      if (gapSec <= RACE_WINDOW_SEC) {
        return { ref_join: joinAfter, mode: 'after' };
      }
    }
  }

  const anyJoin = db.prepare(`
    SELECT MIN(joined_at) AS ref_join
    FROM events
    WHERE server_id = ?
      AND player_name IS NOT NULL
      AND TRIM(player_name) != ''
      AND LOWER(TRIM(player_name)) = ?
  `).get(serverId, playerKey)?.ref_join;

  if (anyJoin) return { ref_join: anyJoin, mode: 'any' };

  return null;
}

function buildDonateTiming(serverId, since = null) {
  const donors = db.prepare(`
    SELECT
      LOWER(TRIM(player)) AS player_key,
      MIN(player) AS player,
      MIN(donated_at) AS first_donate
    FROM donations
    WHERE server_id = ? AND player IS NOT NULL AND TRIM(player) != ''
    GROUP BY LOWER(TRIM(player))
  `).all(serverId);

  const sinceMs = since ? parseDbTime(since) : null;

  const players = [];
  let unmatched = 0;

  for (const d of donors) {
    const donateMs = parseDbTime(d.first_donate);
    if (sinceMs != null && Number.isFinite(sinceMs) && Number.isFinite(donateMs) && donateMs < sinceMs) {
      continue;
    }

    const match = findRefJoin(serverId, d.player_key, d.first_donate);
    if (!match?.ref_join) {
      unmatched += 1;
      continue;
    }

    const joinMs = parseDbTime(match.ref_join);
    if (!Number.isFinite(joinMs) || !Number.isFinite(donateMs)) continue;

    const seconds = Math.max(0, Math.floor((donateMs - joinMs) / 1000));
    players.push({
      player:       d.player,
      seconds,
      ref_join:     match.ref_join,
      first_donate: d.first_donate,
      match_mode:   match.mode,
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
