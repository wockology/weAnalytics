const { db } = require('../db');

function isAdminUser(userId) {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  return !!(row && row.is_admin);
}

/** Server row if the user owns it or is admin; otherwise null. */
function getServerForUser(serverId, userId) {
  const id = parseInt(serverId, 10);
  if (!id) return null;

  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!server) return null;
  if (server.user_id === userId) return server;
  if (isAdminUser(userId)) return server;
  return null;
}

module.exports = { isAdminUser, getServerForUser };
