const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const helmet  = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { db, init } = require('./db');
const { PORT, TRUST_PROXY } = require('./config');
const authPage = require('./middleware/authPage');
const adminPage = require('./middleware/adminPage');
const { seedBootstrapInvite } = require('./lib/invites');
const { REGISTER_SECRET } = require('./config');

const ROOT = path.join(__dirname, '..');

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      scriptSrcElem:  ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      styleSrcElem:   ["'self'"],
      imgSrc:         ["'self'", 'data:'],
      connectSrc:     ["'self'"],
      fontSrc:        ["'self'", 'https://cdn.jsdelivr.net'],
      frameSrc:       ["'none'"],
      objectSrc:      ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cookieParser());
app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (
    p.startsWith('/backend') ||
    p.includes('/data/') ||
    p.endsWith('.db') ||
    p.endsWith('.env')
  ) {
    return res.sendStatus(404);
  }
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Подождите 15 минут.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток регистрации.' },
});

const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    const key = req.headers['x-api-key'];
    return key ? `key:${String(key)}` : `ip:${req.ip}`;
  },
  message: { error: 'Rate limit exceeded' },
});

const donateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' },
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Подождите.' },
});

const serversLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Подождите.' },
});

init().then(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS servers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      name            TEXT NOT NULL,
      api_key         TEXT NOT NULL UNIQUE,
      webhook_secret  TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id   INTEGER NOT NULL,
      subdomain   TEXT NOT NULL,
      player_uuid TEXT,
      player_name TEXT,
      joined_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS donate_config (
      server_id  INTEGER PRIMARY KEY,
      shop_id    TEXT NOT NULL DEFAULT '',
      secret_key TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS donations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id  INTEGER NOT NULL,
      subdomain  TEXT,
      player     TEXT,
      amount     REAL NOT NULL DEFAULT 0,
      payment_id TEXT,
      products   TEXT,
      donated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_events_server   ON events(server_id);
    CREATE INDEX IF NOT EXISTS idx_events_joined   ON events(joined_at);
    CREATE INDEX IF NOT EXISTS idx_events_sub      ON events(subdomain);
    CREATE INDEX IF NOT EXISTS idx_events_player   ON events(player_name);
    CREATE INDEX IF NOT EXISTS idx_donations_srv   ON donations(server_id);
    CREATE INDEX IF NOT EXISTS idx_donations_sub   ON donations(subdomain);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_pid ON donations(server_id, payment_id);
    CREATE TABLE IF NOT EXISTS invite_codes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT NOT NULL UNIQUE,
      is_admin    INTEGER NOT NULL DEFAULT 0,
      max_uses    INTEGER NOT NULL DEFAULT 1,
      uses_count  INTEGER NOT NULL DEFAULT 0,
      note        TEXT,
      created_by  INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at  DATETIME
    );
    CREATE TABLE IF NOT EXISTS server_partners (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id                 INTEGER NOT NULL,
      partner_user_id           INTEGER NOT NULL,
      can_view_revenue          INTEGER NOT NULL DEFAULT 1,
      can_view_donate_analytics INTEGER NOT NULL DEFAULT 1,
      can_view_integrations     INTEGER NOT NULL DEFAULT 1,
      created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, partner_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_server_partners_server  ON server_partners(server_id);
    CREATE INDEX IF NOT EXISTS idx_server_partners_partner ON server_partners(partner_user_id);
    CREATE TABLE IF NOT EXISTS online_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id    INTEGER NOT NULL,
      online_count INTEGER NOT NULL,
      recorded_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_online_snapshots_server_time ON online_snapshots(server_id, recorded_at);
  `);

  try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN webhook_secret TEXT'); } catch {}

  db.exec(`
    UPDATE server_partners
    SET
      can_view_revenue = 1,
      can_view_donate_analytics = 1,
      can_view_integrations = 1
    WHERE can_view_revenue = 0
      AND can_view_donate_analytics = 0
      AND can_view_integrations = 0
  `);

  const missingHooks = db.prepare(
    'SELECT id FROM servers WHERE webhook_secret IS NULL OR webhook_secret = ""'
  ).all();
  const setHook = db.prepare('UPDATE servers SET webhook_secret = ? WHERE id = ?');
  for (const row of missingHooks) {
    setHook.run(`wea_hook_${crypto.randomBytes(18).toString('hex')}`, row.id);
  }

  seedBootstrapInvite(REGISTER_SECRET);

  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth/register', registerLimiter);
  app.use('/api/event', eventLimiter);
  app.use('/api/donate/callback', donateLimiter);
  app.use('/api/admin', adminLimiter);
  app.use('/api/servers', serversLimiter);

  app.use('/api/auth',    require('./routes/auth'));
  app.use('/api/admin',   require('./routes/admin'));
  app.use('/api/servers', require('./routes/servers'));
  app.use('/api/donate',  require('./routes/donate'));
  app.use('/api',         require('./routes/events'));

  app.use('/assets', express.static(path.join(ROOT, 'assets'), { maxAge: '7d' }));

  app.get('/', (_req, res) => res.redirect('/login.html'));
  app.get('/login.html', (_req, res) => res.sendFile(path.join(ROOT, 'login.html')));
  app.get('/register.html', (_req, res) => res.sendFile(path.join(ROOT, 'register.html')));
  app.get('/dashboard.html', authPage, (_req, res) => res.sendFile(path.join(ROOT, 'dashboard.html')));
  app.get('/admin.html', adminPage, (_req, res) => res.sendFile(path.join(ROOT, 'admin.html')));

  app.use((_req, res) => res.sendStatus(404));

  app.listen(PORT, () => {
    console.log(`weAnalytics → http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
