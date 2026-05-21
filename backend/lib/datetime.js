function utcNowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function toUtcIso(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.includes('T')) return s.endsWith('Z') ? s : `${s}Z`;
  return `${s.replace(' ', 'T')}Z`;
}

module.exports = { utcNowSql, toUtcIso };
