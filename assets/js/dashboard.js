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
let currentPage   = 'overview';
let lastData      = null;
let statsPeriod   = 'year';
let heatmapMetric = 'total';

const STATS_PERIOD_LABELS = {
  day: {
    total:   'Всего за день',
    unique:  'Уникальных за день',
    donated: 'Донаты за день',
  },
  week: {
    total:   'Всего за 7 дней',
    unique:  'Уникальных за 7 дней',
    donated: 'Донаты за 7 дней',
  },
  month: {
    total:   'Всего за месяц',
    unique:  'Уникальных за месяц',
    donated: 'Донаты за месяц',
  },
  year: {
    total:   'Всего за год',
    unique:  'Уникальных за год',
    donated: 'Донаты за год',
  },
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

function getCallbackUrl(webhookSecret) {
  return `${window.location.origin}/api/donate/callback?token=${encodeURIComponent(webhookSecret)}`;
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
  if (isViewAsMode()) return;
  if (!requireServer()) return;
  closeModal();
  closeIntegrationsModal();
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
  if (!requireServer() || !currentServer.webhook_secret) return;
  closeModal();
  closeSettingsModal();
  setActiveNav('integrations');
  showIntegrationsError('');
  document.getElementById('integrationsOverlay').classList.add('modal-overlay--open');
  document.getElementById('integrationsServerName').textContent = currentServer.name;
  document.getElementById('callbackUrlDisplay').value = getCallbackUrl(currentServer.webhook_secret);
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

  currentServer = data;
  servers.unshift(data);

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
  const yearBadge = document.getElementById('dashYearBadge');
  if (yearBadge) yearBadge.textContent = new Date().getFullYear();
  navigateTo(currentPage);
  await loadStats();
}

async function loadStats() {
  if (!currentServer) return;
  try {
    const data = await apiFetch(`/servers/${currentServer.id}/stats`);
    lastData = data;
    renderStats(data);
    renderTable(data.subdomains);
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
  if (!timing?.matched) {
    card.hidden = true;
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderStats(data) {
  if (!data?.stats?.periods) return;
  const p = data.stats.periods[statsPeriod];
  if (!p) return;

  renderDonateTiming(data);

  const labels = STATS_PERIOD_LABELS[statsPeriod] || STATS_PERIOD_LABELS.year;
  document.getElementById('statLabelTotal').textContent   = labels.total;
  document.getElementById('statLabelUnique').textContent  = labels.unique;
  document.getElementById('statLabelDonated').textContent = labels.donated;
  document.getElementById('statToday').textContent        = formatNum(p.total);
  document.getElementById('statUnique').textContent       = formatNum(p.unique);
  document.getElementById('statSubdomains').textContent   = formatNum(p.subdomains);
  document.getElementById('statDonated').textContent      = formatMoney(p.donated);
}

function renderTable(subdomains) {
  const tbody = document.getElementById('tableBody');

  if (!subdomains || subdomains.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          Пока нет данных — подключите плагин и дождитесь первых входов
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = subdomains.map(row => {
    const donated = row.donated || 0;
    const donateCls = donated > 0 ? 'td-donate' : 'td-donate td-donate--zero';
    const donateLabel = donated > 0
      ? `${formatMoney(donated)}${row.donate_count > 1 ? ` <span class="td-muted">(${escapeHtml(String(row.donate_count))})</span>` : ''}`
      : '—';
    return `
    <tr>
      <td><span class="td-mono">${escapeHtml(row.subdomain)}</span></td>
      <td><span class="td-badge">${row.today}</span></td>
      <td>${row.week}</td>
      <td>${row.total}</td>
      <td class="${donateCls}">${donateLabel}</td>
      <td class="td-muted">${formatTime(row.last_seen)}</td>
    </tr>`;
  }).join('');
}

function formatHeatmapDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
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

function pluralEntries(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'вход';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'входа';
  return 'входов';
}

function pluralPlayers(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'игрок';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'игрока';
  return 'игроков';
}

function heatmapDayValue(day, metric = heatmapMetric) {
  return metric === 'unique' ? (day.unique ?? 0) : (day.total ?? 0);
}

function updateHeatmapLabels() {
  const sub = document.getElementById('chartMetricSub');
  if (sub) sub.textContent = heatmapMetric === 'unique' ? 'уникальных за год' : 'входов за год';
  const leg = document.getElementById('heatmapLegendZeroLabel');
  if (leg) leg.textContent = heatmapMetric === 'unique' ? '0 игроков' : '0 входов';
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
    const noun = metric === 'unique' ? pluralPlayers(value) : pluralEntries(value);
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
  let lastMonth = -1;

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
      const m = new Date(first.day + 'T12:00:00').getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        monthEl.textContent = MONTHS_SHORT[m];
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
  const bestDate = new Date(best.day + 'T12:00:00');
  const bestVal = heatmapDayValue(best);

  footer.innerHTML = [
    { label: 'Самый активный день', value: `${bestDate.getDate()} ${MONTHS_SHORT[bestDate.getMonth()]} · ${formatNum(bestVal)}` },
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
          currentServer = servers[0];
          await showDashboard();
        }
      }
    } else {
      if (viewParam && !isAdmin) {
        window.history.replaceState(null, '', 'dashboard.html');
      }
      servers = (await apiFetch('/servers')) || [];
      if (servers.length > 0) {
        currentServer = servers[0];
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

  document.getElementById('heatmapMetricTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-metric]');
    if (!btn) return;
    setHeatmapMetric(btn.dataset.metric);
  });

  document.querySelector('.sidebar__link[data-page="overview"]').addEventListener('click', e => {
    e.preventDefault();
    if (!currentServer) return;
    navigateTo('overview');
  });

  document.querySelector('.sidebar__link[data-page="settings"]').addEventListener('click', e => {
    e.preventDefault();
    openSettingsModal();
  });
  document.querySelector('.sidebar__link[data-page="integrations"]').addEventListener('click', e => {
    e.preventDefault();
    openIntegrationsModal();
  });
  document.querySelector('.sidebar__link[data-page="api"]').addEventListener('click', e => {
    e.preventDefault();
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
  document.getElementById('copyCallbackBtn').addEventListener('click', () => {
    copyText(
      document.getElementById('callbackUrlDisplay').value,
      document.getElementById('copyCallbackBtn')
    );
  });
  document.getElementById('sidebarSettingsBtn').addEventListener('click', e => {
    e.preventDefault();
    openSettingsModal();
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
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
            currentServer = servers[0];
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
    if (document.getElementById('integrationsOverlay').classList.contains('modal-overlay--open')) {
      closeIntegrationsModal();
    } else if (document.getElementById('settingsOverlay').classList.contains('modal-overlay--open')) {
      closeSettingsModal();
    } else {
      closeModal();
    }
  });

});
