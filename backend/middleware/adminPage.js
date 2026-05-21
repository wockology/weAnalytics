const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { JWT_SECRET } = require('../config');
const { extractToken } = require('./auth');

module.exports = function adminPage(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.redirect('/login.html');

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare('SELECT is_admin, is_blocked FROM users WHERE id = ?')
      .get(payload.userId);

    if (!user || user.is_blocked || !user.is_admin) {
      return res.redirect('/dashboard.html');
    }
    next();
  } catch {
    res.clearCookie('wea_token', { path: '/', httpOnly: true, sameSite: 'lax' });
    return res.redirect('/login.html');
  }
};
