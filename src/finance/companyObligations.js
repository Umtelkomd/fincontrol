/**
 * Company obligations adapter — the app-facing wrapper over lib/finance
 * `buildObligationsCalendar`.
 *
 * Adds the one rule the pure calendar cannot know: when a month HAS an
 * imported payroll period, its obligations are MATERIALIZED as payables
 * (source 'payroll', incl. the Lohnsteuer due in M+1), so that month's
 * payroll ESTIMATES must be dropped entirely — the lib only skips net+social
 * for 'pagada' months and never skips wage tax. Keeping both would
 * double-count 'parcial'/'cargada' months.
 *
 * VAT estimates always pass through (they only exist as config estimates).
 * Labels are rewritten to the Spanish UI copy so consumers render them as-is.
 */

import { buildObligationsCalendar } from '../lib/finance';

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
 * @param {{
 *   payables?: Object[],
 *   payrollPeriods?: Array<{ period: string }>,
 *   vatEstimates?: Array<{ month: string, amount: number }>,
 *   today: string,
 *   horizonDays?: number,
 * }} params
 * @returns {import('../lib/finance/obligations.js').Obligation[]}
 */
export const buildCompanyObligations = ({
  payables,
  payrollPeriods,
  vatEstimates,
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

  return calendar
    .filter((item) => !(item.source === 'payroll-average' && materializedMonths.has(item.month)))
    .map(withUiLabel);
};

export default buildCompanyObligations;
