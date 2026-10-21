// BuyWise quantity-aware budget helpers (canonical).
// The procurement `budget` is a TOTAL budget in `currency` for `quantity` units.
// Unit prices on offers are per-unit. Never compare unit price to total budget
// directly: derive unit_budget = budget/quantity and total_estimate = unit*qty.
// Unknown taxes/shipping/availability make totals PARTIAL estimates, labeled.
export function toNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function unitBudget(budget, quantity) {
  const b = toNum(budget);
  const q = Number.isInteger(quantity) && quantity > 0 ? quantity : null;
  if (b === null || b <= 0 || q === null) return null;
  return b / q;
}

export function totalFor(unitPrice, quantity) {
  const u = toNum(unitPrice);
  const q = Number.isInteger(quantity) && quantity > 0 ? quantity : null;
  if (u === null || u <= 0 || q === null) return null;
  return Math.round(u * q * 100) / 100;
}

// Compare like with like. Returns { verdict: 1|0|null, basis, unit_price,
// unit_budget, total_estimate, total_budget, partial, reason }.
// verdict null = cannot determine (missing price, currency mismatch, no budget).
// partial=true when required costs (tax/shipping/terms) are unknown — the
// total excludes them and must be labeled a partial estimate.
export function budgetVerdict({ unitPrice, currency, budget, budgetCurrency, quantity }) {
  if (!(toNum(unitPrice) > 0) || !currency) return { verdict: null, reason: 'price unavailable' };
  if (!(toNum(budget) > 0) || !budgetCurrency) return { verdict: null, reason: 'budget unavailable' };
  if (String(currency).toUpperCase() !== String(budgetCurrency).toUpperCase()) {
    return { verdict: null, reason: 'currency mismatch (no FX source)' };
  }
  const q = Number.isInteger(quantity) && quantity > 0 ? quantity : null;
  if (q === null) return { verdict: null, reason: 'quantity unavailable' };
  const ub = unitBudget(budget, q);
  const total = totalFor(unitPrice, q);
  if (ub === null || total === null) return { verdict: null, reason: 'cannot derive totals' };
  return {
    verdict: unitPrice <= ub ? 1 : 0,
    basis: 'unit_vs_unit_total_vs_total',
    unit_price: unitPrice,
    unit_budget: Math.round(ub * 100) / 100,
    total_estimate: total,
    total_budget: budget,
    quantity: q,
    currency: String(currency).toUpperCase(),
    // Taxes, shipping, delivery, discounts and availability are never invented,
    // so every total here excludes them by construction.
    partial: true,
    partial_excludes: ['tax', 'shipping', 'delivery', 'discounts', 'availability'],
  };
}
