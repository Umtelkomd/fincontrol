import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Edit3, ExternalLink, FileText, History, Plus, Trash2, User, X } from 'lucide-react';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { exportAuditTrailToPDF } from '../../utils/pdfExport';

const ACTION_STYLES = {
 create: { color: 'text-[var(--color-ok)]', bg: 'bg-transparent', label: 'Creación', icon: Plus },
 update: { color: 'text-[var(--color-fg-1)]', bg: 'bg-[var(--color-bg-1)]', label: 'Edición', icon: Edit3 },
 delete: { color: 'text-[var(--color-accent)]', bg: 'bg-transparent', label: 'Eliminación', icon: Trash2 },
 payment: { color: 'text-[var(--color-warn)]', bg: 'bg-transparent', label: 'Pago', icon: FileText },
 status_change: { color: 'text-[var(--color-fg-3)]', bg: 'bg-[var(--color-bg-1)]', label: 'Cambio de estado', icon: Edit3 },
 cancel: { color: 'text-[var(--color-warn)]', bg: 'bg-transparent', label: 'Cancelación', icon: Trash2 },
 void: { color: 'text-[var(--color-accent)]', bg: 'bg-transparent', label: 'Anulación', icon: Trash2 },
};

const ENTITY_TYPE_BY_FAMILY = {
 legacy: 'transaction',
 movement: 'bankMovement',
 receivable: 'receivable',
 payable: 'payable',
};

const safeString = (value) => {
 if (value == null) return '';
 if (typeof value === 'object') return JSON.stringify(value);
 return String(value);
};

