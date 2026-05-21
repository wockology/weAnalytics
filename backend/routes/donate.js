const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../db');
const auth    = require('../middleware/auth');

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
  const shopId     = body.shop_id;
  const customer   = body.customer;
  const cost       = body.cost;
  const products   = body.products;
  const signature  = body.signature;

  if (payment_id == null || cost == null) {
    return res.status(400).json({ error: 'payment_id and cost required' });
  }

  const cfg = db.prepare('SELECT shop_id, secret_key FROM donate_config WHERE server_id = ?').get(server.id);
  const shopConfigured = cfg?.shop_id && String(cfg.shop_id).trim();

  if (shopConfigured && shopId != null && String(shopId) !== String(cfg.shop_id)) {
    return res.status(403).json({ error: 'shop_id mismatch' });
  }

  if (shopConfigured) {
    if (!cfg.secret_key?.trim()) {
      return res.status(403).json({ error: 'Donate secret not configured' });
    }
    const hashString = [payment_id, cost, customer].join('@');
    const expected = crypto.createHmac('sha256', cfg.secret_key).update(hashString).digest('hex');
    if (!signature || signature.toLowerCase() !== expected.toLowerCase()) {
      return res.status(403).json({ error: 'Invalid signature' });
    }
  } else if (cfg?.secret_key?.trim()) {
    const hashString = [payment_id, cost, customer].join('@');
    const expected = crypto.createHmac('sha256', cfg.secret_key).update(hashString).digest('hex');
    if (!signature || signature.toLowerCase() !== expected.toLowerCase()) {
      return res.status(403).json({ error: 'Invalid signature' });
    }
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

// Auth: get donate config
router.get('/config/:serverId', auth, (req, res) => {
  const server = db
    .prepare('SELECT id FROM servers WHERE id = ? AND user_id = ?')
    .get(req.params.serverId, req.user.userId);
  if (!server) return res.status(404).json({ error: 'Not found' });

  const cfg = db.prepare('SELECT shop_id, secret_key FROM donate_config WHERE server_id = ?').get(server.id);
  res.json(cfg || { shop_id: '', secret_key: '' });
});

// Auth: save donate config
router.put('/config/:serverId', auth, (req, res) => {
  const server = db
    .prepare('SELECT id FROM servers WHERE id = ? AND user_id = ?')
    .get(req.params.serverId, req.user.userId);
  if (!server) return res.status(404).json({ error: 'Not found' });

  const shop_id    = String(req.body.shop_id    || '').trim();
  const secret_key = String(req.body.secret_key || '').trim();

  const exists = db.prepare('SELECT server_id FROM donate_config WHERE server_id = ?').get(server.id);
  if (exists) {
    db.prepare('UPDATE donate_config SET shop_id = ?, secret_key = ? WHERE server_id = ?')
      .run(shop_id, secret_key, server.id);
  } else {
    db.prepare('INSERT INTO donate_config (server_id, shop_id, secret_key) VALUES (?, ?, ?)')
      .run(server.id, shop_id, secret_key);
  }

  res.json({ ok: true });
});

// Auth: list donations for a server
router.get('/list/:serverId', auth, (req, res) => {
  const server = db
    .prepare('SELECT id FROM servers WHERE id = ? AND user_id = ?')
    .get(req.params.serverId, req.user.userId);
  if (!server) return res.status(404).json({ error: 'Not found' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT id, subdomain, player, amount, payment_id, donated_at
    FROM donations
    WHERE server_id = ?
    ORDER BY donated_at DESC
    LIMIT ?
  `).all(server.id, limit);

  res.json(rows);
});

module.exports = router;
