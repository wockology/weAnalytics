let username = sessionStorage.getItem('wea_username') || localStorage.getItem('wea_username') || '';
let isAdmin  = false;
let viewAsServerId = null;

async function ensureSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) {
      window.location.href = 'login.html';
      return false;
    }
    const data = await res.json();
    username = data.username;
    sessionStorage.setItem('wea_username', username);
    localStorage.removeItem('wea_token');
    sessionStorage.removeItem('wea_token');
    isAdmin = !!data.isAdmin;
    if (isAdmin) sessionStorage.setItem('wea_is_admin', '1');
    else sessionStorage.removeItem('wea_is_admin');
    const adminSlot = document.getElementById('adminNavSlot');
    if (adminSlot) adminSlot.hidden = !isAdmin;
    return true;
  } catch {
    window.location.href = 'login.html';
    return false;
  }
}

let servers       = [];
let currentServer = null;
let currentAccess = null;
let currentPage   = 'overview';
let lastData      = null;
let statsPeriod   = 'day';

const SUBDOMAIN_INITIAL_COUNT = 10;
const SUBDOMAIN_LOAD_MORE_STEP = 10;
let subdomainVisibleLimit = SUBDOMAIN_INITIAL_COUNT;
let subdomainSearchQuery = '';
let heatmapMetric = 'total';

const REFRESH_INTERVAL_MS = 45 * 1000;
const DASHBOARD_TZ = 'Europe/Moscow';

let refreshTimer = null;
let statsLoading = false;

function formatChartTime(value) {
  const ms = typeof value === 'number'
    ? value
    : parseDbTime(value)?.getTime();
  if (ms == null || Number.isNaN(ms)) return '—';
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone:   DASHBOARD_TZ,
    hour:       '2-digit',
    minute:     '2-digit',
    hour12:     false,
  }).formatToParts(new Date(ms));
  const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

function updateDashUpdatedAt() {
  const el = document.getElementById('dashUpdatedAt');
  if (!el) return;
  el.textContent = `Обновлено ${formatChartTime(Date.now())} MSK`;
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => { void refreshDashboard(false); }, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function refreshDashboard(manual = false) {
  if (!currentServer || statsLoading) return;
  const btn = document.getElementById('dashRefreshBtn');
  if (manual && btn) btn.classList.add('dash-refresh-btn--spin');
  statsLoading = true;
  try {
    await loadStats();
    updateDashUpdatedAt();
  } finally {
    statsLoading = false;
    btn?.classList.remove('dash-refresh-btn--spin');
  }
}

const STATS_PERIOD_LABELS = {
  day: {
    sessions:    'Сессии за день',
    players:     'Игроки за день',
    avgSession:  'Средняя сессия за день',
    donatorPct:  'Донатеры за день',
    donated:     'Донаты за день',
  },
  week: {
    sessions:    'Сессии за 7 дней',
    players:     'Игроки за 7 дней',
    avgSession:  'Средняя сессия за 7 дней',
    donatorPct:  'Донатеры за 7 дней',
    donated:     'Донаты за 7 дней',
  },
  month: {
    sessions:    'Сессии за месяц',
    players:     'Игроки за месяц',
    avgSession:  'Средняя сессия за месяц',
    donatorPct:  'Донатеры за месяц',
    donated:     'Донаты за месяц',
  },
  year: {
    sessions:    'Сессии за год',
    players:     'Игроки за год',
    avgSession:  'Средняя сессия за год',
    donatorPct:  'Донатеры за год',
    donated:     'Донаты за год',
  },
};

const INSIGHT_LABELS = {
  day:   { top: 'Топ сегодня', compare: 'К вчера' },
  week:  { top: 'Топ за 7 дн', compare: 'К прошлой неделе' },
  month: { top: 'Топ за месяц', compare: 'К прошлому месяцу' },
  year:  { top: 'Топ за год', compare: 'К прошлому году' },
};

const DASH_TITLE = 'Обзор';

const MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const DOW_LABELS   = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const res = await fetch('/api' + path, {
    ...options,
    credentials: 'include',
    headers,
  });

  let data = {};
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Некорректный ответ сервера');
    }
  }

  if (res.status === 401) {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'login.html';
    throw new Error('Не авторизован');
  }
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

