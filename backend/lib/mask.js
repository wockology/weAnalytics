function maskSecret(value, visible = 12) {
  if (!value || typeof value !== 'string') return '—';
  if (value.length <= visible + 1) return '…';
  return `${value.slice(0, visible)}…`;
}

module.exports = { maskSecret };