const toIso = (value) => {
 if (!value) return null;
 if (typeof value?.toDate === 'function') return value.toDate().toISOString();
 const date = new Date(value);
 return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildEmbeddedEntries = (record) => {
 const trail = Array.isArray(record?.rawRecord?.auditTrail) ? record.rawRecord.auditTrail : [];
 return trail.map((entry, index) => ({
 id: `embedded-${record.id}-${index}`,
 action: entry.action || 'update',
 description: entry.detail || 'Cambio interno registrado en el documento',
 user: entry.user || 'Sistema',
 timestamp: toIso(entry.timestamp),
 source: 'document',
 metadata: null,
 before: null,
 after: null,
 }));
};

const getChangedFields = (entry) => {
 if (!entry?.before || !entry?.after) return [];
 const keys = new Set([...Object.keys(entry.before), ...Object.keys(entry.after)]);
 return [...keys].filter((key) => JSON.stringify(entry.before[key]) !== JSON.stringify(entry.after[key]));
};

const RecordAuditTrailModal = ({ isOpen, onClose, record, logs = [], loading = false }) => {
 const navigate = useNavigate();
 const timeline = useMemo(() => {
 if (!record) return [];

 const entityType = ENTITY_TYPE_BY_FAMILY[record.recordFamily];
 const globalEntries = logs
 .filter((entry) => entry.entityId === record.entityId && entry.entityType === entityType)
 .map((entry) => ({
 ...entry,
 source: 'global',
 timestamp: toIso(entry.timestamp),
 }));

 const embeddedEntries = buildEmbeddedEntries(record);
 const merged = [...globalEntries, ...embeddedEntries];
 const seen = new Set();

 return merged
 .filter((entry) => {
 const key = [
 entry.action || '',
 entry.user || '',
 entry.timestamp || '',
 entry.description || '',
 ].join('|');
 if (seen.has(key)) return false;
 seen.add(key);
 return true;
 })
 .sort((left, right) => {
 const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : 0;
 const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : 0;
 return rightTime - leftTime;
 });
 }, [logs, record]);

 if (!isOpen || !record) return null;

 const handleOpenGlobalAudit = () => {
 const entityType = ENTITY_TYPE_BY_FAMILY[record.recordFamily];
 navigate(`/auditoria?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(record.entityId)}&label=${encodeURIComponent(record.description || record.documentNumber || record.entityId)}`);
 onClose();
 };

 const handleExport = async () => {
 await exportAuditTrailToPDF(record, timeline);
 };

 return (
 <div className="fixed inset-0 z-[250] flex items-center justify-center bg-[var(--color-bg-1)] p-4 ">
 <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <div className="flex items-start justify-between border-b border-[var(--color-line)] px-6 py-5">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">Trazabilidad del registro</p>
 <h3 className="mt-2 text-[24px] font-medium tracking-tight text-[var(--color-fg-1)]">{record.description || 'Registro sin descripción'}</h3>
 <p className="mt-2 text-[13px] text-[var(--color-fg-4)]">
 {record.recordFamilyLabel} · {record.documentNumber || 'Sin documento'} · {record.counterpartyName || 'Sin contraparte'}
 </p>
 </div>

 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={handleExport}
 className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-transparent px-4 py-2 text-[12px] font-medium text-[var(--color-fg-1)] transition-colors hover:bg-[var(--color-bg-1)] hover:text-[var(--color-fg-1)]"
 >
 <Download size={14} />
 Exportar PDF
 </button>
 <button
 type="button"
 onClick={handleOpenGlobalAudit}
 className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-transparent px-4 py-2 text-[12px] font-medium text-[var(--color-fg-1)] transition-colors hover:bg-[var(--color-bg-1)] hover:text-[var(--color-fg-1)]"
 >
 <ExternalLink size={14} />
 Auditoría global
 </button>
 <button
 type="button"
 onClick={onClose}
 className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-2 text-[var(--color-fg-4)] transition-colors hover:text-[var(--color-fg-1)]"
 aria-label="Cerrar trazabilidad"
 >
 <X size={18} />
 </button>
 </div>
 </div>

 <div className="grid gap-3 border-b border-[var(--color-line)] px-6 py-4 md:grid-cols-4">
 <div className="rounded-lg border border-[var(--color-line)] bg-transparent px-4 py-3">
 <p className="label-mono text-[var(--color-fg-4)]">Importe</p>
 <p className="mt-1 text-[18px] font-medium text-[var(--color-fg-1)]">€{formatCurrency(record.amount || 0)}</p>
 </div>
 <div className="rounded-lg border border-[var(--color-line)] bg-transparent px-4 py-3">
 <p className="label-mono text-[var(--color-fg-4)]">Estado</p>
 <p className="mt-1 text-[18px] font-medium text-[var(--color-fg-1)]">{record.statusLabel || record.status || '—'}</p>
 </div>
 <div className="rounded-lg border border-[var(--color-line)] bg-transparent px-4 py-3">
 <p className="label-mono text-[var(--color-fg-4)]">Último editor</p>
 <p className="mt-1 truncate text-[14px] font-medium text-[var(--color-fg-1)]">{record.lastEditor || 'Sin rastro'}</p>
 </div>
 <div className="rounded-lg border border-[var(--color-line)] bg-transparent px-4 py-3">
 <p className="label-mono text-[var(--color-fg-4)]">Último cambio</p>
 <p className="mt-1 text-[14px] font-medium text-[var(--color-fg-1)]">{formatDateTime(record.lastEditedAt) || 'Sin fecha'}</p>
 </div>
 </div>

 <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
 {loading ? (
 <div className="flex items-center justify-center py-18">
 <div className="flex items-center gap-3 text-[var(--color-fg-4)]">
 <History size={18} />
 Cargando…
 </div>
 </div>
 ) : timeline.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-18 text-center">
 <History className="h-8 w-8 text-[var(--color-fg-3)]" />
 <p className="mt-3 text-[14px] font-medium text-[var(--color-fg-1)]">No hay eventos de auditoría todavía</p>
 <p className="mt-1 max-w-md text-[13px] leading-6 text-[var(--color-fg-4)]">
 Las próximas ediciones, pagos, anulaciones o cancelaciones de este registro aparecerán aquí.
 </p>
 </div>
 ) : (
 <div className="relative ml-4 border-l border-[var(--color-line)]">
 {timeline.map((entry) => {
 const style = ACTION_STYLES[entry.action] || ACTION_STYLES.update;
 const Icon = style.icon;
 const changedFields = getChangedFields(entry);

 return (
 <div
 key={entry.id}
 className="relative pb-6 pl-7 last:pb-0"
 >
 <span className={`absolute -left-[9px] top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-bg-1)] ${style.color}`}>
 <span className="h-2 w-2 rounded-full bg-current" />
 </span>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-4">
 <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
 <div className="min-w-0">
 <p className="label-mono text-[var(--color-fg-4)]">{formatDateTime(entry.timestamp) || 'Sin fecha'}</p>
 <div className="mt-2 flex flex-wrap items-center gap-2">
 <span className={`inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line)] px-2 py-1 text-[10px] font-medium ${style.color}`}>
 <Icon size={12} />
 {style.label}
 </span>
 <span className="rounded-md border border-[var(--color-line)] px-2 py-1 text-[10px] text-[var(--color-fg-4)]">
 {entry.source === 'global' ? 'Auditoría global' : 'Rastro interno'}
 </span>
 </div>
 <p className="mt-3 text-[14px] font-medium leading-6 text-[var(--color-fg-1)]">{entry.description}</p>
 </div>

 <div className="shrink-0 rounded-md border border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-fg-4)]">
 <span className="inline-flex items-center gap-1">
 <User size={11} />
 {entry.user || 'Sistema'}
 </span>
 </div>
 </div>

 {changedFields.length > 0 && (
 <div className="mt-3 flex flex-wrap gap-2">
 {changedFields.slice(0, 8).map((field) => (
 <span key={field} className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-2 py-0.5 text-[10px] text-[var(--color-fg-4)]">
 {field}
 </span>
 ))}
 </div>
 )}

 {entry.metadata && (
 <div className="mt-3 grid gap-2 md:grid-cols-2">
 {Object.entries(entry.metadata).map(([key, value]) => (
 <div key={key} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-[11px] text-[var(--color-fg-4)]">
 <span className="font-medium text-[var(--color-fg-4)]">{key}: </span>
 <span className="text-[var(--color-fg-1)]">{safeString(value) || '—'}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 </div>
 </div>
 );
};

export default RecordAuditTrailModal;
