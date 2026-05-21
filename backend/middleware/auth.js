const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { db } = require('../db');

function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  if (req.cookies?.wea_token) {
    return req.cookies.wea_token;
  }
  return null;
}

module.exports = (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare('SELECT id, username, is_admin, is_blocked FROM users WHERE id = ?')
      .get(payload.userId);

    if (!user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    if (user.is_blocked) {
      return res.status(403).json({ error: 'Аккаунт заблокирован' });
    }

    req.user = {
      userId:  user.id,
      username: user.username,
      isAdmin: !!user.is_admin,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Токен недействителен' });
  }
};

module.exports.extractToken = extractToken;
