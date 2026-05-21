function cleanSlug(input) {
  if (input == null) return '';
  return String(input).replace(/:\d+$/, '').toLowerCase().trim();
}

function normalizeSubdomain(input) {
  const slug = cleanSlug(input);
  return slug || null;
}

function mergeSubdomainRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = normalizeSubdomain(row.subdomain);
    if (!key) continue;
    const prev = map.get(key) || {
      subdomain: key,
      today: 0,
      week: 0,
      total: 0,
      donated: 0,
      donate_count: 0,
      last_seen: null,
    };
    prev.today += row.today || 0;
    prev.week += row.week || 0;
    prev.total += row.total || 0;
    prev.donated += row.donated || 0;
    prev.donate_count += row.donate_count || 0;
    if (row.last_seen && (!prev.last_seen || row.last_seen > prev.last_seen)) {
      prev.last_seen = row.last_seen;
    }
    map.set(key, prev);
  }
  return [...map.values()].sort(
    (a, b) => (b.donated || 0) - (a.donated || 0) || b.total - a.total
  );
}

module.exports = { cleanSlug, normalizeSubdomain, mergeSubdomainRows };
