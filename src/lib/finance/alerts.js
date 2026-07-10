/**
 * Deterministic alert generation from the other engine outputs.
 *
 * Severity model:
 *   critical → existential: beyond the credit line, projected negative cash,
 *              or overdue debts to creditors that can freeze the company
 *              (tax office, health insurers, social security bodies).
 *   serious  → cash crunch signals that need action this week.
 *   warning  → data-trust and hygiene signals.
 *
 * Titles/details are terse English diagnostics keyed by `id`; the UI layer
 * is expected to localize by id, not to display these verbatim.
 *
 * Ordering: severity rank first, then |metric.amount| descending (missing
 * amounts sort last within their severity).
 *
 * @typedef {Object} Alert
 * @property {string} id - stable machine key
 * @property {'critical'|'serious'|'warning'} severity
 * @property {string} title
 * @property {string} detail
 * @property {{ amount?: number, count?: number, days?: number|null, weekStart?: string }} metric
 *
 * @typedef {Object} AlertsConfig
 * @property {number} [bufferEur=10000] - minimum comfortable balance
 * @property {number} [bufferWeeks=4] - forecast weeks checked against the buffer
 * @property {number} [creditFloorEur=0] - hard floor (negative for credit lines)
 * @property {number} [receivableOverdueDays=14] - tolerance before chasing
 * @property {number} [maxAnchorAgeDays=45] - reconciliation staleness limit
 * @property {RegExp} [criticalCreditorPattern]
 */

import { diffDays } from './dates.js';

/** Creditors whose overdue debts are existential (spec heuristic). */
export const CRITICAL_CREDITOR_PATTERN =
  /finanzamt|krankenkasse|sozial|aok|tk|barmer|dak|knappschaft|minijob/i;

const SEVERITY_RANK = { critical: 0, serious: 1, warning: 2 };

const DEFAULT_CONFIG = {
  bufferEur: 10000,
  bufferWeeks: 4,
  creditFloorEur: 0,
  receivableOverdueDays: 14,
  maxAnchorAgeDays: 45,
  criticalCreditorPattern: CRITICAL_CREDITOR_PATTERN,
};

const OVERDUE_BUCKET_KEYS = ['d1_30', 'd31_60', 'd61_90', 'd90plus'];

/** All overdue items of an aging report, oldest buckets last. */
const overdueItemsOf = (aging) =>
  OVERDUE_BUCKET_KEYS.flatMap((key) => aging?.[key]?.items ?? []);

const creditorNameOf = (doc) =>
  [doc?.counterpartyName, doc?.vendor, doc?.client].filter(Boolean).join(' ');

/**
 * Build the alert list from the engine outputs.
 *
 * @param {{
 *   position?: import('./cashPosition.js').CashPosition,
 *   forecast?: Array<{ weekStart: string, projectedBalance: number }>,
 *   receivablesAging?: import('./aging.js').AgingReport,
 *   payablesAging?: import('./aging.js').AgingReport,
 *   importGap?: { hasGap: boolean, quietBusinessDays: number|null },
 *   reconciliation?: { lastAnchorDate: string|null },
 *   today: string,
 *   config?: AlertsConfig,
 * }} params
 * @returns {Alert[]}
 */
