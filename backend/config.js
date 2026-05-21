require('dotenv').config();

const DEV_SECRETS = new Set([
  'dev-secret-change-me',
  'change-this-to-a-long-random-secret-in-production',
]);

function requireSecret(name, minLen = 16) {
  const value = process.env[name];
  if (!value || value.length < minLen || DEV_SECRETS.has(value)) {
    console.error(`[security] ${name} must be set in .env (${minLen}+ chars). Example: openssl rand -hex 32`);
    process.exit(1);
  }
  return value;
}

const JWT_SECRET = requireSecret('JWT_SECRET', 32);
const REGISTER_SECRET = requireSecret('REGISTER_SECRET', 8);

module.exports = {
  JWT_SECRET,
  REGISTER_SECRET,
  PORT: parseInt(process.env.PORT || '3000', 10),
  TRUST_PROXY: process.env.TRUST_PROXY === '1',
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
  PUBLIC_URL: process.env.PUBLIC_URL?.replace(/\/$/, '') || null,
};
