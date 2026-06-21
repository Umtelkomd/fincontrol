import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeEuro,
  Plus,
  Search,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import LinkBankMovementModal from '../../components/ui/LinkBankMovementModal';
import RecordDetailModal from '../../components/ui/RecordDetailModal';
import { useToast } from '../../contexts/ToastContext';
import { useBankMovements } from '../../hooks/useBankMovements';
import { useClassifier } from '../../hooks/useClassifier';
import { usePayables } from '../../hooks/usePayables';
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

const validationOptions = [
  { id: 'all', label: 'Todo' },
  { id: 'validated', label: 'Validado DATEV' },
  { id: 'pending', label: 'Pendiente' },
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

const Gastos = ({ userRole, user, onNewTransaction }) => {
  const { showToast } = useToast();
  const metrics = useTreasuryMetrics({ user });
  const { cancelPayable } = usePayables(user);
  const { bankMovements } = useBankMovements(user);
  const { linkPayablesToMovement, forceReconcilePayables } = useClassifier(user);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [validationFilter, setValidationFilter] = useState('all');
  const [linkDoc, setLinkDoc] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [detailRecord, setDetailRecord] = useState(null);

  const canAct = userRole === 'admin' || userRole === 'manager';
  const canForce = userRole === 'admin';

  const paymentMovements = useMemo(
    () => metrics.postedMovements.filter((entry) => String(entry.kind || '').includes('payment')),
    [metrics.postedMovements],
  );

  const isDatevValidated = (entry) => {
    const payments = entry.payments || [];
    return payments.some((p) => p.bankMovementId);
  };

  const rows = useMemo(() => {
    return metrics.payables
      .filter((entry) => {
        if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
        if (validationFilter === 'validated' && !isDatevValidated(entry)) return false;
        if (validationFilter === 'pending' && isDatevValidated(entry)) return false;
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
  }, [metrics.payables, searchTerm, statusFilter, validationFilter]);

  const openRows = metrics.payables.filter((entry) => ['issued', 'partial', 'overdue'].includes(entry.status));
  const totalOpen = openRows.reduce((sum, entry) => sum + entry.openAmount, 0);
  const totalOverdue = metrics.overduePayables.reduce((sum, entry) => sum + entry.openAmount, 0);
  const paidReal = paymentMovements.reduce((sum, entry) => sum + entry.amount, 0);
  const payablesAging = metrics.payablesAging || [];

  const pendingValidation = openRows.filter((entry) => !isDatevValidated(entry));

  const openPayablesForLink = useMemo(
    () => metrics.payables.filter((entry) => ['issued', 'partial', 'overdue'].includes(entry.status)),
    [metrics.payables],
  );

  const unreconciledOutMovements = useMemo(
    () => (bankMovements || []).filter((m) => m.direction === 'out' && !m.reconciledAt && m.status === 'posted'),
    [bankMovements],
  );

  const handleLinkSubmit = async (movement, selectedDocuments) => {
    const result = await linkPayablesToMovement(movement, selectedDocuments);
    if (result.success) showToast('Pago vinculado con DATEV');
    else showToast(result.error?.message || 'No se pudo vincular el pago', 'error');
    return result;
  };

  const handleForceSubmit = async (selectedDocuments, options) => {
    const result = await forceReconcilePayables(selectedDocuments, options);
    if (result.success) showToast('Conciliación forzada (sin DATEV)');
    else showToast(result.error?.message || 'No se pudo forzar la conciliación', 'error');
    return result;
  };

  const handleCancel = async (row) => {
    if (loadingId) return;
    setLoadingId(row.id);
    try {
      const result = await cancelPayable(row);
      if (result.success) showToast('Factura cancelada');
      else showToast(result.error?.message || 'No se pudo cancelar', 'error');
    } finally {
      setLoadingId(null);
    }
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
              Las CXP abiertas permanecen fuera de caja hasta vincular una salida real de DATEV. Aquí ves deuda, abonos y pagos realizados sobre el mismo ledger.
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
        <StatCard title="Pagado real" value={formatCurrency(paidReal)} subtitle={`${paymentMovements.length} pagos bancarios registrados`} accent="var(--color-accent)" icon={Wallet} onClick={() => setValidationFilter('validated')} />
        <StatCard title="Deuda abierta" value={formatCurrency(totalOpen)} subtitle={`${openRows.length} documentos activos`} accent="var(--color-warn)" icon={BadgeEuro} onClick={() => setStatusFilter('all')} />
        <StatCard title="Pendiente de validar" value={formatCurrency(pendingValidation.reduce((s, e) => s + e.openAmount, 0))} subtitle={`${pendingValidation.length} sin vincular con DATEV`} accent="var(--color-warn)" icon={AlertTriangle} onClick={() => setValidationFilter('pending')} />
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
            {validationOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setValidationFilter(option.id)}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
                  validationFilter === option.id
                    ? 'border-[var(--color-line-s)] bg-[var(--color-bg-2)] text-[var(--color-warn)]'
                    : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
                }`}
              >
                {option.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-[var(--color-line)]" />
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
                <th className="px-4 py-3 text-center">DATEV</th>
                {canAct && <th className="px-4 py-3 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {rows.map((row) => {
                const validated = isDatevValidated(row);
                const canLink = ['issued', 'partial', 'overdue'].includes(row.status);
                const canCancel = row.source !== 'legacy-opening' && row.status !== 'settled' && row.status !== 'cancelled' && (row.paidAmount || 0) === 0;
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
                    <td className="px-4 py-4 text-center">
                      {validated ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-ok)]">
                          <ShieldCheck size={12} />
                          Validado
                        </span>
                      ) : canLink ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-warn)]">
                          <AlertTriangle size={12} />
                          Pendiente
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--color-fg-4)]">—</span>
                      )}
                    </td>
                    {canAct && (
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-2">
                          {canLink && (
                            <button
                              type="button"
                              onClick={() => setLinkDoc(row)}
                              className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-accent-hover)]"
                            >
                              Pagar con DATEV
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => handleCancel(row)}
                              disabled={loadingId === row.id}
                              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-xs font-medium text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-bg-2)] hover:text-[var(--color-err)] disabled:opacity-50"
                            >
                              {loadingId === row.id ? '…' : 'Cancelar'}
                            </button>
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

      <LinkBankMovementModal
        isOpen={Boolean(linkDoc)}
        onClose={() => setLinkDoc(null)}
        doc={linkDoc}
        docKind="payable"
        documents={openPayablesForLink}
        bankMovements={unreconciledOutMovements}
        onSubmit={handleLinkSubmit}
        allowManualForce={canForce}
        onForceSubmit={canForce ? handleForceSubmit : undefined}
      />

      <RecordDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} userRole={userRole} />
    </div>
  );
};

export default Gastos;
