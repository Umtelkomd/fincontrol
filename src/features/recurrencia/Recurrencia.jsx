import React, { useState, useMemo } from 'react';
import {
 RefreshCw, CalendarClock, TrendingUp, Play, CheckCircle2,
 Clock, AlertTriangle, Pause
} from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useAllTransactions } from '../../hooks/useAllTransactions';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useToast } from '../../contexts/ToastContext';

const FREQUENCY_LABELS = {
 weekly: 'Semanal',
 biweekly: 'Quincenal',
 monthly: 'Mensual',
 quarterly: 'Trimestral',
 yearly: 'Anual',
};

const FREQUENCY_DAYS = {
 weekly: 7,
 biweekly: 14,
 monthly: 30,
 quarterly: 90,
 yearly: 365,
};

const getNextOccurrence = (lastDate, frequency) => {
 const date = new Date(lastDate);
 switch (frequency) {
 case 'weekly': date.setDate(date.getDate() + 7); break;
 case 'biweekly': date.setDate(date.getDate() + 14); break;
 case 'monthly': date.setMonth(date.getMonth() + 1); break;
 case 'quarterly': date.setMonth(date.getMonth() + 3); break;
 case 'yearly': date.setFullYear(date.getFullYear() + 1); break;
 default: date.setMonth(date.getMonth() + 1);
 }
 return date;
};

const isInCurrentMonth = (date) => {
 const now = new Date();
 return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
};

