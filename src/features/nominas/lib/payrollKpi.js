/**
 * Nómina-as-% -of-revenue KPI helpers (Phase 3, item 5) — pure, no side effects.
 *
 * Uses the CASH obligation (cashTotal) as the payroll cost basis by default,
 * compared against revenue (totalIn from bank movements). Revenue <= 0 yields a
 * null pct — never a divide-by-zero.
 */

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {{ payrollCost:number, revenue:number }} params
 * @returns {{ pct:number|null, ratio:number|null }}
 */
export const payrollAsPctOfRevenue = ({ payrollCost, revenue } = {}) => {
  const cost = Number(payrollCost) || 0;
  const rev = Number(revenue) || 0;
  if (rev <= 0) return { pct: null, ratio: null };
  const ratio = cost / rev;
  return { pct: cents(ratio * 100), ratio };
};

/**
 * Sum cashTotal over all periods, or only those whose period key is in
 * `monthKeys` when provided.
 *
 * @param {Array<{period:string, cashTotal:number}>} periods
 * @param {Array<string>} [monthKeys]
 * @returns {number}
 */
export const sumPayrollCash = (periods, monthKeys) => {
  if (!Array.isArray(periods)) return 0;
  const allow = Array.isArray(monthKeys) ? new Set(monthKeys) : null;
  return cents(
    periods.reduce((sum, p) => {
      if (allow && !allow.has(p.period)) return sum;
      return sum + (Number(p.cashTotal) || 0);
    }, 0),
  );
};
