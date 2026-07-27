import { useMemo } from 'react';
import {
  DAY_MS,
  MAIN_ACCOUNT_ID,
  OPERATIONAL_DATA_START,
  TREASURY_LOOKAHEAD_DAYS,
  WEEK_MS,
} from '../finance/constants';
import { buildAgingView } from '../finance/agingView';
import { isInternalTransfer } from '../lib/finance/movementAmount';
import {
  addDays,
  clampMoney,
  compareIsoDate,
  daysUntil,
  getSignedMovementAmount,
  isOpenDocument,
  isWithinRange,
  startOfDay,
  sumMoney,
  toISODate,
} from '../finance/utils';
import { useFinanceLedger } from './useFinanceLedger';

/**
 * Overdue tranches for the CXC/CXP aging bars. Thin wrapper over the single
 * aging engine (`lib/finance/aging.js`) — this hook used to bucket documents
 * itself and disagreed with Resumen and the CXC/CXP report on the same
 * invoices. Exported so the conversion stays unit-testable without React.
 *
 * @param {object[]} rows - open receivable/payable rows
 * @param {string|Date} referenceDate
 * @returns {Array<{ key: string, label: string, amount: number, count: number, items: object[] }>}
 */
export const buildAgingBuckets = (rows, referenceDate) =>
  buildAgingView({ docs: rows, today: referenceDate }).buckets;

// NOTE: this hook used to build its own 13-week projection here (receivables
// and payables only — no recurring costs, no payroll, no VAT), which made it
// structurally more optimistic than the other two engines that existed at the
// time. It was deleted: the single projection now lives in
// `useCashForecast` / `src/finance/cashForecast.js`. Do not reintroduce one.

const buildCashSeries = (ledger, referenceDate) => {
  const today = startOfDay(referenceDate);
  const windowStart = addDays(today, -77);
  const preWindowBalance =
    ledger.bankAccount.openingBalance +
    sumMoney(
      ledger.postedMovements.filter(
        (entry) =>
          entry.accountId === MAIN_ACCOUNT_ID &&
          compareIsoDate(entry.postedDate, ledger.bankAccount.openingDate) > 0 &&
          compareIsoDate(entry.postedDate, toISODate(windowStart)) < 0,
      ),
      getSignedMovementAmount,
    );

  const series = [];
  let runningBalance = clampMoney(preWindowBalance);

  for (let index = 0; index < 12; index += 1) {
    const bucketStart = new Date(windowStart.getTime() + index * WEEK_MS);
    const bucketEnd = new Date(bucketStart.getTime() + WEEK_MS - DAY_MS);
    const from = toISODate(bucketStart);
    const to = toISODate(bucketEnd);

    const bucketMovements = ledger.postedMovements.filter(
      (entry) =>
        entry.accountId === MAIN_ACCOUNT_ID &&
        compareIsoDate(entry.postedDate, from) >= 0 &&
        compareIsoDate(entry.postedDate, to) <= 0,
    );

    const net = sumMoney(bucketMovements, getSignedMovementAmount);
    runningBalance = clampMoney(runningBalance + net);

    series.push({
      label: bucketStart.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
      balance: runningBalance,
      inflows: sumMoney(bucketMovements.filter((entry) => entry.direction === 'in'), (entry) => entry.amount),
      outflows: sumMoney(bucketMovements.filter((entry) => entry.direction === 'out'), (entry) => entry.amount),
      net,
    });
  }

  return series;
};

// Labels that mean "no project". Kept in sync with UNKNOWN_PROJECT_LABELS in
// src/finance/managementReport.js so the Resumen margin table and the
// management report agree on what counts as an obra.
const UNASSIGNED_PROJECT_LABELS = new Set(['', 'sin proyecto', 'sin asignar', 'n/a', 'unknown']);

export const UNASSIGNED_PROJECT_NAME = 'Sin asignar';

const isUnassignedProject = (name) =>
  UNASSIGNED_PROJECT_LABELS.has(String(name ?? '').trim().toLowerCase());

const emptyBucket = (name) => ({ name, inflows: 0, outflows: 0, net: 0, margin: 0 });

const settleBucket = (bucket) => {
  bucket.net = clampMoney(bucket.inflows - bucket.outflows);
  bucket.margin = bucket.inflows > 0 ? (bucket.net / bucket.inflows) * 100 : 0;
  return bucket;
};

const roundBucket = (bucket) => ({
  ...bucket,
  inflows: clampMoney(bucket.inflows),
  outflows: clampMoney(bucket.outflows),
  net: clampMoney(bucket.net),
  margin: clampMoney(bucket.margin),
});

const addMovement = (bucket, entry) => {
  if (entry.direction === 'in') bucket.inflows += entry.amount;
  else bucket.outflows += entry.amount;
  return settleBucket(bucket);
};

