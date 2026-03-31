import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  BadgeEuro,
  Plus,
  Search,
  Wallet,
} from 'lucide-react';
import PartialPaymentModal from '../../components/ui/PartialPaymentModal';
import RecordDetailModal from '../../components/ui/RecordDetailModal';
import { useToast } from '../../contexts/ToastContext';
import { useReceivables } from '../../hooks/useReceivables';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
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

  return (
    <div
      className={`rounded-[26px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,248,255,0.94))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)] ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:shadow-[0_28px_90px_rgba(0,0,0,0.44)] transition-transform duration-200' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7a96]">{title}</p>
          <p className="mt-2 text-[28px] font-semibold tracking-tight text-[#101938]">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ backgroundColor: `${accent}1f`, color: accent }}>
          <IconComponent size={18} />
        </div>
      </div>
      <p className="text-sm text-[#6b7a96]">{subtitle}</p>
    </div>
  );
};

const toModalTransaction = (row) => ({
  id: row.id,
  amount: row.grossAmount,
  paidAmount: row.paidAmount,
  description: row.description || row.counterpartyName || 'Documento',
});

const Ingresos = ({ userRole, user, onNewTransaction }) => {
  const { showToast } = useToast();
  const metrics = useTreasuryMetrics({ user });
  const { registerPayment: registerReceivablePayment, markAsPaid: settleReceivable } = useReceivables(user);
  const { registerPayment: registerLegacyPayment, markAsCompleted: settleLegacyReceivable } = useTransactionActions(user);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRow, setSelectedRow] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [detailRecord, setDetailRecord] = useState(null);

  const canAct = userRole === 'admin' || userRole === 'manager';

  const collectionMovements = useMemo(
    () => metrics.postedMovements.filter((entry) => String(entry.kind || '').includes('collection')),
    [metrics.postedMovements],
  );

  const rows = useMemo(() => {
    return metrics.receivables
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
  }, [metrics.receivables, searchTerm, statusFilter]);

  const openRows = metrics.receivables.filter((entry) => ['issued', 'partial', 'overdue'].includes(entry.status));
  const totalOpen = openRows.reduce((sum, entry) => sum + entry.openAmount, 0);
  const totalOverdue = metrics.overdueReceivables.reduce((sum, entry) => sum + entry.openAmount, 0);
  const totalPartial = metrics.receivables
    .filter((entry) => entry.status === 'partial')
    .reduce((sum, entry) => sum + entry.paidAmount, 0);
  const collectedReal = collectionMovements.reduce((sum, entry) => sum + entry.amount, 0);

  const handleSettle = async (row) => {
    if (loadingId) return;
    setLoadingId(row.id);
    try {
      let result = { success: false };
      if (row.source === 'receivable') result = await settleReceivable(row);
      if (row.source === 'legacy-transaction') {
        result = await settleLegacyReceivable({
          id: row.legacyTransactionId,
          amount: row.grossAmount,
          type: 'income',
        });
      }
      if (result.success) showToast('Ingreso liquidado');
      else showToast('No se pudo liquidar el ingreso', 'error');
    } finally {
      setLoadingId(null);
    }
  };

  const handlePartialPayment = async (_transaction, paymentData) => {
    if (!selectedRow) return;
    let result = { success: false };
    if (selectedRow.source === 'receivable') result = await registerReceivablePayment(selectedRow, paymentData);
    if (selectedRow.source === 'legacy-transaction') {
      result = await registerLegacyPayment(
        {
          id: selectedRow.legacyTransactionId,
          amount: selectedRow.grossAmount,
          paidAmount: selectedRow.paidAmount,
          type: 'income',
        },
        paymentData,
      );
    }
    if (result.success) showToast('Cobro parcial registrado');
    else showToast('No se pudo registrar el cobro', 'error');
  };

  if (metrics.loading) {
    return (
      <div className="flex items-center justify-center py-28">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#30d158] border-t-transparent" />
          <p className="text-sm text-[#6b7a96]">Consolidando ingresos operativos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <section className="rounded-[34px] border border-[rgba(205,219,243,0.82)] bg-[radial-gradient(circle_at_top_left,rgba(48,209,88,0.18),transparent_28%),linear-gradient(160deg,#0d1310_0%,#090b10_100%)] px-6 py-7 shadow-[0_40px_120px_rgba(0,0,0,0.42)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#80f0a4]">Ingresos</p>
            <h2 className="text-[32px] font-semibold tracking-tight text-[#101938]">Cobros reales y cartera pendiente en una sola vista.</h2>
            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[#a7a7ad]">
              La caja entra solo con movimientos bancarios `posted`. Las facturas abiertas permanecen como cartera hasta registrar un cobro real.
            </p>
          </div>
          {canAct && onNewTransaction && (
            <button
              type="button"
              onClick={() => onNewTransaction('income')}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#30d158] px-4 py-3 text-sm font-semibold text-[#101938] transition-colors hover:bg-[#28c74e]"
            >
              <Plus size={16} />
              Nueva factura CXC
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <StatCard title="Cobrado real" value={formatCurrency(collectedReal)} subtitle={`${collectionMovements.length} cobros bancarios registrados`} accent="#30d158" icon={Wallet} onClick={() => setStatusFilter('settled')} />
        <StatCard title="Cartera abierta" value={formatCurrency(totalOpen)} subtitle={`${openRows.length} documentos activos`} accent="#64d2ff" icon={BadgeEuro} onClick={() => setStatusFilter('all')} />
        <StatCard title="Cobro parcial" value={formatCurrency(totalPartial)} subtitle="Importe ya cobrado sobre facturas aún abiertas" accent="#ff9f0a" icon={ArrowUpCircle} />
        <StatCard title="Vencido" value={formatCurrency(totalOverdue)} subtitle={`${metrics.overdueReceivables.length} documentos fuera de plazo`} accent="#ff453a" icon={AlertTriangle} onClick={() => setStatusFilter('overdue')} />
      </div>

      <section className="rounded-[28px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,248,255,0.94))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7a96]" size={16} />
            <input
              className="w-full rounded-2xl border border-[rgba(205,219,243,0.82)] bg-[#101115] py-3 pl-10 pr-4 text-sm text-[#101938] outline-none transition-all focus:border-[rgba(48,209,88,0.35)]"
              placeholder="Buscar cliente, documento o proyecto"
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
                className={`rounded-full border px-3 py-2 text-sm font-medium transition-all ${
                  statusFilter === option.id
                    ? 'border-[rgba(48,209,88,0.28)] bg-[rgba(48,209,88,0.12)] text-[#30d158]'
                    : 'border-[rgba(255,255,255,0.08)] text-[#6b7a96] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#101938]'
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
              <tr className="border-b border-[rgba(255,255,255,0.06)] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7a96]">
                <th className="px-4 py-3">Cliente</th>
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
            <tbody className="divide-y divide-[rgba(255,255,255,0.04)]">
              {rows.map((row) => {
                const canSettle = row.source !== 'legacy-opening' && row.status !== 'settled' && row.status !== 'cancelled';
                return (
                  <tr key={row.id} className="cursor-pointer hover:bg-[rgba(255,255,255,0.03)]" onClick={() => setDetailRecord(row)}>
                    <td className="px-4 py-4">
                      <p className="text-sm font-semibold text-[#101938]">{row.counterpartyName}</p>
                      <p className="text-xs text-[#6b7a96]">{row.description || 'Sin descripción'}</p>
                    </td>
                    <td className="px-4 py-4 text-sm text-[#16223f]">{row.documentNumber || 'Sin documento'}</td>
                    <td className="px-4 py-4 text-sm text-[#6b7a96]">{row.projectName || 'Sin proyecto'}</td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-[#101938]">{formatCurrency(row.grossAmount)}</td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-[#64d2ff]">{formatCurrency(row.openAmount)}</td>
                    <td className="px-4 py-4 text-center text-sm text-[#6b7a96]">{row.dueDate ? formatDate(row.dueDate) : 'Sin fecha'}</td>
                    <td className="px-4 py-4 text-center">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        row.status === 'settled'
                          ? 'border-[rgba(48,209,88,0.2)] bg-[rgba(48,209,88,0.12)] text-[#30d158]'
                          : row.status === 'overdue'
                            ? 'border-[rgba(255,69,58,0.2)] bg-[rgba(255,69,58,0.12)] text-[#ff453a]'
                            : row.status === 'partial'
                              ? 'border-[rgba(255,159,10,0.2)] bg-[rgba(255,159,10,0.12)] text-[#ff9f0a]'
                              : 'border-[rgba(100,210,255,0.2)] bg-[rgba(100,210,255,0.12)] text-[#64d2ff]'
                      }`}>
                        {statusLabels[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center text-xs text-[#6b7a96]">{row.source}</td>
                    {canAct && (
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-2">
                          {canSettle && (
                            <>
                              <button
                                type="button"
                                onClick={() => setSelectedRow(row)}
                                className="rounded-xl border border-[rgba(205,219,243,0.82)] px-3 py-2 text-xs font-semibold text-[#64d2ff] transition-colors hover:bg-[rgba(100,210,255,0.12)]"
                              >
                                Abono
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSettle(row)}
                                disabled={loadingId === row.id}
                                className="rounded-xl bg-[#30d158] px-3 py-2 text-xs font-semibold text-[#101938] transition-colors hover:bg-[#28c74e] disabled:opacity-50"
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
                  <td colSpan={canAct ? 9 : 8} className="px-4 py-8 text-center text-sm text-[#6b7a96]">
                    No hay ingresos que coincidan con los filtros.
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

export default Ingresos;
