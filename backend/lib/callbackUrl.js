const { PUBLIC_URL } = require('../config');

function getPublicOrigin(req) {
  if (PUBLIC_URL) return PUBLIC_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function buildDonateCallbackUrl(origin, webhookSecret, { includeToken = false } = {}) {
  const base = `${String(origin).replace(/\/$/, '')}/api/donate/callback`;
  if (includeToken && webhookSecret) {
    return `${base}?token=${encodeURIComponent(webhookSecret)}`;
  }
  return base;
}

module.exports = { getPublicOrigin, buildDonateCallbackUrl };