const Recurrencia = ({ user }) => {
 const { transactions, loading } = useTransactions(user);
 const { allTransactions } = useAllTransactions(user);
 const { createTransaction } = useTransactionActions(user);
 const [generating, setGenerating] = useState(false);
 const [filter, setFilter] = useState('all');

 const { showToast } = useToast();

 const recurringTransactions = useMemo(() => {
 return transactions.filter(t => t.isRecurring === true);
 }, [transactions]);

 const enriched = useMemo(() => {
 return recurringTransactions.map(t => {
 const nextDate = getNextOccurrence(t.date, t.recurringFrequency || 'monthly');
 const isExpired = t.recurringEndDate && new Date(t.recurringEndDate) < new Date();
 const isDueThisMonth = isInCurrentMonth(nextDate);
 return { ...t, nextDate, isExpired, isDueThisMonth };
 });
 }, [recurringTransactions]);

 const filtered = useMemo(() => {
 if (filter === 'all') return enriched;
 if (filter === 'active') return enriched.filter(t => !t.isExpired);
 if (filter === 'this_month') return enriched.filter(t => t.isDueThisMonth);
 if (filter === 'expired') return enriched.filter(t => t.isExpired);
 return enriched;
 }, [enriched, filter]);

 // KPIs
 const totalRecurring = enriched.length;
 const dueThisMonth = enriched.filter(t => t.isDueThisMonth && !t.isExpired).length;
 const monthlyEstimate = useMemo(() => {
 return enriched
 .filter(t => !t.isExpired)
 .reduce((sum, t) => {
 const freq = t.recurringFrequency || 'monthly';
 const daysInFreq = FREQUENCY_DAYS[freq] || 30;
 const monthlyFactor = 30 / daysInFreq;
 return sum + (t.amount * monthlyFactor);
 }, 0);
 }, [enriched]);

 const handleGeneratePending = async () => {
 if (generating) return;
 setGenerating(true);

 const today = new Date();
 today.setHours(0, 0, 0, 0);
 let created = 0;

 try {
 for (const t of enriched) {
 if (t.isExpired) continue;
 if (!t.isDueThisMonth) continue;

 // Check if already generated this month
 const alreadyExists = allTransactions.some(existing => {
 if (existing.id === t.id) return false;
 const existingDate = new Date(existing.date);
 return (
 existing.description === t.description &&
 existing.amount === t.amount &&
 existingDate.getMonth() === today.getMonth() &&
 existingDate.getFullYear() === today.getFullYear()
 );
 });

 if (alreadyExists) continue;

 const nextDateStr = t.nextDate.toISOString().split('T')[0];
 const result = await createTransaction({
 date: nextDateStr,
 description: t.description,
 amount: t.amount,
 type: t.type,
 category: t.category || '',
 project: t.project || '',
 costCenter: t.costCenter || 'Sin asignar',
 status: 'pending',
 isRecurring: false,
 comment: `Generada automaticamente desde recurrencia: ${t.description}`,
 });

 if (result?.success) created++;
 }

 if (created > 0) {
 showToast(`${created} transaccion(es) recurrente(s) generada(s)`, 'success');
 } else {
 showToast('No hay transacciones pendientes por generar este mes', 'info');
 }
 } catch (err) {
 console.error('Error generating recurring transactions:', err);
 showToast('Error al generar transacciones recurrentes', 'error');
 } finally {
 setGenerating(false);
 }
 };

 if (loading) {
 return (
 <div className="flex items-center justify-center py-20">
 <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
 </div>
 );
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex items-center justify-between">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5 ">
 <p className="label-mono text-[var(--color-fg-1)]">Automatización</p>
 <h2 className="mt-2 text-[24px] font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">Recurrencia automática</h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">Controla los movimientos periódicos y genera los pendientes del mes con un solo paso.</p>
 </div>
 <button
 onClick={handleGeneratePending}
 disabled={generating}
 className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-s)] bg-transparent px-4 py-2 text-[12px] font-medium text-[var(--color-ok)] transition hover:bg-transparent disabled:opacity-50"
 >
 {generating ? (
 <div className="h-3.5 w-3.5 rounded-full border-2 border-[var(--color-ok)] border-t-transparent animate-spin" />
 ) : (
 <Play size={14} />
 )}
 Generar pendientes
 </button>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center justify-between mb-2">
 <p className="label-mono text-[var(--color-fg-3)]">Total recurrentes</p>
 <RefreshCw size={18} className="text-[var(--color-fg-1)]" />
 </div>
 <p className="font-display text-[28px] font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">{totalRecurring}</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center justify-between mb-2">
 <p className="label-mono text-[var(--color-fg-3)]">Próximas este mes</p>
 <CalendarClock size={18} className="text-[var(--color-warn)]" />
 </div>
 <p className="font-display text-[28px] font-medium tracking-[-0.03em] text-[var(--color-warn)]">{dueThisMonth}</p>
 </div>
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex items-center justify-between mb-2">
 <p className="label-mono text-[var(--color-fg-3)]">Monto mensual estimado</p>
 <TrendingUp size={18} className="text-[var(--color-ok)]" />
 </div>
 <p className="font-display text-[28px] font-medium tracking-[-0.03em] text-[var(--color-ok)]">{formatCurrency(monthlyEstimate)}</p>
 </div>
 </div>

 <div className="flex gap-2">
 {[
 { id: 'all', label: 'Todas' },
 { id: 'active', label: 'Activas' },
 { id: 'this_month', label: 'Este Mes' },
 { id: 'expired', label: 'Expiradas' },
 ].map(tab => (
 <button key={tab.id} onClick={() => setFilter(tab.id)}
 className={`px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
 filter === tab.id
 ? 'border border-[var(--color-fg-1)] bg-transparent text-[var(--color-fg-1)]'
 : 'border border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:bg-transparent'
 }`}>
 {tab.label}
 </button>
 ))}
 </div>

 <div className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <div className="overflow-x-auto">
 <table className="w-full text-left">
 <thead>
 <tr className="border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
 <th className="px-4 py-3 label-mono text-[var(--color-fg-3)]">Descripción</th>
 <th className="px-4 py-3 label-mono text-[var(--color-fg-3)]">Tipo</th>
 <th className="px-4 py-3 label-mono text-[var(--color-fg-3)]">Frecuencia</th>
 <th className="px-4 py-3 text-right label-mono text-[var(--color-fg-3)]">Monto</th>
 <th className="px-4 py-3 label-mono text-[var(--color-fg-3)]">Próxima fecha</th>
 <th className="px-4 py-3 label-mono text-[var(--color-fg-3)]">Estado</th>
 </tr>
 </thead>
 <tbody>
 {filtered.map((t) => (
 <tr key={t.id} className="border-b border-[var(--color-bg-1)] transition-colors hover:bg-[var(--color-bg-1)]">
 <td className="px-4 py-3">
 <p className="max-w-[220px] truncate text-[13px] font-medium text-[var(--color-fg-1)]">{t.description}</p>
 <p className="text-[11px] text-[var(--color-fg-3)]">{t.project || 'Sin proyecto'}</p>
 </td>
 <td className="px-4 py-3">
 <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
 t.type === 'income'
 ? 'bg-transparent text-[var(--color-ok)]'
 : 'bg-transparent text-[var(--color-accent)]'
 }`}>
 {t.type === 'income' ? 'Ingreso' : 'Gasto'}
 </span>
 </td>
 <td className="px-4 py-3">
 <span className="text-[12px] text-[var(--color-fg-3)]">
 {FREQUENCY_LABELS[t.recurringFrequency] || 'Mensual'}
 </span>
 </td>
 <td className="px-4 py-3 text-right">
 <span className={`text-[13px] font-medium ${
 t.type === 'income' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'
 }`}>
 {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
 </span>
 </td>
 <td className="px-4 py-3">
 <span className="text-[12px] text-[var(--color-fg-3)]">
 {formatDate(t.nextDate.toISOString())}
 </span>
 </td>
 <td className="px-4 py-3">
 {t.isExpired ? (
 <span className="inline-flex items-center gap-1 rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium text-[var(--color-fg-3)]">
 <Pause size={10} /> Expirada
 </span>
 ) : t.isDueThisMonth ? (
 <span className="inline-flex items-center gap-1 rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium text-[var(--color-warn)]">
 <AlertTriangle size={10} /> Pendiente
 </span>
 ) : (
 <span className="inline-flex items-center gap-1 rounded-full bg-transparent px-2 py-0.5 text-[11px] font-medium text-[var(--color-ok)]">
 <CheckCircle2 size={10} /> Activa
 </span>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>

 {filtered.length === 0 && (
 <div className="text-center py-16">
 <RefreshCw className="mx-auto mb-3 h-8 w-8 text-[var(--color-fg-3)]" />
 <p className="mb-1 text-sm text-[var(--color-fg-3)]">No hay transacciones recurrentes</p>
 <p className="text-[11px] text-[var(--color-fg-3)]">Marca una transacción como recurrente al crearla o editarla.</p>
 </div>
 )}
 </div>
 </div>
 );
};

export default Recurrencia;
