/**
 * Resumen metrics — pure math, no React, no Firestore.
 *
 * The "Resumen / Cómo va la empresa" view is a presentational composition over
 * existing engines (useTreasuryMetrics, runway.js, payrollAllocation). The ONLY
 * genuinely new logic lives here:
 *
 *   computeMonthlyResult({ income, expenses, payrollCost })
 *     → { income, baseExpenses, payrollCost, totalExpenses, result, isProfit }
 *     WHY: settled cash movements do NOT include unpaid payroll (payroll is a
 *     CXP payable until paid, not a posted bank movement), so the current
 *     month's payroll cost must be added explicitly or the result lies.
 *
 *   selectDueWithinDays(items, days, asOfDate?)
 *     → items whose dueDate falls in [asOf, asOf+days] inclusive, sorted
 *       ascending by dueDate (stable on ties). Skips items without a dueDate.
 *       Used for the "próximos vencimientos" list (CXC + CXP, incl. payroll).
 *
 *   runwayWeeks(months)
 *     → months * 4.345 rounded to 1 decimal; Infinity/null/NaN → Infinity.
 *
 * Conventions (round2, toIso, addDaysIso, __internal) keep the helpers
 * deterministic and easy to unit-test without React or Firestore.
 */

const WEEKS_PER_MONTH = 4.345;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

const toIso = (date) => {
  if (!date) return null;
  if (typeof date === 'string') return date.slice(0, 10);
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }
  return null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const addDaysIso = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Non-negative coercion: NaN, undefined, negative → 0. Money inputs in the
 * monthly result must never go negative (a negative "expense" would silently
 * inflate profit). round2 keeps parity with runway.js.
 */
const nonNegMoney = (n) => {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return 0;
  return round2(value);
};

/**
 * Did we make or lose money this month, WITH payroll counted as a cost?
 *
 * @param {object} args
 * @param {number} args.income       settled cash inflows for the month
 * @param {number} args.expenses     settled cash outflows for the month (base)
 * @param {number} [args.payrollCost] the still-UNPAID payroll for the month to
 *   add on top. Payroll already PAID is in `expenses` (a cash 'out'), so the
 *   caller passes only the unpaid obligations here → payroll is counted exactly
 *   once, no double-count. 0 when payroll is unavailable (no cxp permission /
 *   no period loaded).
 * @returns {{ income, baseExpenses, payrollCost, totalExpenses, result, isProfit }}
 */
export const computeMonthlyResult = ({ income, expenses, payrollCost } = {}) => {
  const safeIncome = nonNegMoney(income);
  const baseExpenses = nonNegMoney(expenses);
  const safePayroll = nonNegMoney(payrollCost);
  const totalExpenses = round2(baseExpenses + safePayroll);
  const result = round2(safeIncome - totalExpenses);

  return {
    income: safeIncome,
    baseExpenses,
    payrollCost: safePayroll,
    totalExpenses,
    result,
    isProfit: result > 0,
  };
};

/**
 * Pick the items due within the next `days` days, soonest first.
 *
 * Window is inclusive on both ends: [asOf, asOf+days]. Items without a usable
 * dueDate are skipped. Sort is ascending by ISO dueDate and stable on ties, so
 * the "next few" list is deterministic. All original fields (openAmount,
 * payrollKind, counterpartyName, description, kind, …) are preserved untouched —
 * payroll-kind payables flow through like any other item, no special-casing.
 *
 * @param {Array} items   CXC / CXP open documents with a dueDate + openAmount
 * @param {number} days   window size in days
 * @param {string|Date} [asOfDate] defaults to today
 * @returns {Array} filtered + sorted copy of the matching items
 */
export const selectDueWithinDays = (items, days, asOfDate) => {
  if (!Array.isArray(items) || items.length === 0) return [];

  const safeDays = Math.max(0, Math.floor(Number(days) || 0));
  const asOf = toIso(asOfDate) || todayIso();
  const windowEnd = addDaysIso(asOf, safeDays);

  return items
    .map((entry, index) => ({ entry, index, due: toIso(entry?.dueDate) }))
    .filter(({ due }) => due && due >= asOf && due <= windowEnd)
    .sort((a, b) => {
      if (a.due === b.due) return a.index - b.index; // stable on ties
      return a.due < b.due ? -1 : 1;
    })
    .map(({ entry }) => entry);
};

