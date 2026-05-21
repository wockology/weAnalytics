const express = require('express');
const { db }  = require('../db');
const { normalizeSubdomain } = require('../lib/subdomain');
const { utcNowSql } = require('../lib/datetime');
const { ensureFirstJoin } = require('../lib/playerAttribution');

const router = express.Router();

router.post('/event', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key missing' });

  const server = db
    .prepare('SELECT id FROM servers WHERE api_key = ?')
    .get(apiKey);

  if (!server) return res.status(401).json({ error: 'Invalid API key' });

  const raw = req.body.subdomain ?? req.body.server;
  if (!raw) return res.status(400).json({ error: 'subdomain required' });

  const subdomain = normalizeSubdomain(raw);
  if (!subdomain) return res.status(400).json({ error: 'invalid server' });

  const joinedAt = utcNowSql();
  const playerUuid = req.body.player_uuid || null;
  const playerName = req.body.player_name || null;

  db.prepare(
    'INSERT INTO events (server_id, subdomain, player_uuid, player_name, joined_at) VALUES (?, ?, ?, ?, ?)'
  ).run(server.id, subdomain, playerUuid, playerName, joinedAt);

  ensureFirstJoin(server.id, subdomain, playerUuid, playerName, joinedAt);

  res.json({ ok: true, subdomain });
});

router.post('/online', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key missing' });

  const server = db
    .prepare('SELECT id FROM servers WHERE api_key = ?')
    .get(apiKey);

  if (!server) return res.status(401).json({ error: 'Invalid API key' });

  const online = Number.parseInt(req.body?.online, 10);
  if (!Number.isFinite(online) || online < 0) {
    return res.status(400).json({ error: 'online must be a non-negative integer' });
  }

  db.prepare(
    'INSERT INTO online_snapshots (server_id, online_count, recorded_at) VALUES (?, ?, ?)'
  ).run(server.id, online, utcNowSql());

  res.json({ ok: true, online });
});

module.exports = router;
