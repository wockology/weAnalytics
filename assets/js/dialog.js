(function () {
  let overlay;
  let titleEl;
  let messageEl;
  let iconEl;
  let actionsEl;
  let pendingResolve = null;
  let pendingMode = 'alert';

  function ensureDom() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'weaDialogOverlay';
    overlay.innerHTML = `
      <div class="modal modal--dialog" role="dialog" aria-modal="true" aria-labelledby="weaDialogTitle">
        <div class="modal__icon modal__icon--warn" id="weaDialogIcon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h2 class="modal__title" id="weaDialogTitle"></h2>
        <p class="modal__sub muted" id="weaDialogMessage"></p>
        <div class="modal__actions" id="weaDialogActions"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    titleEl = overlay.querySelector('#weaDialogTitle');
    messageEl = overlay.querySelector('#weaDialogMessage');
    iconEl = overlay.querySelector('#weaDialogIcon');
    actionsEl = overlay.querySelector('#weaDialogActions');

    overlay.addEventListener('click', e => {
      if (e.target === overlay && pendingMode === 'confirm') finish(false);
    });

    document.addEventListener('keydown', e => {
      if (!overlay.classList.contains('modal-overlay--open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(pendingMode === 'alert');
      }
    });
  }

  function finish(result) {
    overlay.classList.remove('modal-overlay--open');
    document.body.style.overflow = '';
    const resolve = pendingResolve;
    pendingResolve = null;
    if (resolve) resolve(result);
  }

  function bindButton(label, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    actionsEl.appendChild(btn);
    return btn;
  }

  function openDialog(opts) {
    ensureDom();
    const {
      mode = 'alert',
      title = mode === 'confirm' ? 'Подтвердите действие' : 'Уведомление',
      message = '',
      confirmLabel = mode === 'confirm' ? 'Удалить' : 'OK',
      cancelLabel = 'Отмена',
      danger = false,
      showIcon = mode === 'confirm',
    } = opts;

    pendingMode = mode;
    titleEl.textContent = title;
    messageEl.textContent = message;
    iconEl.hidden = !showIcon;
    actionsEl.innerHTML = '';

    if (mode === 'confirm') {
      bindButton(cancelLabel, 'btn btn--ghost', () => finish(false));
      bindButton(
        confirmLabel,
        danger ? 'btn btn--danger' : 'btn btn--primary',
        () => finish(true),
      );
    } else {
      bindButton(confirmLabel, 'btn btn--primary btn--block', () => finish(true));
    }

    document.body.style.overflow = 'hidden';
    overlay.classList.add('modal-overlay--open');

    return new Promise(resolve => {
      pendingResolve = resolve;
    });
  }

  window.showAlert = function showAlert(message, title = 'Уведомление') {
    return openDialog({ mode: 'alert', title, message, confirmLabel: 'OK', showIcon: false });
  };

  window.showConfirm = function showConfirm(message, options = {}) {
    return openDialog({
      mode: 'confirm',
      message,
      title: options.title ?? 'Подтвердите действие',
      confirmLabel: options.confirmLabel ?? 'Подтвердить',
      cancelLabel: options.cancelLabel ?? 'Отмена',
      danger: options.danger ?? false,
      showIcon: options.showIcon !== false,
    });
  };
})();
