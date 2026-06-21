import { useMemo, useState } from 'react';
import {
 AlertTriangle,
 ArrowDownCircle,
 BadgeEuro,
 Plus,
 Search,
 Wallet,
} from 'lucide-react';
import PartialPaymentModal from '../../components/ui/PartialPaymentModal';
import RecordDetailModal from '../../components/ui/RecordDetailModal';
import { useToast } from '../../contexts/ToastContext';
import { usePayables } from '../../hooks/usePayables';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency, formatDate } from '../../utils/formatters';

const statusOptions = [
 { id: 'all', label: 'Todas' },
 { id: 'issued', label: 'Emitidas' },
 { id: 'partial', label: 'Parciales' },
 { id: 'overdue', label: 'Vencidas' },
 { id: 'settled', label: 'Liquidadas' },
];

const statusLabels = {
 issued: 'Emitida',
 partial: 'Parcial',
 overdue: 'Vencida',
 settled: 'Liquidada',
 cancelled: 'Cancelada',
};

const StatCard = ({ title, value, subtitle, accent, icon, onClick }) => {
  const IconComponent = icon;
  const Root = onClick ? 'button' : 'div';

  return (
  <Root
  type={onClick ? 'button' : undefined}
  className={`rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 text-left ${onClick ? 'w-full cursor-pointer transition-colors hover:bg-[var(--color-bg-2)]' : ''}`}
  onClick={onClick}
  >
 <div className="mb-4 flex items-center justify-between">
 <div>
  <p className="label-mono text-[var(--color-fg-3)]">{title}</p>
  <p className="mt-2 font-display text-[28px] font-medium tracking-tight text-[var(--color-fg-1)]">{value}</p>
 </div>
 <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}1f`, color: accent }}>
 <IconComponent size={18} />
 </div>
 </div>
  <p className="text-sm text-[var(--color-fg-3)]">{subtitle}</p>
  </Root>
 );
};

const toModalTransaction = (row) => ({
 id: row.id,
 amount: row.grossAmount,
 paidAmount: row.paidAmount,
 description: row.description || row.counterpartyName || 'Documento',
});

const Gastos = ({ userRole, user, onNewTransaction }) => {
 const { showToast } = useToast();
 const metrics = useTreasuryMetrics({ user });
 const { registerPayment: registerPayablePayment, markAsPaid: settlePayable } = usePayables(user);
 const { registerPayment: registerLegacyPayment, markAsCompleted: settleLegacyPayable } = useTransactionActions(user);

 const [searchTerm, setSearchTerm] = useState('');
 const [statusFilter, setStatusFilter] = useState('all');
 const [selectedRow, setSelectedRow] = useState(null);
 const [loadingId, setLoadingId] = useState(null);
 const [detailRecord, setDetailRecord] = useState(null);

 const canAct = userRole === 'admin' || userRole === 'manager';

 const paymentMovements = useMemo(
 () => metrics.postedMovements.filter((entry) => String(entry.kind || '').includes('payment')),
 [metrics.postedMovements],
 );

 const rows = useMemo(() => {
 return metrics.payables
 .filter((entry) => {
 if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
 if (!searchTerm.trim()) return true;
 const query = searchTerm.toLowerCase();
 return (
 (entry.counterpartyName || '').toLowerCase().includes(query) ||
 (entry.description || '').toLowerCase().includes(query) ||
 (entry.documentNumber || '').toLowerCase().includes(query) ||
 (entry.projectName || '').toLowerCase().includes(query)
 );
 })
 .sort((left, right) => (right.dueDate || '').localeCompare(left.dueDate || ''));
 }, [metrics.payables, searchTerm, statusFilter]);

  const openRows = metrics.payables.filter((entry) => ['issued', 'partial', 'overdue'].includes(entry.status));
  const totalOpen = openRows.reduce((sum, entry) => sum + entry.openAmount, 0);
  const totalOverdue = metrics.overduePayables.reduce((sum, entry) => sum + entry.openAmount, 0);
  const totalPartial = metrics.payables
  .filter((entry) => entry.status === 'partial')
  .reduce((sum, entry) => sum + entry.paidAmount, 0);
  const paidReal = paymentMovements.reduce((sum, entry) => sum + entry.amount, 0);
  const payablesAging = metrics.payablesAging || [];

 const handleSettle = async (row) => {
 if (loadingId) return;
 setLoadingId(row.id);
 try {
 let result = { success: false };
 if (row.source === 'payable') result = await settlePayable(row);
 if (row.source === 'legacy-transaction') {
 result = await settleLegacyPayable({
 id: row.legacyTransactionId,
 amount: row.grossAmount,
 type: 'expense',
 });
 }
 if (result.success) showToast('Gasto liquidado');
 else showToast('No se pudo liquidar el gasto', 'error');
 } finally {
 setLoadingId(null);
 }
 };

 const handlePartialPayment = async (_transaction, paymentData) => {
 if (!selectedRow) return;
 let result = { success: false };
 if (selectedRow.source === 'payable') result = await registerPayablePayment(selectedRow, paymentData);
 if (selectedRow.source === 'legacy-transaction') {
 result = await registerLegacyPayment(
 {
 id: selectedRow.legacyTransactionId,
 amount: selectedRow.grossAmount,
 paidAmount: selectedRow.paidAmount,
 type: 'expense',
 },
 paymentData,
 );
 }
 if (result.success) showToast('Pago parcial registrado');
 else showToast('No se pudo registrar el pago', 'error');
 };

 if (metrics.loading) {
 return (
 <div className="flex items-center justify-center py-28">
  <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
 </div>
 );
 }

 return (
 <div className="space-y-6 pb-12">
  <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-6 py-7">
 <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
 <div>
  <p className="mb-3 label-mono text-[var(--color-warn)]">Gastos</p>
  <h2 className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">Pagos reales y deuda operativa sin mezclar con caja futura.</h2>
  <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[var(--color-fg-3)]">
 Las CXP abiertas permanecen fuera de caja hasta registrar una salida real en banco. Aquí ves deuda, abonos y pagos realizados sobre el mismo ledger.
 </p>
 </div>
 {canAct && onNewTransaction && (
 <button
 type="button"
 onClick={() => onNewTransaction('expense')}
  className="inline-flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-3 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-accent-hover)]"
 >
 <Plus size={16} />
 Nueva factura CXP
 </button>
 )}
 </div>
 </section>

  <div className="grid gap-4 lg:grid-cols-4">
   <StatCard title="Pagado real" value={formatCurrency(paidReal)} subtitle={`${paymentMovements.length} pagos bancarios registrados`} accent="var(--color-accent)" icon={Wallet} onClick={() => setStatusFilter('settled')} />
   <StatCard title="Deuda abierta" value={formatCurrency(totalOpen)} subtitle={`${openRows.length} documentos activos`} accent="var(--color-warn)" icon={BadgeEuro} onClick={() => setStatusFilter('all')} />
   <StatCard title="Pago parcial" value={formatCurrency(totalPartial)} subtitle="Importe ya pagado sobre facturas aún abiertas" accent="var(--color-fg-3)" icon={ArrowDownCircle} />
   <StatCard title="Vencido" value={formatCurrency(totalOverdue)} subtitle={`${metrics.overduePayables.length} documentos fuera de plazo`} accent="var(--color-accent)" icon={AlertTriangle} onClick={() => setStatusFilter('overdue')} />
  </div>

  <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
   <div className="mb-3 flex items-center justify-between">
    <p className="label-mono text-[var(--color-fg-3)]">Aging de pagos</p>
    <p className="text-[11px] text-[var(--color-fg-4)]">Días desde vencimiento</p>
   </div>
   <div className="grid grid-cols-4 divide-x divide-[var(--color-line)]">
    {payablesAging.map((b) => (
    <div key={b.label} className="px-3 py-3 text-center">
    <p className="label-mono text-[10px] text-[var(--color-fg-4)]">{b.label}</p>
    <p className="mt-1 font-mono text-[14px] tabular-nums" style={{ color: b.total > 0 ? 'var(--color-warn)' : 'var(--color-fg-4)' }}>
    {formatCurrency(b.total)}
    </p>
    </div>
    ))}
   </div>
  </section>

  <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
 <div className="relative w-full xl:max-w-sm">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-3)]" size={16} />
 <input
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] py-3 pl-10 pr-4 text-sm text-[var(--color-fg-1)] outline-none transition-all placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 placeholder="Buscar proveedor, documento o proyecto"
 value={searchTerm}
 onChange={(event) => setSearchTerm(event.target.value)}
 />
 </div>
 <div className="flex flex-wrap items-center gap-2">
 {statusOptions.map((option) => (
 <button
 key={option.id}
 type="button"
 onClick={() => setStatusFilter(option.id)}
  className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
 statusFilter === option.id
  ? 'border-[var(--color-line-s)] bg-[var(--color-bg-2)] text-[var(--color-warn)]'
  : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
 }`}
 >
 {option.label}
 </button>
 ))}
 </div>
 </div>

 <div className="overflow-x-auto">
 <table className="w-full min-w-[980px] text-left">
 <thead>
  <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-3)]">
 <th className="px-4 py-3">Proveedor</th>
 <th className="px-4 py-3">Documento</th>
 <th className="px-4 py-3">Proyecto</th>
 <th className="px-4 py-3 text-right">Bruto</th>
 <th className="px-4 py-3 text-right">Abierto</th>
 <th className="px-4 py-3 text-center">Vence</th>
 <th className="px-4 py-3 text-center">Estado</th>
 <th className="px-4 py-3 text-center">Origen</th>
 {canAct && <th className="px-4 py-3 text-right">Acciones</th>}
 </tr>
 </thead>
  <tbody className="divide-y divide-[var(--color-line)]">
 {rows.map((row) => {
 const canSettle = row.source !== 'legacy-opening' && row.status !== 'settled' && row.status !== 'cancelled';
 return (
   <tr key={row.id} {...rowButtonProps(() => setDetailRecord(row), 'hover:bg-[var(--color-bg-2)]')}>
 <td className="px-4 py-4">
  <p className="text-sm font-medium text-[var(--color-fg-1)]">{row.counterpartyName}</p>
  <p className="text-xs text-[var(--color-fg-3)]">{row.description || 'Sin descripción'}</p>
 </td>
  <td className="px-4 py-4 text-sm text-[var(--color-fg-1)]">{row.documentNumber || 'Sin documento'}</td>
  <td className="px-4 py-4 text-sm text-[var(--color-fg-3)]">{row.projectName || 'Sin proyecto'}</td>
  <td className="px-4 py-4 text-right text-sm font-medium text-[var(--color-fg-1)]">{formatCurrency(row.grossAmount)}</td>
  <td className="px-4 py-4 text-right text-sm font-medium text-[var(--color-warn)]">{formatCurrency(row.openAmount)}</td>
  <td className="px-4 py-4 text-center text-sm text-[var(--color-fg-3)]">{row.dueDate ? formatDate(row.dueDate) : 'Sin fecha'}</td>
 <td className="px-4 py-4 text-center">
 <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
 row.status === 'settled'
  ? 'border-[var(--color-line-s)] bg-transparent text-[var(--color-ok)]'
 : row.status === 'overdue'
  ? 'border-[var(--color-line-s)] bg-transparent text-[var(--color-accent)]'
 : row.status === 'partial'
  ? 'border-[var(--color-line-s)] bg-transparent text-[var(--color-warn)]'
  : 'border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)]'
 }`}>
 {statusLabels[row.status]}
 </span>
 </td>
  <td className="px-4 py-4 text-center text-xs text-[var(--color-fg-3)]">{row.source}</td>
 {canAct && (
 <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
 <div className="flex justify-end gap-2">
 {canSettle && (
 <>
 <button
 type="button"
 onClick={() => setSelectedRow(row)}
  className="rounded-md border border-[var(--color-line)] px-3 py-2 text-xs font-medium text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]"
 >
 Abono
 </button>
 <button
 type="button"
 onClick={() => handleSettle(row)}
 disabled={loadingId === row.id}
  className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
 >
 {loadingId === row.id ? 'Procesando...' : 'Liquidar'}
 </button>
 </>
 )}
 </div>
 </td>
 )}
 </tr>
 );
 })}
 {rows.length === 0 && (
 <tr>
  <td colSpan={canAct ? 9 : 8} className="px-4 py-8 text-center text-sm text-[var(--color-fg-3)]">
 No hay gastos que coincidan con los filtros.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </section>

 <PartialPaymentModal
 isOpen={Boolean(selectedRow)}
 onClose={() => setSelectedRow(null)}
 transaction={selectedRow ? toModalTransaction(selectedRow) : null}
 onSubmit={handlePartialPayment}
 />

 <RecordDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} userRole={userRole} />
 </div>
 );
};

export default Gastos;
