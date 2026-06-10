import React, { useMemo, useState } from 'react';
import {
 Bell, AlertTriangle, Clock, Users, TrendingDown, CheckCircle2,
 Eye
} from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { useReceivables } from '../../hooks/useReceivables';
import { usePayables } from '../../hooks/usePayables';
import { useTransactions } from '../../hooks/useTransactions';
import { useBudgets } from '../../hooks/useBudgets';
import { useAllTransactions } from '../../hooks/useAllTransactions';
import { formatCurrency } from '../../utils/formatters';
import { balances2025 } from '../../data/balances2025';
import { useToast } from '../../contexts/ToastContext';

const SEVERITY_STYLES = {
 critical: { bg: 'rgba(255, 77, 46, 0.12)', border: 'var(--color-err)', color: 'var(--color-accent)', icon: AlertTriangle },
 warning: { bg: 'rgba(255, 176, 32, 0.12)', border: 'var(--color-warn)', color: 'var(--color-warn)', icon: Clock },
 info: { bg: 'var(--color-bg-1)', border: 'var(--color-line)', color: 'var(--color-fg-3)', icon: Bell },
};

const getDaysUntilDue = (dueDate) => {
 if (!dueDate) return 0;
 const due = new Date(dueDate);
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 due.setHours(0, 0, 0, 0);
 return Math.ceil((due - today) / (1000 * 60 * 60 * 24));
};

