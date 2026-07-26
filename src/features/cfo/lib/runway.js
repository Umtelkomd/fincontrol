/**
 * Runway / Cash Position math — pure, no React, no Firestore.
 *
 * Inputs always come from the CFO snapshot. The `asOfDate` parameter
 * defaults to today and is exposed only to make the functions easy to
 * test with frozen clocks.
 *
 * CASH MODEL — reconciliation anchors are canonical (see CLAUDE.md, "Cash
 * position"). Cash today = newest anchor with date <= today, plus the signed
 * bank movements posted after it. The anchor maths live in
 * `lib/finance/cashPosition.js` and are shared with `useFinanceLedger` through
 * `finance/cashSource.js`, so `/cfo` and `/resumen` cannot disagree. The old
 * `bankAccount.balanceDate` walk survives only as the pre-anchor fallback and
 * is reported as `source: 'legacy'` — callers must surface that as degraded,
 * never as a reconciled figure.
 *
 * Public API:
 *   computeCashToday({ bankAccount, bankMovements, anchors }, asOfDate?)
 *     → { cashToday, source, anchor, startingBalance, balanceDate,
 *         netSinceBalanceDate, lastMovementDate, staleDays }
 *
 *   computeBurnRate({ bankMovements }, days, asOfDate?)
 *     → { totalOut, totalIn, net, perDay, perMonth, days }
 *
 *   computeRunway({ cashToday, burnPerMonth, criticalThreshold? }, asOfDate?)
 *     → { months, projectedZeroDate, projectedCriticalDate, isCritical, isInfinite }
 *
 *   computeBalanceTimeseries({ bankAccount, bankMovements, anchors }, lookbackDays, asOfDate?)
 *     → [{ date, balance }, ...]   // one point per day, oldest → newest;
 *                                   balance is null before the first anchor
 *
 *   summarizeCashPosition(snapshot, options?)
 *     → composes the above into a single object for the panel
 */

import { resolveCashSource } from '../../../finance/cashSource';
import { dailyBalanceSeries, deriveBalance } from '../../../lib/finance';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CRITICAL_THRESHOLD_DEFAULT = 10000;

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

const daysBetween = (fromIso, toIsoStr) => {
  if (!fromIso || !toIsoStr) return 0;
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIsoStr}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
};

const isSettledMovement = (m) => m && m.status !== 'void';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Sum signed bank movements between [fromIsoExclusive, toIsoInclusive].
 * fromIsoExclusive: only count movements with postedDate STRICTLY > this date
 * toIsoInclusive:   only count movements with postedDate <= this date
 */
const sumNet = (bankMovements, fromIsoExclusive, toIsoInclusive) => {
  let net = 0;
  for (const m of bankMovements || []) {
    if (!isSettledMovement(m)) continue;
    const date = m.postedDate;
    if (!date) continue;
    if (fromIsoExclusive && date <= fromIsoExclusive) continue;
    if (toIsoInclusive && date > toIsoInclusive) continue;
    const amount = Number(m.amount) || 0;
    if (m.direction === 'in') net += amount;
    else if (m.direction === 'out') net -= amount;
  }
  return net;
};

/**
 * Cash as of `asOfDate`, anchor-first.
 *
 * `source` tells the caller which model produced the number:
 *   'anchors' → reconciled: newest anchor <= asOfDate + signed movements after it
 *   'legacy'  → estimated from `bankAccount.balanceDate`; NOT reconciled
 *
 * @param {{ bankAccount?: object, bankMovements?: object[], anchors?: object[] }} input
 * @param {string|Date} [asOfDate]
 */
