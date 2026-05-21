const crypto = require('crypto');
const { db } = require('../db');

function findInvite(code) {
  const row = db.prepare(`
    SELECT * FROM invite_codes
    WHERE code = ? AND uses_count < max_uses
  `).get(String(code).trim());

  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row;
}

function consumeInvite(inviteId) {
  db.prepare('UPDATE invite_codes SET uses_count = uses_count + 1 WHERE id = ?').run(inviteId);
}

function generateInviteCode() {
  return crypto.randomBytes(12).toString('hex');
}

function seedBootstrapInvite(code) {
  if (!code?.trim()) return;
  const existing = db.prepare('SELECT id FROM invite_codes WHERE code = ?').get(code.trim());
  if (existing) return;
  db.prepare(`
    INSERT INTO invite_codes (code, is_admin, max_uses, uses_count, note)
    VALUES (?, 1, 1, 0, 'Первый админ (из REGISTER_SECRET)')
  `).run(code.trim());
}

module.exports = {
  findInvite,
  consumeInvite,
  generateInviteCode,
  seedBootstrapInvite,
};
