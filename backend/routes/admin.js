const express = require('express');
const { db } = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const { generateInviteCode } = require('../lib/invites');

const router = express.Router();
router.use(requireAdmin);

router.get('/stats', (_req, res) => {
  const users   = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const servers = db.prepare('SELECT COUNT(*) AS n FROM servers').get().n;
  const events  = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  const donated = db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM donations').get().s;
  res.json({ users, servers, events, donated });
});

router.get('/users', (_req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.is_admin,
      u.is_blocked,
      u.created_at,
      (SELECT COUNT(*) FROM servers s WHERE s.user_id = u.id) AS server_count,
      (SELECT s.id FROM servers s WHERE s.user_id = u.id ORDER BY s.created_at DESC LIMIT 1) AS server_id,
      (SELECT s.name FROM servers s WHERE s.user_id = u.id ORDER BY s.created_at DESC LIMIT 1) AS server_name
    FROM users u
    ORDER BY u.created_at DESC
  `).all();
  res.json(rows);
});

router.patch('/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const target = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  if (id === req.user.userId && req.body.is_admin === false) {
    return res.status(400).json({ error: 'Нельзя снять админку с себя' });
  }
  if (id === req.user.userId && req.body.is_blocked === true) {
    return res.status(400).json({ error: 'Нельзя заблокировать себя' });
  }

  const is_admin   = req.body.is_admin   !== undefined ? (req.body.is_admin ? 1 : 0) : target.is_admin;
  const is_blocked = req.body.is_blocked !== undefined ? (req.body.is_blocked ? 1 : 0) : undefined;

  if (is_blocked !== undefined) {
    db.prepare('UPDATE users SET is_admin = ?, is_blocked = ? WHERE id = ?')
      .run(is_admin, is_blocked, id);
  } else {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin, id);
  }

  res.json({ ok: true });
});

router.get('/invites', (_req, res) => {
  const rows = db.prepare(`
    SELECT
      i.id,
      i.code,
      i.is_admin,
      i.max_uses,
      i.uses_count,
      i.note,
      i.created_at,
      i.expires_at,
      u.username AS created_by_name
    FROM invite_codes i
    LEFT JOIN users u ON u.id = i.created_by
    ORDER BY i.created_at DESC
  `).all();
  res.json(rows);
});

router.post('/invites', (req, res) => {
  const is_admin = req.body.is_admin ? 1 : 0;
  const max_uses = Math.max(1, Math.min(parseInt(req.body.max_uses, 10) || 1, 100));
  const note     = String(req.body.note || '').trim().slice(0, 200);
  const code     = generateInviteCode();

  const result = db.prepare(`
    INSERT INTO invite_codes (code, is_admin, max_uses, note, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(code, is_admin, max_uses, note, req.user.userId);

  res.json({
    id:         result.lastInsertRowid,
    code,
    is_admin:   !!is_admin,
    max_uses,
    uses_count: 0,
    note,
  });
});

router.get('/servers/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const row = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.api_key,
      s.created_at,
      u.id AS owner_id,
      u.username AS owner_username
    FROM servers s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(id);

  if (!row) return res.status(404).json({ error: 'Сервер не найден' });

  res.json({
    id:             row.id,
    name:           row.name,
    api_key:        row.api_key,
    created_at:     row.created_at,
    owner_id:       row.owner_id,
    owner_username: row.owner_username,
  });
});

router.delete('/invites/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT uses_count FROM invite_codes WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Код не найден' });
  if (row.uses_count > 0) {
    return res.status(409).json({ error: 'Код уже использован — удалить нельзя' });
  }
  db.prepare('DELETE FROM invite_codes WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
