const PERIOD_KEYS = ['day', 'week', 'month', 'year'];

function maskPeriodRevenue(period) {
  if (!period) return;
  period.donated = null;
  period.donated_masked = true;
}

function maskPeriodDonateAnalytics(period) {
  if (!period) return;
  delete period.donate_timing;
  delete period.donate_products;
  if (period.insights) {
    period.insights.avg_check = null;
    period.insights.donation_count = null;
    period.insights.total_amount = null;
    period.insights.avg_check_masked = true;
  }
}

function maskDonateProductsMoney(products) {
  if (!products) return;
  products.avg_check = null;
  products.total_amount = null;
  products.avg_check_masked = true;
  products.top = (products.top || []).map(item => ({
    ...item,
    revenue: null,
    revenue_masked: true,
  }));
}

function maskStatsForPartner(payload, permissions) {
  const out = JSON.parse(JSON.stringify(payload));
  const perms = permissions || {};

  if (!perms.can_view_revenue) {
    PERIOD_KEYS.forEach(key => maskPeriodRevenue(out.stats?.periods?.[key]));

    if (Array.isArray(out.subdomains)) {
      out.subdomains = out.subdomains.map(row => ({
        ...row,
        donated: null,
        donate_count: null,
        donated_masked: true,
      }));
    }
  }

  if (!perms.can_view_donate_analytics) {
    PERIOD_KEYS.forEach(key => maskPeriodDonateAnalytics(out.stats?.periods?.[key]));
  } else if (!perms.can_view_revenue) {
    PERIOD_KEYS.forEach(key => {
      maskDonateProductsMoney(out.stats?.periods?.[key]?.donate_products);
      if (out.stats?.periods?.[key]?.insights) {
        out.stats.periods[key].insights.avg_check = null;
        out.stats.periods[key].insights.avg_check_masked = true;
      }
    });
  }

  return out;
}

module.exports = { maskStatsForPartner };
