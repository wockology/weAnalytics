function cleanSlug(input) {
  if (input == null) return '';
  return String(input).replace(/:\d+$/, '').toLowerCase().trim();
}

function isValidHostname(host) {
  if (!host || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return false;
  const labels = host.split('.');
  if (labels.length < 1) return false;
  return labels.every(
    label => label.length >= 1
      && label.length <= 63
      && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}

function normalizeSubdomain(input) {
  const slug = cleanSlug(input);
  if (!slug || !isValidHostname(slug)) return null;
  return slug;
}

function mergeDonationsPeriods(a, b) {
  const out = {};
  const keys = new Set([
    ...Object.keys(a || {}),
    ...Object.keys(b || {}),
  ]);
  for (const key of keys) {
    const pa = a?.[key] || { amount: 0, count: 0 };
    const pb = b?.[key] || { amount: 0, count: 0 };
    out[key] = {
      amount: (pa.amount || 0) + (pb.amount || 0),
      count:  (pa.count  || 0) + (pb.count  || 0),
    };
  }
  return out;
}

function mergeSubdomainRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = normalizeSubdomain(row.subdomain);
    if (!key) continue;
    const prev = map.get(key) || {
      subdomain:    key,
      today:        0,
      week:         0,
      total:        0,
      today_unique: 0,
      week_unique:  0,
      total_unique: 0,
      donations:    {},
      last_seen:    null,
    };
    prev.today += row.today || 0;
    prev.week += row.week || 0;
    prev.total += row.total || 0;
    prev.today_unique = Math.max(prev.today_unique, row.today_unique || 0);
    prev.week_unique = Math.max(prev.week_unique, row.week_unique || 0);
    prev.total_unique = Math.max(prev.total_unique, row.total_unique || 0);
    prev.donations = mergeDonationsPeriods(prev.donations, row.donations);
    if (row.last_seen && (!prev.last_seen || row.last_seen > prev.last_seen)) {
      prev.last_seen = row.last_seen;
    }
    map.set(key, prev);
  }
  return [...map.values()].sort(
    (a, b) => (b.donations?.all?.amount || 0) - (a.donations?.all?.amount || 0) || b.total - a.total
  );
}

module.exports = { cleanSlug, isValidHostname, normalizeSubdomain, mergeSubdomainRows };
