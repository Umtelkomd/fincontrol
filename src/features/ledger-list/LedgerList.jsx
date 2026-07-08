import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  BadgeEuro,
  Plus,
  Search,
  Wallet,
} from 'lucide-react';
import ConfirmModal from '../../components/ui/ConfirmModal';
import PartialPaymentModal from '../../components/ui/PartialPaymentModal';
import RecordDetailModal from '../../components/ui/RecordDetailModal';
import { useToast } from '../../contexts/ToastContext';
import { useClassifier } from '../../hooks/useClassifier';
import { useReceivables } from '../../hooks/useReceivables';
import { usePayables } from '../../hooks/usePayables';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency, formatDate } from '../../utils/formatters';

// Human-readable labels for the "source" field stored in Firestore.
// 'payable'              — a CXP document created in the payables collection
// 'receivable'           — a CXC document created in the receivables collection
// 'legacy-transaction'   — a record migrated from the old transactions collection
// 'legacy-opening'       — a static opening-balance entry (Dec 2025 anchor)
const SOURCE_LABELS = {
  payable: 'Factura',
  receivable: 'Factura',
  'legacy-transaction': 'Transacción migrada',
  'legacy-opening': 'Saldo inicial',
};

const STATUS_OPTIONS = [
  { id: 'all', label: 'Todas' },
  { id: 'issued', label: 'Emitidas' },
  { id: 'partial', label: 'Parciales' },
  { id: 'overdue', label: 'Vencidas' },
  { id: 'settled', label: 'Liquidadas' },
];

const STATUS_LABELS = {
  issued: 'Emitida',
  partial: 'Parcial',
  overdue: 'Vencida',
  settled: 'Liquidada',
  cancelled: 'Cancelada',
};

