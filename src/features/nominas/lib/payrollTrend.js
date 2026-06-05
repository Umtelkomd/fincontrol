/**
 * Payroll monthly-trend pure helpers (Phase 3, item 1) — no side effects.
 *
 * Trends BOTH the cash obligation (cashTotal = KK + Lohnsteuer + net wages) and
 * the true company cost (employerCostTotal = sum of per-line gesamtkosten), plus
 * the delta between them (the non-cash employer load). These are DIFFERENT totals
 * on purpose — never mix them.
 *
 * All money rounded to cents; percentages left as raw floats (the panel rounds
 * for display).
 */

import { monthLabel } from './payroll.js';

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Build the period-sorted trend series.
 *
 * @param {Array<{period:string, cashTotal?:number, employerCostTotal?:number}>} periods
 * @returns {Array<{period:string, label:string, cashTotal:number, employerCostTotal:number, delta:number}>}
 */
export const buildPayrollTrend = (periods) => {
  if (!Array.isArray(periods) || periods.length === 0) return [];
  return [...periods]
    .filter((p) => p && p.period)
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .map((p) => {
      const cashTotal = cents(p.cashTotal);
      const employerCostTotal = cents(p.employerCostTotal);
      return {
        period: p.period,
        label: monthLabel(p.period),
        cashTotal,
        employerCostTotal,
        delta: cents(employerCostTotal - cashTotal),
      };
    });
};

/**
 * Per-point month-over-month % change for a numeric field.
 * First point is null (no prior). Prev=0 yields 0 (never Infinity/NaN).
 *
 * @param {Array<object>} series
 * @param {string} field
 * @returns {Array<number|null>}
 */
export const momChange = (series, field) => {
  if (!Array.isArray(series)) return [];
  return series.map((point, i) => {
    if (i === 0) return null;
    const prev = Number(series[i - 1]?.[field]) || 0;
    const curr = Number(point?.[field]) || 0;
    if (prev === 0) return 0;
    return ((curr - prev) / prev) * 100;
  });
};

/**
 * Trailing N-month rolling average for a numeric field. The head uses a partial
 * window (fewer points). Window larger than the series never throws.
 *
 * @param {Array<object>} series
 * @param {string} field
 * @param {number} [window=3]
 * @returns {Array<number>}
 */
export const rollingAverage = (series, field, window = 3) => {
  if (!Array.isArray(series)) return [];
  const size = Math.max(1, Number(window) || 1);
  return series.map((_, i) => {
    const start = Math.max(0, i - size + 1);
    const slice = series.slice(start, i + 1);
    const sum = slice.reduce((acc, p) => acc + (Number(p?.[field]) || 0), 0);
    return cents(sum / slice.length);
  });
};
