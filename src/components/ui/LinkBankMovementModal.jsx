import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Link2,
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  Search,
  Database,
  ShieldAlert,
} from 'lucide-react';
import { Button, Badge, EmptyState } from '@/components/ui/nexus';
import { formatCurrency, formatDate } from '../../utils/formatters';
import {
  RECONCILIATION_EPSILON,
  getDocumentOpenAmount,
  sumDocumentOpenAmount,
} from '../../finance/reconciliation';

const getDocumentLabel = (document) =>
  document?.documentNumber || document?.counterpartyName || document?.description || document?.id;

const isOpenDocument = (document) => {
  const status = String(document?.status || '').toLowerCase();
  if (['cancelled', 'void', 'settled', 'paid'].includes(status)) return false;
  return getDocumentOpenAmount(document) > RECONCILIATION_EPSILON;
};

const getLinkedIds = (movement, docKind) => {
  const idField = docKind === 'receivable' ? 'receivableId' : 'payableId';
  const idsField = docKind === 'receivable' ? 'receivableIds' : 'payableIds';
  return new Set([
    movement?.[idField],
    ...(Array.isArray(movement?.[idsField]) ? movement[idsField] : []),
  ].filter(Boolean));
};

/**
 * LinkBankMovementModal — pick one bankMovement (DATEV) to reconcile one or
 * more CXC/CXP documents. Admins can also create an audited manual
 * reconciliation when DATEV data is not available.
 */