export const buildAlerts = ({
  position,
  forecast,
  receivablesAging,
  payablesAging,
  importGap,
  reconciliation,
  today,
  config,
}) => {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  const alerts = [];

  // ── balance below the credit floor ──────────────────────────────────────────
  const balance = position?.balance;
  if (typeof balance === 'number' && Number.isFinite(balance) && balance < cfg.creditFloorEur) {
    alerts.push({
      id: 'balance-below-credit-floor',
      severity: 'critical',
      title: 'Balance below credit floor',
      detail: `Derived balance ${balance} is below the credit floor ${cfg.creditFloorEur}.`,
      metric: { amount: balance },
    });
  }

  // ── projected balance below buffer within the first weeks ───────────────────
  let worstWeek = null;
  for (const week of (forecast || []).slice(0, cfg.bufferWeeks)) {
    const projected = week?.projectedBalance;
    if (typeof projected !== 'number' || !Number.isFinite(projected)) continue;
    if (!worstWeek || projected < worstWeek.projectedBalance) worstWeek = week;
  }
  if (worstWeek && worstWeek.projectedBalance < cfg.bufferEur) {
    alerts.push({
      id: 'projected-balance-below-buffer',
      severity: worstWeek.projectedBalance < 0 ? 'critical' : 'serious',
      title: 'Projected balance below buffer',
      detail: `Projected balance falls to ${worstWeek.projectedBalance} in the week of ${worstWeek.weekStart} (buffer ${cfg.bufferEur}).`,
      metric: { amount: worstWeek.projectedBalance, weekStart: worstWeek.weekStart },
    });
  }

  // ── overdue payables — general and critical creditors ───────────────────────
  const payablesOverdue = payablesAging?.totals?.overdue ?? 0;
  if (payablesOverdue > 0) {
    alerts.push({
      id: 'payables-overdue',
      severity: 'serious',
      title: 'Overdue payables',
      detail: `Open payables past their due date total ${payablesOverdue}.`,
      metric: { amount: payablesOverdue, count: payablesAging?.totals?.overdueCount ?? 0 },
    });
  }
  const criticalItems = overdueItemsOf(payablesAging).filter((item) =>
    cfg.criticalCreditorPattern.test(creditorNameOf(item.doc)),
  );
  if (criticalItems.length > 0) {
    const amount = criticalItems.reduce((sum, item) => sum + item.openAmount, 0);
    alerts.push({
      id: 'payables-overdue-critical-creditors',
      severity: 'critical',
      title: 'Overdue payables to critical creditors',
      detail: `Overdue debt to tax/social-security creditors totals ${amount}.`,
      metric: { amount, count: criticalItems.length },
    });
  }

  // ── receivables overdue beyond tolerance ────────────────────────────────────
  const staleReceivables = overdueItemsOf(receivablesAging).filter(
    (item) => item.daysOverdue > cfg.receivableOverdueDays,
  );
  if (staleReceivables.length > 0) {
    const amount = staleReceivables.reduce((sum, item) => sum + item.openAmount, 0);
    alerts.push({
      id: 'receivables-overdue',
      severity: 'warning',
      title: 'Receivables overdue beyond tolerance',
      detail: `Receivables overdue for more than ${cfg.receivableOverdueDays} days total ${amount}.`,
      metric: { amount, count: staleReceivables.length },
    });
  }

  // ── reconciliation staleness ────────────────────────────────────────────────
  const lastAnchorDate = reconciliation?.lastAnchorDate ?? position?.anchor?.date ?? null;
  const anchorAge = lastAnchorDate ? diffDays(lastAnchorDate, today) : null;
  if (anchorAge === null || anchorAge > cfg.maxAnchorAgeDays) {
    alerts.push({
      id: 'reconciliation-stale',
      severity: 'warning',
      title: 'Reconciliation anchor is stale',
      detail:
        anchorAge === null
          ? 'No reconciliation anchor exists.'
          : `Last reconciliation anchor is ${anchorAge} days old (limit ${cfg.maxAnchorAgeDays}).`,
      metric: { days: anchorAge },
    });
  }

  // ── import gap ──────────────────────────────────────────────────────────────
  if (importGap?.hasGap) {
    alerts.push({
      id: 'import-gap',
      severity: 'warning',
      title: 'Bank import gap',
      detail: `No bank movements imported for ${importGap.quietBusinessDays ?? 'an unknown number of'} business days.`,
      metric: { days: importGap.quietBusinessDays ?? null },
    });
  }

  return alerts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Math.abs(b.metric.amount ?? 0) - Math.abs(a.metric.amount ?? 0),
  );
};
