const { db } = require('../db');

const FULL_PERMISSIONS = {
  can_view_revenue:          true,
  can_view_donate_analytics: true,
  can_view_integrations:     true,
};

function isAdminUser(userId) {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  return !!(row && row.is_admin);
}

function getOwnerUsername(userId) {
  return db.prepare('SELECT username FROM users WHERE id = ?').get(userId)?.username || null;
}

function getServerForUser(serverId, userId) {
  const access = getServerAccess(serverId, userId);
  return access?.server || null;
}

function getServerAccess(serverId, userId) {
  const id = parseInt(serverId, 10);
  if (!id) return null;

  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!server) return null;

  if (isAdminUser(userId)) {
    return {
      server,
      role:           'admin',
      permissions:    { ...FULL_PERMISSIONS },
      owner_username: getOwnerUsername(server.user_id),
    };
  }

  if (server.user_id === userId) {
    return {
      server,
      role:        'owner',
      permissions: { ...FULL_PERMISSIONS },
    };
  }

  const partner = db.prepare(`
    SELECT *
    FROM server_partners
    WHERE server_id = ? AND partner_user_id = ?
  `).get(id, userId);

  if (!partner) return null;

  return {
    server,
    role:           'partner',
    partner_id:     partner.id,
    permissions: {
      can_view_revenue:          !!partner.can_view_revenue,
      can_view_donate_analytics: !!partner.can_view_donate_analytics,
      can_view_integrations:     !!partner.can_view_integrations,
    },
    owner_username: getOwnerUsername(server.user_id),
  };
}

function isServerOwner(serverId, userId) {
  const access = getServerAccess(serverId, userId);
  return access?.role === 'owner';
}

module.exports = {
  isAdminUser,
  getServerForUser,
  getServerAccess,
  isServerOwner,
  FULL_PERMISSIONS,
};
