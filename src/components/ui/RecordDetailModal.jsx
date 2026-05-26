import { Edit3, History, X } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';

const Field = ({ label, value }) => value ? (
 <div>
 <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-4)]">{label}</p>
 <p className="mt-0.5 text-sm text-[var(--color-fg-1)]">{String(value)}</p>
 </div>
) : null;

const FAMILY_LABELS = { legacy: 'Registro histórico', movement: 'Movimiento bancario', receivable: 'Factura CXC', payable: 'Factura CXP' };
const STATUS_LABELS = { paid: 'Liquidado', pending: 'Pendiente', partial: 'Parcial', overdue: 'Vencido', void: 'Anulado', cancelled: 'Anulado', issued: 'Emitida', settled: 'Liquidada' };

const RecordDetailModal = ({
 record,
 onClose,
 onEdit,
 onChangeStatus,
 onViewAuditTrail,
 userRole,
 canEdit,
 canChangeStatus,
 canViewAuditTrail,
}) => {
 if (!record) return null;

 const r = record;
 const raw = r.rawRecord || r.raw || r;
 const isIncome = r.type === 'income' || r.kind === 'receivable' || r.direction === 'in';
 const amount = r.amount || r.grossAmount || raw.grossAmount || raw.amount || 0;
 const status = r.status || raw.status || 'pending';
 const family = r.recordFamily || r.kind || r.source || '';
 const description = r.description || raw.description || '';
 const date = r.date || r.issueDate || raw.issueDate || raw.postedDate || raw.date || '';
 const project = r.project || r.projectName || raw.projectName || '';
 const costCenter = r.costCenter || r.costCenterId || raw.costCenterId || '';
 const category = r.categoryLabel || r.category || raw.category || '';
 const counterparty = r.counterpartyName || raw.counterpartyName || raw.client || raw.vendor || '';
 const docNumber = r.documentNumber || raw.documentNumber || raw.invoiceNumber || '';
 const dueDate = raw.dueDate || r.dueDate || '';
 const createdBy = raw.createdBy || r.createdBy || '';
 const lastEditor = r.lastEditor || raw.updatedBy || raw.lastModifiedBy || '';
 const paidAmount = Number(r.paidAmount || raw.paidAmount || 0);
 const openAmount = Number(r.openAmount || raw.openAmount || 0);
 const payments = raw.payments || r.payments || [];
 const rawNotes = raw.notes || r.notes || [];
 const notes = (Array.isArray(rawNotes) ? rawNotes : []).filter((n) => typeof n === 'object');
 const allowEdit = canEdit ?? (userRole === 'admin');
 const allowChangeStatus = canChangeStatus ?? (userRole === 'admin');
 const allowAuditTrail = canViewAuditTrail ?? (userRole === 'admin');

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn" onClick={onClose}>
 <div className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-xl max-h-[85vh] overflow-hidden animate-scaleIn flex flex-col" onClick={(e) => e.stopPropagation()}>
 <div className="px-6 py-4 border-b border-[var(--color-line)] flex justify-between items-start shrink-0">
 <div className="min-w-0 flex-1">
 <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${isIncome ? 'bg-transparent text-[var(--color-ok)]' : 'bg-transparent text-[var(--color-accent)]'}`}>
 {isIncome ? 'Ingreso' : 'Egreso'} · {FAMILY_LABELS[family] || family}
 </span>
 <h3 className="mt-2 text-lg font-medium text-[var(--color-fg-1)] break-words">{description}</h3>
 </div>
 <button onClick={onClose} className="ml-3 shrink-0 text-[var(--color-fg-4)] hover:text-[var(--color-fg-3)] transition-colors">
 <X size={20} />
 </button>
 </div>

 <div className="overflow-y-auto px-6 py-5 space-y-5">
 <div className="flex items-baseline justify-between">
 <span className={`text-[32px] font-medium tracking-tight ${isIncome ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
 {isIncome ? '+' : '-'}{formatCurrency(amount)}
 </span>
 <span className={`rounded-full px-3 py-1 text-xs font-medium ${
 status === 'paid' || status === 'settled' ? 'bg-transparent text-[var(--color-ok)]' :
 status === 'void' || status === 'cancelled' ? 'bg-[var(--color-bg-1)] text-[var(--color-fg-3)]' :
 status === 'overdue' ? 'bg-transparent text-[var(--color-accent)]' :
 'bg-transparent text-[var(--color-warn)]'
 }`}>
 {r.statusLabel || STATUS_LABELS[status] || status}
 </span>
 </div>

 {paidAmount > 0 && openAmount > 0 && (
 <div>
 <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-2)]">
 <div className="h-full rounded-full bg-[var(--color-ok)]" style={{ width: `${amount > 0 ? (paidAmount / amount) * 100 : 0}%` }} />
 </div>
 <p className="mt-1 text-xs text-[var(--color-fg-3)]">Pagado: {formatCurrency(paidAmount)} / {formatCurrency(amount)} · Abierto: {formatCurrency(openAmount)}</p>
 </div>
 )}

 <div className="grid grid-cols-2 gap-4 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] p-4">
 <Field label="Fecha" value={date} />
 <Field label="Origen" value={r.sourceLabel || r.source} />
 <Field label="Proyecto" value={project} />
 <Field label="Centro de costo" value={costCenter} />
 <Field label="Categoría" value={category} />
 <Field label="Contraparte" value={counterparty} />
 <Field label="No. documento" value={docNumber} />
 <Field label="Familia" value={FAMILY_LABELS[family] || family} />
 {dueDate && <Field label="Vencimiento" value={dueDate} />}
 {createdBy && <Field label="Creado por" value={createdBy} />}
 {lastEditor && <Field label="Última edición" value={lastEditor} />}
 </div>

 {payments.length > 0 && (
 <div>
 <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-4)]">Pagos registrados ({payments.length})</p>
 <div className="space-y-1.5">
 {payments.map((p, idx) => (
 <div key={idx} className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2">
 <div>
 <p className="text-sm text-[var(--color-fg-1)]">{p.method || 'Pago'}</p>
 <p className="text-[11px] text-[var(--color-fg-4)]">{p.date} {p.user ? `· ${p.user}` : ''}</p>
 </div>
 <span className="text-sm font-medium text-[var(--color-ok)]">{formatCurrency(p.amount)}</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {notes.length > 0 && (
 <div>
 <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-4)]">Notas ({notes.length})</p>
 <div className="space-y-1.5">
 {notes.map((n, idx) => (
 <div key={idx} className={`rounded-lg border px-3 py-2 text-sm ${n.type === 'system' ? 'border-[var(--color-line)] bg-[var(--color-bg-0)] text-[var(--color-fg-4)]' : 'border-[var(--color-line-s)] bg-transparent text-[var(--color-fg-3)]'}`}>
 <p>{n.text}</p>
 <p className="mt-1 text-[10px] text-[var(--color-fg-4)]">{n.timestamp ? new Date(n.timestamp).toLocaleString('es-ES') : ''} {n.user ? `· ${n.user}` : ''}</p>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>

 <div className="shrink-0 border-t border-[var(--color-line)] px-6 py-3 flex gap-2">
 {onEdit && allowEdit && (
 <button type="button" onClick={() => { onClose(); onEdit(record); }} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-bg-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg-3)] hover:bg-[var(--color-line)]">
 <Edit3 size={14} />
 Editar
 </button>
 )}
 {onViewAuditTrail && allowAuditTrail && (
 <button type="button" onClick={() => { onClose(); onViewAuditTrail(record); }} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-bg-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg-3)] hover:bg-[var(--color-line)]">
 <History size={14} />
 Log
 </button>
 )}
 {onChangeStatus && allowChangeStatus && (
 <button type="button" onClick={() => { onClose(); onChangeStatus(record); }} className="flex-1 rounded-lg bg-[var(--color-bg-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-warn)] hover:bg-[var(--color-line)]">Cambiar estado</button>
 )}
 <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-[var(--color-bg-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg-3)] hover:bg-[var(--color-line)]">Cerrar</button>
 </div>
 </div>
 </div>
 );
};

export default RecordDetailModal;
