const express = require('express');
const { db }  = require('../db');
const { utcNowSql } = require('../lib/datetime');

const router = express.Router();

function getWebhookSecret(req) {
  const header = req.headers['x-webhook-secret'];
  if (header && String(header).trim()) return String(header).trim();
  const query = req.query.token;
  if (query && String(query).trim()) return String(query).trim();
  return null;
}

router.post('/callback', (req, res) => {
  const secret = getWebhookSecret(req);
  if (!secret) {
    return res.status(401).json({ error: 'Webhook secret required (header X-Webhook-Secret)' });
  }

  const server = db.prepare('SELECT * FROM servers WHERE webhook_secret = ?').get(secret);
  if (!server) return res.status(403).json({ error: 'Invalid webhook secret' });

  const body = req.body || {};
  const payment_id = body.payment_id;
  const customer   = body.customer;
  const cost       = body.cost;
  const products   = body.products;

  if (payment_id == null || cost == null) {
    return res.status(400).json({ error: 'payment_id and cost required' });
  }

  const exists = db.prepare(
    'SELECT id FROM donations WHERE server_id = ? AND payment_id = ?'
  ).get(server.id, String(payment_id));
  if (exists) return res.json({ ok: true, duplicate: true });

  const lastJoin = customer
    ? db.prepare(`
        SELECT subdomain FROM events
        WHERE server_id = ? AND LOWER(player_name) = LOWER(?)
        ORDER BY joined_at DESC LIMIT 1
      `).get(server.id, String(customer))
    : null;

  db.prepare(`
    INSERT INTO donations (server_id, subdomain, player, amount, payment_id, products, donated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    server.id,
    lastJoin?.subdomain ?? null,
    customer ? String(customer).slice(0, 64) : null,
    parseFloat(cost) || 0,
    String(payment_id).slice(0, 128),
    products ? JSON.stringify(products) : null,
    utcNowSql()
  );

  res.json({ ok: true });
});

module.exports = router;
