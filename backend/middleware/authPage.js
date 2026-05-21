const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { extractToken } = require('./auth');

module.exports = function authPage(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.redirect('/login.html');
  }
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('wea_token', { path: '/', httpOnly: true, sameSite: 'lax' });
    return res.redirect('/login.html');
  }
};
