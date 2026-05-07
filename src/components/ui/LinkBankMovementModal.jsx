import { useMemo, useState } from 'react';
import { X, Link2, ArrowDownRight, ArrowUpRight, AlertTriangle, Search, Database } from 'lucide-react';
import { Button, Badge, EmptyState } from '@/components/ui/nexus';
import { formatCurrency, formatDate } from '../../utils/formatters';

/**
 * LinkBankMovementModal — pick a bankMovement (from DATEV) to reconcile
 * a CXC or CXP. Replaces the legacy "register manual payment" flow.
 *
 * Props:
 *   isOpen, onClose
 *   doc            — receivable or payable to link
 *   docKind        — 'receivable' | 'payable'
 *   bankMovements  — full list of bank movements (filtered inside)
 *   onSubmit(movement) — called when user confirms
 *
 * Filters bankMovements to:
 *   - status !== 'void'
 *   - direction matches doc kind ('in' for CXC, 'out' for CXP)
 *   - not already linked to another doc (no receivableId / payableId set)
 *
 * Scores remaining matches by amount + date proximity, with the same
 * algorithm used in useClassifier.suggestMatches.
 */
const LinkBankMovementModal = ({
  isOpen,
  onClose,
  doc,
  docKind,
  bankMovements = [],
  onSubmit,
}) => {
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const direction = docKind === 'receivable' ? 'in' : 'out';
  const open = Number(doc?.openAmount || doc?.grossAmount || doc?.amount || 0);
  const refDate = doc?.dueDate || doc?.issueDate || '';

  const candidates = useMemo(() => {
    if (!doc) return [];
    const targetDate = new Date(refDate || new Date().toISOString().slice(0, 10));
    const validTarget = !Number.isNaN(targetDate.getTime());

    const list = (bankMovements || [])
      .filter((m) => {
        if (m.status === 'void') return false;
        if (m.direction !== direction) return false;
        // Already linked to ANOTHER doc?
        if (docKind === 'receivable' && m.receivableId && m.receivableId !== doc.id) return false;
        if (docKind === 'payable' && m.payableId && m.payableId !== doc.id) return false;
        return true;
      })
      .map((m) => {
        const amount = Math.abs(Number(m.amount) || 0);
        const amountDiff = Math.abs(open - amount);
        const itemDate = new Date(m.postedDate || '');
        const validItem = !Number.isNaN(itemDate.getTime());
        const daysDiff =
          validItem && validTarget ? Math.abs((itemDate - targetDate) / (1000 * 60 * 60 * 24)) : Infinity;

        let score = 0;
        if (amountDiff < 0.01) score += 100;
        else if (amountDiff < 1) score += 80;
        else if (amountDiff < 10) score += 40;
        else score += 0;
        if (daysDiff <= 21) score += Math.max(0, 30 - daysDiff);

        return { movement: m, amount, amountDiff, daysDiff, score };
      })
      .filter((c) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        const m = c.movement;
        return (
          (m.description || '').toLowerCase().includes(q) ||
          (m.counterpartyName || '').toLowerCase().includes(q) ||
          String(m.amount || '').includes(q)
        );
      })
      .sort((a, b) => b.score - a.score || (b.movement.postedDate || '').localeCompare(a.movement.postedDate || ''));
    return list;
  }, [doc, bankMovements, direction, refDate, open, search, docKind]);

  const top = candidates.slice(0, 30);
  const exactMatches = candidates.filter((c) => c.score >= 100).length;

  if (!isOpen || !doc) return null;

  const handleSubmit = async () => {
    if (!selectedId) {
      setError('Elegí un movimiento bancario para vincular');
      return;
    }
    const chosen = candidates.find((c) => c.movement.id === selectedId);
    if (!chosen) {
      setError('Movimiento no encontrado');
      return;
    }
    setSubmitting(true);
    setError('');
    const r = await onSubmit(chosen.movement);
    setSubmitting(false);
    if (r?.success) onClose();
    else setError(r?.error?.message || r?.error || 'Error al vincular');
  };

  const ArrowIcon = direction === 'in' ? ArrowUpRight : ArrowDownRight;
  const colorClass = direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-[var(--color-line)] flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Database size={18} className="text-[var(--color-accent)] flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-lg font-medium text-[var(--color-fg-1)] truncate">
                Vincular {docKind === 'receivable' ? 'CXC' : 'CXP'} con movimiento bancario
              </h2>
              <p className="text-[12px] text-[var(--color-fg-3)] truncate">
                {doc.documentNumber || doc.counterpartyName || doc.description || doc.id} · abierto{' '}
                {formatCurrency(open)}
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
              Política UMTELKOMD: cambiar status requiere un movimiento bancario real (DATEV).
              Si el extracto aún no llegó, esperá al DATEV semanal.
            </span>
          </p>
        </div>

        <div className="px-6 py-3 border-b border-[var(--color-line)] flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" size={14} />
            <input
              type="text"
              placeholder="Filtrar por contraparte, descripción o monto..."
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-1.5 pl-8 pr-3 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-3)]">
            <Badge variant={exactMatches > 0 ? 'ok' : 'neutral'}>
              {exactMatches} match exacto(s)
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
              } correspondientes. Después volvé acá para vincularlos.`}
            />
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {top.map(({ movement, amount, amountDiff, daysDiff, score }) => {
                const isSelected = selectedId === movement.id;
                const tone = score >= 130 ? 'ok' : score >= 100 ? 'info' : 'warn';
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

        {error && (
          <div className="px-6 py-2 border-t border-[var(--color-line)]">
            <p className="text-sm text-[var(--color-err)]">{error}</p>
          </div>
        )}

        <footer className="px-6 py-4 border-t border-[var(--color-line)] flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            icon={Link2}
            disabled={submitting || !selectedId}
            loading={submitting}
            onClick={handleSubmit}
          >
            Vincular movimiento
          </Button>
        </footer>
      </div>
    </div>
  );
};

export default LinkBankMovementModal;
