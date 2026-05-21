const { db } = require('../db');

const SESSION_MS = 30 * 60 * 1000;
const SAMPLE_MS  = 5 * 60 * 1000;

function parseUtcMs(value) {
  if (value == null) return NaN;
  const s = String(value).trim();
  const normalized = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  return new Date(normalized).getTime();
}

function formatPointLabel(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function playerKey(row) {
  if (row.player_uuid) return `u:${row.player_uuid}`;
  if (row.player_name) return `n:${row.player_name}`;
  return null;
}

function mergeSessions(joinsMs) {
  if (!joinsMs.length) return [];
  const sorted = [...joinsMs].sort((a, b) => a - b);
  const intervals = [];
  let start = sorted[0];
  let end = start + SESSION_MS;

  for (let i = 1; i < sorted.length; i++) {
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

function countOnlineAt(intervalsByPlayer, timeMs) {
  let count = 0;
  for (const intervals of intervalsByPlayer.values()) {
    for (const [start, end] of intervals) {
      if (timeMs >= start && timeMs < end) {
        count++;
        break;
      }
    }
  }
  return count;
}

function buildFromSnapshots(serverId, sinceSql) {
  const rows = db.prepare(`
    SELECT online_count, recorded_at
    FROM online_snapshots
    WHERE server_id = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(serverId, sinceSql);

  if (!rows.length) return null;

  const points = rows.map(row => ({
    online: row.online_count || 0,
    recorded_at: row.recorded_at,
    label: formatPointLabel(parseUtcMs(row.recorded_at)),
  }));

  let peakOnline = 0;
  let peakLabel = '—';
  points.forEach(point => {
    if (point.online >= peakOnline) {
      peakOnline = point.online;
      peakLabel = point.label;
    }
  });

  const last = points[points.length - 1];
  return {
    source:         'snapshots',
    session_minutes: null,
    points,
    peak_online:    peakOnline,
    peak_label:     peakLabel,
    current_online: last?.online ?? 0,
    current_label:  last?.label ?? '—',
  };
}

function buildEstimatedOnline(serverId, now = new Date()) {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - 24 * 3600000;
  const sinceMs = windowStartMs - SESSION_MS;
  const sinceSql = new Date(sinceMs).toISOString().slice(0, 19).replace('T', ' ');

  const snapshotResult = buildFromSnapshots(serverId, sinceSql);
  if (snapshotResult) return snapshotResult;

  const rows = db.prepare(`
    SELECT player_uuid, player_name, joined_at
    FROM events
    WHERE server_id = ? AND joined_at >= ?
    ORDER BY joined_at ASC
  `).all(serverId, sinceSql);

  const joinsByPlayer = new Map();
  rows.forEach(row => {
    const key = playerKey(row);
    const joinMs = parseUtcMs(row.joined_at);
    if (!key || Number.isNaN(joinMs)) return;
    if (!joinsByPlayer.has(key)) joinsByPlayer.set(key, []);
    joinsByPlayer.get(key).push(joinMs);
  });

  const intervalsByPlayer = new Map();
  joinsByPlayer.forEach((joins, key) => {
    intervalsByPlayer.set(key, mergeSessions(joins));
  });

  const sampleStartMs = Math.floor(windowStartMs / SAMPLE_MS) * SAMPLE_MS;
  const points = [];

  for (let t = sampleStartMs; t <= nowMs; t += SAMPLE_MS) {
    points.push({
      online: countOnlineAt(intervalsByPlayer, t),
      recorded_at: new Date(t).toISOString().slice(0, 19).replace('T', ' '),
      label: formatPointLabel(t),
    });
  }

  if (!points.length) {
    points.push({
      online: 0,
      recorded_at: new Date(nowMs).toISOString().slice(0, 19).replace('T', ' '),
      label: formatPointLabel(nowMs),
    });
  }

  let peakOnline = 0;
  let peakLabel = '—';
  points.forEach(point => {
    if (point.online >= peakOnline) {
      peakOnline = point.online;
      peakLabel = point.label;
    }
  });

  const last = points[points.length - 1];

  return {
    source:          'estimated',
    session_minutes: SESSION_MS / 60000,
    points,
    peak_online:     peakOnline,
    peak_label:      peakLabel,
    current_online:  last.online,
    current_label:   last.label,
  };
}

function buildDayOnline(serverId, now = new Date()) {
  return buildEstimatedOnline(serverId, now);
}

module.exports = { buildDayOnline };