export const computeCashToday = ({ bankAccount, bankMovements, anchors }, asOfDate) => {
  const today = toIso(asOfDate) || todayIso();
  const startingBalance = Number(bankAccount?.balance) || 0;
  const balanceDate = bankAccount?.balanceDate ? toIso(bankAccount.balanceDate) : null;

  // Void movements never touch cash under either model.
  const movements = (bankMovements || []).filter(isSettledMovement);

  const netSinceBalanceDate =
    bankAccount && balanceDate ? sumNet(movements, balanceDate, today) : 0;
  const legacyBalance = startingBalance + netSinceBalanceDate;

  // Same resolver useFinanceLedger uses, so /cfo and /resumen agree by
  // construction rather than by two similar-looking formulas.
  const { currentCash, source, cashMeta } = resolveCashSource({
    anchors: anchors || [],
    movements,
    today,
    legacyBalance,
  });

  if (source === 'anchors') {
    const usedAnchor = cashMeta.anchor;
    return {
      cashToday: round2(currentCash),
      source,
      anchor: usedAnchor,
      startingBalance: round2(usedAnchor.balance),
      balanceDate: usedAnchor.date,
      netSinceBalanceDate: round2(currentCash - usedAnchor.balance),
      lastMovementDate: cashMeta.lastMovementDate,
      staleDays: cashMeta.staleDays,
    };
  }

  return {
    cashToday: round2(legacyBalance),
    source: 'legacy',
    anchor: null,
    startingBalance: round2(startingBalance),
    balanceDate,
    netSinceBalanceDate: round2(netSinceBalanceDate),
    lastMovementDate: cashMeta.lastMovementDate,
    staleDays: cashMeta.staleDays,
  };
};

export const computeBurnRate = ({ bankMovements }, days, asOfDate) => {
  const safeDays = Math.max(1, Math.floor(Number(days) || 0));
  const today = toIso(asOfDate) || todayIso();
  const fromExclusive = addDaysIso(today, -safeDays);

  let totalIn = 0;
  let totalOut = 0;
  for (const m of bankMovements || []) {
    if (!isSettledMovement(m)) continue;
    const date = m.postedDate;
    if (!date) continue;
    if (date <= fromExclusive) continue;
    if (date > today) continue;
    const amount = Math.abs(Number(m.amount) || 0);
    if (m.direction === 'in') totalIn += amount;
    else if (m.direction === 'out') totalOut += amount;
  }

  const net = totalIn - totalOut;
  const burnPerDay = totalOut / safeDays;
  const burnPerMonth = burnPerDay * 30;

  return {
    days: safeDays,
    totalIn: round2(totalIn),
    totalOut: round2(totalOut),
    net: round2(net),
    perDay: round2(burnPerDay),
    perMonth: round2(burnPerMonth),
  };
};

export const computeRunway = (
  { cashToday, burnPerMonth, criticalThreshold = CRITICAL_THRESHOLD_DEFAULT },
  asOfDate,
) => {
  const cash = Number(cashToday) || 0;
  const burn = Number(burnPerMonth) || 0;
  const today = toIso(asOfDate) || todayIso();

  if (burn <= 0) {
    return {
      months: Infinity,
      projectedZeroDate: null,
      projectedCriticalDate: null,
      isInfinite: true,
      isCritical: cash < criticalThreshold,
      criticalThreshold,
    };
  }

  const months = cash / burn;
  const daysToZero = Math.max(0, Math.round((cash / burn) * 30));
  const daysToCritical = Math.max(
    0,
    Math.round(((cash - criticalThreshold) / burn) * 30),
  );

  const projectedZeroDate = addDaysIso(today, daysToZero);
  const projectedCriticalDate =
    cash <= criticalThreshold ? today : addDaysIso(today, daysToCritical);

  return {
    months: round2(months),
    projectedZeroDate,
    projectedCriticalDate,
    isInfinite: false,
    isCritical: cash < criticalThreshold,
    criticalThreshold,
  };
};

/**
 * Build a daily balance series for the last `lookbackDays` days, ending at
 * asOfDate inclusive.
 *
 * With reconciliation anchors the series is rebuilt by `dailyBalanceSeries`
 * (anchors re-anchor the running balance on their own date), so its last point
 * always equals `computeCashToday().cashToday`. Days before the first anchor
 * carry `balance: null` — the chart shows a gap instead of inventing history.
 *
 * Without anchors it falls back to the legacy walk from `balanceDate`.
 *
 * Each point: { date: 'YYYY-MM-DD', balance: number|null }
 * Length: lookbackDays + 1 (inclusive of the start day)
 */
