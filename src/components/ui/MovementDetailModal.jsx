import { useState } from 'react';
import { X, ArrowDownRight, ArrowUpRight, Tag, Pencil } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { Button, Badge } from '@/components/ui/nexus';

/**
 * MovementDetailModal — read-only detail view of a bankMovement
 * with optional inline re-categorization.
 *
 * Shows: header metadata, audit trail, link to CXC/CXP if any,
 * classification fields. The user can click "Editar categorización"
 * which opens the regular CategorizeModal externally.
 */
const MovementDetailModal = ({
 isOpen,
 onClose,
 movement,
 receivable,
 payable,
 onEditCategory,
}) => {
 const [auditExpanded, setAuditExpanded] = useState(false);
 if (!isOpen || !movement) return null;

 const isIn = movement.direction === 'in';
 const ArrowIcon = isIn ? ArrowUpRight : ArrowDownRight;
 const colorClass = isIn ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]';
 const linkedDoc = receivable || payable;
 const isVoid = movement.status === 'void';
 const isReconciled = !!movement.receivableId || !!movement.payableId || !!movement.reconciledAt;

 const auditTrail = Array.isArray(movement.auditTrail) ? movement.auditTrail : [];

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn" onClick={onClose}>
 <div className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
 <header className="px-6 py-4 border-b border-[var(--color-line)] flex items-center justify-between">
 <div className="flex items-center gap-3 min-w-0">
 <ArrowIcon size={18} className={`flex-shrink-0 ${colorClass}`} />
 <div className="min-w-0">
 <h2 className="text-lg font-medium text-[var(--color-fg-1)] truncate">
 {movement.description || 'Sin descripción'}
 </h2>
 <p className="text-[12px] text-[var(--color-fg-3)] font-mono">
 {movement.postedDate} · {movement.counterpartyName || '—'}
 </p>
 </div>
 </div>
 <button type="button" onClick={onClose} className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)]">
 <X size={20} />
 </button>
 </header>

 <div className="overflow-y-auto px-6 py-5 flex-1 space-y-5">
 {/* Hero amount */}
 <div className="flex items-baseline justify-between flex-wrap gap-3">
 <span className={`font-display text-[40px] font-light tabular-nums tracking-tight ${colorClass}`}>
 {isIn ? '+' : '-'}{formatCurrency(movement.amount)}
 </span>
 <div className="flex flex-wrap gap-2">
 {isVoid && <Badge variant="err" dot>Anulado</Badge>}
 {isReconciled && !isVoid && <Badge variant="ok" dot>Conciliado</Badge>}
 {!isReconciled && !isVoid && <Badge variant="warn" dot>Sin conciliar</Badge>}
 {movement.importSource === 'datev' && <Badge variant="info">DATEV</Badge>}
 </div>
 </div>

 {/* Classification grid */}
 <div className="grid grid-cols-2 gap-3">
 <Field label="Fecha banco" value={movement.postedDate} mono />
 <Field label="Fecha valor" value={movement.valueDate} mono />
 <Field label="Categoría" value={movement.categoryName || '—'} />
 <Field label="Centro de costo" value={movement.costCenterId || '—'} />
 <Field label="Proyecto" value={movement.projectName || movement.projectId || '—'} />
 <Field label="Contraparte" value={movement.counterpartyName || '—'} />
 {movement.counterpartyIban && <Field label="IBAN contraparte" value={movement.counterpartyIban} mono />}
 {movement.counterpartyBic && <Field label="BIC" value={movement.counterpartyBic} mono />}
 </div>

 {/* Linked CXC/CXP */}
 {linkedDoc && (
 <div className="rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-2)] px-4 py-3">
 <p className="label-mono text-[var(--color-fg-3)] mb-2">
 Vinculado a {receivable ? 'CXC' : 'CXP'}
 </p>
 <p className="text-sm text-[var(--color-fg-1)]">
 {linkedDoc.description || linkedDoc.counterpartyName || linkedDoc.documentNumber || linkedDoc.id}
 </p>
 <p className="mt-1 text-[12px] text-[var(--color-fg-3)] font-mono">
 Vence {linkedDoc.dueDate || '—'} ·
 abierto {formatCurrency(linkedDoc.openAmount || 0)} ·
 estado {linkedDoc.status || '—'}
 </p>
 </div>
 )}

 {/* Recurring source if generated */}
 {movement.recurringCostId && (
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
 <p className="label-mono text-[var(--color-fg-3)] mb-1">Origen recurrente</p>
 <p className="text-[12px] text-[var(--color-fg-4)] font-mono">
 {movement.recurringPeriod || '—'} · regla {movement.recurringCostId}
 </p>
 </div>
 )}

 {/* Import meta */}
 {movement.importSource === 'datev' && (
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
 <p className="label-mono text-[var(--color-fg-3)] mb-1">Fuente del import</p>
 <p className="text-[12px] text-[var(--color-fg-4)] font-mono break-all">
 {movement.importFile || '—'}
 {movement.importLineNumber ? ` · línea ${movement.importLineNumber}` : ''}
 </p>
 </div>
 )}

 {/* Audit */}
 {auditTrail.length > 0 && (
 <div>
 <button
 type="button"
 className="label-mono text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)] flex items-center gap-2"
 onClick={() => setAuditExpanded((v) => !v)}
 >
 Audit trail ({auditTrail.length}) {auditExpanded ? '▾' : '▸'}
 </button>
 {auditExpanded && (
 <div className="mt-2 space-y-2">
 {auditTrail.slice(-12).reverse().map((entry, i) => (
 <div key={i} className="text-[12px] border-l-2 border-[var(--color-line)] pl-3">
 <p className="text-[var(--color-fg-1)]">{entry.detail || entry.action}</p>
 <p className="font-mono text-[10px] text-[var(--color-fg-4)]">
 {(entry.timestamp || '').slice(0, 19).replace('T', ' ')} · {entry.user || '—'}
 </p>
 </div>
 ))}
 {auditTrail.length > 12 && (
 <p className="text-[11px] text-[var(--color-fg-4)]">
 …{auditTrail.length - 12} entradas más antiguas omitidas
 </p>
 )}
 </div>
 )}
 </div>
 )}
 </div>

 <footer className="px-6 py-4 border-t border-[var(--color-line)] flex justify-end gap-3">
 <Button variant="ghost" onClick={onClose}>Cerrar</Button>
 {!isVoid && onEditCategory && (
 <Button variant="primary" icon={Tag} onClick={onEditCategory}>
 Editar categorización
 </Button>
 )}
 </footer>
 </div>
 </div>
 );
};

const Field = ({ label, value, mono }) => (
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">{label}</p>
 <p className={`mt-0.5 text-[13px] text-[var(--color-fg-1)] ${mono ? 'font-mono' : ''}`}>
 {value || '—'}
 </p>
 </div>
);

export default MovementDetailModal;