const LinkBankMovementModal = ({
  isOpen,
  onClose,
  doc,
  docKind,
  documents = [],
  bankMovements = [],
  onSubmit,
  allowManualForce = false,
  onForceSubmit,
}) => {
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [forceSubmitting, setForceSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [manualReason, setManualReason] = useState('');

  useEffect(() => {
    if (!isOpen || !doc) return;
    setSearch('');
    setError('');
    setSelectedId(null);
    setSelectedDocIds([doc.id]);
    setManualReason('');
  }, [doc, isOpen]);

  const direction = docKind === 'receivable' ? 'in' : 'out';
  const refDate = doc?.dueDate || doc?.issueDate || '';

  const documentOptions = useMemo(() => {
    const seen = new Set();
    return [doc, ...(documents || [])]
      .filter(Boolean)
      .filter((document) => {
        if (seen.has(document.id)) return false;
        seen.add(document.id);
        return document.id === doc?.id || isOpenDocument(document);
      });
  }, [doc, documents]);

  const selectedDocuments = useMemo(
    () => documentOptions.filter((document) => selectedDocIds.includes(document.id)),
    [documentOptions, selectedDocIds],
  );

  const selectedOpen = sumDocumentOpenAmount(selectedDocuments);

  const candidates = useMemo(() => {
    if (!doc) return [];
    const targetDate = new Date(refDate || new Date().toISOString().slice(0, 10));
    const validTarget = !Number.isNaN(targetDate.getTime());

    const list = (bankMovements || [])
      .filter((movement) => {
        if (movement.status === 'void') return false;
        if (movement.reconciledAt) return false;
        if (movement.direction !== direction) return false;
        const linkedIds = getLinkedIds(movement, docKind);
        return linkedIds.size === 0;
      })
      .map((movement) => {
        const amount = Math.abs(Number(movement.amount) || 0);
        const amountDiff = Math.abs(selectedOpen - amount);
        const itemDate = new Date(movement.postedDate || '');
        const validItem = !Number.isNaN(itemDate.getTime());
        const daysDiff =
          validItem && validTarget ? Math.abs((itemDate - targetDate) / (1000 * 60 * 60 * 24)) : Infinity;

        let score = 0;
        if (amountDiff < 0.01) score += 100;
        else if (amountDiff < 1) score += 80;
        else if (amountDiff < 10) score += 40;
        else if (amount <= selectedOpen + RECONCILIATION_EPSILON) score += 20;
        if (daysDiff <= 21) score += Math.max(0, 30 - daysDiff);

        return { movement, amount, amountDiff, daysDiff, score };
      })
      .filter((candidate) => {
        if (!search.trim()) return true;
        const query = search.toLowerCase();
        const movement = candidate.movement;
        return (
          (movement.description || '').toLowerCase().includes(query) ||
          (movement.counterpartyName || '').toLowerCase().includes(query) ||
          String(movement.amount || '').includes(query)
        );
      })
      .sort((left, right) => right.score - left.score || (right.movement.postedDate || '').localeCompare(left.movement.postedDate || ''));
    return list;
  }, [doc, bankMovements, direction, refDate, selectedOpen, search, docKind]);

  const top = candidates.slice(0, 30);
  const exactMatches = candidates.filter((candidate) => candidate.amountDiff < 0.01).length;

  if (!isOpen || !doc) return null;

  const toggleDocument = (documentId) => {
    if (documentId === doc.id) return;
    setSelectedDocIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  };

  const handleSubmit = async () => {
    if (!selectedId) {
      setError('Elegí un movimiento bancario para vincular');
      return;
    }
    if (selectedOpen <= RECONCILIATION_EPSILON) {
      setError('Seleccioná órdenes con saldo abierto');
      return;
    }
    const chosen = candidates.find((candidate) => candidate.movement.id === selectedId);
    if (!chosen) {
      setError('Movimiento no encontrado');
      return;
    }
    if (chosen.amount > selectedOpen + RECONCILIATION_EPSILON) {
      setError(`El DATEV tiene ${formatCurrency(chosen.amount)} y las órdenes seleccionadas explican ${formatCurrency(selectedOpen)}. Seleccioná más órdenes.`);
      return;
    }
    setSubmitting(true);
    setError('');
    const result = await onSubmit(chosen.movement, selectedDocuments);
    setSubmitting(false);
    if (result?.success) onClose();
    else setError(result?.error?.message || result?.error || 'Error al vincular');
  };

  const handleForceSubmit = async () => {
    if (!allowManualForce || !onForceSubmit) return;
    if (selectedOpen <= RECONCILIATION_EPSILON) {
      setError('Seleccioná órdenes con saldo abierto');
      return;
    }
    setForceSubmitting(true);
    setError('');
    const result = await onForceSubmit(selectedDocuments, { reason: manualReason });
    setForceSubmitting(false);
    if (result?.success) onClose();
    else setError(result?.error?.message || result?.error || 'Error al forzar la conciliación');
  };

  const ArrowIcon = direction === 'in' ? ArrowUpRight : ArrowDownRight;
  const colorClass = direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]';
  const selectedMovement = candidates.find((candidate) => candidate.movement.id === selectedId);
  const selectedMovementLeavesPartial =
    selectedMovement && selectedMovement.amount < selectedOpen - RECONCILIATION_EPSILON;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-[var(--color-line)] flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Database size={18} className="text-[var(--color-accent)] flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-lg font-medium text-[var(--color-fg-1)] truncate">
                Vincular {docKind === 'receivable' ? 'CXC' : 'CXP'} con movimiento bancario
              </h2>
              <p className="text-[12px] text-[var(--color-fg-3)] truncate">
                {getDocumentLabel(doc)} · seleccionado {formatCurrency(selectedOpen)}
                {refDate && ` · vence ${formatDate(refDate)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)]"
          >
            <X size={20} />
          </button>
        </header>

        <div className="px-6 py-3 border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
          <p className="text-[12px] text-[var(--color-fg-3)] flex items-start gap-2">
            <AlertTriangle size={12} className="text-[var(--color-warn)] flex-shrink-0 mt-0.5" />
            <span>
              Un solo movimiento DATEV puede aplicarse a varias órdenes. Si el movimiento es menor que el total
              seleccionado, la última orden queda parcial. Si es mayor, falta explicar saldo.
            </span>
          </p>
        </div>

        <section className="px-6 py-4 border-b border-[var(--color-line)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="label-mono text-[var(--color-fg-4)]">Órdenes incluidas</p>
              <p className="mt-1 text-[13px] text-[var(--color-fg-3)]">
                {selectedDocuments.length} seleccionada(s) · {formatCurrency(selectedOpen)}
              </p>
            </div>
            <Badge variant={selectedDocuments.length > 1 ? 'info' : 'neutral'}>
              {selectedDocuments.length > 1 ? 'Pago agrupado' : 'Pago individual'}
            </Badge>
          </div>

          <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--color-line)]">
            {documentOptions.map((documentItem) => {
              const checked = selectedDocIds.includes(documentItem.id);
              const isPrimary = documentItem.id === doc.id;
              return (
                <label
                  key={documentItem.id}
                  className={`flex cursor-pointer items-center gap-3 border-b border-[var(--color-line)] px-3 py-2 text-sm last:border-b-0 ${
                    checked ? 'bg-[var(--color-bg-2)]' : 'bg-[var(--color-bg-1)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isPrimary}
                    onChange={() => toggleDocument(documentItem.id)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--color-fg-1)]">{getDocumentLabel(documentItem)}</span>
                    <span className="block truncate text-[11px] text-[var(--color-fg-4)]">
                      {documentItem.counterpartyName || 'Sin contraparte'} · vence {documentItem.dueDate ? formatDate(documentItem.dueDate) : 'sin fecha'}
                    </span>
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-[var(--color-fg-1)]">
                    {formatCurrency(getDocumentOpenAmount(documentItem))}
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <div className="px-6 py-3 border-b border-[var(--color-line)] flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" size={14} />
            <input
              type="text"
              placeholder="Filtrar DATEV por contraparte, descripción o monto..."
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-1.5 pl-8 pr-3 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-3)]">
            <Badge variant={exactMatches > 0 ? 'ok' : 'neutral'}>
              {exactMatches} exacto(s)
            </Badge>
            <Badge variant="neutral">{candidates.length} candidato(s)</Badge>
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {top.length === 0 ? (
            <EmptyState
              icon={Database}
              title="No hay movimientos bancarios disponibles"
              description={`Subí el último DATEV para que aparezcan los ${
                direction === 'in' ? 'ingresos' : 'gastos'
              } correspondientes. Un admin puede forzar la conciliación si hace falta.`}
            />
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {top.map(({ movement, amount, amountDiff, daysDiff, score }) => {
                const isSelected = selectedId === movement.id;
                const tone = amountDiff < 0.01 ? 'ok' : amount <= selectedOpen + RECONCILIATION_EPSILON ? 'info' : 'warn';
                return (
                  <button
                    key={movement.id}
                    type="button"
                    onClick={() => setSelectedId(movement.id)}
                    className={`w-full text-left px-5 py-3 flex items-start gap-4 transition-colors ${
                      isSelected
                        ? 'bg-[var(--color-bg-2)] border-l-2 border-l-[var(--color-accent)]'
                        : 'hover:bg-[var(--color-bg-2)]'
                    }`}
                  >
                    <ArrowIcon size={14} className={`flex-shrink-0 mt-1 ${colorClass}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={tone} dot>
                          score {Math.round(score)}
                        </Badge>
                        {movement.importSource === 'datev' && <Badge variant="info">DATEV</Badge>}
                        {amountDiff < 0.01 && <Badge variant="ok">monto exacto</Badge>}
                        {amount <= selectedOpen + RECONCILIATION_EPSILON && amountDiff >= 0.01 && (
                          <Badge variant="info">deja parcial</Badge>
                        )}
                        {Number.isFinite(daysDiff) && daysDiff <= 7 && (
                          <Badge variant="neutral">±{Math.round(daysDiff)}d</Badge>
                        )}
                      </div>
                      <p className="mt-1.5 text-[13px] text-[var(--color-fg-1)] truncate">
                        {movement.description || 'Sin descripción'}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-4)]">
                        {movement.postedDate} · {movement.counterpartyName || 'Sin contraparte'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0">
                      <span className={`font-mono tabular-nums text-[14px] ${colorClass}`}>
                        {direction === 'in' ? '+' : '-'}
                        {formatCurrency(amount)}
                      </span>
                      {amountDiff > 0.01 && (
                        <span className="font-mono text-[10px] text-[var(--color-fg-4)]">
                          dif {formatCurrency(amountDiff)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {allowManualForce && (
          <div className="border-t border-[var(--color-line)] px-6 py-3">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 label-mono text-[var(--color-fg-4)]">
                <ShieldAlert size={13} />
                Motivo para forzar sin DATEV
              </span>
              <input
                type="text"
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                placeholder="Ej: pago confirmado por banco, DATEV pendiente"
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
              />
            </label>
          </div>
        )}

        {selectedMovementLeavesPartial && (
          <div className="px-6 py-2 border-t border-[var(--color-line)]">
            <p className="text-[12px] text-[var(--color-warn)]">
              El movimiento seleccionado no cubre todo el total: se aplicará en orden y dejará saldo parcial.
            </p>
          </div>
        )}

        {error && (
          <div className="px-6 py-2 border-t border-[var(--color-line)]">
            <p className="text-sm text-[var(--color-err)]">{error}</p>
          </div>
        )}

        <footer className="px-6 py-4 border-t border-[var(--color-line)] flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            {allowManualForce && (
              <Button
                variant="danger"
                icon={ShieldAlert}
                disabled={forceSubmitting || submitting || selectedOpen <= RECONCILIATION_EPSILON}
                loading={forceSubmitting}
                onClick={handleForceSubmit}
              >
                Forzar sin DATEV
              </Button>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose} disabled={submitting || forceSubmitting}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              icon={Link2}
              disabled={submitting || forceSubmitting || !selectedId}
              loading={submitting}
              onClick={handleSubmit}
            >
              Vincular movimiento
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default LinkBankMovementModal;
