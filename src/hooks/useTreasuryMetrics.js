import { useMemo } from 'react';
import {
  DAY_MS,
  MAIN_ACCOUNT_ID,
  TREASURY_LOOKAHEAD_DAYS,
  TREASURY_PROJECTION_WEEKS,
  WEEK_MS,
} from '../finance/constants';
import {
  addDays,
  clampMoney,
  compareIsoDate,
  daysUntil,
  endOfDay,
  getSignedMovementAmount,
  isOpenDocument,
  isWithinRange,
  startOfDay,
  sumMoney,
  toISODate,
} from '../finance/utils';
import { useFinanceLedger } from './useFinanceLedger';

const buildAgingBuckets = (rows, referenceDate) => {
  const buckets = [
    { label: '0-30d', total: 0 },
    { label: '31-60d', total: 0 },
    { label: '61-90d', total: 0 },
    { label: '>90d', total: 0 },
  ];

  rows.forEach((entry) => {
    if (!entry.dueDate || !isOpenDocument(entry)) return;
    const overdueDays = Math.max(0, -daysUntil(entry.dueDate, referenceDate));
    const amount = entry.openAmount;
    if (overdueDays === 0) return;
    if (overdueDays <= 30) buckets[0].total += amount;
    else if (overdueDays <= 60) buckets[1].total += amount;
    else if (overdueDays <= 90) buckets[2].total += amount;
    else buckets[3].total += amount;
  });

  return buckets.map((bucket) => ({ ...bucket, total: clampMoney(bucket.total) }));
};

const buildWeeklyProjection = (currentCash, receivables, payables, referenceDate) => {
  const projection = [];
  let runningBalance = currentCash;
  const today = startOfDay(referenceDate);

  for (let index = 0; index < TREASURY_PROJECTION_WEEKS; index += 1) {
    const weekStart = addDays(today, index * 7);
    const weekEnd = endOfDay(addDays(weekStart, 6));
    const from = toISODate(weekStart);
    const to = toISODate(weekEnd);

    const inflows = receivables.filter(
      (entry) =>
        isOpenDocument(entry) &&
        entry.dueDate &&
        compareIsoDate(entry.dueDate, from) >= 0 &&
        compareIsoDate(entry.dueDate, to) <= 0,
    );
    const outflows = payables.filter(
      (entry) =>
        isOpenDocument(entry) &&
        entry.dueDate &&
        compareIsoDate(entry.dueDate, from) >= 0 &&
        compareIsoDate(entry.dueDate, to) <= 0,
    );

    const committedIn = sumMoney(inflows, (entry) => entry.openAmount);
    const committedOut = sumMoney(outflows, (entry) => entry.openAmount);
    runningBalance = clampMoney(runningBalance + committedIn - committedOut);

    projection.push({
      week: `W${index + 1}`,
      label: `${weekStart.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} - ${weekEnd.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}`,
      committedIn,
      committedOut,
      projectedBalance: runningBalance,
    });
  }

  return projection;
};

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

const buildProjectMargins = (movements) => {
  const projectMap = new Map();

  movements.forEach((entry) => {
    const key = entry.projectName || 'Sin proyecto';
    const current = projectMap.get(key) || { name: key, inflows: 0, outflows: 0, net: 0, margin: 0 };
    if (entry.direction === 'in') current.inflows += entry.amount;
    else current.outflows += entry.amount;
    current.net = clampMoney(current.inflows - current.outflows);
    current.margin = current.inflows > 0 ? (current.net / current.inflows) * 100 : 0;
    projectMap.set(key, current);
  });

  return Array.from(projectMap.values())
    .sort((left, right) => right.net - left.net)
    .slice(0, 6)
    .map((entry) => ({
      ...entry,
      inflows: clampMoney(entry.inflows),
      outflows: clampMoney(entry.outflows),
      net: clampMoney(entry.net),
      margin: clampMoney(entry.margin),
    }));
};

export const useTreasuryMetrics = (options = {}) => {
  const { user, from, to, projectId, accountId = MAIN_ACCOUNT_ID } = options;
  const ledger = useFinanceLedger(user);

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
    const year2026Start = '2026-01-01';
    // Filter to 2026-only movements for burn rate calculation (no 2025 legacy data)
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
      weeklyProjection: buildWeeklyProjection(currentCash, openReceivables, openPayables, referenceDate),
      cashSeries: buildCashSeries(ledger, referenceDate),
      receivablesAging: buildAgingBuckets(openReceivables, referenceDate),
      payablesAging: buildAgingBuckets(openPayables, referenceDate),
      projectMargins: buildProjectMargins(filteredMovements),
      unreconciledMovements: ledger.bankMovements
        .filter((entry) => !entry.reconciledAt && entry.status === 'posted')
        .sort((left, right) => compareIsoDate(right.postedDate, left.postedDate)),
    };
  }, [accountId, from, ledger, options.referenceDate, projectId, to]);
};

export default useTreasuryMetrics;
