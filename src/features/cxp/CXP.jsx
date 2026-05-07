import React, { useState, useMemo } from 'react';
import { TrendingDown, Clock, AlertCircle, DollarSign, CheckCircle2, ArrowDownCircle } from 'lucide-react';
import { formatCurrency, formatDate, getDaysOverdue, safe } from '../../utils/formatters';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import PartialPaymentModal from '../../components/ui/PartialPaymentModal';
import { KPIGrid, KPI, Button, Badge, Panel, EmptyState, Toast } from '@/components/ui/nexus';

const CXP = ({
 transactions,
 userRole,
 user
}) => {
 const { registerPayment, markAsCompleted } = useTransactionActions(user);
 const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
 const [paymentTransaction, setPaymentTransaction] = useState(null);
 const [toast, setToast] = useState(null);
 const [loadingId, setLoadingId] = useState(null);

 const payables = useMemo(
 () => transactions.filter(t => t.type === 'expense' && (t.status === 'pending' || t.status === 'partial')),
 [transactions]
 );

 const totalPayable = payables.reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
 const overduePayables = payables.filter(t => getDaysOverdue(t.date) > 0);
 const totalOverdue = overduePayables.reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
 const dueThisWeek = payables.filter(t => {
 const d = -getDaysOverdue(t.date);
 return d >= 0 && d <= 7;
 });
 const totalDueThisWeek = dueThisWeek.reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
 const partialPayables = payables.filter(t => t.status === 'partial');
 const totalPartial = partialPayables.reduce((sum, t) => sum + (t.paidAmount || 0), 0);

 const showToast = (message, type = 'success') => {
 setToast({ message, type });
 setTimeout(() => setToast(null), 3000);
 };

 const handleMarkPagado = async (t) => {
 if (loadingId) return;
 setLoadingId(t.id);
 const result = await markAsCompleted(t);
 if (result?.success) showToast('Factura marcada como pagada');
 else showToast('Error al marcar como pagada', 'error');
 setLoadingId(null);
 };

 const handlePaymentSubmit = async (transaction, paymentData) => {
 const result = await registerPayment(transaction, paymentData);
 if (result?.success) showToast('Abono registrado correctamente');
 else showToast('Error al registrar abono', 'error');
 };

 const sorted = useMemo(() => {
 return [...payables].sort((a, b) => {
 const aOv = getDaysOverdue(a.date) > 0 ? 1 : 0;
 const bOv = getDaysOverdue(b.date) > 0 ? 1 : 0;
 if (aOv !== bOv) return bOv - aOv;
 return new Date(a.date) - new Date(b.date);
 });
 }, [payables]);

 const canAct = userRole === 'admin' || userRole === 'manager';

 return (
 <div className="space-y-6">
 {toast && (
 <Toast variant={toast.type === 'success' ? 'ok' : 'err'} onDismiss={() => setToast(null)}>
 {toast.message}
 </Toast>
 )}

 <KPIGrid cols={4}>
 <KPI
 label="Total por pagar"
 value={formatCurrency(totalPayable)}
 meta={`${payables.length} facturas pendientes`}
 icon={TrendingDown}
 />
 <KPI
 label="Pagado parcialmente"
 value={formatCurrency(totalPartial)}
 meta={`${partialPayables.length} facturas con abono`}
 tone="warn"
 icon={DollarSign}
 />
 <KPI
 label="Vencido"
 value={formatCurrency(totalOverdue)}
 meta={`${overduePayables.length} facturas vencidas`}
 tone="err"
 icon={AlertCircle}
 />
 <KPI
 label="Vence esta semana"
 value={formatCurrency(totalDueThisWeek)}
 meta={`${dueThisWeek.length} facturas próximas`}
 tone="warn"
 icon={Clock}
 />
 </KPIGrid>

 <Panel title="Cuentas por pagar" meta={`${sorted.length} facturas pendientes`} padding={false}>
 <div className="overflow-x-auto">
 <table className="w-full text-left">
 <thead className="bg-[var(--color-bg-1)] border-b border-[var(--color-line)]">
 <tr>
 <th className="px-4 py-4 label-mono text-[var(--color-fg-3)]">Fecha</th>
 <th className="px-4 py-4 label-mono text-[var(--color-fg-3)]">Descripción</th>
 <th className="px-4 py-4 label-mono text-[var(--color-fg-3)] hidden md:table-cell">Categoría</th>
 <th className="px-4 py-4 label-mono text-[var(--color-fg-3)] text-right">Monto</th>
 <th className="px-4 py-4 label-mono text-[var(--color-fg-3)] text-center">Estado</th>
 {canAct && <th className="px-4 py-4 label-mono text-[var(--color-fg-3)] text-center">Acciones</th>}
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-line)]">
 {sorted.map((t) => {
 const isOverdue = getDaysOverdue(t.date) > 0;
 const isPartial = t.status === 'partial';
 const paidAmount = t.paidAmount || 0;
 const remaining = t.amount - paidAmount;
 const paidPct = t.amount > 0 ? (paidAmount / t.amount) * 100 : 0;
 const isLoading = loadingId === t.id;
 return (
 <tr key={t.id} className={`group transition-all duration-200 ${isOverdue ? 'bg-transparent' : 'hover:bg-[var(--color-bg-1)]'}`}>
 <td className="px-4 py-4 whitespace-nowrap">
 <div className="flex flex-col">
 <span className="text-sm font-medium text-[var(--color-fg-3)]">{formatDate(t.date)}</span>
 {isOverdue && <span className="text-[10px] text-[var(--color-accent)] font-medium">Vencido {getDaysOverdue(t.date)}d</span>}
 </div>
 </td>
 <td className="px-4 py-4">
 <div className="flex items-start gap-3">
 <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 bg-transparent">
 <ArrowDownCircle className="w-5 h-5 text-[var(--color-accent)]" />
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-sm font-medium text-[var(--color-fg-1)]">{safe(t.description)}</span>
 {t.isRecurring && (
 <Badge variant="neutral" dot>Recurrente</Badge>
 )}
 </div>
 <span className="text-xs text-[var(--color-fg-4)] block mt-0.5">{safe(t.project)}</span>
 {isPartial && (
 <div className="mt-1.5">
 <div className="w-full max-w-[160px] h-1.5 bg-[var(--color-bg-2)] rounded-full overflow-hidden">
 <div className="h-full bg-[var(--color-ok)] rounded-full" style={{ width: `${paidPct}%` }} />
 </div>
 <span className="text-[10px] text-[var(--color-fg-3)] mt-0.5 block">Pagado: {formatCurrency(paidAmount)} / {formatCurrency(t.amount)}</span>
 </div>
 )}
 </div>
 </div>
 </td>
 <td className="px-4 py-4 hidden md:table-cell">
 <Badge variant="neutral">{safe(t.category)}</Badge>
 </td>
 <td className="px-4 py-4 text-right whitespace-nowrap">
 <div className="flex flex-col items-end">
 <span className="font-mono text-sm tabular-nums text-[var(--color-accent)]">-{formatCurrency(t.amount)}</span>
 {isPartial && <span className="text-xs text-[var(--color-warn)]">Restante: {formatCurrency(remaining)}</span>}
 </div>
 </td>
 <td className="px-4 py-4 text-center">
 {isPartial ? (
 <Badge variant="warn" dot>Pago Parcial</Badge>
 ) : isOverdue ? (
 <Badge variant="err" dot>Vencido</Badge>
 ) : (
 <Badge variant="warn" dot>Pendiente</Badge>
 )}
 </td>
 {canAct && (
 <td className="px-4 py-4 text-center">
 <div className="flex items-center justify-center gap-2">
 <Button
 variant="primary"
 size="sm"
 icon={CheckCircle2}
 onClick={() => handleMarkPagado(t)}
 loading={isLoading}
 disabled={isLoading}
 >
 {isLoading ? 'Guardando...' : 'Pagado'}
 </Button>
 <Button
 variant="ghost"
 size="sm"
 icon={DollarSign}
 onClick={() => { setPaymentTransaction(t); setIsPaymentModalOpen(true); }}
 disabled={isLoading}
 >
 Abono
 </Button>
 </div>
 </td>
 )}
 </tr>
 );
 })}
 {sorted.length === 0 && (
 <tr>
 <td colSpan={canAct ? 6 : 5}>
 <EmptyState
 icon={TrendingDown}
 title="Sin cuentas por pagar"
 description="Las facturas pendientes aparecerán aquí."
 />
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </Panel>

 <PartialPaymentModal
 isOpen={isPaymentModalOpen}
 onClose={() => { setIsPaymentModalOpen(false); setPaymentTransaction(null); }}
 transaction={paymentTransaction}
 onSubmit={handlePaymentSubmit}
 />
 </div>
 );
};

export default CXP;
