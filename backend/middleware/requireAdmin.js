const { db } = require('../db');
const auth = require('./auth');

module.exports = function requireAdmin(req, res, next) {
  auth(req, res, () => {
    const user = db
      .prepare('SELECT is_admin, is_blocked FROM users WHERE id = ?')
      .get(req.user.userId);

    if (!user || user.is_blocked) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (!user.is_admin) {
      return res.status(403).json({ error: 'Только для администратора' });
    }
    next();
  });
};
