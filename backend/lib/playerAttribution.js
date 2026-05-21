const { db } = require('../db');
const { normalizeSubdomain } = require('./subdomain');

function buildPlayerKey(playerUuid, playerName) {
  const uuid = playerUuid && String(playerUuid).trim();
  if (uuid) return `u:${uuid.toLowerCase()}`;
  const name = playerName && String(playerName).trim().toLowerCase();
  if (name) return `n:${name.slice(0, 64)}`;
  return null;
}

function ensureFirstJoin(serverId, subdomain, playerUuid, playerName, joinedAt) {
  const playerKey = buildPlayerKey(playerUuid, playerName);
  if (!playerKey) return false;

  const result = db.prepare(`
    INSERT OR IGNORE INTO player_attribution (
      server_id, player_key, player_uuid, player_name, subdomain, first_joined_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    serverId,
    playerKey,
    playerUuid ? String(playerUuid).trim() : null,
    playerName ? String(playerName).trim().slice(0, 64) : null,
    subdomain,
    joinedAt
  );

  return result.changes > 0;
}

function getAttributedSubdomain(serverId, playerUuid, playerName) {
  const playerKey = buildPlayerKey(playerUuid, playerName);
  if (playerKey) {
    const row = db.prepare(`
      SELECT subdomain FROM player_attribution
      WHERE server_id = ? AND player_key = ?
    `).get(serverId, playerKey);
    if (row?.subdomain) return row.subdomain;
  }

  const name = playerName && String(playerName).trim();
  if (!name) return null;

  const byName = db.prepare(`
    SELECT subdomain FROM player_attribution
    WHERE server_id = ? AND player_name IS NOT NULL AND LOWER(player_name) = LOWER(?)
    LIMIT 1
  `).get(serverId, name);

  return byName?.subdomain ?? null;
}

function backfillFromEvents() {
  db.exec(`
    INSERT OR IGNORE INTO player_attribution (
      server_id, player_key, player_uuid, player_name, subdomain, first_joined_at
    )
    SELECT
      server_id,
      player_key,
      player_uuid,
      player_name,
      subdomain,
      first_joined_at
    FROM (
      SELECT
        server_id,
        CASE
          WHEN player_uuid IS NOT NULL AND TRIM(player_uuid) != ''
            THEN 'u:' || LOWER(TRIM(player_uuid))
          ELSE 'n:' || LOWER(TRIM(player_name))
        END AS player_key,
        NULLIF(TRIM(player_uuid), '') AS player_uuid,
        NULLIF(TRIM(player_name), '') AS player_name,
        LOWER(TRIM(subdomain)) AS subdomain,
        joined_at AS first_joined_at,
        ROW_NUMBER() OVER (
          PARTITION BY server_id,
            CASE
              WHEN player_uuid IS NOT NULL AND TRIM(player_uuid) != ''
                THEN 'u:' || LOWER(TRIM(player_uuid))
              ELSE 'n:' || LOWER(TRIM(player_name))
            END
          ORDER BY joined_at ASC, id ASC
        ) AS rn
      FROM events
      WHERE player_uuid IS NOT NULL AND TRIM(player_uuid) != ''
         OR (player_name IS NOT NULL AND TRIM(player_name) != '')
    )
    WHERE rn = 1
  `);
}

function countUniquePlayers(serverId, { day, since } = {}) {
  if (day) {
    return db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM player_attribution
      WHERE server_id = ? AND date(first_joined_at) = ?
    `).get(serverId, day).cnt;
  }
  if (since) {
    return db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM player_attribution
      WHERE server_id = ? AND first_joined_at >= ?
    `).get(serverId, since).cnt;
  }
  return db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM player_attribution
    WHERE server_id = ?
  `).get(serverId).cnt;
}

function uniqueCountsBySubdomain(serverId, todayUtc, weekAgo) {
  const rows = db.prepare(`
    SELECT
      LOWER(TRIM(subdomain)) AS subdomain,
      COUNT(CASE WHEN date(first_joined_at) = ? THEN 1 END) AS today_unique,
      COUNT(CASE WHEN first_joined_at >= ? THEN 1 END) AS week_unique,
      COUNT(*) AS total_unique
    FROM player_attribution
    WHERE server_id = ?
    GROUP BY LOWER(TRIM(subdomain))
  `).all(todayUtc, weekAgo, serverId);

  const map = new Map();
  for (const row of rows) {
    const key = normalizeSubdomain(row.subdomain);
    if (!key) continue;
    map.set(key, {
      today_unique: row.today_unique || 0,
      week_unique: row.week_unique || 0,
      total_unique: row.total_unique || 0,
    });
  }
  return map;
}

function uniqueCountsByDay(serverId, since) {
  const rows = db.prepare(`
    SELECT date(first_joined_at) AS day, COUNT(*) AS cnt
    FROM player_attribution
    WHERE server_id = ? AND first_joined_at >= ?
    GROUP BY day
  `).all(serverId, since);

  const map = {};
  for (const row of rows) {
    map[row.day] = row.cnt;
  }
  return map;
}

function deleteForServer(serverId) {
  db.prepare('DELETE FROM player_attribution WHERE server_id = ?').run(serverId);
}

module.exports = {
  buildPlayerKey,
  ensureFirstJoin,
  getAttributedSubdomain,
  backfillFromEvents,
  countUniquePlayers,
  uniqueCountsBySubdomain,
  uniqueCountsByDay,
  deleteForServer,
};
