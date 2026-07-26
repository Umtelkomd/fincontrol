/**
 * Company obligations adapter — the app-facing wrapper over lib/finance
 * `buildObligationsCalendar`.
 *
 * This is the complete list of what the company owes inside the horizon:
 * open payables, payroll (net wages / social security / wage tax), VAT, AND
 * the active recurring-cost rules that have not been materialized into a
 * payable yet. `buildCashForecast` feeds it straight into the forecast, so
 * anything missing here is an outflow the projection will understate.
 *
 * Adds the two rules the pure calendar cannot know:
 *
 *   1. When a month HAS an imported payroll period, its obligations are
 *      MATERIALIZED as payables (source 'payroll', incl. the Lohnsteuer due
 *      in M+1), so that month's payroll ESTIMATES must be dropped entirely —
 *      the lib only skips net+social for 'pagada' months and never skips wage
 *      tax. Keeping both would double-count 'parcial'/'cargada' months.
 *   2. Recurring-cost rules generate payables month by month. A (rule, month)
 *      pair that already has a payable is dropped from the estimates — the
 *      real document carries it.
 *
 * VAT estimates always pass through (they only exist as config estimates).
 * Labels are rewritten to the Spanish UI copy so consumers render them as-is.
 */

import { buildObligationsCalendar } from '../lib/finance';
import { amountForPeriod, dueDateForPeriod, periodKey, ruleAppliesToPeriod } from './recurringGenerator';

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

/** Spanish label prefix per estimated obligation kind. */
const KIND_LABEL_ES = {
  'payroll-net': 'Nómina',
  social: 'Seguridad social',
  'wage-tax': 'Lohnsteuer',
  vat: 'IVA',
};

const withUiLabel = (item) => {
  const prefix = KIND_LABEL_ES[item.kind];
  if (!prefix || !item.month) return item;
  return { ...item, label: `${prefix} ${item.month}` };
};

/**
 * Recurring markers live at the top level on raw Firestore payables, but
 * `adaptPayableDoc` (the ledger shape) only keeps them under `raw`. Read both
 * so the dedupe works no matter which shape the caller passes.
 */
const recurringMarkersOf = (doc) => ({
  costId: doc?.recurringCostId ?? doc?.raw?.recurringCostId ?? null,
  period: doc?.recurringPeriod ?? doc?.raw?.recurringPeriod ?? null,
});

const isVoidedPayable = (doc) => doc?.status === 'cancelled' || doc?.status === 'void';

/**
 * Every (rule, month) pair that already exists as a live payable. A cancelled
 * or voided materialization does NOT count — that cost is still coming.
 */
const materializedRecurringKeys = (payables) => {
  const keys = new Set();
  for (const doc of payables || []) {
    if (isVoidedPayable(doc)) continue;
    const { costId, period } = recurringMarkersOf(doc);
    if (costId && period) keys.add(`${costId}|${period}`);
  }
  return keys;
};

/**
 * Expand active recurring-cost rules into obligations for every month whose
 * due date falls inside [today, horizonEnd] and that has no payable yet.
 *
 * @returns {import('../lib/finance/obligations.js').Obligation[]}
 */
const buildRecurringObligations = ({ recurringCosts, payables, today, horizonEnd }) => {
  const rules = (recurringCosts || []).filter((rule) => rule?.active);
  if (rules.length === 0) return [];

  const alreadyMaterialized = materializedRecurringKeys(payables);
  const items = [];

  const [endYear, endMonth] = horizonEnd.split('-').map(Number);
  let [year, month] = today.split('-').map(Number);

  while (year * 12 + month <= endYear * 12 + endMonth) {
    const period = periodKey(year, month);
    for (const rule of rules) {
      if (!ruleAppliesToPeriod(rule, year, month)) continue;
      if (alreadyMaterialized.has(`${rule.id}|${period}`)) continue;
      const date = dueDateForPeriod(rule, year, month);
      // A charge dated before today either already left the account (it is in
      // the bank balance) or is not provable — projecting it double-counts.
      if (date < today || date > horizonEnd) continue;
      items.push({
        date,
        kind: 'recurring',
        label: [rule.concept, rule.ownerName].filter(Boolean).join(' — ') || 'Costo recurrente',
        amount: amountForPeriod(rule),
        source: 'recurring-costs',
        overdue: false,
        estimated: true,
        month: period,
      });
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return items;
};

/**
 * @param {{
 *   payables?: Object[],
 *   payrollPeriods?: Array<{ period: string }>,
 *   vatEstimates?: Array<{ month: string, amount: number }>,
 *   recurringCosts?: Object[],
 *   today: string,
 *   horizonDays?: number,
 * }} params
 * @returns {import('../lib/finance/obligations.js').Obligation[]}
 */
export const buildCompanyObligations = ({
  payables,
  payrollPeriods,
  vatEstimates,
  recurringCosts,
  today,
  horizonDays = 60,
}) => {
  const calendar = buildObligationsCalendar({
    payables: payables || [],
    payrollPeriods: payrollPeriods || [],
    vatEstimates: vatEstimates || [],
    today,
    horizonDays,
  });

  const materializedMonths = new Set(
    (payrollPeriods || [])
      .map((p) => p?.period)
      .filter((key) => typeof key === 'string' && MONTH_KEY_RE.test(key)),
  );

  const horizonEnd = addDaysIso(today, horizonDays);
  const recurring = buildRecurringObligations({
    recurringCosts,
    payables,
    today,
    horizonEnd,
  });

  return [
    ...calendar.filter(
      (item) => !(item.source === 'payroll-average' && materializedMonths.has(item.month)),
    ),
    ...recurring,
  ]
    .map(withUiLabel)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.kind.localeCompare(b.kind) ||
        String(a.label).localeCompare(String(b.label)),
    );
};

/** Local ISO date arithmetic — mirrors `addDays` in lib/finance/dates.js, which is internal. */
function addDaysIso(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default buildCompanyObligations;
