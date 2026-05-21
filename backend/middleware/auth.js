const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

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
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Токен недействителен' });
  }
};

module.exports.extractToken = extractToken;
