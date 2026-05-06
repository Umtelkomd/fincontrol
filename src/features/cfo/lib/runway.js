/**
 * Runway / Cash Position math — pure, no React, no Firestore.
 *
 * Inputs always come from the CFO snapshot. The `asOfDate` parameter
 * defaults to today and is exposed only to make the functions easy to
 * test with frozen clocks.
 *
 * Public API:
 *   computeCashToday({ bankAccount, bankMovements }, asOfDate?)
 *     → { cashToday, startingBalance, balanceDate, netSinceBalanceDate }
 *
 *   computeBurnRate({ bankMovements }, days, asOfDate?)
 *     → { totalOut, totalIn, net, perDay, perMonth, days }
 *
 *   computeRunway({ cashToday, burnPerMonth, criticalThreshold? }, asOfDate?)
 *     → { months, projectedZeroDate, projectedCriticalDate, isCritical, isInfinite }
 *
 *   computeBalanceTimeseries({ bankAccount, bankMovements }, lookbackDays, asOfDate?)
 *     → [{ date, balance }, ...]   // one point per day, oldest → newest
 *
 *   summarizeCashPosition(snapshot, options?)
 *     → composes the above into a single object for the panel
 */

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

export const computeCashToday = ({ bankAccount, bankMovements }, asOfDate) => {
  const today = toIso(asOfDate) || todayIso();
  const startingBalance = Number(bankAccount?.balance) || 0;
  const balanceDate = bankAccount?.balanceDate ? toIso(bankAccount.balanceDate) : null;

  if (!bankAccount || !balanceDate) {
    return {
      cashToday: startingBalance,
      startingBalance,
      balanceDate,
      netSinceBalanceDate: 0,
    };
  }

  const netSinceBalanceDate = sumNet(bankMovements, balanceDate, today);
  const cashToday = round2(startingBalance + netSinceBalanceDate);

  return {
    cashToday,
    startingBalance: round2(startingBalance),
    balanceDate,
    netSinceBalanceDate: round2(netSinceBalanceDate),
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
 * asOfDate inclusive. Reconstructs by walking forward from balanceDate
 * (or, if that is older than the window, from the window start using the
 * cumulative net through that date).
 *
 * Each point: { date: 'YYYY-MM-DD', balance: number }
 * Length: lookbackDays + 1 (inclusive of the start day)
 */
export const computeBalanceTimeseries = (
  { bankAccount, bankMovements },
  lookbackDays,
  asOfDate,
) => {
  const days = Math.max(1, Math.floor(Number(lookbackDays) || 0));
  const today = toIso(asOfDate) || todayIso();
  const startIso = addDaysIso(today, -days);

  const startingBalance = Number(bankAccount?.balance) || 0;
  const balanceDate = bankAccount?.balanceDate ? toIso(bankAccount.balanceDate) : null;

  // Bucket movements by date
  const byDate = new Map();
  for (const m of bankMovements || []) {
    if (!isSettledMovement(m)) continue;
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
