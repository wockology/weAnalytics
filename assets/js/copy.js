/**
 * Copy text with Clipboard API, fallback to execCommand (works on HTTP).
 */
function fallbackCopyText(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function copyToClipboard(text) {
  const value = String(text ?? '');
  if (!value) return Promise.reject(new Error('empty'));

  return new Promise((resolve, reject) => {
    const finish = ok => (ok ? resolve() : reject(new Error('copy failed')));

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(() => finish(true)).catch(() => {
        finish(fallbackCopyText(value));
      });
      return;
    }
    finish(fallbackCopyText(value));
  });
}
