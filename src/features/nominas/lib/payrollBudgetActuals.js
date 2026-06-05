/**
 * Payroll accruals as a Presupuesto actual source (Phase 3, item 4) — pure.
 *
 * Buckets each payroll period's cost into the 'Salarios' budget category keyed
 * by month index, mirroring BudgetVsActual's "categoryName|direction|monthIdx"
 * map shape so the UI can merge or compare it directly.
 *
 * IMPORTANT (double-counting): these are ACCRUALS (comprometido), not settled
 * cash. The consumer must present them as a distinct "comprometido" overlay or
 * REPLACE the cash actual for that month — it must never be added on top of the
 * paid movement for the same Salarios month, or payroll would be counted twice.
 *
 * @param {{
 *   periods: Array<{period:string, cashTotal?:number, employerCostTotal?:number}>,
 *   year: number|string,
 *   basis?: 'cashTotal'|'employerCostTotal'
 * }} params
 * @returns {Map<string, number>}  key = 'Salarios|expense|<monthIdx>'
 */
export const buildPayrollBudgetActuals = ({ periods, year, basis = 'cashTotal' } = {}) => {
  const map = new Map();
  if (!Array.isArray(periods)) return map;

  const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const targetYear = Number(year);

  for (const period of periods) {
    if (!period || !period.period) continue;
    if (Number(period.period.slice(0, 4)) !== targetYear) continue;
    const monthIdx = Number(period.period.slice(5, 7)) - 1;
    if (monthIdx < 0 || monthIdx > 11) continue;
    const amount = cents(period[basis]);
    const key = `Salarios|expense|${monthIdx}`;
    map.set(key, cents((map.get(key) || 0) + amount));
  }

  return map;
};
