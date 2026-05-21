function utcNowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function utcDateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function toUtcIso(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.includes('T')) return s.endsWith('Z') ? s : `${s}Z`;
  return `${s.replace(' ', 'T')}Z`;
}

function periodSinceUtc(period, now = new Date()) {
  if (period === 'day') return `${utcDateStr(now)} 00:00:00`;
  const t = now.getTime();
  if (period === 'week') {
    return new Date(t - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  }
  if (period === 'month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return start.toISOString().slice(0, 19).replace('T', ' ');
  }
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return yearStart.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { utcNowSql, utcDateStr, toUtcIso, periodSinceUtc };
