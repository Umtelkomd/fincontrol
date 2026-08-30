/**
 * Conciliación de remesas — one incoming transfer, several invoices.
 *
 * Insyte pays through confirming: CaixaBank, BBVA or Santander settle a batch
 * of invoices with a single transfer, so no bank movement ever equals one
 * document and the one-to-one flow in /cxc could never close them. Left alone,
 * the ledger reported invoices as open long after the money had arrived.
 *
 * The screen is built around the DIFFERENCE. It is on screen from the moment a
 * transfer is picked, it stays there while invoices are ticked, and it is what
 * says whether the batch is finished. Under-explained is allowed and shown in
 * warning colour — a confirming remesa often covers an invoice that is not in
 * the system yet, and refusing the whole batch for that is what made these
 * transfers unreconcilable in the first place. Over-explained is blocked.
 *
 * "Sugerir" proposes a combination but never applies one: the operator always
 * confirms, and the suggestion stays silent whenever more than one combination
 * could explain the same total.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, BadgeEuro, Layers, Link2, Wand2 } from 'lucide-react';

import HelpButton from '../../components/ui/HelpButton';
import { Badge, Button, KPI, KPIGrid } from '@/components/ui/nexus';
import { useToast } from '../../contexts/ToastContext';
import { useBankMovements } from '../../hooks/useBankMovements';
import { useReceivables } from '../../hooks/useReceivables';
import {
  buildAllocationDraft,
  buildBatchCandidates,
  isPendingBatch,
  isReconciliationPending,
  reconcilableAmountOf,
  suggestCombination,
  summarizeSelection,
  unreconciledAmountOf,
} from '../../finance/batchReconciliation';
import { isInternalTransfer } from '../../lib/finance/movementAmount';
import { formatCurrency, formatDate } from '../../utils/formatters';

const STATUS_LABEL = {
  exact: 'Cuadra',
  under: 'Falta por explicar',
  over: 'Excede la remesa',
};

/** Neutral until something is ticked; then ok / warning / error. */
const differenceTone = (status, hasSelection) => {
  if (!hasSelection) return 'var(--color-fg-3)';
  if (status === 'exact') return 'var(--color-ok)';
  if (status === 'over') return 'var(--color-err)';
  return 'var(--color-warn)';
};