function parseDbTime(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s.includes('T') ? (s.endsWith('Z') ? s : s + 'Z') : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTime(iso) {
  if (!iso) return '—';
  const at = parseDbTime(iso);
  if (!at) return '—';
  const diff    = Date.now() - at.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1)  return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

function formatNum(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatMoney(n) {
  if (n == null || n === 0) return '0 ₽';
  const val = Number(n);
  if (Number.isNaN(val)) return '—';
  return val.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

function formatAvgSession(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds >= 3600) {
    const hours = seconds / 3600;
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} ч`;
  }
  if (seconds >= 60) return `${Math.round(seconds / 60)} мин`;
  return `${seconds} сек`;
}

function formatDonatorPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return `${pct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

const FULL_PERMISSIONS = {
  can_view_revenue:          true,
  can_view_donate_analytics: true,
  can_view_integrations:     true,
};

function getCurrentPermissions() {
  return currentAccess?.permissions || currentServer?.permissions || FULL_PERMISSIONS;
}

function isPartnerMode() {
  return currentServer?.role === 'partner';
}

function isOwnerMode() {
  if (isViewAsMode()) return false;
  return currentServer?.role === 'owner';
}

function formatMaybeMoney(n, masked) {
  if (masked) return '???';
  if (n == null) return '—';
  return formatMoney(n);
}

function pickCurrentServer(list) {
  return list.find(s => s.role === 'owner') || list[0] || null;
}

function updateSidebarForAccess() {
  const perms = getCurrentPermissions();
  const owner = isOwnerMode();

  const partnersLink = document.getElementById('partnersNavLink');
  if (partnersLink) partnersLink.hidden = !owner;

  document.querySelectorAll('.sidebar__link[data-page="settings"], .sidebar__link[data-page="api"]').forEach(el => {
    el.hidden = !owner;
  });

  const integrationsLink = document.querySelector('.sidebar__link[data-page="integrations"]');
  if (integrationsLink) integrationsLink.hidden = !owner && !perms.can_view_integrations;

  const sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
  if (sidebarSettingsBtn) sidebarSettingsBtn.hidden = !owner;
}

function showPartnerBanner(serverName, ownerName) {
  const banner = document.getElementById('partnerViewBanner');
  if (!banner || !isPartnerMode()) {
    hidePartnerBanner();
    return;
  }
  document.getElementById('partnerViewServerName').textContent = serverName || '—';
  document.getElementById('partnerViewOwner').textContent = ownerName || '—';
  banner.hidden = false;
}

function hidePartnerBanner() {
  const banner = document.getElementById('partnerViewBanner');
  if (banner) banner.hidden = true;
}

function syncAccessFromServer() {
  if (!currentServer) {
    currentAccess = null;
    return;
  }
  currentAccess = {
    role: currentServer.role ?? (currentServer.api_key ? 'owner' : 'partner'),
    permissions: currentServer.permissions || FULL_PERMISSIONS,
    owner_username: currentServer.owner_username,
  };
  updateSidebarForAccess();
  if (isPartnerMode()) {
    showPartnerBanner(currentServer.name, currentAccess.owner_username);
  } else {
    hidePartnerBanner();
  }
}

function showModalCreateError(msg) {
  const el = document.getElementById('modalCreateError');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function hideModalCreateError() {
  const el = document.getElementById('modalCreateError');
  if (el) el.hidden = true;
}

function isViewAsMode() {
  return viewAsServerId != null;
}

function showViewAsBanner(serverName, ownerName) {
  const banner = document.getElementById('adminViewBanner');
  if (!banner || !isAdmin || !viewAsServerId) {
    hideViewAsBanner();
    return;
  }
  document.getElementById('adminViewServerName').textContent = serverName || '—';
  document.getElementById('adminViewOwner').textContent = ownerName || '—';
  banner.hidden = false;
}

function hideViewAsBanner() {
  const banner = document.getElementById('adminViewBanner');
  if (banner) banner.hidden = true;
}

async function loadViewAsServer(serverId) {
  if (!isAdmin) {
    hideViewAsBanner();
    viewAsServerId = null;
    window.history.replaceState(null, '', 'dashboard.html');
    return false;
  }
  const s = await apiFetch(`/admin/servers/${serverId}`);
  viewAsServerId = s.id;
  currentServer = { id: s.id, name: s.name };
  currentAccess = { role: 'admin', permissions: FULL_PERMISSIONS };
  servers = [currentServer];
  showViewAsBanner(s.name, s.owner_username);
  await showDashboard();
  return true;
}

function openModal() {
  if (isViewAsMode()) return;
  if (servers.length > 0) {
    currentServer = servers[0];
    document.getElementById('modalOverlay').classList.remove('modal-overlay--open');
    void showDashboard();
    return;
  }
  hideModalCreateError();
  document.getElementById('modalOverlay').classList.add('modal-overlay--open');
  document.getElementById('modalStep1').hidden = false;
  document.getElementById('modalStep2').hidden = true;
  document.getElementById('serverNameInput').value = '';
  document.getElementById('modal-field-name').classList.remove('field--error');
  setTimeout(() => document.getElementById('serverNameInput').focus(), 150);
}

async function closeModal() {
  document.getElementById('modalOverlay').classList.remove('modal-overlay--open');
  if (currentServer) {
    currentPage = 'overview';
    await showDashboard();
  }
}

function requireServer() {
  if (!currentServer && servers.length > 0) {
    currentServer = servers[0];
  }
  if (!currentServer) {
    if (!isViewAsMode()) openModal();
    return false;
  }
  return true;
}

function showIntegrationsError(msg) {
  const el = document.getElementById('integrationsError');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function openSettingsModal() {
  if (isViewAsMode() || !isOwnerMode()) return;
  if (!requireServer()) return;
  closeModal();
  closeIntegrationsModal();
  closePartnersModal();
  setActiveNav('settings');
  document.getElementById('settingsOverlay').classList.add('modal-overlay--open');
  document.getElementById('settingsServerName').textContent = currentServer.name;
  document.getElementById('settingsApiKey').value = currentServer.api_key;
}

function closeSettingsModal() {
  document.getElementById('settingsOverlay').classList.remove('modal-overlay--open');
  if (currentServer) setActiveNav('overview');
}

function openIntegrationsModal() {
  if (isViewAsMode()) return;
  if (!requireServer()) return;
  const perms = getCurrentPermissions();
  if (!isOwnerMode() && !perms.can_view_integrations) return;

  const callbackUrl = currentServer.callback_url;
  if (!callbackUrl) return;

  closeModal();
  closeSettingsModal();
  closePartnersModal();
  setActiveNav('integrations');
  showIntegrationsError('');
  document.getElementById('integrationsOverlay').classList.add('modal-overlay--open');
  document.getElementById('integrationsServerName').textContent = currentServer.name;
  document.getElementById('callbackUrlDisplay').value = callbackUrl;

  const secretWrap = document.getElementById('webhookSecretWrap');
  const secretInput = document.getElementById('webhookSecretDisplay');
  if (secretWrap && secretInput) {
    const showSecret = isOwnerMode() && currentServer.webhook_secret;
    secretWrap.hidden = !showSecret;
    secretInput.value = showSecret ? currentServer.webhook_secret : '';
  }
}

function showPartnersError(msg) {
  const el = document.getElementById('partnersError');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function closePartnersModal() {
  document.getElementById('partnersOverlay')?.classList.remove('modal-overlay--open');
  if (currentServer) setActiveNav('overview');
}

async function openPartnersModal() {
  if (!isOwnerMode() || !requireServer()) return;
  closeModal();
  closeSettingsModal();
  closeIntegrationsModal();
  setActiveNav('partners');
  showPartnersError('');
  document.getElementById('partnersServerName').textContent = currentServer.name;
  document.getElementById('partnersOverlay').classList.add('modal-overlay--open');
  await loadPartnersList();
}

function getPartnerAddPerms() {
  return {
    can_view_revenue:          document.getElementById('partnerPermRevenue')?.checked || false,
    can_view_donate_analytics: document.getElementById('partnerPermDonateAnalytics')?.checked || false,
    can_view_integrations:     document.getElementById('partnerPermIntegrations')?.checked || false,
  };
}

function readPartnerRowPerms(rowEl) {
  return {
    can_view_revenue:          rowEl.querySelector('[data-perm="can_view_revenue"]')?.checked || false,
    can_view_donate_analytics: rowEl.querySelector('[data-perm="can_view_donate_analytics"]')?.checked || false,
    can_view_integrations:     rowEl.querySelector('[data-perm="can_view_integrations"]')?.checked || false,
  };
}

function renderPartnersList(partners) {
  const list = document.getElementById('partnersList');
  if (!list) return;

  if (!partners.length) {
    list.innerHTML = '<p class="muted partners-empty">Партнёров пока нет</p>';
    return;
  }

  list.innerHTML = partners.map(p => `
    <div class="partner-row" data-partner-id="${p.id}">
      <div>
        <div class="partner-row__name">${escapeHtml(p.username)}</div>
        <div class="partner-row__perms">
          <label class="partners-check">
            <input type="checkbox" data-perm="can_view_revenue" ${p.can_view_revenue ? 'checked' : ''} />
            <span>Доход</span>
          </label>
          <label class="partners-check">
            <input type="checkbox" data-perm="can_view_donate_analytics" ${p.can_view_donate_analytics ? 'checked' : ''} />
            <span>Аналитика донатов</span>
          </label>
          <label class="partners-check">
            <input type="checkbox" data-perm="can_view_integrations" ${p.can_view_integrations ? 'checked' : ''} />
            <span>Интеграции</span>
          </label>
        </div>
      </div>
      <div class="partner-row__actions">
        <button type="button" class="btn-flat btn-sm" data-save-partner="${p.id}">Сохранить</button>
        <button type="button" class="btn-flat btn-sm" data-delete-partner="${p.id}">Удалить</button>
      </div>
    </div>
  `).join('');
}

async function loadPartnersList() {
  if (!currentServer) return;
  try {
    const partners = await apiFetch(`/servers/${currentServer.id}/partners`);
    renderPartnersList(Array.isArray(partners) ? partners : []);
  } catch (err) {
    showPartnersError(err.message || 'Не удалось загрузить партнёров');
  }
}

async function addPartner() {
  if (!currentServer) return;
  const username = document.getElementById('partnerUsernameInput')?.value.trim();
  if (!username) {
    showPartnersError('Укажите username');
    return;
  }

  const btn = document.getElementById('partnerAddBtn');
  btn.disabled = true;
  showPartnersError('');

  try {
    await apiFetch(`/servers/${currentServer.id}/partners`, {
      method: 'POST',
      body:   JSON.stringify({ username, ...getPartnerAddPerms() }),
    });
    document.getElementById('partnerUsernameInput').value = '';
    document.getElementById('partnerPermRevenue').checked = true;
    document.getElementById('partnerPermDonateAnalytics').checked = true;
    document.getElementById('partnerPermIntegrations').checked = true;
    await loadPartnersList();
  } catch (err) {
    showPartnersError(err.message || 'Не удалось добавить партнёра');
  } finally {
    btn.disabled = false;
  }
}

async function savePartner(partnerId) {
  if (!currentServer) return;
  const rowEl = document.querySelector(`.partner-row[data-partner-id="${partnerId}"]`);
  if (!rowEl) return;

  showPartnersError('');
  try {
    await apiFetch(`/servers/${currentServer.id}/partners/${partnerId}`, {
      method: 'PATCH',
      body:   JSON.stringify(readPartnerRowPerms(rowEl)),
    });
    await loadPartnersList();
  } catch (err) {
    showPartnersError(err.message || 'Не удалось сохранить права');
  }
}

async function deletePartner(partnerId) {
  if (!currentServer) return;
  showPartnersError('');
  try {
    await apiFetch(`/servers/${currentServer.id}/partners/${partnerId}`, { method: 'DELETE' });
    await loadPartnersList();
  } catch (err) {
    showPartnersError(err.message || 'Не удалось удалить партнёра');
  }
}

function closeIntegrationsModal() {
  document.getElementById('integrationsOverlay').classList.remove('modal-overlay--open');
  if (currentServer) setActiveNav('overview');
}

function copyText(text, btn) {
  const done = () => {
    const prev = btn.innerHTML;
    btn.innerHTML = '<span style="color:var(--accent)">✓</span>';
    setTimeout(() => { btn.innerHTML = prev; }, 2000);
  };
  copyToClipboard(text).then(done).catch(() => {
    showIntegrationsError('Не удалось скопировать — выделите URL вручную');
  });
}

async function createServer(name) {
  const data = await apiFetch('/servers', {
    method: 'POST',
    body:   JSON.stringify({ name }),
  });

  currentServer = {
    ...data,
    role:        'owner',
    permissions: FULL_PERMISSIONS,
  };
  syncAccessFromServer();
  servers.unshift(currentServer);

  document.getElementById('modalStep1').hidden = true;
  document.getElementById('modalStep2').hidden = false;
  document.getElementById('apikeyDisplay').value = data.api_key;
}

function setActiveNav(page) {
  document.querySelectorAll('.sidebar__link[data-page]').forEach(link => {
    link.classList.toggle('sidebar__link--active', link.dataset.page === page);
  });
}

function navigateTo(page) {
  currentPage = 'overview';
  setActiveNav('overview');
  document.getElementById('panelOverview').hidden = false;
  document.getElementById('dashTitle').textContent = DASH_TITLE;
}

async function showDashboard() {
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('dashContent').hidden = false;
  syncAccessFromServer();
  navigateTo(currentPage);
  await loadStats();
  updateDashUpdatedAt();
  startAutoRefresh();
}

async function loadStats() {
  if (!currentServer) return;
  try {
    const data = await apiFetch(`/servers/${currentServer.id}/stats`);
    lastData = data;
    if (data.access) {
      currentAccess = {
        role:           data.access.role,
        permissions:    data.access.permissions || FULL_PERMISSIONS,
        owner_username: data.access.owner_username ?? currentAccess?.owner_username,
      };
      updateSidebarForAccess();
      if (isPartnerMode()) {
        showPartnerBanner(currentServer.name, currentAccess.owner_username);
      } else {
        hidePartnerBanner();
      }
    }
    renderStats(data);
    subdomainVisibleLimit = SUBDOMAIN_INITIAL_COUNT;
    renderTable(data.subdomains);
    renderDayOnline(data);
    renderChart(data);
  } catch (err) {
    console.error('loadStats error:', err.message);
  }
}

function setStatsPeriod(period) {
  statsPeriod = period;
  document.querySelectorAll('#statsPeriodTabs .period-tab').forEach(btn => {
    btn.classList.toggle('period-tab--active', btn.dataset.period === period);
  });
  if (lastData) {
    renderStats(lastData);
    renderDonateTiming(lastData);
    renderDonateProducts(lastData);
    renderInsights(lastData);
  }
}

const DONATE_TIMING_BUCKETS = [
  { key: 'under_1h',  label: 'До 1 часа' },
  { key: 'under_24h', label: '1–24 часа' },
  { key: 'under_7d',  label: '1–7 дней' },
  { key: 'under_30d', label: '7–30 дней' },
  { key: 'over_30d',  label: '30+ дней' },
];

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.floor(seconds));
  if (s === 0) return 'менее 1 сек';
  if (s < 60) return `${s} сек`;
  if (s < 3600) return `${Math.round(s / 60)} мин`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h ? `${d} д ${h} ч` : `${d} д`;
}

function renderDonateTiming(data) {
  const card   = document.getElementById('donateTimingCard');
  const median = document.getElementById('donateTimingMedian');
  const sub    = document.getElementById('donateTimingSub');
  const bars   = document.getElementById('donateTimingBars');
  const footer = document.getElementById('donateTimingFooter');
  if (!card || !median) return;

  const timing = data?.stats?.periods?.[statsPeriod]?.donate_timing;
  if (!timing || (!timing.matched && !timing.unmatched_donors)) {
    card.hidden = true;
    return;
  }

  if (!timing.matched) {
    card.hidden = false;
    median.textContent = '—';
    sub.textContent = `нет пар «вход → донат» · ${timing.unmatched_donors} без входа в логах`;
    bars.innerHTML = '';
    footer.innerHTML = '';
    return;
  }

  card.hidden = false;
  median.textContent = formatDuration(timing.median_seconds);
  sub.textContent = `медиана · ${timing.matched} ${pluralPlayers(timing.matched)} с донатом`;

  const maxBucket = Math.max(1, ...DONATE_TIMING_BUCKETS.map(b => timing.buckets[b.key] || 0));
  bars.innerHTML = DONATE_TIMING_BUCKETS.map(b => {
    const n = timing.buckets[b.key] || 0;
    const pct = Math.round((n / maxBucket) * 100);
    return `
      <div class="donate-timing-bar-row">
        <span class="donate-timing-bar-label">${b.label}</span>
        <div class="donate-timing-bar-track">
          <div class="donate-timing-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="donate-timing-bar-count">${n}</span>
      </div>
    `;
  }).join('');

  const fastest = (timing.fastest || [])[0];
  footer.innerHTML = [
    { label: 'В среднем', value: formatDuration(timing.avg_seconds) },
    {
      label: 'Быстрее всех',
      value: fastest ? `${fastest.player} · ${formatDuration(fastest.seconds)}` : '—',
    },
    {
      label: 'Без входа в логах',
      value: String(timing.unmatched_donors || 0),
    },
  ].map(s => `
    <div class="heatmap-stat">
      <div class="heatmap-stat__label">${s.label}</div>
      <div class="heatmap-stat__value">${escapeHtml(String(s.value))}</div>
    </div>
  `).join('');
}

function pluralPayments(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'платёж';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'платежа';
  return 'платежей';
}

function renderDonateProducts(data) {
  const card   = document.getElementById('donateProductsCard');
  const avgEl  = document.getElementById('donateProductsAvg');
  const sub    = document.getElementById('donateProductsSub');
  const bars   = document.getElementById('donateProductsBars');
  const footer = document.getElementById('donateProductsFooter');
  if (!card || !avgEl) return;

  const products = data?.stats?.periods?.[statsPeriod]?.donate_products;
  if (!products || !products.donation_count) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  avgEl.textContent = formatMaybeMoney(products.avg_check, products.avg_check_masked);
  sub.textContent = `средний чек · ${products.donation_count} ${pluralPayments(products.donation_count)}`;

  const top = products.top || [];
  if (!top.length) {
    bars.innerHTML = `
      <p class="muted" style="font-size:13px;margin:0">
        Нет данных о товарах — в старых донатах поле products могло не сохраниться
      </p>`;
  } else {
    const maxRevenue = Math.max(
      1,
      ...top.map(p => (p.revenue_masked ? 0 : (p.revenue || 0)))
    );
    bars.innerHTML = top.map(p => {
      const rev = p.revenue_masked ? null : (p.revenue || 0);
      const pct = p.revenue_masked ? 0 : Math.round((rev / maxRevenue) * 100);
      const label = escapeHtml(p.name);
      const revenueLabel = formatMaybeMoney(p.revenue, p.revenue_masked);
      return `
        <div class="donate-product-row">
          <div class="donate-product-row__head">
            <span class="donate-product-row__name" title="${label}">${label}</span>
            <span class="donate-product-row__stats">${escapeHtml(revenueLabel)} · ${p.sales_count} шт.</span>
          </div>
          <div class="donate-timing-bar-track">
            <div class="donate-timing-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  const topOne = top[0];
  const breakdownNote = products.with_products < products.donation_count
    ? `${products.with_products} из ${products.donation_count} с товарами`
    : `${products.with_products} с товарами`;

  footer.innerHTML = [
    {
      label: 'Сумма донатов',
      value: formatMaybeMoney(products.total_amount, products.avg_check_masked),
    },
    { label: 'Разбивка', value: breakdownNote },
    {
      label: 'Топ товар',
      value: topOne
        ? `${topOne.name} · ${formatMaybeMoney(topOne.revenue, topOne.revenue_masked)}`
        : '—',
    },
  ].map(s => `
    <div class="heatmap-stat">
      <div class="heatmap-stat__label">${s.label}</div>
      <div class="heatmap-stat__value">${escapeHtml(String(s.value))}</div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatChangePct(changePct) {
  if (changePct > 0) {
    return { text: `+${changePct}% сессий`, cls: 'insight-chip__value--up' };
  }
  if (changePct < 0) {
    return { text: `${changePct}% сессий`, cls: 'insight-chip__value--down' };
  }
  return { text: 'без изменений', cls: 'insight-chip__value--flat' };
}

function renderInsightChip(label, valueHtml) {
  return `
    <div class="insight-chip">
      <span class="insight-chip__label">${escapeHtml(label)}</span>
      <span class="insight-chip__value">${valueHtml}</span>
    </div>
  `;
}

function renderInsights(data) {
  const host = document.getElementById('insightChips');
  if (!host) return;

  const insights = data?.stats?.periods?.[statsPeriod]?.insights;
  if (!insights) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }

  const labels = INSIGHT_LABELS[statsPeriod] || INSIGHT_LABELS.year;
  const chips = [];

  if (insights.top_subdomain?.subdomain) {
    const top = insights.top_subdomain;
    chips.push(renderInsightChip(
      labels.top,
      `<span class="insight-chip__value--mono">${escapeHtml(top.subdomain)} · ${escapeHtml(formatNum(top.count))}</span>`
    ));
  }

  if (insights.avg_check != null && !insights.avg_check_masked) {
    chips.push(renderInsightChip(
      'Средний чек',
      `<span class="${insights.avg_check_masked ? 'value-masked' : ''}">${escapeHtml(formatMaybeMoney(insights.avg_check, insights.avg_check_masked))}</span>`
    ));
  }

  if (insights.change_pct != null) {
    const change = formatChangePct(insights.change_pct);
    chips.push(renderInsightChip(
      labels.compare,
      `<span class="${change.cls}">${escapeHtml(change.text)}</span>`
    ));
  }

  if (!chips.length) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }

  host.hidden = false;
  host.innerHTML = chips.join('');
}

function renderStats(data) {
  if (!data?.stats?.periods) return;
  const p = data.stats.periods[statsPeriod];
  if (!p) return;

  renderDonateTiming(data);
  renderDonateProducts(data);
  renderInsights(data);

  const labels = STATS_PERIOD_LABELS[statsPeriod] || STATS_PERIOD_LABELS.year;
  document.getElementById('statLabelPlayers').textContent     = labels.players;
  document.getElementById('statLabelSessions').textContent    = labels.sessions;
  document.getElementById('statLabelAvgSession').textContent  = labels.avgSession;
  document.getElementById('statLabelDonatorPct').textContent  = labels.donatorPct;
  document.getElementById('statLabelDonated').textContent     = labels.donated;
  document.getElementById('statPlayers').textContent            = formatNum(p.unique);
  document.getElementById('statSessions').textContent           = formatNum(p.total);
  document.getElementById('statAvgSession').textContent         = formatAvgSession(p.avg_session_seconds);
  document.getElementById('statDonatorPct').textContent = p.donator_pct_masked
    ? '???'
    : formatDonatorPct(p.donator_pct);
  if (p.donator_pct_masked) {
    document.getElementById('statDonatorPct').classList.add('value-masked');
  } else {
    document.getElementById('statDonatorPct').classList.remove('value-masked');
  }
  document.getElementById('statSubdomains').textContent         = formatNum(p.subdomains);
  document.getElementById('statDonated').textContent = p.donated_masked
    ? '???'
    : formatMoney(p.donated);
  if (p.donated_masked) {
    document.getElementById('statDonated').classList.add('value-masked');
  } else {
    document.getElementById('statDonated').classList.remove('value-masked');
  }
}

function renderMetricCell(players, sessions) {
  const playersLabel = formatNum(players || 0);
  const sessionsLabel = formatNum(sessions || 0);

  return `
    <div class="td-metrics">
      <div class="td-metric-row">
        <span class="td-metric-row__label">Игроки</span>
        <span class="td-metric-row__value">${playersLabel}</span>
      </div>
      <div class="td-metric-row">
        <span class="td-metric-row__label">Сессии</span>
        <span class="td-metric-row__value">${sessionsLabel}</span>
      </div>
    </div>`;
}

function filterSubdomains(subdomains) {
  const query = subdomainSearchQuery.trim().toLowerCase();
  if (!query) return subdomains || [];
  return (subdomains || []).filter(row => String(row.subdomain || '').toLowerCase().includes(query));
}

function updateSubdomainTableChrome(totalFiltered, visibleCount) {
  const meta = document.getElementById('subdomainTableMeta');
  const foot = document.getElementById('subdomainTableFoot');
  const btn = document.getElementById('subdomainLoadMoreBtn');
  const hasMore = totalFiltered > 0 && visibleCount < totalFiltered;

  if (meta) {
    if (!totalFiltered) {
      meta.textContent = subdomainSearchQuery.trim() ? 'ничего не найдено' : '';
    } else if (hasMore) {
      meta.textContent = `${visibleCount} из ${totalFiltered}`;
    } else {
      meta.textContent = String(totalFiltered);
    }
  }

  if (foot) {
    foot.hidden = !hasMore;
  }

  if (btn) {
    if (hasMore) {
      const next = Math.min(SUBDOMAIN_LOAD_MORE_STEP, totalFiltered - visibleCount);
      btn.textContent = `Показать ещё ${next}`;
    } else {
      btn.textContent = 'Показать ещё';
    }
  }
}

function renderTable(subdomains) {
  const tbody = document.getElementById('tableBody');
  const filtered = filterSubdomains(subdomains);
  const visible = filtered.slice(0, subdomainVisibleLimit);

  if (!subdomains || subdomains.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          Пока нет данных — подключите плагин и дождитесь первых входов
        </td>
      </tr>`;
    updateSubdomainTableChrome(0, 0);
    return;
  }

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          Ничего не найдено по «${escapeHtml(subdomainSearchQuery.trim())}»
        </td>
      </tr>`;
    updateSubdomainTableChrome(0, 0);
    return;
  }

  tbody.innerHTML = visible.map(row => {
    const donated = row.donated || 0;
    const donateMasked = !!row.donated_masked;
    const donateCls = donateMasked
      ? 'td-donate value-masked'
      : donated > 0 ? 'td-donate' : 'td-donate td-donate--zero';
    const donateLabel = donateMasked
      ? '???'
      : donated > 0
        ? `${formatMoney(donated)}${row.donate_count > 1 ? ` <span class="td-muted">(${escapeHtml(String(row.donate_count))})</span>` : ''}`
        : '—';
    return `
    <tr>
      <td><span class="td-mono">${escapeHtml(row.subdomain)}</span></td>
      <td>${renderMetricCell(row.today_unique, row.today)}</td>
      <td>${renderMetricCell(row.week_unique, row.week)}</td>
      <td>${renderMetricCell(row.total_unique, row.total)}</td>
      <td class="${donateCls}">${donateLabel}</td>
      <td class="td-muted">${formatTime(row.last_seen)}</td>
    </tr>`;
  }).join('');

  updateSubdomainTableChrome(filtered.length, visible.length);
}

function formatHeatmapDate(dayStr) {
  const at = parseDbTime(`${dayStr}T12:00:00`);
  if (!at) return dayStr;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: DASHBOARD_TZ,
    day:      'numeric',
    month:    'long',
    year:     'numeric',
  }).format(at);
}

function formatHeatmapMonth(dayStr) {
  const at = parseDbTime(`${dayStr}T12:00:00`);
  if (!at) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: DASHBOARD_TZ,
    month:    'short',
  }).format(at).replace('.', '');
}

function formatHeatmapDayShort(dayStr) {
  const at = parseDbTime(`${dayStr}T12:00:00`);
  if (!at) return dayStr;
  const day = new Intl.DateTimeFormat('ru-RU', {
    timeZone: DASHBOARD_TZ,
    day:      'numeric',
  }).format(at);
  return `${day} ${formatHeatmapMonth(dayStr)}`;
}

function heatmapMonthKey(dayStr) {
  const at = parseDbTime(`${dayStr}T12:00:00`);
  if (!at) return dayStr;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: DASHBOARD_TZ,
    month:    'numeric',
    year:     'numeric',
  }).format(at);
}

function avatarPalette(name) {
  let hash = 0;
  const s = name || 'user';
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return {
    bg:    `hsla(${hue}, 42%, 32%, 1)`,
    color: `hsla(${hue}, 55%, 82%, 1)`,
  };
}

function setSidebarAvatar(name) {
  const el = document.getElementById('sidebarAvatar');
  if (!el) return;

  const clean = (name || 'U').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : clean.slice(0, 2).toUpperCase() || 'U';

  el.textContent = initials;
  const { bg, color } = avatarPalette(clean);
  el.style.background = bg;
  el.style.color = color;
}

function pluralSessions(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сессия';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сессии';
  return 'сессий';
}

function pluralPlayers(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'игрок';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'игрока';
  return 'игроков';
}

function formatHourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function dayOnlineNiceMax(value) {
  if (value <= 0) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / step;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 4 ? 4 : scaled <= 5 ? 5 : 10;
  return nice * step;
}

function dayOnlineTicks(max, count = 4) {
  const ticks = [];
  for (let i = 0; i <= count; i++) {
    ticks.push(Math.round((max * i) / count));
  }
  return ticks;
}

let dayOnlinePoints = [];

function setupDayOnlineTooltip() {
  const wrap = document.querySelector('#dayOnlineCard .day-online-wrap');
  const svg  = document.getElementById('dayOnlineSvg');
  const tip  = document.getElementById('dayOnlineTooltip');
  if (!wrap || !svg || !tip || wrap.dataset.tipReady) return;
  wrap.dataset.tipReady = '1';

  wrap.addEventListener('mousemove', e => {
    if (!dayOnlinePoints.length) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * 320;
    let nearest = dayOnlinePoints[0];
    let minDist = Infinity;
    dayOnlinePoints.forEach(p => {
      const dist = Math.abs(p.x - relX);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    });

    svg.querySelectorAll('.day-online-dot').forEach(dot => {
      dot.classList.toggle('day-online-dot--active', Number(dot.dataset.index) === nearest.index);
    });

    const noun = pluralPlayers(nearest.value);
    tip.hidden = false;
    tip.innerHTML = `<strong>${escapeHtml(nearest.label)} MSK</strong><span>${nearest.value} ${noun} онлайн</span>`;
    tip.style.left = e.clientX + 'px';
    tip.style.top  = e.clientY + 'px';
  });

  wrap.addEventListener('mouseleave', () => {
    tip.hidden = true;
    svg.querySelectorAll('.day-online-dot').forEach(dot => dot.classList.remove('day-online-dot--active'));
  });
}

function renderDayOnline(data) {
  const card  = document.getElementById('dayOnlineCard');
  const svg   = document.getElementById('dayOnlineSvg');
  const subEl = document.getElementById('dayOnlineSub');
  if (!card || !svg || !subEl) return;

  const online = data?.day_online;
  const series = (online?.points || []).map(point => ({
    ...point,
    label: formatChartTime(point.ts ?? point.recorded_at),
  }));
  if (!series.length) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  const values = series.map(row => row.online || 0);
  const rawMax = Math.max(...values, 1);
  const max = dayOnlineNiceMax(rawMax);
  const W = 320;
  const H = 140;
  const padL = 34;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const baseY = padT + chartH;

  dayOnlinePoints = series.map((row, i) => {
    const value = row.online || 0;
    const x = padL + (i / Math.max(series.length - 1, 1)) * chartW;
    const y = padT + chartH - (value / max) * chartH;
    return { x, y, value, label: row.label, index: i };
  });

  const lineD = dayOnlinePoints
    .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  const areaD = `${lineD} L${dayOnlinePoints[dayOnlinePoints.length - 1].x.toFixed(2)},${baseY} L${dayOnlinePoints[0].x.toFixed(2)},${baseY} Z`;

  const yTicks = dayOnlineTicks(max, 4);
  const xLabelCount = Math.min(9, series.length);
  const xLabelIdx = new Set(
    Array.from({ length: xLabelCount }, (_, i) => Math.round((i / Math.max(xLabelCount - 1, 1)) * (series.length - 1)))
  );

  let peakValue = 0;
  let peakLabel = '—';
  series.forEach(point => {
    const val = point.online || 0;
    if (val >= peakValue) {
      peakValue = val;
      peakLabel = point.label;
    }
  });
  const currentValue = online.current_online ?? values[values.length - 1];
  const currentLabel = series[series.length - 1]?.label ?? formatChartTime(Date.now());

  if (online.source === 'snapshots') {
    subEl.textContent = `пик ${formatNum(peakValue)} · ${peakLabel} · сейчас ${formatNum(currentValue)} (${currentLabel})`;
  } else {
    subEl.textContent = `оценка · пик ${formatNum(peakValue)} · ${peakLabel} · сейчас ${formatNum(currentValue)} (${currentLabel})`;
  }

  svg.innerHTML = `
    <defs>
      <linearGradient id="dayOnlineFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(62, 207, 142, 0.28)"/>
        <stop offset="100%" stop-color="rgba(62, 207, 142, 0)"/>
      </linearGradient>
    </defs>
    ${yTicks.map(v => {
      const y = padT + chartH - (v / max) * chartH;
      return `
        <line class="day-online-grid" x1="${padL}" y1="${y.toFixed(2)}" x2="${W - padR}" y2="${y.toFixed(2)}"/>
        <text class="day-online-axis-label" x="${padL - 6}" y="${(y + 3).toFixed(2)}" text-anchor="end">${v}</text>
      `;
    }).join('')}
    ${[...xLabelIdx].map(i => {
      const p = dayOnlinePoints[i];
      return `<text class="day-online-axis-label" x="${p.x.toFixed(2)}" y="${H - 4}" text-anchor="middle">${escapeHtml(series[i].label)}</text>`;
    }).join('')}
    <path class="day-online-area" d="${areaD}"/>
    <path class="day-online-line" d="${lineD}"/>
    ${dayOnlinePoints.map(p => `
      <circle class="day-online-dot" data-index="${p.index}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3.5"/>
      <rect class="day-online-hit" data-index="${p.index}" x="${(p.x - chartW / Math.max(series.length * 2, 2)).toFixed(2)}" y="${padT}" width="${(chartW / Math.max(series.length - 1, 1)).toFixed(2)}" height="${chartH}"/>
    `).join('')}
  `;

  setupDayOnlineTooltip();
}

function heatmapDayValue(day, metric = heatmapMetric) {
  return metric === 'unique' ? (day.unique ?? 0) : (day.total ?? 0);
}

function updateHeatmapLabels() {
  const sub = document.getElementById('chartMetricSub');
  if (sub) sub.textContent = heatmapMetric === 'unique' ? 'игроков за год' : 'сессий за год';
  const leg = document.getElementById('heatmapLegendZeroLabel');
  if (leg) leg.textContent = heatmapMetric === 'unique' ? '0 игроков' : '0 сессий';
}

function setHeatmapMetric(metric) {
  heatmapMetric = metric;
  document.querySelectorAll('#heatmapMetricTabs .period-tab').forEach(btn => {
    const active = btn.dataset.metric === metric;
    btn.classList.toggle('period-tab--active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  updateHeatmapLabels();
  if (lastData) renderChart(lastData);
}

function setupHeatmapTooltip() {
  const grid = document.getElementById('heatmapGrid');
  const tip  = document.getElementById('heatmapTooltip');
  if (!grid || !tip || grid.dataset.tipReady) return;
  grid.dataset.tipReady = '1';

  grid.addEventListener('mouseover', e => {
    const cell = e.target.closest('.heatmap__cell[data-day]');
    if (!cell) {
      tip.hidden = true;
      return;
    }
    const value = Number(cell.dataset.value) || 0;
    const metric = cell.dataset.metric || 'total';
    const noun = metric === 'unique' ? pluralPlayers(value) : pluralSessions(value);
    tip.hidden = false;
    tip.innerHTML = `<strong>${formatHeatmapDate(cell.dataset.day)}</strong><br><span>${value} ${noun}</span>`;
    tip.style.left = e.clientX + 'px';
    tip.style.top  = e.clientY + 'px';
  });

  grid.addEventListener('mouseleave', () => {
    tip.hidden = true;
  });
}

function heatmapLevel(value, max) {
  if (!value) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5)  return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function mondayIndex(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return (d.getDay() + 6) % 7;
}

function buildHeatmapWeeks(days) {
  if (!days.length) return [];

  if (days.length <= 7) {
    const week = Array(7).fill(null);
    days.forEach(d => {
      week[mondayIndex(d.day)] = d;
    });
    return [week];
  }

  const firstPad = mondayIndex(days[0].day);
  const padded = [...Array(firstPad).fill(null), ...days];

  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) {
    const chunk = padded.slice(i, i + 7);
    while (chunk.length < 7) chunk.push(null);
    weeks.push(chunk);
  }
  return weeks;
}

function renderChart(data) {
  const grid    = document.getElementById('heatmapGrid');
  const footer  = document.getElementById('heatmapFooter');
  const totalEl = document.getElementById('chartTotal');
  const timeline = data.timeline || [];

  grid.innerHTML = '';
  footer.innerHTML = '';

  const days = timeline.map(row => ({
    day:    row.day,
    total:  row.total ?? 0,
    unique: row.unique ?? 0,
  }));

  updateHeatmapLabels();

  const periodTotal = days.reduce((s, d) => s + heatmapDayValue(d), 0);
  totalEl.textContent = formatNum(periodTotal);

  if (!days.length) {
    grid.innerHTML = '<div class="heatmap-empty">Нет данных за этот год</div>';
    return;
  }

  const max = Math.max(1, ...days.map(d => heatmapDayValue(d)));
  const weeks = buildHeatmapWeeks(days);
  let lastMonth = '';

  DOW_LABELS.forEach((text, i) => {
    const label = document.createElement('div');
    label.className = 'heatmap__dow-label';
    label.textContent = text;
    label.style.gridRow = String(i + 2);
    grid.appendChild(label);
  });

  weeks.forEach((week, wi) => {
    const col = wi + 2;
    const first = week.find(d => d);
    const monthEl = document.createElement('div');
    monthEl.className = 'heatmap__month';
    monthEl.style.gridColumn = String(col);
    monthEl.style.gridRow = '1';
    if (first) {
      const monthKey = heatmapMonthKey(first.day);
      if (monthKey !== lastMonth) {
        lastMonth = monthKey;
        monthEl.textContent = formatHeatmapMonth(first.day);
      }
    }
    grid.appendChild(monthEl);

    week.forEach((day, ri) => {
      const cell = document.createElement('div');
      cell.style.gridColumn = String(col);
      cell.style.gridRow = String(ri + 2);
      if (!day) {
        cell.className = 'heatmap__cell heatmap__cell--empty';
        grid.appendChild(cell);
        return;
      }
      const value = heatmapDayValue(day);
      const level = heatmapLevel(value, max);
      cell.className = 'heatmap__cell' + (value === 0 ? ' heatmap__cell--zero' : '');
      cell.dataset.level = level;
      cell.dataset.day = day.day;
      cell.dataset.value = String(value);
      cell.dataset.metric = heatmapMetric;
      grid.appendChild(cell);
    });
  });

  setupHeatmapTooltip();

  const best = days.reduce((a, b) => (heatmapDayValue(b) > heatmapDayValue(a) ? b : a), days[0]);
  const avg  = Math.round(periodTotal / days.length);
  const bestVal = heatmapDayValue(best);

  footer.innerHTML = [
    { label: 'Самый активный день', value: `${formatHeatmapDayShort(best.day)} · ${formatNum(bestVal)}` },
    { label: 'Среднее в день',      value: formatNum(avg) },
    { label: 'Пик за день',         value: formatNum(bestVal) },
    { label: 'Дней в году',         value: String(days.length) },
  ].map(s => `
    <div class="heatmap-stat">
      <div class="heatmap-stat__label">${s.label}</div>
      <div class="heatmap-stat__value">${s.value}</div>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureSession())) return;

  document.getElementById('sidebarUsername').textContent = username;
  setSidebarAvatar(username);

  hideViewAsBanner();
  viewAsServerId = null;

  const viewParam = parseInt(new URLSearchParams(window.location.search).get('server'), 10);

  try {
    if (viewParam && isAdmin) {
      const viewed = await loadViewAsServer(viewParam);
      if (!viewed) {
        servers = (await apiFetch('/servers')) || [];
        if (servers.length > 0) {
          currentServer = pickCurrentServer(servers);
          syncAccessFromServer();
          await showDashboard();
        }
      }
    } else {
      if (viewParam && !isAdmin) {
        window.history.replaceState(null, '', 'dashboard.html');
      }
      servers = (await apiFetch('/servers')) || [];
      if (servers.length > 0) {
        currentServer = pickCurrentServer(servers);
        syncAccessFromServer();
        await showDashboard();
      }
    }
  } catch (err) {
    hideViewAsBanner();
    viewAsServerId = null;
    console.error('Init error:', err.message);
  }

  document.getElementById('adminViewExitBtn')?.addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });

  document.getElementById('emptyCreateBtn').addEventListener('click', openModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);

  document.getElementById('statsPeriodTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    setStatsPeriod(btn.dataset.period);
  });

  document.getElementById('subdomainSearch')?.addEventListener('input', e => {
    subdomainSearchQuery = e.target.value;
    subdomainVisibleLimit = SUBDOMAIN_INITIAL_COUNT;
    if (lastData?.subdomains) renderTable(lastData.subdomains);
  });

  document.getElementById('subdomainLoadMoreBtn')?.addEventListener('click', () => {
    subdomainVisibleLimit += SUBDOMAIN_LOAD_MORE_STEP;
    if (lastData?.subdomains) renderTable(lastData.subdomains);
  });

  document.getElementById('heatmapMetricTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-metric]');
    if (!btn) return;
    setHeatmapMetric(btn.dataset.metric);
  });

  document.getElementById('dashRefreshBtn')?.addEventListener('click', () => {
    void refreshDashboard(true);
  });

  document.querySelector('.sidebar__link[data-page="overview"]').addEventListener('click', e => {
    e.preventDefault();
    if (!currentServer) return;
    navigateTo('overview');
  });

  document.querySelector('.sidebar__link[data-page="settings"]')?.addEventListener('click', e => {
    e.preventDefault();
    if (!isOwnerMode()) return;
    openSettingsModal();
  });
  document.querySelector('.sidebar__link[data-page="integrations"]')?.addEventListener('click', e => {
    e.preventDefault();
    openIntegrationsModal();
  });
  document.getElementById('partnersNavLink')?.addEventListener('click', e => {
    e.preventDefault();
    if (!isOwnerMode()) return;
    openPartnersModal();
  });
  document.querySelector('.sidebar__link[data-page="api"]')?.addEventListener('click', e => {
    e.preventDefault();
    if (!isOwnerMode()) return;
    openSettingsModal();
  });

  document.getElementById('settingsClose').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsOverlay').addEventListener('click', e => {
    if (e.target.id === 'settingsOverlay') closeSettingsModal();
  });
  document.getElementById('copyApiKeyBtn').addEventListener('click', () => {
    copyText(document.getElementById('settingsApiKey').value, document.getElementById('copyApiKeyBtn'));
  });
  document.getElementById('integrationsClose').addEventListener('click', closeIntegrationsModal);
  document.getElementById('integrationsOverlay').addEventListener('click', e => {
    if (e.target.id === 'integrationsOverlay') closeIntegrationsModal();
  });
  document.getElementById('partnersClose')?.addEventListener('click', closePartnersModal);
  document.getElementById('partnersOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'partnersOverlay') closePartnersModal();
  });
  document.getElementById('partnerAddBtn')?.addEventListener('click', () => { void addPartner(); });
  document.getElementById('partnersList')?.addEventListener('click', e => {
    const saveBtn = e.target.closest('[data-save-partner]');
    if (saveBtn) {
      void savePartner(Number(saveBtn.dataset.savePartner));
      return;
    }
    const deleteBtn = e.target.closest('[data-delete-partner]');
    if (deleteBtn) {
      void deletePartner(Number(deleteBtn.dataset.deletePartner));
    }
  });
  document.getElementById('copyCallbackBtn').addEventListener('click', () => {
    copyText(
      document.getElementById('callbackUrlDisplay').value,
      document.getElementById('copyCallbackBtn')
    );
  });
  document.getElementById('copyWebhookSecretBtn')?.addEventListener('click', () => {
    copyText(
      document.getElementById('webhookSecretDisplay').value,
      document.getElementById('copyWebhookSecretBtn')
    );
  });
  document.getElementById('sidebarSettingsBtn')?.addEventListener('click', e => {
    e.preventDefault();
    if (!isOwnerMode()) return;
    openSettingsModal();
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    stopAutoRefresh();
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'login.html';
  });

  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  document.getElementById('serverNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('createServerBtn').click();
  });

  document.getElementById('serverNameInput').addEventListener('input', () => {
    document.getElementById('modal-field-name').classList.remove('field--error');
    hideModalCreateError();
  });

  document.getElementById('createServerBtn').addEventListener('click', async () => {
    const input = document.getElementById('serverNameInput');
    const field = document.getElementById('modal-field-name');
    if (!input.value.trim()) { field.classList.add('field--error'); return; }

    const btn = document.getElementById('createServerBtn');
    btn.disabled    = true;
    btn.textContent = 'Создание...';
    hideModalCreateError();

    try {
      await createServer(input.value.trim());
    } catch (err) {
      if (err.message?.includes('один сервер')) {
        try {
          servers = (await apiFetch('/servers')) || [];
          if (servers.length > 0) {
            currentServer = pickCurrentServer(servers);
            syncAccessFromServer();
            await closeModal();
            return;
          }
        } catch {}
      }
      showModalCreateError(err.message || 'Не удалось создать сервер');
      field.classList.add('field--error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Создать сервер';
    }
  });

  document.getElementById('apikeyBtn').addEventListener('click', () => {
    const key = document.getElementById('apikeyDisplay').value;
    const btn  = document.getElementById('apikeyBtn');
    const prev = btn.textContent;
    copyToClipboard(key).then(() => {
      btn.textContent         = 'Скопировано!';
      btn.style.color         = 'var(--accent)';
      btn.style.borderColor   = 'rgba(31,157,85,0.4)';
      setTimeout(() => {
        btn.textContent       = prev;
        btn.style.color       = '';
        btn.style.borderColor = '';
      }, 2000);
    }).catch(() => {
      showModalCreateError('Не удалось скопировать ключ');
    });
  });

  document.getElementById('doneBtn').addEventListener('click', () => {
    void closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('partnersOverlay')?.classList.contains('modal-overlay--open')) {
      closePartnersModal();
    } else if (document.getElementById('integrationsOverlay').classList.contains('modal-overlay--open')) {
      closeIntegrationsModal();
    } else if (document.getElementById('settingsOverlay').classList.contains('modal-overlay--open')) {
      closeSettingsModal();
    } else {
      closeModal();
    }
  });

});
