const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { db }  = require('../db');
const { JWT_SECRET, COOKIE_SECURE } = require('../config');
const { extractToken } = require('../middleware/auth');
const { findInvite, consumeInvite } = require('../lib/invites');

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   COOKIE_SECURE,
  sameSite: 'lax',
  maxAge:   30 * 24 * 60 * 60 * 1000,
  path:     '/',
};

function issueToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });
}

function sendAuth(res, token, username, isAdmin) {
  res.cookie('wea_token', token, COOKIE_OPTS);
  res.json({ token, username, isAdmin: !!isAdmin });
}

router.get('/me', (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare('SELECT id, username, is_admin, is_blocked FROM users WHERE id = ?')
      .get(payload.userId);

    if (!user || user.is_blocked) {
      return res.status(401).json({ error: 'Не авторизован' });
    }

    res.json({
      token,
      username: user.username,
      userId:   user.id,
      isAdmin:  !!user.is_admin,
    });
  } catch {
    res.status(401).json({ error: 'Токен недействителен' });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('wea_token', { path: '/', httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE });
  res.json({ ok: true });
});

router.post('/register', async (req, res) => {
  const { username, email, password, invite_code } = req.body;

  const invite = findInvite(invite_code);
  if (!invite) {
    return res.status(403).json({ error: 'Неверный или использованный код приглашения' });
  }

  if (!username?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });
  }

  try {
    const hash   = await bcrypt.hash(password, 12);
    const result = db
      .prepare('INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)')
      .run(username.trim(), email.trim().toLowerCase(), hash, invite.is_admin ? 1 : 0);

    consumeInvite(invite.id);

    const name  = username.trim();
    const token = issueToken(result.lastInsertRowid, name);
    sendAuth(res, token, name, invite.is_admin);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      const field = err.message.includes('email') ? 'Email' : 'Никнейм';
      return res.status(409).json({ error: `${field} уже занят` });
    }
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email?.trim() || !password) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }

  try {
    const user = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase());

    if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });
    if (user.is_blocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });

    const token = issueToken(user.id, user.username);
    sendAuth(res, token, user.username, user.is_admin);
  } catch {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