export const buildProjectMargins = (movements, payrollByProject = {}) => {
  const projectMap = new Map();

  movements.forEach((entry) => {
    // Own-account transfers are neither revenue nor cost — see isInternalTransfer.
    // The money did move (and the cash position counts it), but crediting an obra
    // with it would invent revenue and charging it would invent cost.
    if (isInternalTransfer(entry)) return;
    // Movements without a real project are excluded: the table ranks obras, and
    // the unassigned bucket used to win it outright. buildUnassignedMargin
    // surfaces that money separately so nothing is silently dropped.
    const key = entry.projectName || '';
    if (isUnassignedProject(key)) return;
    const current = projectMap.get(key) || emptyBucket(key);
    projectMap.set(key, addMovement(current, entry));
  });

  // Phase 3, item 3 — fold allocated labor cost (gesamtkosten, NOT cashTotal)
  // into each project's outflows so margins stop ignoring payroll. Optional and
  // defaulting to {} keeps every existing caller and test untouched.
  Object.entries(payrollByProject || {}).forEach(([projectKey, laborCost]) => {
    const cost = Number(laborCost) || 0;
    if (cost === 0 || isUnassignedProject(projectKey)) return;
    const current = projectMap.get(projectKey) || emptyBucket(projectKey);
    current.outflows += cost;
    projectMap.set(projectKey, settleBucket(current));
  });

  return Array.from(projectMap.values())
    .sort((left, right) => right.net - left.net)
    .slice(0, 6)
    .map(roundBucket);
};

/**
 * Cash that buildProjectMargins leaves out because it carries no project.
 * Returns null when everything is assigned, so callers can skip the row.
 */
export const buildUnassignedMargin = (movements = [], payrollByProject = {}) => {
  const bucket = emptyBucket(UNASSIGNED_PROJECT_NAME);
  let touched = false;

  movements.forEach((entry) => {
    if (isInternalTransfer(entry)) return;
    if (!isUnassignedProject(entry.projectName)) return;
    touched = true;
    addMovement(bucket, entry);
  });

  Object.entries(payrollByProject || {}).forEach(([projectKey, laborCost]) => {
    const cost = Number(laborCost) || 0;
    if (cost === 0 || !isUnassignedProject(projectKey)) return;
    touched = true;
    bucket.outflows += cost;
    settleBucket(bucket);
  });

  return touched ? roundBucket(bucket) : null;
};

