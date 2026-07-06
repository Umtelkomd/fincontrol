import { useMemo } from 'react';
import { useRecurringCosts } from './useRecurringCosts';
import { usePayables } from './usePayables';
import { useReceivables } from './useReceivables';
import { useBankAccount } from './useBankAccount';
import {
 ruleAppliesToPeriod,
 dueDateForPeriod,
 amountForPeriod,
} from '../finance/recurringGenerator';

const DAY_MS = 24 * 60 * 60 * 1000;

const today = () => {
 const d = new Date();
 d.setHours(0, 0, 0, 0);
 return d;
};

const addDays = (date, n) => {
 const d = new Date(date);
 d.setDate(d.getDate() + n);
 return d;
};

// Local date parts, not toISOString(): the projection starts at local midnight,
// and in Europe/Berlin toISOString() would shift the whole series back one day.
const isoDate = (d) => {
 const pad = (n) => String(n).padStart(2, '0');
 return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * useForwardProjection — projects cashflow N days into the future.
 *
 * Combines:
 *   - Open receivables (CXC) → expected inflows by dueDate
 *   - Open payables (CXP) → expected outflows by dueDate
 *   - Active recurringCosts → expected outflows generated for upcoming months
 *     (skipping rules that already produced a payable for that period)
 *
 * Returns daily timeseries from today to today+horizon (default 90d) plus
 * aggregate KPIs.
 */
export const useForwardProjection = (user, horizonDays = 90) => {
 const { recurringCosts } = useRecurringCosts(user);
 const { payables } = usePayables(user);
 const { receivables } = useReceivables(user);
 const { bankAccount } = useBankAccount(user);

 return useMemo(() => {
 const start = today();
 const end = addDays(start, horizonDays);
 const startISO = isoDate(start);
 const endISO = isoDate(end);

 // === Inflows from open receivables ===
 const inflows = (receivables || [])
 .filter((r) => {
 if (r.status === 'settled' || r.status === 'cancelled') return false;
 const due = r.dueDate || r.issueDate;
 return due && due >= startISO && due <= endISO;
 })
 .map((r) => ({
 date: r.dueDate || r.issueDate,
 amount: Number(r.openAmount || r.grossAmount || r.amount) || 0,
 source: 'receivable',
 sourceId: r.id,
 description: r.description || r.counterpartyName || 'CXC',
 }));

 // === Outflows from open payables ===
 const outflowsPayables = (payables || [])
 .filter((p) => {
 if (p.status === 'settled' || p.status === 'cancelled') return false;
 const due = p.dueDate || p.issueDate;
 return due && due >= startISO && due <= endISO;
 })
 .map((p) => ({
 date: p.dueDate || p.issueDate,
 amount: Number(p.openAmount || p.grossAmount || p.amount) || 0,
 source: 'payable',
 sourceId: p.id,
 description: p.description || p.counterpartyName || 'CXP',
 }));

 // === Outflows from recurringCosts (for months in horizon) ===
 // Walk month-by-month from start to end, expand each rule, dedupe against
 // already-existing payables (same recurringCostId + recurringPeriod).
 const existingByKey = new Set(
 (payables || [])
 .filter((p) => p.recurringCostId && p.recurringPeriod && p.status !== 'cancelled' && p.status !== 'void')
 .map((p) => `${p.recurringCostId}|${p.recurringPeriod}`),
 );

 const outflowsRecurring = [];
 const monthCursor = new Date(start.getFullYear(), start.getMonth(), 1);
 while (monthCursor <= end) {
 const y = monthCursor.getFullYear();
 const m = monthCursor.getMonth() + 1;
 const period = `${y}-${String(m).padStart(2, '0')}`;
 for (const rule of recurringCosts || []) {
 if (!rule.active) continue;
 if (!ruleAppliesToPeriod(rule, y, m)) continue;
 const key = `${rule.id}|${period}`;
 if (existingByKey.has(key)) continue; // already created
 const due = dueDateForPeriod(rule, y, m);
 if (due < startISO || due > endISO) continue;
 outflowsRecurring.push({
 date: due,
 amount: amountForPeriod(rule),
 source: 'recurring',
 sourceId: rule.id,
 description: `${rule.concept || ''} — ${rule.ownerName || ''}`.trim(),
 });
 }
 monthCursor.setMonth(monthCursor.getMonth() + 1);
 }

 const allInflows = inflows;
 const allOutflows = [...outflowsPayables, ...outflowsRecurring];

 // === Build daily timeseries ===
 const startingBalance = Number(bankAccount?.balance) || 0;
 const days = horizonDays + 1;
 const series = [];
 let runningBalance = startingBalance;

 for (let i = 0; i < days; i++) {
 const date = isoDate(addDays(start, i));
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

 // === Aggregate KPIs ===
 const totalInflows = allInflows.reduce((s, e) => s + e.amount, 0);
 const totalOutflows = allOutflows.reduce((s, e) => s + e.amount, 0);
 const netHorizon = totalInflows - totalOutflows;
 const projectedEndBalance = startingBalance + netHorizon;

 // Find first day where balance goes negative (warning indicator)
 const firstNegativeDay = series.find((d) => d.balance < 0);

 // Bucketed by horizon segments
 const next30 = series.find((_, i) => i === 30) || series[series.length - 1];
 const next60 = series.find((_, i) => i === 60) || series[series.length - 1];
 const next90 = series[series.length - 1];

 // Top counterparties by upcoming outflow
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
 startingBalance,
 series,
 inflows: allInflows,
 outflows: allOutflows,
 outflowsPayables,
 outflowsRecurring,
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
 }, [recurringCosts, payables, receivables, bankAccount, horizonDays]);
};

export default useForwardProjection;
