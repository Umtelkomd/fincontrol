/**
 * buildCashForecast — the ONE cash-flow projection in the app.
 *
 * Pure (no Firebase, no wall clock: the caller passes `today`). It assembles
 * the complete obligation picture and runs it through the single forecast
 * engine, `lib/finance/forecast.js`:
 *
 *   inflows   open receivables, expected COLLECTION_SLIP_DAYS after their due
 *             date (overdue ones expected immediately)
 *   outflows  open payables + payroll (net wages, social security, wage tax)
 *             + VAT estimates + active recurring-cost rules that have not
 *             been materialized into a payable yet
 *
 * There is no optimistic/pessimistic band and no scenario multiplier. Every
 * number here traces to a document, a configured estimate, or a recurring
 * rule the user created. The only modelled assumption is the collection slip,
 * which re-times committed money and never invents an amount; it is exposed
 * on the result as `collectionSlipDays` so screens can state it out loud.
 *
 * `startBalance` MUST be the anchor-derived cash position
 * (`ledger.summary.currentCash`). Every screen projects from the same day
 * zero — that is the whole point of this module.
 *
 * @typedef {import('../lib/finance/forecast.js').ForecastWeek & {
 *   week: string, label: string
 * }} CashForecastWeek
 */

import { COLLECTION_SLIP_DAYS, forecastHorizon, forecastWeeks } from '../lib/finance';
import { buildCompanyObligations } from './companyObligations';

/** Month abbreviations for week labels — fixed, so labels never vary by ICU build. */
const MONTH_ABBR_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

const dayMonthEs = (iso) => `${iso.slice(8, 10)} ${MONTH_ABBR_ES[Number(iso.slice(5, 7)) - 1]}`;

/** Statuses that take a document out of the forecast entirely. */
const CLOSED_STATUSES = new Set(['cancelled', 'void', 'settled', 'paid']);

const isForecastable = (doc) => doc && !CLOSED_STATUSES.has(doc.status);

/**
 * Build the committed cash forecast.
 *
 * @param {{
 *   startBalance: number,
 *   today: string,
 *   weeks?: number,
 *   receivables?: Object[],
 *   payables?: Object[],
 *   recurringCosts?: Object[],
 *   payrollPeriods?: Object[],
 *   vatEstimates?: Array<{ month: string, amount: number }>,
 *   collectionSlipDays?: number,
 * }} params
 * @returns {{
 *   weeks: CashForecastWeek[],
 *   obligations: import('../lib/finance/obligations.js').Obligation[],
 *   startBalance: number,
 *   totalInflow: number,
 *   totalOutflow: number,
 *   netHorizon: number,
 *   endBalance: number,
 *   firstNegativeWeek: CashForecastWeek|null,
 *   lowestWeek: CashForecastWeek|null,
 *   collectionSlipDays: number,
 *   horizonWeeks: number,
 *   horizonEnd: string,
 * }}
 */
export const buildCashForecast = ({
  startBalance = 0,
  today,
  weeks = 13,
  receivables = [],
  payables = [],
  recurringCosts = [],
  payrollPeriods = [],
  vatEstimates = [],
  collectionSlipDays = COLLECTION_SLIP_DAYS,
}) => {
  const horizon = forecastHorizon({ today, weeks });

  const openReceivables = (receivables || []).filter(isForecastable);
  const openPayables = (payables || []).filter(isForecastable);

  // Size the obligations window to exactly the weeks the forecast will build,
  // so nothing due inside the horizon is missed and nothing beyond it leaks in.
  const obligations = buildCompanyObligations({
    payables: openPayables,
    payrollPeriods,
    vatEstimates,
    recurringCosts,
    today,
    horizonDays: horizon.horizonDays,
  });

  const rawWeeks = forecastWeeks({
    startBalance,
    today,
    weeks,
    receivables: openReceivables,
    payables: openPayables,
    obligations,
    collectionSlipDays,
  });

  const decorated = rawWeeks.map((week, index) => ({
    ...week,
    week: `W${index + 1}`,
    label: `${dayMonthEs(week.weekStart)} - ${dayMonthEs(week.weekEnd)}`,
  }));

  const totalInflow = decorated.reduce((sum, week) => sum + week.inflow, 0);
  const totalOutflow = decorated.reduce((sum, week) => sum + week.outflow, 0);
  const lowestWeek = decorated.reduce(
    (min, week) => (min === null || week.projectedBalance < min.projectedBalance ? week : min),
    null,
  );

  const firstNegativeIndex = decorated.findIndex((week) => week.projectedBalance < 0);

  return {
    weeks: decorated,
    obligations,
    startBalance,
    totalInflow,
    totalOutflow,
    netHorizon: totalInflow + totalOutflow,
    endBalance: decorated.length > 0 ? decorated[decorated.length - 1].projectedBalance : startBalance,
    firstNegativeWeek: firstNegativeIndex >= 0 ? decorated[firstNegativeIndex] : null,
    // Whole weeks from now until cash goes under; 0 means "already this week".
    weeksToNegative: firstNegativeIndex >= 0 ? firstNegativeIndex : null,
    lowestWeek,
    collectionSlipDays,
    horizonWeeks: weeks,
    horizonEnd: horizon.horizonEnd,
  };
};

export default buildCashForecast;
