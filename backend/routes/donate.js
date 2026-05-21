const express = require('express');
const { db }  = require('../db');

const router = express.Router();

// Public: EasyDonate webhook
// URL: POST /api/donate/callback?key=SERVER_API_KEY
router.post('/callback', (req, res) => {
  const apiKey = req.query.key;
  if (!apiKey) return res.status(400).json({ error: 'key required' });

  const server = db.prepare('SELECT * FROM servers WHERE api_key = ?').get(apiKey);
  if (!server) return res.status(403).json({ error: 'Invalid key' });

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
    INSERT INTO donations (server_id, subdomain, player, amount, payment_id, products)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    server.id,
    lastJoin?.subdomain ?? null,
    customer ? String(customer) : null,
    parseFloat(cost) || 0,
    String(payment_id),
    products ? JSON.stringify(products) : null
  );

  res.json({ ok: true });
});

module.exports = router;