export const useTreasuryMetrics = (options = {}) => {
  const { user, from, to, projectId, accountId = MAIN_ACCOUNT_ID } = options;
  // Accept a pre-fetched ledger from FinanceLedgerContext to avoid opening a
  // duplicate set of Firestore listeners. Falls back to a local instantiation
  // for call sites that don't have the provider (e.g. isolated routes/tests).
  const localLedger = useFinanceLedger(options.ledger ? null : user);
  const ledger = options.ledger ?? localLedger;

  return useMemo(() => {
    const referenceDate = options.referenceDate || new Date();
    const rangeFrom = toISODate(from);
    const rangeTo = toISODate(to);

    const matchProject = (entry) => !projectId || entry.projectId === projectId || entry.projectName === projectId;
    const matchAccount = (entry) => !accountId || entry.accountId === accountId;

    const filteredMovements = ledger.postedMovements.filter(
      (entry) =>
        matchProject(entry) &&
        matchAccount(entry) &&
        isWithinRange(entry.postedDate, rangeFrom, rangeTo),
    );
    const filteredReceivables = ledger.receivables.filter(
      (entry) =>
        matchProject(entry) &&
        matchAccount(entry) &&
        (!rangeFrom || compareIsoDate(entry.issueDate, rangeFrom) >= 0) &&
        (!rangeTo || compareIsoDate(entry.issueDate, rangeTo) <= 0),
    );
    const filteredPayables = ledger.payables.filter(
      (entry) =>
        matchProject(entry) &&
        matchAccount(entry) &&
        (!rangeFrom || compareIsoDate(entry.issueDate, rangeFrom) >= 0) &&
        (!rangeTo || compareIsoDate(entry.issueDate, rangeTo) <= 0),
    );

    const openReceivables = filteredReceivables.filter(isOpenDocument);
    const openPayables = filteredPayables.filter(isOpenDocument);

    // One aging pass per side. Both the tranche bars and the full report (with
    // the `current` bucket, per-item daysOverdue and totals) come from the same
    // computation so no screen can drift from another.
    const receivablesAgingView = buildAgingView({ docs: openReceivables, today: referenceDate });
    const payablesAgingView = buildAgingView({ docs: openPayables, today: referenceDate });

    const currentCash = ledger.summary.currentCash;
    const pendingReceivables = sumMoney(openReceivables, (entry) => entry.openAmount);
    const pendingPayables = sumMoney(openPayables, (entry) => entry.openAmount);
    const overdueReceivables = openReceivables.filter((entry) => entry.dueDate && daysUntil(entry.dueDate, referenceDate) < 0);
    const overduePayables = openPayables.filter((entry) => entry.dueDate && daysUntil(entry.dueDate, referenceDate) < 0);
    const nextWindowEnd = addDays(referenceDate, TREASURY_LOOKAHEAD_DAYS);
    const upcomingReceivables = openReceivables.filter((entry) => {
      const iso = toISODate(entry.dueDate);
      return iso && compareIsoDate(iso, toISODate(referenceDate)) >= 0 && compareIsoDate(iso, toISODate(nextWindowEnd)) <= 0;
    });
    const upcomingPayables = openPayables.filter((entry) => {
      const iso = toISODate(entry.dueDate);
      return iso && compareIsoDate(iso, toISODate(referenceDate)) >= 0 && compareIsoDate(iso, toISODate(nextWindowEnd)) <= 0;
    });

    const cashInflows = sumMoney(filteredMovements.filter((entry) => entry.direction === 'in'), (entry) => entry.amount);
    const cashOutflows = sumMoney(filteredMovements.filter((entry) => entry.direction === 'out'), (entry) => entry.amount);
    const netMovement = clampMoney(cashInflows - cashOutflows);

    const trailing90Start = toISODate(addDays(referenceDate, -90));
    const trailing90End = toISODate(referenceDate);
    const year2026Start = OPERATIONAL_DATA_START;
    // Filter to operational-data-only movements for burn rate calculation (no 2025 legacy data)
    const trailingOutflows = ledger.postedMovements.filter(
      (entry) =>
        entry.direction === 'out' &&
        compareIsoDate(entry.postedDate, trailing90Start) >= 0 &&
        compareIsoDate(entry.postedDate, trailing90End) <= 0 &&
        compareIsoDate(entry.postedDate, year2026Start) >= 0,
    );
    const trailingInflows = ledger.postedMovements.filter(
      (entry) =>
        entry.direction === 'in' &&
        compareIsoDate(entry.postedDate, trailing90Start) >= 0 &&
        compareIsoDate(entry.postedDate, trailing90End) <= 0 &&
        compareIsoDate(entry.postedDate, year2026Start) >= 0,
    );
    // Number of months actually covered (avoid dividing by 3 if <3 months of 2026 data)
    const monthsCovered2026 = Math.max(1,
      Math.min(3, Math.ceil((new Date(referenceDate) - new Date(year2026Start)) / (1000 * 60 * 60 * 24 * 30)))
    );
    const avgMonthlyOutflows = clampMoney(sumMoney(trailingOutflows, (entry) => entry.amount) / monthsCovered2026);
    const avgMonthlyInflows = clampMoney(sumMoney(trailingInflows, (entry) => entry.amount) / monthsCovered2026);
    const runwayMonths = avgMonthlyOutflows > 0 ? clampMoney(currentCash / avgMonthlyOutflows) : null;

    return {
      ...ledger,
      filteredMovements,
      filteredReceivables,
      filteredPayables,
      currentCash,
      cashInflows,
      cashOutflows,
      netMovement,
      pendingReceivables,
      pendingPayables,
      projectedLiquidity: clampMoney(currentCash + pendingReceivables - pendingPayables),
      overdueReceivables,
      overduePayables,
      upcomingReceivables,
      upcomingPayables,
      next14Net: clampMoney(
        sumMoney(upcomingReceivables, (entry) => entry.openAmount) -
          sumMoney(upcomingPayables, (entry) => entry.openAmount),
      ),
      runwayMonths,
      avgMonthlyInflows,
      avgMonthlyOutflows,
      cashSeries: buildCashSeries(ledger, referenceDate),
      receivablesAging: receivablesAgingView.buckets,
      payablesAging: payablesAgingView.buckets,
      receivablesAgingReport: receivablesAgingView.report,
      payablesAgingReport: payablesAgingView.report,
      projectMargins: buildProjectMargins(filteredMovements, options.payrollByProject || {}),
      unassignedMargin: buildUnassignedMargin(filteredMovements, options.payrollByProject || {}),
      unreconciledMovements: ledger.bankMovements
        .filter((entry) => !entry.reconciledAt && entry.status === 'posted')
        .sort((left, right) => compareIsoDate(right.postedDate, left.postedDate)),
    };
  }, [accountId, from, ledger, options.referenceDate, options.payrollByProject, projectId, to]);
};

export default useTreasuryMetrics;