// Map status to .nx-badge variant
const STATUS_BADGE_VARIANT = {
  settled: 'ok',
  overdue: 'err',
  partial: 'warn',
  issued: 'neutral',
  cancelled: 'neutral',
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

/**
 * LedgerList — parameterized list of receivables (income) or payables (expenses).
 *
 * family: 'income' | 'expense'
 *
 * Settle semantics:
 *   UMTELKOMD policy requires every settlement to link a bank movement, which
 *   happens through the reconciliation flow (/cxc, /cxp) or the "Abono" path
 *   (PartialPaymentModal). legacy-transaction rows settle via markAsCompleted,
 *   which legitimately predates that policy.
 *
 *   For CXC/CXP document rows, "Liquidar" is an ADMIN-ONLY escape hatch: it runs
 *   the audited force-reconcile path (forceReceivablesReconcile /
 *   forcePayablesReconcile) after asking for a mandatory reason — same mechanism
 *   as "Forzar sin DATEV" in the reconciliation modal. Managers still get the
 *   policy error and must reconcile through /cxc /cxp.
 *
 *   Bulk settle reports successes vs rejections honestly — it must never claim
 *   a CXC/CXP document was settled when the guard rejected it.
 */
const LedgerList = ({ family, userRole, user, onNewTransaction }) => {
  const isIncome = family === 'income';
  const { showToast } = useToast();
  const ledger = useFinanceLedgerContext();
  const metrics = useTreasuryMetrics({ user, ledger });

  const { registerPayment: registerReceivablePayment, markAsPaid: settleReceivable } = useReceivables(user);
  const { registerPayment: registerPayablePayment, markAsPaid: settlePayable } = usePayables(user);
  const { registerPayment: registerLegacyPayment, markAsCompleted: settleLegacy } = useTransactionActions(user);
  const { forceReceivablesReconcile, forcePayablesReconcile } = useClassifier(user);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRow, setSelectedRow] = useState(null); // for Abono modal
  const [loadingId, setLoadingId] = useState(null);
  const [detailRecord, setDetailRecord] = useState(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Admin force-settle confirmation: { docRows, legacyRows } | null
  const [forceTarget, setForceTarget] = useState(null);

  const canAct = userRole === 'admin' || userRole === 'manager';
  const isAdmin = userRole === 'admin';

  // Movement stats differ by family
  const movementStat = useMemo(() => {
    if (isIncome) {
      const entries = metrics.postedMovements.filter((e) => String(e.kind || '').includes('collection'));
      return { entries, total: entries.reduce((s, e) => s + e.amount, 0) };
    }
    const entries = metrics.postedMovements.filter((e) => String(e.kind || '').includes('payment'));
    return { entries, total: entries.reduce((s, e) => s + e.amount, 0) };
  }, [isIncome, metrics.postedMovements]);

  const allRows = isIncome ? metrics.receivables : metrics.payables;
  const overdueRows = isIncome ? metrics.overdueReceivables : metrics.overduePayables;

  const rows = useMemo(() => {
    return allRows
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
      .sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
  }, [allRows, searchTerm, statusFilter]);

  const openRows = allRows.filter((e) => ['issued', 'partial', 'overdue'].includes(e.status));
  const totalOpen = openRows.reduce((s, e) => s + e.openAmount, 0);
  const totalOverdue = overdueRows.reduce((s, e) => s + e.openAmount, 0);
  const totalPartial = allRows.filter((e) => e.status === 'partial').reduce((s, e) => s + e.paidAmount, 0);

  // Settles a single row using the existing non-Abono path.
  // Returns the settle result; silent=true suppresses per-row toasts (bulk mode).
  // For CXC/CXP doc rows this hits the markAsPaid policy guard and fails loudly —
  // admins never reach this path for doc rows (they go through handleForceConfirm).
  const handleSettle = async (row, { silent = false } = {}) => {
    if (!silent && loadingId) return { success: false };
    setLoadingId(row.id);
    try {
      let result = { success: false };
      if (isIncome) {
        if (row.source === 'receivable') result = await settleReceivable(row);
        if (row.source === 'legacy-transaction') {
          result = await settleLegacy({ id: row.legacyTransactionId, amount: row.grossAmount, type: 'income' });
        }
        if (!silent) {
          if (result.success) showToast('Ingreso liquidado');
          else showToast(result.error?.message || 'No se pudo liquidar el ingreso', 'error');
        }
      } else {
        if (row.source === 'payable') result = await settlePayable(row);
        if (row.source === 'legacy-transaction') {
          result = await settleLegacy({ id: row.legacyTransactionId, amount: row.grossAmount, type: 'expense' });
        }
        if (!silent) {
          if (result.success) showToast('Gasto liquidado');
          else showToast(result.error?.message || 'No se pudo liquidar el gasto', 'error');
        }
      }
      return result;
    } finally {
      setLoadingId(null);
    }
  };

  // "Liquidar" click on a single row. Doc rows (CXC/CXP) require the audited
  // admin force path with a mandatory reason; legacy rows settle directly.
  const handleSettleClick = (row) => {
    if (isAdmin && (row.source === 'receivable' || row.source === 'payable')) {
      setForceTarget({ docRows: [row], legacyRows: [] });
      return;
    }
    handleSettle(row);
  };

  // Confirmed force-settle (admin): legacy rows keep their native settle path,
  // doc rows go through the audited force-reconcile in one batch.
  const handleForceConfirm = async (reason) => {
    if (!forceTarget) return true;
    if (bulkProcessing) return false; // guard against double-submit while awaiting
    const { docRows, legacyRows } = forceTarget;
    setBulkProcessing(true);
    let legacySucceeded = 0;
    for (const row of legacyRows) {
      const result = await handleSettle(row, { silent: true });
      if (result?.success) legacySucceeded += 1;
    }
    const forceFn = isIncome ? forceReceivablesReconcile : forcePayablesReconcile;
    const result = docRows.length > 0 ? await forceFn(docRows, { reason }) : { success: true, count: 0 };
    setBulkProcessing(false);
    if (!result.success) {
      showToast(result.error?.message || 'Error al forzar la liquidación', 'error');
      return false; // keep the modal open so the admin can retry/fix the reason
    }
    setSelectedIds(new Set());
    setForceTarget(null);
    const total = legacySucceeded + (result.count || 0);
    showToast(
      docRows.length > 0
        ? `${total} documento(s) liquidado(s) sin DATEV (forzado, auditado)`
        : `${total} documento(s) liquidado(s)`,
    );
    return true;
  };

  // Bulk settle: process selected settleable rows one by one using the same
  // handleSettle path, counting only real successes — CXC/CXP documents are
  // rejected by the bank-movement policy guard and must not be reported as settled.
  // Admins instead confirm the audited force path (one reason for the batch).
  const handleBulkSettle = async () => {
    const settleableRows = rows.filter(
      (row) =>
        selectedIds.has(row.id) &&
        row.source !== 'legacy-opening' &&
        row.status !== 'settled' &&
        row.status !== 'cancelled',
    );
    if (settleableRows.length === 0) return;
    const docRows = settleableRows.filter((row) => row.source === 'receivable' || row.source === 'payable');
    if (isAdmin && docRows.length > 0) {
      setForceTarget({
        docRows,
        legacyRows: settleableRows.filter((row) => row.source === 'legacy-transaction'),
      });
      return;
    }
    setBulkProcessing(true);
    let succeeded = 0;
    for (const row of settleableRows) {
      const result = await handleSettle(row, { silent: true });
      if (result?.success) succeeded++;
    }
    setSelectedIds(new Set());
    setBulkProcessing(false);
    const failed = settleableRows.length - succeeded;
    if (failed === 0) {
      showToast(`${succeeded} documento(s) liquidado(s)`);
    } else if (succeeded === 0) {
      showToast(
        'No se liquidó ningún documento: las facturas CXC/CXP requieren conciliación con un movimiento bancario.',
        'error',
      );
    } else {
      showToast(
        `${succeeded} de ${settleableRows.length} liquidados. ${failed} requieren conciliación con movimiento bancario.`,
        'error',
      );
    }
  };

  const handlePartialPayment = async (_transaction, paymentData) => {
    if (!selectedRow) return;
    let result = { success: false };
    if (isIncome) {
      if (selectedRow.source === 'receivable') result = await registerReceivablePayment(selectedRow, paymentData);
      if (selectedRow.source === 'legacy-transaction') {
        result = await registerLegacyPayment(
          { id: selectedRow.legacyTransactionId, amount: selectedRow.grossAmount, paidAmount: selectedRow.paidAmount, type: 'income' },
          paymentData,
        );
      }
      if (result.success) showToast('Cobro parcial registrado');
      else showToast('No se pudo registrar el cobro', 'error');
    } else {
      if (selectedRow.source === 'payable') result = await registerPayablePayment(selectedRow, paymentData);
      if (selectedRow.source === 'legacy-transaction') {
        result = await registerLegacyPayment(
          { id: selectedRow.legacyTransactionId, amount: selectedRow.grossAmount, paidAmount: selectedRow.paidAmount, type: 'expense' },
          paymentData,
        );
      }
      if (result.success) showToast('Pago parcial registrado');
      else showToast('No se pudo registrar el pago', 'error');
    }
  };

  const toggleRowSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const settleableIds = rows
      .filter((r) => r.source !== 'legacy-opening' && r.status !== 'settled' && r.status !== 'cancelled')
      .map((r) => r.id);
    if (settleableIds.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(settleableIds));
    }
  };

  const settleableCount = [...selectedIds].filter((id) => {
    const row = rows.find((r) => r.id === id);
    return row && row.source !== 'legacy-opening' && row.status !== 'settled' && row.status !== 'cancelled';
  }).length;

  if (metrics.loading) {
    return (
      <div className="flex items-center justify-center py-28">
        <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
      </div>
    );
  }

  const accentColor = isIncome ? 'var(--color-ok)' : 'var(--color-warn)';
  const counterpartyLabel = isIncome ? 'Cliente' : 'Proveedor';
  const ctaLabel = isIncome ? 'Nueva factura CXC' : 'Nueva factura CXP';
  const newTxType = isIncome ? 'income' : 'expense';
  const emptyMsg = isIncome
    ? 'No hay ingresos que coincidan con los filtros.'
    : 'No hay gastos que coincidan con los filtros.';

  return (
    <div className="space-y-6 pb-12">
      {/* Header section */}
      <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-6 py-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mb-3 label-mono" style={{ color: accentColor }}>
              {isIncome ? 'Ingresos' : 'Gastos'}
            </p>
            <h2 className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">
              {isIncome
                ? 'Cobros reales y cartera pendiente en una sola vista.'
                : 'Pagos reales y deuda operativa sin mezclar con caja futura.'}
            </h2>
            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[var(--color-fg-3)]">
              {isIncome
                ? 'La caja entra solo con movimientos bancarios `posted`. Las facturas abiertas permanecen como cartera hasta registrar un cobro real.'
                : 'Las CXP abiertas permanecen fuera de caja hasta registrar una salida real en banco. Aquí ves deuda, abonos y pagos realizados sobre el mismo ledger.'}
            </p>
          </div>
          {canAct && onNewTransaction && (
            <button
              type="button"
              onClick={() => onNewTransaction(newTxType)}
              className="nx-btn nx-btn-primary"
            >
              <Plus size={16} />
              {ctaLabel}
            </button>
          )}
        </div>
      </section>

      {/* KPI stat cards */}
      <div className="grid gap-4 lg:grid-cols-4">
        {isIncome ? (
          <>
            <StatCard title="Cobrado real" value={formatCurrency(movementStat.total)} subtitle={`${movementStat.entries.length} cobros bancarios registrados`} accent="var(--color-ok)" icon={Wallet} onClick={() => setStatusFilter('settled')} />
            <StatCard title="Cartera abierta" value={formatCurrency(totalOpen)} subtitle={`${openRows.length} documentos activos`} accent="var(--color-fg-3)" icon={BadgeEuro} onClick={() => setStatusFilter('all')} />
            <StatCard title="Cobro parcial" value={formatCurrency(totalPartial)} subtitle="Importe ya cobrado sobre facturas aún abiertas" accent="var(--color-warn)" icon={ArrowUpCircle} />
            <StatCard title="Vencido" value={formatCurrency(totalOverdue)} subtitle={`${overdueRows.length} documentos fuera de plazo`} accent="var(--color-accent)" icon={AlertTriangle} onClick={() => setStatusFilter('overdue')} />
          </>
        ) : (
          <>
            <StatCard title="Pagado real" value={formatCurrency(movementStat.total)} subtitle={`${movementStat.entries.length} pagos bancarios registrados`} accent="var(--color-accent)" icon={Wallet} onClick={() => setStatusFilter('settled')} />
            <StatCard title="Deuda abierta" value={formatCurrency(totalOpen)} subtitle={`${openRows.length} documentos activos`} accent="var(--color-warn)" icon={BadgeEuro} onClick={() => setStatusFilter('all')} />
            <StatCard title="Pago parcial" value={formatCurrency(totalPartial)} subtitle="Importe ya pagado sobre facturas aún abiertas" accent="var(--color-fg-3)" icon={ArrowDownCircle} />
            <StatCard title="Vencido" value={formatCurrency(totalOverdue)} subtitle={`${overdueRows.length} documentos fuera de plazo`} accent="var(--color-accent)" icon={AlertTriangle} onClick={() => setStatusFilter('overdue')} />
          </>
        )}
      </div>

      {/* Table section */}
      <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          {/* Search */}
          <div className="relative w-full xl:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-3)]" size={16} />
            <input
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] py-3 pl-10 pr-4 text-sm text-[var(--color-fg-1)] outline-none transition-all placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
              placeholder={isIncome ? 'Buscar cliente, documento o proyecto' : 'Buscar proveedor, documento o proyecto'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status filter tabs */}
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id)}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
                  statusFilter === option.id
                    ? `border-[var(--color-line-s)] bg-[var(--color-bg-2)] ${isIncome ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}`
                    : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
                }`}
              >
                {option.label}
              </button>
            ))}

            {/* Bulk settle action */}
            {canAct && selectedIds.size > 0 && settleableCount > 0 && (
              <button
                type="button"
                disabled={bulkProcessing}
                onClick={handleBulkSettle}
                className="nx-btn nx-btn-primary nx-btn-sm"
              >
                {bulkProcessing
                  ? 'Procesando…'
                  : `Liquidar seleccionados (${settleableCount})`}
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-left">
            <thead>
              <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-3)]">
                {canAct && (
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      className="accent-[var(--color-accent)]"
                      checked={
                        rows.length > 0 &&
                        rows
                          .filter((r) => r.source !== 'legacy-opening' && r.status !== 'settled' && r.status !== 'cancelled')
                          .every((r) => selectedIds.has(r.id))
                      }
                      onChange={toggleSelectAll}
                      aria-label="Seleccionar todos"
                    />
                  </th>
                )}
                <th className="px-4 py-3">{counterpartyLabel}</th>
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
                const badgeVariant = STATUS_BADGE_VARIANT[row.status] || 'neutral';
                return (
                  <tr key={row.id} {...rowButtonProps(() => setDetailRecord(row), 'hover:bg-[var(--color-bg-2)]')}>
                    {canAct && (
                      <td className="px-3 py-4 w-8" onClick={(e) => e.stopPropagation()}>
                        {canSettle && (
                          <input
                            type="checkbox"
                            className="accent-[var(--color-accent)]"
                            checked={selectedIds.has(row.id)}
                            onChange={() => toggleRowSelection(row.id)}
                            aria-label={`Seleccionar ${row.counterpartyName}`}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-4 py-4">
                      <p className="text-sm font-medium text-[var(--color-fg-1)]">{row.counterpartyName}</p>
                      <p className="text-xs text-[var(--color-fg-3)]">{row.description || 'Sin descripción'}</p>
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--color-fg-1)]">{row.documentNumber || 'Sin documento'}</td>
                    <td className="px-4 py-4 text-sm text-[var(--color-fg-3)]">{row.projectName || 'Sin proyecto'}</td>
                    <td className="px-4 py-4 text-right text-sm font-medium text-[var(--color-fg-1)]">{formatCurrency(row.grossAmount)}</td>
                    <td className={`px-4 py-4 text-right text-sm font-medium ${isIncome ? 'text-[var(--color-fg-3)]' : 'text-[var(--color-warn)]'}`}>
                      {formatCurrency(row.openAmount)}
                    </td>
                    <td className="px-4 py-4 text-center text-sm text-[var(--color-fg-3)]">
                      {row.dueDate ? formatDate(row.dueDate) : 'Sin fecha'}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className={`nx-badge nx-badge-${badgeVariant}`}>
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center text-xs text-[var(--color-fg-3)]">
                      {SOURCE_LABELS[row.source] ?? row.source}
                    </td>
                    {canAct && (
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-2">
                          {canSettle && (
                            <>
                              <button
                                type="button"
                                onClick={() => setSelectedRow(row)}
                                className="nx-btn nx-btn-secondary nx-btn-sm"
                              >
                                Abono
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSettleClick(row)}
                                disabled={loadingId === row.id}
                                className="nx-btn nx-btn-primary nx-btn-sm disabled:opacity-50"
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
                  <td colSpan={canAct ? 10 : 8} className="px-4 py-8 text-center text-sm text-[var(--color-fg-3)]">
                    {emptyMsg}
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

      <ConfirmModal
        isOpen={Boolean(forceTarget)}
        onClose={() => setForceTarget(null)}
        onConfirm={handleForceConfirm}
        title="Liquidar sin DATEV"
        message={
          isIncome
            ? 'Vas a marcar como cobradas estas facturas SIN vincular un movimiento bancario DATEV. La operación queda auditada con tu usuario y motivo.'
            : 'Vas a marcar como pagadas estas facturas SIN vincular un movimiento bancario DATEV. La operación queda auditada con tu usuario y motivo.'
        }
        confirmText={bulkProcessing ? 'Procesando…' : 'Forzar liquidación'}
        variant="warning"
        details={
          forceTarget
            ? [
                { label: 'Documentos', value: String(forceTarget.docRows.length + forceTarget.legacyRows.length), emphasis: true },
                {
                  label: 'Importe abierto',
                  value: formatCurrency(
                    [...forceTarget.docRows, ...forceTarget.legacyRows].reduce(
                      (sum, row) => sum + (Number(row.openAmount) || 0),
                      0,
                    ),
                  ),
                  emphasis: true,
                },
              ]
            : []
        }
        warning="Política UMTELKOMD: la vía normal es conciliar con el extracto DATEV. Usá esto solo cuando el banco confirmó y el DATEV todavía no llegó."
        reasonLabel="Motivo para forzar sin DATEV"
        reasonPlaceholder="Ej: pago confirmado por banco, DATEV pendiente"
      />

      <RecordDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} userRole={userRole} />
    </div>
  );
};

export default LedgerList;
