const { db } = require('../db');

const SESSION_MS = 30 * 60 * 1000;

function parseUtcMs(value) {
  if (value == null) return NaN;
  const s = String(value).trim();
  const normalized = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  return new Date(normalized).getTime();
}

function playerKey(row) {
  const uuid = row.player_uuid && String(row.player_uuid).trim();
  if (uuid) return `u:${uuid.toLowerCase()}`;
  const name = row.player_name && String(row.player_name).trim().toLowerCase();
  if (name) return `n:${name.slice(0, 64)}`;
  return null;
}

function mergeSessions(joinsMs) {
  if (!joinsMs.length) return [];
  const sorted = [...joinsMs].sort((a, b) => a - b);
  const intervals = [];
  let start = sorted[0];
  let end = start + SESSION_MS;

  for (let i = 1; i < sorted.length; i += 1) {
    const join = sorted[i];
    if (join <= end) {
      end = Math.max(end, join + SESSION_MS);
    } else {
      intervals.push([start, end]);
      start = join;
      end = join + SESSION_MS;
    }
  }
  intervals.push([start, end]);
  return intervals;
}

function countActivePlayers(serverId, period, since, todayUtc) {
  if (period === 'day') {
    return db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM (
        SELECT 1
        FROM events
        WHERE server_id = ?
          AND date(joined_at) = ?
          AND (
            (player_uuid IS NOT NULL AND TRIM(player_uuid) != '')
            OR (player_name IS NOT NULL AND TRIM(player_name) != '')
          )
        GROUP BY CASE
          WHEN player_uuid IS NOT NULL AND TRIM(player_uuid) != ''
            THEN 'u:' || LOWER(TRIM(player_uuid))
          ELSE 'n:' || LOWER(TRIM(player_name))
        END
      )
    `).get(serverId, todayUtc).cnt;
  }

  return db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT 1
      FROM events
      WHERE server_id = ?
        AND joined_at >= ?
        AND (
          (player_uuid IS NOT NULL AND TRIM(player_uuid) != '')
          OR (player_name IS NOT NULL AND TRIM(player_name) != '')
        )
      GROUP BY CASE
        WHEN player_uuid IS NOT NULL AND TRIM(player_uuid) != ''
          THEN 'u:' || LOWER(TRIM(player_uuid))
        ELSE 'n:' || LOWER(TRIM(player_name))
      END
    )
  `).get(serverId, since).cnt;
}

function countDonators(serverId, period, since, todayUtc) {
  if (period === 'day') {
    return db.prepare(`
      SELECT COUNT(DISTINCT LOWER(TRIM(player))) AS cnt
      FROM donations
      WHERE server_id = ?
        AND date(donated_at) = ?
        AND player IS NOT NULL
        AND TRIM(player) != ''
    `).get(serverId, todayUtc).cnt;
  }

  return db.prepare(`
    SELECT COUNT(DISTINCT LOWER(TRIM(player))) AS cnt
    FROM donations
    WHERE server_id = ?
      AND donated_at >= ?
      AND player IS NOT NULL
      AND TRIM(player) != ''
  `).get(serverId, since).cnt;
}

function buildAvgSessionSeconds(serverId, period, since, todayUtc) {
  const sinceMs = parseUtcMs(since);
  if (!Number.isFinite(sinceMs)) return { avg_session_seconds: null, session_count: 0 };

  const lookbackSql = new Date(sinceMs - SESSION_MS).toISOString().slice(0, 19).replace('T', ' ');

  const rows = period === 'day'
    ? db.prepare(`
        SELECT player_uuid, player_name, joined_at
        FROM events
        WHERE server_id = ?
          AND joined_at >= ?
          AND date(joined_at) = ?
        ORDER BY joined_at ASC
      `).all(serverId, lookbackSql, todayUtc)
    : db.prepare(`
        SELECT player_uuid, player_name, joined_at
        FROM events
        WHERE server_id = ?
          AND joined_at >= ?
        ORDER BY joined_at ASC
      `).all(serverId, lookbackSql);

  const joinsByPlayer = new Map();
  rows.forEach(row => {
    const key = playerKey(row);
    const joinMs = parseUtcMs(row.joined_at);
    if (!key || !Number.isFinite(joinMs)) return;
    if (!joinsByPlayer.has(key)) joinsByPlayer.set(key, []);
    joinsByPlayer.get(key).push(joinMs);
  });

  let totalMs = 0;
  let sessionCount = 0;

  joinsByPlayer.forEach(joins => {
    mergeSessions(joins).forEach(([start, end]) => {
      if (start >= sinceMs) {
        totalMs += end - start;
        sessionCount += 1;
      }
    });
  });

  return {
    avg_session_seconds: sessionCount > 0 ? Math.round(totalMs / sessionCount / 1000) : null,
    session_count: sessionCount,
  };
}

function buildPeriodEngagement(serverId, period, since, todayUtc) {
  const activePlayers = countActivePlayers(serverId, period, since, todayUtc);
  const donators = countDonators(serverId, period, since, todayUtc);
  const { avg_session_seconds, session_count } = buildAvgSessionSeconds(
    serverId,
    period,
    since,
    todayUtc
  );

  const donatorPct = activePlayers > 0
    ? Math.round((donators / activePlayers) * 1000) / 10
    : null;

  return {
    avg_session_seconds,
    session_count,
    active_players: activePlayers,
    donators,
    donator_pct: donatorPct,
  };
}

module.exports = {
  SESSION_MS,
  buildPeriodEngagement,
};