/**
 * Estimated fiscal obligations (IVA / SV / Lohnsteuer / nómina) shaped as
 * DueList pseudo-items for the "Próximos pagos" list. Documents (`kind:
 * 'payable'`) are excluded — the real payables list already carries them.
 * Calendar-safe UTC date math (same addDaysIso as selectDueWithinDays) so a
 * document and an estimate due the same day never land on opposite sides of
 * the window cutoff.
 *
 * @param {Array<{ date: string, kind: string, label: string, amount: number, month?: string }>} obligations
 * @param {number} days       window size in days
 * @param {string|Date} [asOfDate] defaults to today
 * @returns {Array<{ id, counterpartyName, dueDate, openAmount, estimated }>}
 */
export const selectUpcomingObligations = (obligations, days, asOfDate) => {
  if (!Array.isArray(obligations) || obligations.length === 0) return [];

  const safeDays = Math.max(0, Math.floor(Number(days) || 0));
  const asOf = toIso(asOfDate) || todayIso();
  const windowEnd = addDaysIso(asOf, safeDays);

  return obligations
    .filter(
      (item) =>
        item &&
        item.kind !== 'payable' &&
        typeof item.date === 'string' &&
        item.date >= asOf &&
        item.date <= windowEnd &&
        (Number(item.amount) || 0) > 0,
    )
    .map((item) => ({
      id: `obligation:${item.kind}:${item.month || item.date}`,
      counterpartyName: item.label,
      dueDate: item.date,
      openAmount: Number(item.amount) || 0,
      estimated: true,
    }));
};

/**
 * Convert a runway expressed in months to whole weeks for a scannable display.
 * Non-finite / null months (infinite runway, no burn) collapse to Infinity so
 * the caller can render an ∞ sentinel.
 */
export const runwayWeeks = (months) => {
  // null/undefined mean "no finite runway computed" → ∞ sentinel, not 0.
  // (Number(null) === 0 would otherwise leak through as a finite 0.)
  if (months === null || months === undefined) return Infinity;
  const value = Number(months);
  if (!Number.isFinite(value)) return Infinity;
  return round1(value * WEEKS_PER_MONTH);
};

/**
 * Monthly cash-flow series for the Resumen charts.
 *
 * Builds N monthly buckets ending with the month containing `referenceDate`.
 * Each bucket aggregates posted bank movements by direction ('in'/'out') and
 * walks a running balance forward from `startingBalance`. Movements outside
 * the window are skipped. Empty months produce zero inflows/outflows and carry
 * the previous balance forward.
 *
 * @param {object} args
 * @param {Array} args.postedMovements  movements with { postedDate, direction, amount }
 * @param {string|Date} [args.referenceDate] defaults to today
 * @param {number} [args.monthsCount=12]  number of monthly buckets
 * @param {number} [args.startingBalance=0]  balance at the beginning of the window
 * @returns {Array<{ key, label, inflows, outflows, net, balance }>}
 */
export const buildMonthlyCashFlowSeries = ({
  postedMovements = [],
  referenceDate = new Date(),
  monthsCount = 12,
  startingBalance = 0,
} = {}) => {
  const asOf = toIso(referenceDate) || todayIso();
  const asOfDate = new Date(`${asOf}T00:00:00Z`);
  const safeMonths = Math.max(1, Math.floor(Number(monthsCount) || 12));
  const startBalance = round2(Number(startingBalance) || 0);

  // Build the bucket keys (YYYY-MM) from N-1 months before asOf up to asOf's month.
  const buckets = [];
  for (let offset = safeMonths - 1; offset >= 0; offset -= 1) {
    const d = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() - offset, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
    buckets.push({ key, label, inflows: 0, outflows: 0, net: 0, balance: startBalance });
  }

  // Index buckets by key for O(1) lookup
  const byKey = new Map(buckets.map((b, i) => [b.key, i]));

  // Aggregate movements into buckets
  const windowStartKey = buckets[0].key;
  const windowEndKey = buckets[buckets.length - 1].key;

  postedMovements.forEach((entry) => {
    const iso = toIso(entry?.postedDate);
    if (!iso) return;
    const key = iso.slice(0, 7); // YYYY-MM
    if (key < windowStartKey || key > windowEndKey) return;
    const idx = byKey.get(key);
    if (idx === undefined) return;
    const amount = Number(entry?.amount) || 0;
    if (entry?.direction === 'in') buckets[idx].inflows += amount;
    else if (entry?.direction === 'out') buckets[idx].outflows += amount;
  });

  // Round inflows/outflows and walk running balance forward
  let running = startBalance;
  buckets.forEach((b) => {
    b.inflows = round2(b.inflows);
    b.outflows = round2(b.outflows);
    b.net = round2(b.inflows - b.outflows);
    running = round2(running + b.net);
    b.balance = running;
  });

  return buckets;
};

// Exposed for tests
export const __internal = {
  round2,
  round1,
  toIso,
  addDaysIso,
  nonNegMoney,
  WEEKS_PER_MONTH,
};
