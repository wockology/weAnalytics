const eyeOpen  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const eyeClosed = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const checkmark = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

function setError(field, hasError) {
  field.classList.toggle('field--error', hasError);
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function initToggle(toggleId, inputId) {
  const input  = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if (!input || !toggle) return;
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.innerHTML = show ? eyeClosed : eyeOpen;
  });
}

function handleSuccess(btn) {
  btn.classList.remove('btn--loading');
  btn.classList.add('btn--success');
  btn.innerHTML = checkmark;
  setTimeout(() => { window.location.href = 'dashboard.html'; }, 2500);
}

function showFormError(form, msg) {
  let el = form.querySelector('.form-error');
  if (!el) {
    el = document.createElement('div');
    el.className = 'form-error';
    form.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'flex';
}

function clearFormError(form) {
  const el = form.querySelector('.form-error');
  if (el) el.style.display = 'none';
}

function initLogin() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(form);
    let valid = true;

    const emailField = document.getElementById('field-email');
    const emailVal   = emailField.querySelector('input').value;
    const emailOk    = isValidEmail(emailVal);
    setError(emailField, !emailOk);
    if (!emailOk) valid = false;

    const pwField = document.getElementById('field-password');
    const pwVal   = pwField.querySelector('input').value;
    const pwOk    = pwVal.length > 0;
    setError(pwField, !pwOk);
    if (!pwOk) valid = false;

    if (!valid) return;

    const btn = document.getElementById('loginBtn');
    btn.classList.add('btn--loading');

    try {
      const res  = await fetch('/api/auth/login', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ email: emailVal.trim(), password: pwVal }),
      });
      const data = await res.json();

      if (!res.ok) {
        btn.classList.remove('btn--loading');
        showFormError(form, data.error || 'Ошибка входа');
        return;
      }

      const remember = form.querySelector('input[name="remember"]').checked;
      const store = remember ? localStorage : sessionStorage;
      store.setItem('wea_token',    data.token);
      store.setItem('wea_username', data.username);
      handleSuccess(btn);
    } catch {
      btn.classList.remove('btn--loading');
      showFormError(form, 'Не удалось подключиться к серверу');
    }
  });

  form.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      input.closest('.field').classList.remove('field--error');
      clearFormError(form);
    });
  });

  initToggle('loginToggle', 'loginPwd');
}

function initRegister() {
  const form = document.getElementById('registerForm');
  if (!form) return;

  const pwd           = document.getElementById('passwordInput');
  const bars          = document.querySelectorAll('.strength__bars span');
  const strengthLabel = document.querySelector('.strength__label');
  const levels = [
    { text: 'Слишком короткий', cls: 'lvl-0', count: 0 },
    { text: 'Слабый',           cls: 'lvl-1', count: 1 },
    { text: 'Средний',          cls: 'lvl-2', count: 2 },
    { text: 'Хороший',          cls: 'lvl-3', count: 3 },
    { text: 'Надёжный',         cls: 'lvl-4', count: 4 },
  ];

  function score(v) {
    if (!v || v.length < 6) return 0;
    let s = 0;
    if (v.length >= 8)                          s++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v))    s++;
    if (/\d/.test(v))                           s++;
    if (/[^A-Za-z0-9]/.test(v))                s++;
    return s;
  }

  pwd?.addEventListener('input', (e) => {
    document.getElementById('field-password').classList.remove('field--error');
    const lvl = levels[score(e.target.value)];
    bars.forEach((b, i) => { b.className = i < lvl.count ? lvl.cls : ''; });
    strengthLabel.textContent = lvl.text;
    strengthLabel.classList.toggle('muted', lvl.count === 0);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(form);
    let valid = true;

    const usernameField = document.getElementById('field-username');
    const usernameVal   = usernameField.querySelector('input').value.trim();
    const usernameOk    = usernameVal.length > 0;
    setError(usernameField, !usernameOk);
    if (!usernameOk) valid = false;

    const emailField = document.getElementById('field-email');
    const emailVal   = emailField.querySelector('input').value;
    const emailOk    = isValidEmail(emailVal);
    setError(emailField, !emailOk);
    if (!emailOk) valid = false;

    const pwField = document.getElementById('field-password');
    const pwVal   = pwField.querySelector('input').value;
    const pwOk    = pwVal.length >= 8;
    setError(pwField, !pwOk);
    if (!pwOk) valid = false;

    const inviteField = document.getElementById('field-invite');
    const inviteVal   = inviteField?.querySelector('input')?.value?.trim() || '';
    const inviteOk    = inviteVal.length > 0;
    setError(inviteField, !inviteOk);
    if (!inviteOk) valid = false;

    if (!valid) return;

    const btn = document.getElementById('regBtn');
    btn.classList.add('btn--loading');

    try {
      const res  = await fetch('/api/auth/register', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({
          username:   usernameVal,
          email:      emailVal.trim(),
          password:   pwVal,
          invite_code: inviteVal,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        btn.classList.remove('btn--loading');
        if (data.error?.includes('приглашения')) {
          inviteField.querySelector('.field__error').textContent = data.error;
          setError(inviteField, true);
        } else if (data.error?.includes('Никнейм')) {
          usernameField.querySelector('.field__error').textContent = data.error;
          setError(usernameField, true);
        } else if (data.error?.includes('Email')) {
          emailField.querySelector('.field__error').textContent = data.error;
          setError(emailField, true);
        } else {
          showFormError(form, data.error || 'Ошибка регистрации');
        }
        return;
      }

      localStorage.setItem('wea_token',    data.token);
      localStorage.setItem('wea_username', data.username);
      handleSuccess(btn);
    } catch {
      btn.classList.remove('btn--loading');
      showFormError(form, 'Не удалось подключиться к серверу');
    }
  });

  form.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      input.closest('.field')?.classList.remove('field--error');
      clearFormError(form);
    });
  });

  initToggle('regToggle', 'passwordInput');
}

document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  initRegister();
});
