/**
 * buildCashForecast — the ONE cash-flow projection in the app.
 *
 * Pure (no Firebase, no wall clock: the caller passes `today`). It assembles
 * the complete obligation picture and runs it through the single forecast
 * engine, `lib/finance/forecast.js`:
 *
 *   inflows   open receivables, expected `collectionSlipDays` after their due
 *             date (overdue ones expected immediately)
 *   outflows  open payables + payroll (net wages, social security, wage tax)
 *             + VAT estimates + active recurring-cost rules that have not
 *             been materialized into a payable yet
 *
 * There is no optimistic/pessimistic band and no scenario multiplier. Every
 * number here traces to a document, a configured estimate, or a recurring
 * rule the user created. The only modelled assumption is the collection slip,
 * which re-times committed money and never invents an amount.
 *
 * That slip is MEASURED, not assumed: the same `receivables` array carries the
 * company's own collection history (invoices already settled), and
 * `deriveCollectionSlip` reads the amount-weighted delay out of it. Settled
 * documents feed the measurement and are then filtered out of the projection —
 * they are evidence, not future cash. When the history is too thin the
 * documented COLLECTION_SLIP_DAYS default is used instead. Both the number and
 * where it came from are exposed on the result (`collectionSlipDays`,
 * `collectionSlip`) so screens can state the assumption out loud.
 *
 * `startBalance` MUST be the anchor-derived cash position
 * (`ledger.summary.currentCash`). Every screen projects from the same day
 * zero — that is the whole point of this module.
 *
 * @typedef {import('../lib/finance/forecast.js').ForecastWeek & {
 *   week: string, label: string
 * }} CashForecastWeek
 */

import { deriveCollectionSlip, forecastHorizon, forecastWeeks } from '../lib/finance';
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
 * }} params - omit `collectionSlipDays` to use the slip measured from
 *   `receivables`; pass it only for sensitivity analysis.
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
 *   collectionSlip: {
 *     slipDays: number,
 *     sampleSize: number,
 *     confidence: 'measured'|'default'|'override',
 *   },
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
  collectionSlipDays,
}) => {
  const horizon = forecastHorizon({ today, weeks });

  // Measured BEFORE filtering: the settled invoices that carry the collection
  // history are exactly the ones `isForecastable` removes from the projection.
  const measuredSlip = deriveCollectionSlip({ receivables });
  const overrideSlip = Number(collectionSlipDays);
  const isOverridden = collectionSlipDays !== undefined && Number.isFinite(overrideSlip);
  const slipDays = isOverridden ? overrideSlip : measuredSlip.slipDays;
  const collectionSlip = isOverridden
    ? { slipDays, sampleSize: measuredSlip.sampleSize, confidence: 'override' }
    : measuredSlip;

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
    collectionSlipDays: slipDays,
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
    collectionSlipDays: slipDays,
    collectionSlip,
    horizonWeeks: weeks,
    horizonEnd: horizon.horizonEnd,
  };
};

export default buildCashForecast;
