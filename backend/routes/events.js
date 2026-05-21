const express = require('express');
const { db }  = require('../db');
const { normalizeSubdomain } = require('../lib/subdomain');

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

  db.prepare(
    'INSERT INTO events (server_id, subdomain, player_uuid, player_name) VALUES (?, ?, ?, ?)'
  ).run(server.id, subdomain, req.body.player_uuid || null, req.body.player_name || null);

  res.json({ ok: true, subdomain });
});

module.exports = router;
