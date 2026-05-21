const { db } = require('../db');

function parseProductsJson(raw) {
  if (!raw || !String(raw).trim()) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.products)) return data.products;
    return [];
  } catch {
    return [];
  }
}

function productQty(product) {
  const n = Number(product?.count ?? product?.number ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function productUnitCost(product) {
  const n = parseFloat(product?.cost ?? product?.price ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function productKey(product) {
  if (product?.id != null && String(product.id).trim()) {
    return `id:${String(product.id).trim()}`;
  }
  const name = String(product?.name || '').trim().toLowerCase();
  return name ? `name:${name}` : null;
}

function productName(product) {
  const name = String(product?.name || '').trim();
  if (name) return name.slice(0, 80);
  if (product?.id != null) return `Товар #${product.id}`;
  return 'Без названия';
}

function lineRevenue(product, paymentAmount, itemsInPayment) {
  const qty = productQty(product);
  const unit = productUnitCost(product);
  if (unit > 0) return unit * qty;
  if (itemsInPayment === 1) return paymentAmount;
  return itemsInPayment > 0 ? paymentAmount / itemsInPayment : 0;
}

function buildDonateProducts(serverId, since = null) {
  const filtered = db.prepare(`
    SELECT amount, products
    FROM donations
    WHERE server_id = ? AND (? IS NULL OR donated_at >= ?)
    ORDER BY donated_at ASC
  `).all(serverId, since, since);

  const totals = {
    donation_count: 0,
    total_amount:   0,
    with_products:  0,
  };
  const byProduct = new Map();

  for (const row of filtered) {
    const amount = parseFloat(row.amount) || 0;
    totals.donation_count += 1;
    totals.total_amount += amount;

    const items = parseProductsJson(row.products);
    if (!items.length) continue;

    totals.with_products += 1;
    const validItems = items.filter(p => productKey(p));
    const itemCount = Math.max(1, validItems.length);

    for (const product of validItems) {
      const key = productKey(product);
      if (!key) continue;

      const qty = productQty(product);
      const revenue = lineRevenue(product, amount, itemCount);
      const prev = byProduct.get(key) || {
        id:           product.id ?? null,
        name:         productName(product),
        sales_count:  0,
        revenue:      0,
      };
      prev.sales_count += qty;
      prev.revenue += revenue;
      if (!prev.name && productName(product)) prev.name = productName(product);
      byProduct.set(key, prev);
    }
  }

  const avgCheck = totals.donation_count > 0
    ? Math.round((totals.total_amount / totals.donation_count) * 100) / 100
    : null;

  const top = [...byProduct.values()]
    .sort((a, b) => b.revenue - a.revenue || b.sales_count - a.sales_count)
    .slice(0, 8)
    .map(p => ({
      id:          p.id,
      name:        p.name,
      sales_count: p.sales_count,
      revenue:     Math.round(p.revenue * 100) / 100,
    }));

  return {
    donation_count: totals.donation_count,
    total_amount:   Math.round(totals.total_amount * 100) / 100,
    avg_check:      avgCheck,
    with_products:  totals.with_products,
    top,
  };
}

module.exports = { buildDonateProducts, parseProductsJson };