export const computeBalanceTimeseries = (
  { bankAccount, bankMovements, anchors },
  lookbackDays,
  asOfDate,
) => {
  const days = Math.max(1, Math.floor(Number(lookbackDays) || 0));
  const today = toIso(asOfDate) || todayIso();
  const startIso = addDaysIso(today, -days);

  const startingBalance = Number(bankAccount?.balance) || 0;
  const balanceDate = bankAccount?.balanceDate ? toIso(bankAccount.balanceDate) : null;
  const settledMovements = (bankMovements || []).filter(isSettledMovement);

  const anchorList = anchors || [];
  const isAnchored =
    deriveBalance({ anchors: anchorList, movements: settledMovements, today }).balance !== null;

  if (isAnchored) {
    return dailyBalanceSeries({
      anchors: anchorList,
      movements: settledMovements,
      from: startIso,
      to: today,
    }).map(({ date, balance }) => ({
      date,
      balance: balance === null ? null : round2(balance),
    }));
  }

  // Bucket movements by date
  const byDate = new Map();
  for (const m of settledMovements) {
    if (!m.postedDate) continue;
    const amt = Number(m.amount) || 0;
    const signed = m.direction === 'in' ? amt : m.direction === 'out' ? -amt : 0;
    byDate.set(m.postedDate, (byDate.get(m.postedDate) || 0) + signed);
  }

  // Compute the balance at start-of-window (one day before startIso).
  // Walk: startingBalance + sumNet(balanceDate exclusive, startIso-1 inclusive).
  // If balanceDate is null, just start from startingBalance.
  const dayBeforeWindow = addDaysIso(startIso, -1);
  let runningBalance = startingBalance;
  if (balanceDate && balanceDate < dayBeforeWindow) {
    runningBalance += sumNet(bankMovements, balanceDate, dayBeforeWindow);
  } else if (balanceDate && balanceDate > dayBeforeWindow) {
    // Window starts before balanceDate — we don't have data before
    // balanceDate; treat balance as starting from balanceDate forward.
    // For pre-balanceDate days, return startingBalance as the best-effort
    // baseline (no movements yet to apply).
    runningBalance = startingBalance;
  }

  const series = [];
  for (let i = 0; i <= days; i++) {
    const date = addDaysIso(startIso, i);
    const delta = byDate.get(date) || 0;
    // For days strictly before balanceDate, freeze at startingBalance.
    if (balanceDate && date < balanceDate) {
      series.push({ date, balance: round2(startingBalance) });
      continue;
    }
    runningBalance += delta;
    series.push({ date, balance: round2(runningBalance) });
  }
  return series;
};

/**
 * High-level summarizer used by CashPositionPanel — composes the others
 * into a single object that the React component renders.
 */
export const summarizeCashPosition = (snapshot, options = {}) => {
  const {
    asOfDate,
    burn30Days = 30,
    burn90Days = 90,
    sparklineDays = 90,
    criticalThreshold = CRITICAL_THRESHOLD_DEFAULT,
  } = options;

  const cash = computeCashToday(
    {
      bankAccount: snapshot?.bankAccount,
      bankMovements: snapshot?.bankMovements,
      anchors: snapshot?.anchors,
    },
    asOfDate,
  );

  const burn30 = computeBurnRate(
    { bankMovements: snapshot?.bankMovements },
    burn30Days,
    asOfDate,
  );

  const burn90 = computeBurnRate(
    { bankMovements: snapshot?.bankMovements },
    burn90Days,
    asOfDate,
  );

  const runway = computeRunway(
    {
      cashToday: cash.cashToday,
      burnPerMonth: burn30.perMonth,
      criticalThreshold,
    },
    asOfDate,
  );

  const net30PerMonth = round2((burn30.net / burn30.days) * 30);
  const net90PerMonth = round2((burn90.net / burn90.days) * 30);
  const cashCoverageMonths =
    burn30.perMonth > 0 ? round2(cash.cashToday / burn30.perMonth) : Infinity;
  const netRunwayMonths =
    net30PerMonth < 0 ? round2(cash.cashToday / Math.abs(net30PerMonth)) : Infinity;
  const netRunway = computeRunway(
    {
      cashToday: cash.cashToday,
      burnPerMonth: net30PerMonth < 0 ? Math.abs(net30PerMonth) : 0,
      criticalThreshold,
    },
    asOfDate,
  );

  const sparkline = computeBalanceTimeseries(
    {
      bankAccount: snapshot?.bankAccount,
      bankMovements: snapshot?.bankMovements,
      anchors: snapshot?.anchors,
    },
    sparklineDays,
    asOfDate,
  );

  return {
    cash,
    burn30,
    burn90,
    runway,
    netRunway,
    net30PerMonth,
    net90PerMonth,
    cashCoverageMonths,
    netRunwayMonths,
    sparkline,
  };
};

// Exposed for tests
export const __internal = {
  toIso,
  addDaysIso,
  daysBetween,
  sumNet,
  CRITICAL_THRESHOLD_DEFAULT,
};
