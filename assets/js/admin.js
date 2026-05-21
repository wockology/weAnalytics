let token = localStorage.getItem('wea_token') || '';

const PAGE_TITLES = {
  overview: 'Обзор',
  users:    'Пользователи',
  invites:  'Коды приглашения',
};

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = 'Bearer ' + token;

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
    window.location.href = 'login.html';
    throw new Error('Не авторизован');
  }
  if (res.status === 403) {
    window.location.href = 'dashboard.html';
    throw new Error('Нет доступа');
  }
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

function formatMoney(n) {
  const val = Number(n) || 0;
  return val.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

function setAdminPage(page) {
  document.querySelectorAll('[data-admin-page]').forEach(link => {
    link.classList.toggle('sidebar__link--active', link.dataset.adminPage === page);
  });
  document.getElementById('adminPageTitle').textContent = PAGE_TITLES[page] || 'Админка';
  document.getElementById('panelOverview').hidden = page !== 'overview';
  document.getElementById('panelUsers').hidden    = page !== 'users';
  document.getElementById('panelInvites').hidden  = page !== 'invites';
}

function avatarPalette(name) {
  let hash = 0;
  const s = name || 'admin';
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 35% 28%)`;
}

async function loadStats() {
  const s = await apiFetch('/admin/stats');
  document.getElementById('statUsers').textContent   = s.users;
  document.getElementById('statServers').textContent = s.servers;
  document.getElementById('statEvents').textContent  = s.events;
  document.getElementById('statDonated').textContent = formatMoney(s.donated);
}

function renderUsers(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Нет пользователей</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => `
    <tr>
      <td><span class="td-mono">${escapeHtml(u.username)}</span></td>
      <td class="td-muted">${escapeHtml(u.email)}</td>
      <td><span class="td-badge">${u.server_count}</span></td>
      <td>${u.is_admin ? '<span class="tag tag--admin">Админ</span>' : '<span class="tag">Пользователь</span>'}</td>
      <td>${u.is_blocked ? '<span class="tag tag--blocked">Заблокирован</span>' : '<span class="tag">Активен</span>'}</td>
      <td class="col-actions">
        <div class="td-actions">
          ${u.server_id
            ? `<a href="dashboard.html?server=${u.server_id}" class="btn-flat btn-sm">Открыть</a>`
            : ''}
          ${u.is_admin
            ? `<button type="button" class="btn-flat btn-sm" data-action="demote" data-id="${u.id}">Снять админа</button>`
            : `<button type="button" class="btn-flat btn-sm" data-action="promote" data-id="${u.id}">Админ</button>`}
          ${u.is_blocked
            ? `<button type="button" class="btn-flat btn-sm" data-action="unblock" data-id="${u.id}">Разблокировать</button>`
            : `<button type="button" class="btn-flat btn-sm" data-action="block" data-id="${u.id}">Заблокировать</button>`}
        </div>
      </td>
    </tr>
  `).join('');
}

function renderInvites(invites) {
  const tbody = document.getElementById('invitesTableBody');
  if (!invites.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Нет кодов</td></tr>';
    return;
  }
  tbody.innerHTML = invites.map(i => {
    const used = `${i.uses_count} / ${i.max_uses}`;
    const exhausted = i.uses_count >= i.max_uses;
    return `
      <tr>
        <td>
          <div class="admin-code-cell">
            <code class="inline-code">${escapeHtml(i.code)}</code>
            <button type="button" class="btn-flat btn-sm" data-copy="${escapeAttr(i.code)}">Копировать</button>
          </div>
        </td>
        <td>${i.is_admin ? '<span class="tag tag--admin">Админ</span>' : '<span class="tag">Пользователь</span>'}</td>
        <td><span class="td-badge${exhausted ? ' td-muted' : ''}">${used}</span></td>
        <td class="td-muted">${escapeHtml(i.note || '—')}</td>
        <td class="col-actions">
          ${i.uses_count === 0
            ? `<button type="button" class="btn-flat btn-sm" data-delete-invite="${i.id}">Удалить</button>`
            : '<span class="td-muted">—</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

async function loadUsers() {
  renderUsers(await apiFetch('/admin/users'));
}

async function loadInvites() {
  renderInvites(await apiFetch('/admin/invites'));
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const me = await apiFetch('/auth/me');
    if (!me.isAdmin) {
      window.location.href = 'dashboard.html';
      return;
    }
    token = me.token;
    localStorage.setItem('wea_token', token);
    localStorage.setItem('wea_is_admin', '1');
    document.getElementById('adminUsername').textContent = me.username;
    const av = document.getElementById('adminAvatar');
    av.textContent = (me.username[0] || 'A').toUpperCase();
    av.style.background = avatarPalette(me.username);

    await loadStats();
    setAdminPage('overview');
  } catch {
    return;
  }

  document.querySelectorAll('[data-admin-page]').forEach(link => {
    link.addEventListener('click', async e => {
      e.preventDefault();
      const page = link.dataset.adminPage;
      setAdminPage(page);
      if (page === 'overview') await loadStats();
      if (page === 'users') await loadUsers();
      if (page === 'invites') await loadInvites();
    });
  });

  document.getElementById('createInviteBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('inviteCreateError');
    const okEl  = document.getElementById('inviteCreatedMsg');
    errEl.hidden = true;
    okEl.hidden  = true;

    try {
      const data = await apiFetch('/admin/invites', {
        method: 'POST',
        body:   JSON.stringify({
          is_admin:  document.getElementById('inviteIsAdmin').checked,
          max_uses:  parseInt(document.getElementById('inviteMaxUses').value, 10) || 1,
          note:      document.getElementById('inviteNote').value.trim(),
        }),
      });
      okEl.textContent = `Код создан: ${data.code}`;
      okEl.hidden = false;
      document.getElementById('inviteNote').value = '';
      await loadInvites();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  document.getElementById('usersTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    const action = btn.dataset.action;
    const body = {};
    if (action === 'promote') body.is_admin = true;
    if (action === 'demote') body.is_admin = false;
    if (action === 'block') body.is_blocked = true;
    if (action === 'unblock') body.is_blocked = false;
    try {
      await apiFetch(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await loadUsers();
    } catch (err) {
      await showAlert(err.message, 'Ошибка');
    }
  });

  document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'login.html';
  });

  document.getElementById('invitesTableBody').addEventListener('click', async e => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      const code = copyBtn.dataset.copy;
      try {
        await copyToClipboard(code);
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = 'Копировать'; }, 1500);
      } catch {
        await showAlert('Не удалось скопировать', 'Ошибка');
      }
      return;
    }
    const delBtn = e.target.closest('[data-delete-invite]');
    if (!delBtn) return;
    const ok = await showConfirm('Удалить неиспользованный код?', {
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/admin/invites/${delBtn.dataset.deleteInvite}`, { method: 'DELETE' });
      await loadInvites();
    } catch (err) {
      await showAlert(err.message, 'Ошибка');
    }
  });
});
