const express = require('express');
const { db } = require('../db');
const { isServerOwner } = require('../lib/serverAccess');

const router = express.Router({ mergeParams: true });

const DEFAULT_PARTNER_FLAGS = 1;

function parseFlag(value, fallback = DEFAULT_PARTNER_FLAGS) {
  if (value === undefined) return fallback;
  return value ? 1 : 0;
}

function mapPartnerRow(row) {
  return {
    id:                        row.id,
    username:                  row.username,
    can_view_revenue:          !!row.can_view_revenue,
    can_view_donate_analytics: !!row.can_view_donate_analytics,
    can_view_integrations:     !!row.can_view_integrations,
    created_at:                row.created_at,
  };
}

router.get('/', (req, res) => {
  const serverId = parseInt(req.params.id, 10);
  if (!isServerOwner(serverId, req.user.userId)) {
    return res.status(403).json({ error: 'Только владелец сервера' });
  }

  const rows = db.prepare(`
    SELECT
      sp.id,
      sp.can_view_revenue,
      sp.can_view_donate_analytics,
      sp.can_view_integrations,
      sp.created_at,
      u.username
    FROM server_partners sp
    JOIN users u ON u.id = sp.partner_user_id
    WHERE sp.server_id = ?
    ORDER BY sp.created_at DESC
  `).all(serverId);

  res.json(rows.map(mapPartnerRow));
});

router.post('/', (req, res) => {
  const serverId = parseInt(req.params.id, 10);
  if (!isServerOwner(serverId, req.user.userId)) {
    return res.status(403).json({ error: 'Только владелец сервера' });
  }

  const username = String(req.body?.username || '').trim();
  if (!username) return res.status(400).json({ error: 'Укажите username партнёра' });

  const partnerUser = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!partnerUser) return res.status(404).json({ error: 'Пользователь не найден' });
  if (partnerUser.id === req.user.userId) {
    return res.status(400).json({ error: 'Нельзя добавить себя партнёром' });
  }

  const server = db.prepare('SELECT user_id FROM servers WHERE id = ?').get(serverId);
  if (server?.user_id === partnerUser.id) {
    return res.status(400).json({ error: 'Владелец сервера не может быть партнёром' });
  }

  const exists = db.prepare(`
    SELECT id FROM server_partners WHERE server_id = ? AND partner_user_id = ?
  `).get(serverId, partnerUser.id);
  if (exists) return res.status(409).json({ error: 'Партнёр уже добавлен' });

  const result = db.prepare(`
    INSERT INTO server_partners (
      server_id,
      partner_user_id,
      can_view_revenue,
      can_view_donate_analytics,
      can_view_integrations
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    serverId,
    partnerUser.id,
    parseFlag(req.body.can_view_revenue, DEFAULT_PARTNER_FLAGS),
    parseFlag(req.body.can_view_donate_analytics, DEFAULT_PARTNER_FLAGS),
    parseFlag(req.body.can_view_integrations, DEFAULT_PARTNER_FLAGS)
  );

  const row = db.prepare(`
    SELECT
      sp.id,
      sp.can_view_revenue,
      sp.can_view_donate_analytics,
      sp.can_view_integrations,
      sp.created_at,
      u.username
    FROM server_partners sp
    JOIN users u ON u.id = sp.partner_user_id
    WHERE sp.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(mapPartnerRow(row));
});

router.patch('/:partnerId', (req, res) => {
  const serverId = parseInt(req.params.id, 10);
  const partnerId = parseInt(req.params.partnerId, 10);
  if (!isServerOwner(serverId, req.user.userId)) {
    return res.status(403).json({ error: 'Только владелец сервера' });
  }

  const existing = db.prepare(`
    SELECT * FROM server_partners WHERE id = ? AND server_id = ?
  `).get(partnerId, serverId);
  if (!existing) return res.status(404).json({ error: 'Партнёр не найден' });

  db.prepare(`
    UPDATE server_partners
    SET
      can_view_revenue = ?,
      can_view_donate_analytics = ?,
      can_view_integrations = ?
    WHERE id = ?
  `).run(
    req.body.can_view_revenue !== undefined
      ? parseFlag(req.body.can_view_revenue, 0)
      : existing.can_view_revenue,
    req.body.can_view_donate_analytics !== undefined
      ? parseFlag(req.body.can_view_donate_analytics, 0)
      : existing.can_view_donate_analytics,
    req.body.can_view_integrations !== undefined
      ? parseFlag(req.body.can_view_integrations, 0)
      : existing.can_view_integrations,
    partnerId
  );

  const row = db.prepare(`
    SELECT
      sp.id,
      sp.can_view_revenue,
      sp.can_view_donate_analytics,
      sp.can_view_integrations,
      sp.created_at,
      u.username
    FROM server_partners sp
    JOIN users u ON u.id = sp.partner_user_id
    WHERE sp.id = ?
  `).get(partnerId);

  res.json(mapPartnerRow(row));
});

router.delete('/:partnerId', (req, res) => {
  const serverId = parseInt(req.params.id, 10);
  const partnerId = parseInt(req.params.partnerId, 10);
  if (!isServerOwner(serverId, req.user.userId)) {
    return res.status(403).json({ error: 'Только владелец сервера' });
  }

  const result = db.prepare(`
    DELETE FROM server_partners WHERE id = ? AND server_id = ?
  `).run(partnerId, serverId);

  if (!result.changes) return res.status(404).json({ error: 'Партнёр не найден' });
  res.json({ ok: true });
});

module.exports = router;
