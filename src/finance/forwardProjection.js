/**
 * Forward cash projection — pure core extracted from useForwardProjection.
 *
 * Projects a daily balance series over the horizon combining:
 *   - open receivables (CXC) → inflows on their due date
 *   - open payables (CXP) → outflows on their due date
 *   - active recurringCosts rules → generated monthly outflows, deduped
 *     against payables that already materialized that (rule, period)
 *   - fiscal obligations (from companyObligations.js) → synthetic outflows;
 *     items of kind 'payable' are IGNORED because the open payables above
 *     already carry them. Overdue obligations clamp to today (that money is
 *     expected to leave immediately), zero-amount landmark rows are skipped.
 *
 * No wall clock, no Firestore: the caller passes `today` ('YYYY-MM-DD').
 */

import { amountForPeriod, dueDateForPeriod, ruleAppliesToPeriod } from './recurringGenerator';

const addDaysIso = (iso, days) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isOpenDoc = (doc) => doc?.status !== 'settled' && doc?.status !== 'cancelled';

const docAmount = (doc) => Number(doc.openAmount || doc.grossAmount || doc.amount) || 0;

/**
 * @param {{
 *   startingBalance?: number,
 *   today: string,
 *   horizonDays?: number,
 *   receivables?: Object[],
 *   payables?: Object[],
 *   recurringCosts?: Object[],
 *   obligations?: Array<{ date: string, kind: string, label: string, amount: number }>,
 * }} params
 */
export const buildForwardProjection = ({
  startingBalance = 0,
  today,
  horizonDays = 90,
  receivables = [],
  payables = [],
  recurringCosts = [],
  obligations = [],
}) => {
  const startISO = today;
  const endISO = addDaysIso(today, horizonDays);

  // ── Inflows from open receivables ───────────────────────────────────────────
  const inflows = (receivables || [])
    .filter((r) => {
      if (!isOpenDoc(r)) return false;
      const due = r.dueDate || r.issueDate;
      return due && due >= startISO && due <= endISO;
    })
    .map((r) => ({
      date: r.dueDate || r.issueDate,
      amount: docAmount(r),
      source: 'receivable',
      sourceId: r.id,
      description: r.description || r.counterpartyName || 'CXC',
    }));

  // ── Outflows from open payables ─────────────────────────────────────────────
  const outflowsPayables = (payables || [])
    .filter((p) => {
      if (!isOpenDoc(p)) return false;
      const due = p.dueDate || p.issueDate;
      return due && due >= startISO && due <= endISO;
    })
    .map((p) => ({
      date: p.dueDate || p.issueDate,
      amount: docAmount(p),
      source: 'payable',
      sourceId: p.id,
      description: p.description || p.counterpartyName || 'CXP',
    }));

  // ── Outflows from recurringCosts (deduped against materialized payables) ────
  const existingByKey = new Set(
    (payables || [])
      .filter((p) => p.recurringCostId && p.recurringPeriod && p.status !== 'cancelled' && p.status !== 'void')
      .map((p) => `${p.recurringCostId}|${p.recurringPeriod}`),
  );

  const outflowsRecurring = [];
  let [cursorYear, cursorMonth] = startISO.split('-').map(Number);
  const [endYear, endMonth] = endISO.split('-').map(Number);
  while (cursorYear * 12 + cursorMonth <= endYear * 12 + endMonth) {
    const period = `${cursorYear}-${String(cursorMonth).padStart(2, '0')}`;
    for (const rule of recurringCosts || []) {
      if (!rule.active) continue;
      if (!ruleAppliesToPeriod(rule, cursorYear, cursorMonth)) continue;
      if (existingByKey.has(`${rule.id}|${period}`)) continue; // already created
      const due = dueDateForPeriod(rule, cursorYear, cursorMonth);
      if (due < startISO || due > endISO) continue;
      outflowsRecurring.push({
        date: due,
        amount: amountForPeriod(rule),
        source: 'recurring',
        sourceId: rule.id,
        description: `${rule.concept || ''} — ${rule.ownerName || ''}`.trim(),
      });
    }
    cursorMonth += 1;
    if (cursorMonth > 12) {
      cursorMonth = 1;
      cursorYear += 1;
    }
  }

  // ── Outflows from fiscal obligations (estimates, never 'payable' kind) ──────
  const outflowsObligations = (obligations || [])
    .filter((item) => {
      if (!item || item.kind === 'payable') return false;
      const amount = Number(item.amount) || 0;
      if (amount <= 0) return false;
      return typeof item.date === 'string' && item.date <= endISO;
    })
    .map((item) => ({
      date: item.date < startISO ? startISO : item.date, // overdue → leaves now
      amount: Number(item.amount) || 0,
      source: 'obligation',
      sourceId: `${item.kind}|${item.month || item.date}`,
      description: item.label || item.kind,
    }));

  const allInflows = inflows;
  const allOutflows = [...outflowsPayables, ...outflowsRecurring, ...outflowsObligations];

  // ── Daily timeseries ────────────────────────────────────────────────────────
  const days = horizonDays + 1;
  const series = [];
  let runningBalance = Number(startingBalance) || 0;

  for (let i = 0; i < days; i += 1) {
    const date = addDaysIso(startISO, i);
    const dayInflows = allInflows.filter((e) => e.date === date).reduce((s, e) => s + e.amount, 0);
    const dayOutflows = allOutflows.filter((e) => e.date === date).reduce((s, e) => s + e.amount, 0);
    runningBalance += dayInflows - dayOutflows;
    series.push({
      date,
      inflow: dayInflows,
      outflow: dayOutflows,
      net: dayInflows - dayOutflows,
      balance: runningBalance,
    });
  }

  // ── Aggregate KPIs ──────────────────────────────────────────────────────────
  const totalInflows = allInflows.reduce((s, e) => s + e.amount, 0);
  const totalOutflows = allOutflows.reduce((s, e) => s + e.amount, 0);
  const netHorizon = totalInflows - totalOutflows;
  const projectedEndBalance = (Number(startingBalance) || 0) + netHorizon;

  const firstNegativeDay = series.find((d) => d.balance < 0);

  const next30 = series[Math.min(30, series.length - 1)];
  const next60 = series[Math.min(60, series.length - 1)];
  const next90 = series[series.length - 1];

  const cpMap = new Map();
  allOutflows.forEach((e) => {
    const key = (e.description || 'Sin descripción').slice(0, 40);
    cpMap.set(key, (cpMap.get(key) || 0) + e.amount);
  });
  const topOutflowCounterparties = [...cpMap.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  return {
    startingBalance: Number(startingBalance) || 0,
    series,
    inflows: allInflows,
    outflows: allOutflows,
    outflowsPayables,
    outflowsRecurring,
    outflowsObligations,
    totalInflows,
    totalOutflows,
    netHorizon,
    projectedEndBalance,
    firstNegativeDay,
    next30Balance: next30.balance,
    next60Balance: next60.balance,
    next90Balance: next90.balance,
    topOutflowCounterparties,
    horizonDays,
  };
};

export default buildForwardProjection;