const Alertas = ({ user }) => {
 const { notifications, loading, unreadCount, markAsRead, markAllAsRead } = useNotifications(user);
 const { receivables } = useReceivables(user);
 const { payables } = usePayables(user);
 const { transactions } = useTransactions(user);
 const { budgets } = useBudgets(user);
 const { allTransactions, loading: allTxLoading } = useAllTransactions(user);
 const [filter, setFilter] = useState('all');

 const { showToast } = useToast();

 // Auto-generated alerts from current data
 const autoAlerts = useMemo(() => {
 const alerts = [];

 // CXC overdue (>30d)
 receivables.filter(r => r.status !== 'settled' && r.status !== 'cancelled').forEach(r => {
 const days = getDaysUntilDue(r.dueDate);
 if (days < -30) {
 alerts.push({
 id: `cxc_overdue_${r.id}`,
 type: 'cxc_overdue',
 severity: 'critical',
 title: 'CXC Vencida >30 días',
 message: `${r.counterpartyName}: ${formatCurrency(r.openAmount)} — vencida hace ${Math.abs(days)} días`,
 auto: true,
 });
 }
 });

 // CXC due this week
 receivables.filter(r => r.status !== 'settled' && r.status !== 'cancelled').forEach(r => {
 const days = getDaysUntilDue(r.dueDate);
 if (days >= 0 && days <= 7) {
 alerts.push({
 id: `cxc_due_${r.id}`,
 type: 'cxc_due_soon',
 severity: 'warning',
 title: 'CXC por vencer',
 message: `${r.counterpartyName}: ${formatCurrency(r.openAmount)} — vence en ${days} días`,
 auto: true,
 });
 }
 });

 // CXP overdue
 payables.filter(p => p.status !== 'settled' && p.status !== 'cancelled').forEach(p => {
 const days = getDaysUntilDue(p.dueDate);
 if (days < 0) {
 alerts.push({
 id: `cxp_overdue_${p.id}`,
 type: 'cxp_overdue',
 severity: 'critical',
 title: 'CXP Vencida',
 message: `${p.counterpartyName}: ${formatCurrency(p.openAmount)} — vencida hace ${Math.abs(days)} días`,
 auto: true,
 });
 }
 });

 // Transaction-based CXC overdue (income pending/partial > 30d)
 const linkedRxIds = new Set(receivables.filter(r => r.linkedTransactionId).map(r => r.linkedTransactionId));
 transactions
 .filter(t => t.type === 'income' && (t.status === 'pending' || t.status === 'partial') && !linkedRxIds.has(t.id))
 .forEach(t => {
 const days = getDaysUntilDue(t.date);
 if (days < -30) {
 alerts.push({
 id: `txcxc_overdue_${t.id}`,
 type: 'cxc_overdue',
 severity: 'critical',
 title: 'CXC Vencida >30 días (Transacción)',
 message: `${t.description}: ${formatCurrency((parseFloat(t.amount) || 0) - (parseFloat(t.paidAmount) || 0))} — vencida hace ${Math.abs(days)} días`,
 auto: true,
 });
 } else if (days >= 0 && days <= 7) {
 alerts.push({
 id: `txcxc_due_${t.id}`,
 type: 'cxc_due_soon',
 severity: 'warning',
 title: 'CXC por vencer (Transacción)',
 message: `${t.description}: ${formatCurrency((parseFloat(t.amount) || 0) - (parseFloat(t.paidAmount) || 0))} — vence en ${days} días`,
 auto: true,
 });
 }
 });

 // Transaction-based CXP overdue (expense pending/partial)
 const linkedPxIds = new Set(payables.filter(p => p.linkedTransactionId).map(p => p.linkedTransactionId));
 transactions
 .filter(t => t.type === 'expense' && (t.status === 'pending' || t.status === 'partial') && !linkedPxIds.has(t.id))
 .forEach(t => {
 const days = getDaysUntilDue(t.date);
 if (days < 0) {
 alerts.push({
 id: `txcxp_overdue_${t.id}`,
 type: 'cxp_overdue',
 severity: 'critical',
 title: 'CXP Vencida (Transacción)',
 message: `${t.description}: ${formatCurrency((parseFloat(t.amount) || 0) - (parseFloat(t.paidAmount) || 0))} — vencida hace ${Math.abs(days)} días`,
 auto: true,
 });
 }
 });

 // Budget exceeded (>80%)
 const currentYear = new Date().getFullYear();
 budgets.filter(b => b.year === currentYear).forEach(b => {
 let actualExpense = 0;
 allTransactions.forEach(t => {
 if (t.type !== 'expense') return;
 const y = new Date(t.date).getFullYear();
 const m = new Date(t.date).getMonth() + 1;
 if (y !== b.year) return;
 if (b.month && m !== b.month) return;
 if ((t.project || '') === b.projectName || (!b.month && !b.projectId)) {
 actualExpense += t.amount;
 }
 });
 if (b.expenseLimit > 0) {
 const usage = (actualExpense / b.expenseLimit) * 100;
 if (usage > 100) {
 alerts.push({
 id: `budget_exceeded_${b.id}`,
 type: 'budget_exceeded',
 severity: 'critical',
 title: 'Presupuesto Excedido',
 message: `${b.projectName}: ${usage.toFixed(0)}% del límite de gasto (${formatCurrency(actualExpense)} / ${formatCurrency(b.expenseLimit)})`,
 auto: true,
 });
 } else if (usage > 80) {
 alerts.push({
 id: `budget_warning_${b.id}`,
 type: 'budget_warning',
 severity: 'warning',
 title: 'Presupuesto al 80%+',
 message: `${b.projectName}: ${usage.toFixed(0)}% del límite de gasto`,
 auto: true,
 });
 }
 }
 });

 // Negative cash flow projection
 const cashBalance = allTransactions.reduce((sum, t) => {
 if (t.status === 'pending') return sum;
 return sum + (t.type === 'income' ? t.amount : -t.amount);
 }, balances2025.bancoDic2025);
 if (cashBalance < 0) {
 alerts.push({
 id: 'cashflow_negative',
 type: 'cashflow_warning',
 severity: 'critical',
 title: 'Flujo de Caja Negativo',
 message: `Saldo actual: ${formatCurrency(cashBalance)}`,
 auto: true,
 });
 }

 return alerts;
 }, [receivables, payables, transactions, budgets, allTransactions]);

 // Merge auto alerts + stored notifications
 const allAlerts = useMemo(() => {
 const stored = notifications.map(n => ({ ...n, auto: false }));
 return [...autoAlerts, ...stored];
 }, [autoAlerts, notifications]);

 const filtered = useMemo(() => {
 if (filter === 'all') return allAlerts;
 if (filter === 'unread') return allAlerts.filter(a => a.auto || !a.read);
 return allAlerts.filter(a => a.severity === filter);
 }, [allAlerts, filter]);

 const criticalCount = allAlerts.filter(a => a.severity === 'critical').length;
 const warningCount = allAlerts.filter(a => a.severity === 'warning').length;

 if (loading) {
 return <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-[var(--color-warn)] border-t-transparent rounded-full animate-spin" /></div>;
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex items-center justify-between">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5 ">
 <p className="label-mono text-[var(--color-fg-1)]">Seguimiento</p>
 <h2 className="mt-2 text-[24px] font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">Centro de alertas</h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Revisa vencimientos, riesgos y avisos operativos desde una sola bandeja.</p>
 </div>
 {unreadCount > 0 && (
 <button onClick={async () => { await markAllAsRead(); showToast('Todas marcadas como leídas'); }}
 className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-2 text-[12px] font-medium text-[var(--color-fg-1)] transition hover:bg-transparent">
 <CheckCircle2 size={14} /> Marcar todas como leídas
 </button>
 )}
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center justify-between mb-2">
 <p className="label-mono text-[var(--color-fg-3)]">Críticas</p>
 <AlertTriangle size={18} className="text-[var(--color-accent)]" />
 </div>
 <p className="font-display text-[28px] font-medium tracking-[-0.03em] text-[var(--color-accent)]">{criticalCount}</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center justify-between mb-2">
 <p className="label-mono text-[var(--color-fg-3)]">Advertencias</p>
 <Clock size={18} className="text-[var(--color-warn)]" />
 </div>
 <p className="font-display text-[28px] font-medium tracking-[-0.03em] text-[var(--color-warn)]">{warningCount}</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center justify-between mb-2">
 <p className="label-mono text-[var(--color-fg-3)]">No leídas</p>
 <Bell size={18} className="text-[var(--color-fg-1)]" />
 </div>
 <p className="font-display text-[28px] font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">{unreadCount}</p>
 </div>
 </div>

 <div className="flex gap-2">
 {[
 { id: 'all', label: 'Todas' },
 { id: 'critical', label: 'Críticas' },
 { id: 'warning', label: 'Advertencias' },
 { id: 'unread', label: 'No leídas' },
 ].map(tab => (
 <button key={tab.id} onClick={() => setFilter(tab.id)}
className={`px-3.5 py-1.5 rounded-md label-mono transition-all ${
 filter === tab.id
 ? 'border border-[var(--color-fg-1)] bg-transparent text-[var(--color-fg-1)]'
 : 'border border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:bg-transparent'
 }`}>
 {tab.label}
 </button>
 ))}
 </div>

 <div className="space-y-2">
 {filtered.map((alert) => {
 const style = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info;
 const IconComp = style.icon;
 return (
 <div key={alert.id}
 className={`flex items-start gap-3 px-4 py-3.5 rounded-md border transition-colors ${!alert.auto && alert.read ? 'opacity-60' : ''}`}
 style={{ background: style.bg, borderColor: style.border }}
 >
 <IconComp size={18} style={{ color: style.color }} className="flex-shrink-0 mt-0.5" />
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-medium text-[var(--color-fg-1)]">{alert.title}</p>
 <p className="mt-0.5 text-[12px] text-[var(--color-fg-4)]">{alert.message}</p>
 {alert.createdAt && (
 <p className="mt-1 text-[10px] text-[var(--color-fg-3)]">
 {new Date(alert.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
 </p>
 )}
 </div>
 {!alert.auto && !alert.read && (
 <button onClick={() => markAsRead(alert.id)}
 className="flex-shrink-0 rounded-md p-1.5 text-[var(--color-fg-3)] transition-colors hover:bg-transparent hover:text-[var(--color-fg-1)]">
 <Eye size={14} />
 </button>
 )}
 {alert.auto && (
<span className="flex-shrink-0 rounded-full border border-[var(--color-line-s)] bg-transparent px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-fg-3)]">AUTO</span>
 )}
 </div>
 );
 })}
 {filtered.length === 0 && (
 <div className="text-center py-16">
 <Bell className="mx-auto mb-3 h-8 w-8 text-[var(--color-fg-3)]" />
 <p className="text-sm text-[var(--color-fg-3)]">No hay alertas</p>
 </div>
 )}
 </div>
 </div>
 );
};

export default Alertas;