const BatchReconciliation = ({ user, userRole }) => {
  const { showToast } = useToast();
  const { bankMovements, loading: movementsLoading } = useBankMovements(user);
  const { receivables, loading: receivablesLoading, reconcileBatch } = useReceivables(user);

  const [selectedMovementId, setSelectedMovementId] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // The fee the bank kept on this remesa. Invoices are measured against
  // movement + fee, so a batch that covers its invoices exactly "cuadra"
  // even though the transfer arrived short by the fee.
  const [discountInput, setDiscountInput] = useState('');
  const confirmingDiscount = Math.max(0, Number(discountInput) || 0);

  const canAct = userRole === 'admin' || userRole === 'manager';

  // An incoming transfer that still has money no invoice explains — including
  // one an earlier pass only half closed. Own-account rebookings are excluded
  // for the same reason the classifier inbox drops them: there is no CXC behind
  // a movement between our own accounts.
  const pendingBatches = useMemo(
    () =>
      (bankMovements || [])
        .filter((movement) => isPendingBatch(movement) && !isInternalTransfer(movement))
        .sort((left, right) => (right.postedDate || '').localeCompare(left.postedDate || '')),
    [bankMovements],
  );

  // Every unlinked inbound movement lands in the list — tax refunds, interest
  // and one-off collections included, and in production that is well over a
  // hundred rows. The count is what separates a workable remesa from a row
  // there is no point opening.
  const candidateCounts = useMemo(() => {
    const counts = new Map();
    pendingBatches.forEach((entry) => {
      counts.set(entry.id, buildBatchCandidates({ movement: entry, receivables }).length);
    });
    return counts;
  }, [pendingBatches, receivables]);

  const movement = useMemo(
    () => pendingBatches.find((entry) => entry.id === selectedMovementId) || null,
    [pendingBatches, selectedMovementId],
  );

  const candidates = useMemo(
    () => (movement ? buildBatchCandidates({ movement, receivables }) : []),
    [movement, receivables],
  );

  const selected = useMemo(
    () => candidates.filter((entry) => selectedIds.includes(entry.id)),
    [candidates, selectedIds],
  );

  const summary = useMemo(
    () => summarizeSelection({ movement: movement || { amount: 0 }, selected, confirmingDiscount }),
    [movement, selected, confirmingDiscount],
  );

  // The reconciled transfer leaves `pendingBatches` as soon as Firestore echoes
  // the write back, so the panel has to let go of it.
  useEffect(() => {
    if (selectedMovementId && !movement) {
      setSelectedMovementId('');
      setSelectedIds([]);
      setNotice(null);
      setDiscountInput('');
    }
  }, [movement, selectedMovementId]);

  const pendingTotal = pendingBatches.reduce((sum, entry) => sum + unreconciledAmountOf(entry), 0);
  const bulkPendingCount = (receivables || []).filter(isReconciliationPending).length;

  const handleSelectMovement = (id) => {
    setSelectedMovementId(id);
    setSelectedIds([]);
    setNotice(null);
    setDiscountInput('');
  };

  const handleToggle = (id) => {
    setNotice(null);
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const handleSuggest = () => {
    if (!movement) return;
    const result = suggestCombination({ movement, candidates });

    if (result.combination) {
      setSelectedIds(result.combination.map((entry) => entry.id));
      setNotice({
        tone: 'ok',
        text: `Combinación encontrada: ${result.combination.length} factura(s) por ${formatCurrency(result.total)} €. Revisala y confirmá.`,
      });
      return;
    }

    setSelectedIds([]);
    setNotice({
      tone: 'warn',
      text:
        result.alternatives > 1
          ? `Hay varias combinaciones posibles (${result.alternatives}), revísalo a mano: ninguna es segura.`
          : `Ninguna combinación de hasta 6 facturas suma ${formatCurrency(summary.movementAmount)} €.${
              result.truncated ? ' La búsqueda se limitó a las 12 más antiguas.' : ''
            }`,
    });
  };

  const handleReconcile = async () => {
    if (!movement || selected.length === 0) return;
    setSubmitting(true);
    try {
      const result = await reconcileBatch(movement, buildAllocationDraft(selected), { confirmingDiscount });
      if (!result?.success) {
        showToast(result?.error?.message || 'No se pudo conciliar la remesa', 'error');
        return;
      }
      const unexplained = result.unexplained ?? result.difference;
      showToast(
        `${result.count} factura${result.count === 1 ? '' : 's'} conciliada${result.count === 1 ? '' : 's'} con la remesa${
          unexplained > 0 ? ` — quedan ${formatCurrency(unexplained)} € sin explicar` : ''
        }`,
        unexplained > 0 ? 'warning' : 'success',
      );
      setSelectedIds([]);
      setNotice(null);
    } finally {
      setSubmitting(false);
    }
  };

  if (movementsLoading || receivablesLoading) {
    return (
      <div className="flex items-center justify-center py-28">
        <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
      </div>
    );
  }

  const hasSelection = selected.length > 0;
  const tone = differenceTone(summary.status, hasSelection);
  const alreadyReconciled = movement
    ? Math.max(0, Number(movement.amount || 0) - summary.movementAmount)
    : 0;

  return (
    <div className="space-y-6 pb-12">
      <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="label-mono mb-3 text-[var(--color-fg-3)]">Cuentas por cobrar</p>
            <h2 className="font-display text-[32px] font-light tracking-tight text-[var(--color-fg-1)]">
              Conciliación de remesas{' '}
              <HelpButton title="Conciliación de remesas">
                <p><strong>Remesa</strong> — Una sola transferencia (confirming de Insyte via CaixaBank, BBVA o Santander) que paga varias facturas a la vez.</p>
                <p><strong>Diferencia</strong> — Lo que el banco trajo menos lo que marcaste. Si falta, hay una factura que no esta en el sistema o no la marcaste. Nunca se redondea.</p>
                <p><strong>Sugerir</strong> — Busca la combinacion de facturas que suma el importe exacto. Si hay mas de una posible, no propone ninguna: elegir mal deja el cobro en la factura equivocada.</p>
                <p><strong>Cierre masivo</strong> — Facturas que se cerraron en bloque sin identificar su remesa. Al conciliarlas aqui se reemplaza ese cierre, no se cobra dos veces.</p>
              </HelpButton>
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[var(--color-fg-4)]">
              Elegí el cobro que entró y marcá las facturas que cubre. Conciliar solo enlaza documentos con el movimiento: la caja no cambia.
            </p>
          </div>
          <Link to="/cxc" className="nx-btn nx-btn-ghost nx-btn-sm self-start">
            <ArrowLeft size={12} />
            Volver a CXC
          </Link>
        </div>
      </section>

      <KPIGrid cols={3}>
        <KPI
          label="Remesas sin conciliar"
          value={String(pendingBatches.length)}
          meta="Cobros entrantes sin factura enlazada"
          icon={Layers}
        />
        <KPI
          label="Importe sin explicar"
          value={formatCurrency(pendingTotal)}
          meta="Dinero que entró y aún no tiene documento"
          icon={BadgeEuro}
          tone={pendingTotal > 0 ? 'warn' : undefined}
        />
        <KPI
          label="Facturas del cierre masivo"
          value={String(bulkPendingCount)}
          meta="Cerradas en bloque, pendientes de casar con su remesa"
          icon={AlertTriangle}
        />
      </KPIGrid>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
          <p className="label-mono mb-4 text-[var(--color-fg-4)]">Cobros entrantes</p>
          {pendingBatches.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-3)]">
              No hay cobros pendientes de conciliar.
            </p>
          ) : (
            <ul className="space-y-2">
              {pendingBatches.map((entry) => {
                const active = entry.id === selectedMovementId;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectMovement(entry.id)}
                      aria-pressed={active}
                      className={`w-full rounded-md border px-4 py-3 text-left transition-all ${
                        active
                          ? 'border-[var(--color-accent)] bg-[var(--color-bg-2)]'
                          : 'border-[var(--color-line)] bg-[var(--color-bg-1)] hover:bg-[var(--color-bg-2)]'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="label-mono text-[var(--color-fg-4)]">
                          {entry.postedDate ? formatDate(entry.postedDate) : 'Sin fecha'}
                        </span>
                        <span
                          className={`font-mono text-sm tabular-nums ${
                            active ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-1)]'
                          }`}
                        >
                          {formatCurrency(entry.amount)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-[var(--color-fg-1)]">
                        {entry.counterpartyName || 'Sin contraparte'}
                      </p>
                      <p className="truncate text-xs text-[var(--color-fg-3)]">
                        {entry.description || 'Sin concepto'}
                      </p>
                      <p className="label-mono mt-2 text-[var(--color-fg-4)]">
                        {candidateCounts.get(entry.id) > 0
                          ? `${candidateCounts.get(entry.id)} facturas candidatas`
                          : 'Sin facturas candidatas'}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
          {!movement ? (
            <p className="text-sm text-[var(--color-fg-3)]">
              Elegí un cobro de la izquierda para ver las facturas que podría cubrir.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
                  <p className="label-mono text-[var(--color-fg-4)]">Remesa</p>
                  <p className="mt-1 font-mono text-lg tabular-nums text-[var(--color-fg-1)]">
                    {formatCurrency(movement.amount)}
                  </p>
                  {alreadyReconciled > 0 && (
                    <p className="label-mono mt-1 text-[var(--color-fg-4)]">
                      Ya conciliado: {formatCurrency(alreadyReconciled)}
                    </p>
                  )}
                </div>
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
                  <p className="label-mono text-[var(--color-fg-4)]">Seleccionado</p>
                  <p
                    data-testid="batch-selected"
                    className="mt-1 font-mono text-lg tabular-nums text-[var(--color-fg-1)]"
                  >
                    {formatCurrency(summary.selectedTotal)}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
                  <p className="label-mono text-[var(--color-fg-4)]">Diferencia</p>
                  <p
                    data-testid="batch-difference"
                    className="mt-1 font-mono text-lg tabular-nums"
                    style={{ color: tone }}
                  >
                    {formatCurrency(Math.abs(summary.difference))}
                  </p>
                  <p data-testid="batch-status" className="label-mono mt-1" style={{ color: tone }}>
                    {STATUS_LABEL[summary.status]}
                  </p>
                  {hasSelection && summary.status === 'under' && (
                    <p data-testid="batch-unexplained" className="label-mono mt-1 text-[var(--color-fg-4)]">
                      {formatCurrency(summary.difference)} € sin explicar
                      {confirmingDiscount > 0 ? ' (más allá del descuento)' : ''}
                    </p>
                  )}
                </div>
              </div>

              <label className="block max-w-xs">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Descuento confirming (€)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={discountInput}
                  onChange={(event) => setDiscountInput(event.target.value)}
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 font-mono text-sm tabular-nums text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
                />
                <span className="mt-1 block text-xs text-[var(--color-fg-4)]">
                  Comisión que retuvo el banco. Las facturas se miden contra el cobro más este descuento.
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" icon={Wand2} onClick={handleSuggest}>
                  Sugerir combinación
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSelectMovement(movement.id)}
                  disabled={!hasSelection}
                >
                  Limpiar
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={Link2}
                  loading={submitting}
                  disabled={!canAct || !hasSelection || summary.status === 'over' || submitting}
                  onClick={handleReconcile}
                  title={
                    canAct
                      ? 'Enlazar las facturas marcadas con este cobro'
                      : 'Tu rol no puede conciliar cobros'
                  }
                >
                  Conciliar {selected.length > 0 ? `(${selected.length})` : ''}
                </Button>
              </div>

              {notice && (
                <p
                  className="rounded-md border px-4 py-3 text-sm"
                  style={{
                    borderColor: notice.tone === 'ok' ? 'var(--color-ok)' : 'var(--color-warn)',
                    color: notice.tone === 'ok' ? 'var(--color-ok)' : 'var(--color-warn)',
                  }}
                >
                  {notice.text}
                </p>
              )}

              {candidates.length === 0 ? (
                <p className="text-sm text-[var(--color-fg-3)]">
                  No encontramos facturas abiertas del cliente de este cobro. Revisá que la factura
                  esté dada de alta y que su fecha de emisión sea anterior al cobro.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left">
                    <thead>
                      <tr className="label-mono border-b border-[var(--color-line)] text-[var(--color-fg-4)]">
                        <th className="px-3 py-3">Marcar</th>
                        <th className="px-3 py-3">Documento</th>
                        <th className="px-3 py-3">Cliente</th>
                        <th className="px-3 py-3 text-center">Emitida</th>
                        <th className="px-3 py-3 text-center">Vence</th>
                        <th className="px-3 py-3 text-right">Pendiente</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-line)]">
                      {candidates.map((entry) => {
                        const checked = selectedIds.includes(entry.id);
                        return (
                          <tr
                            key={entry.id}
                            className={checked ? 'bg-[var(--color-bg-2)]' : undefined}
                          >
                            <td className="px-3 py-3">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggle(entry.id)}
                                aria-label={`Marcar ${entry.documentNumber || entry.id}`}
                                className="h-4 w-4 accent-[var(--color-accent)]"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <p className="text-sm font-medium text-[var(--color-fg-1)]">
                                {entry.documentNumber || 'Sin documento'}
                              </p>
                              {isReconciliationPending(entry) && (
                                <Badge variant="warn">Cierre masivo</Badge>
                              )}
                            </td>
                            <td className="px-3 py-3 text-sm text-[var(--color-fg-3)]">
                              {entry.counterpartyName}
                            </td>
                            <td className="px-3 py-3 text-center text-sm text-[var(--color-fg-3)]">
                              {entry.issueDate ? formatDate(entry.issueDate) : '—'}
                            </td>
                            <td className="px-3 py-3 text-center text-sm text-[var(--color-fg-3)]">
                              {entry.dueDate ? formatDate(entry.dueDate) : '—'}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-fg-1)]">
                              {formatCurrency(reconcilableAmountOf(entry))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default BatchReconciliation;
