import { useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

const fieldClassName =
 'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-[13px] text-[var(--color-fg-1)] outline-none transition-all focus:border-[var(--color-line-s)] focus:bg-[var(--color-bg-1)] focus:';

const STATUS_LABELS = {
  issued: 'Emitida',
  partial: 'Parcial',
  settled: 'Liquidada',
  cancelled: 'Cancelada',
};

const STATUS_WARNINGS = {
  issued: 'Revertir a Emitida borrará todos los pagos registrados y pondrá el importe abierto a cero.',
  settled: 'Marcar como Liquidada forzará el importe cobrado/pagado al total bruto.',
  cancelled: 'Cancelar la orden cierra el importe abierto a cero.',
  partial: '',
};

const buildInitialFormData = (record) => ({
 direction: record?.rawRecord?.direction || 'in',
 amount: String(record?.amount ?? ''),
 postedDate: record?.rawRecord?.postedDate || record?.date || '',
 issueDate: record?.rawRecord?.issueDate || record?.date || '',
 dueDate: record?.rawRecord?.dueDate || '',
 description: record?.rawRecord?.description || record?.description || '',
 counterpartyName: record?.rawRecord?.counterpartyName || record?.counterpartyName || '',
 documentNumber: record?.rawRecord?.documentNumber || record?.documentNumber || '',
 projectId: record?.rawRecord?.projectId || '',
 costCenterId: record?.rawRecord?.costCenterId || '',
 categoryName: record?.rawRecord?.categoryName || record?.categoryLabel || '',
 forceStatus: '',
 correctionReason: '',
});

const CanonicalRecordModal = ({ isOpen, onClose, record, onSubmit, projects = [], costCenters = [], categories = [], submitting = false, userRole = '' }) => {
 const [formData, setFormData] = useState(() => buildInitialFormData(record));

 if (!isOpen || !record) return null;

 const isOrder = record.recordFamily === 'receivable' || record.recordFamily === 'payable';
 const isAdmin = userRole === 'admin';
 const showStatusOverride = isAdmin && isOrder;
 const requiresReason = Boolean(formData.forceStatus);
 const canSubmit = !submitting && (!requiresReason || formData.correctionReason.trim().length > 0);

 const projectLabel = record.recordFamily === 'movement' ? 'Movimiento bancario' : record.recordFamily === 'receivable' ? 'Factura CXC' : 'Factura CXP';

 const handleSubmit = async (event) => {
 event.preventDefault();
 if (!canSubmit) return;
 await onSubmit(formData);
 };

 return (
 <div className="fixed inset-0 z-[240] flex items-center justify-center bg-[var(--color-bg-1)] p-4 ">
 <div className="w-full max-w-2xl overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <div className="flex items-start justify-between border-b border-[var(--color-line)] px-5 py-4">
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">Edición operativa</p>
 <h3 className="mt-1 text-[22px] font-medium tracking-tight text-[var(--color-fg-1)]">Editar {projectLabel}</h3>
 <p className="mt-1 text-[12px] text-[var(--color-fg-3)]">{record.description}</p>
 </div>
 <button
 type="button"
 aria-label="Cerrar edición"
 onClick={onClose}
 className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-2 text-[var(--color-fg-3)] transition-colors hover:text-[var(--color-fg-1)]"
 >
 <X size={18} />
 </button>
 </div>

 <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
 {record.recordFamily === 'movement' && (
 <div className="grid gap-4 md:grid-cols-3">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Dirección</span>
 <select
 className={fieldClassName}
 value={formData.direction}
 onChange={(event) => setFormData((current) => ({ ...current, direction: event.target.value }))}
 >
 <option value="in">Entrada</option>
 <option value="out">Salida</option>
 </select>
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Fecha</span>
 <input
 type="date"
 className={fieldClassName}
 value={formData.postedDate}
 onChange={(event) => setFormData((current) => ({ ...current, postedDate: event.target.value }))}
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Importe</span>
 <input
 type="number"
 step="0.01"
 min="0.01"
 className={fieldClassName}
 value={formData.amount}
 onChange={(event) => setFormData((current) => ({ ...current, amount: event.target.value }))}
 />
 </label>
 </div>
 )}

 {record.recordFamily !== 'movement' && (
 <div className="grid gap-4 md:grid-cols-3">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Emisión</span>
 <input
 type="date"
 className={fieldClassName}
 value={formData.issueDate}
 onChange={(event) => setFormData((current) => ({ ...current, issueDate: event.target.value }))}
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Vencimiento</span>
 <input
 type="date"
 className={fieldClassName}
 value={formData.dueDate}
 onChange={(event) => setFormData((current) => ({ ...current, dueDate: event.target.value }))}
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Importe</span>
 <input
 type="number"
 step="0.01"
 min={formData.forceStatus ? 0 : (record.paidAmount || 0)}
 className={fieldClassName}
 value={formData.amount}
 onChange={(event) => setFormData((current) => ({ ...current, amount: event.target.value }))}
 />
 </label>
 </div>
 )}

 <div className="grid gap-4 md:grid-cols-2">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Contraparte</span>
 <input
 type="text"
 className={fieldClassName}
 value={formData.counterpartyName}
 onChange={(event) => setFormData((current) => ({ ...current, counterpartyName: event.target.value }))}
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Documento</span>
 <input
 type="text"
 className={fieldClassName}
 value={formData.documentNumber}
 onChange={(event) => setFormData((current) => ({ ...current, documentNumber: event.target.value }))}
 />
 </label>
 </div>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Descripción</span>
 <textarea
 rows="3"
 className={fieldClassName}
 value={formData.description}
 onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
 />
 </label>

 <div className="grid gap-4 md:grid-cols-3">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Categoría</span>
 <select
 className={fieldClassName}
 value={formData.categoryName}
 onChange={(event) => setFormData((current) => ({ ...current, categoryName: event.target.value }))}
 >
 <option value="">Sin categoría</option>
 {categories.map((cat) => (
 <option key={cat} value={cat}>{cat}</option>
 ))}
 </select>
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Centro de costo</span>
 <select
 className={fieldClassName}
 value={formData.costCenterId}
 onChange={(event) => setFormData((current) => ({ ...current, costCenterId: event.target.value }))}
 >
 <option value="">Sin centro</option>
 {costCenters.map((center) => (
 <option key={center.id || center.name} value={center.name || center.id}>
 {center.name || center.id}
 </option>
 ))}
 </select>
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Proyecto</span>
 <select
 className={fieldClassName}
 value={formData.projectId}
 onChange={(event) => setFormData((current) => ({ ...current, projectId: event.target.value }))}
 >
 <option value="">Sin proyecto</option>
 {projects.map((project) => (
 <option key={project.id} value={project.id}>
 {project.name || project.displayName || project.code}
 </option>
 ))}
 </select>
 </label>
 </div>

 {showStatusOverride && (
 <div className="space-y-3 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] p-4">
 <p className="label-mono text-[var(--color-fg-4)]">Corrección de estado — solo admin</p>
 <div className="flex items-center gap-2 text-xs text-[var(--color-fg-3)]">
   <span>Estado actual:</span>
   <span className="font-medium text-[var(--color-fg-1)]">{STATUS_LABELS[record.rawRecord?.status] || record.rawRecord?.status || '—'}</span>
 </div>
 <label className="block">
   <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Forzar estado</span>
   <select
     className={fieldClassName}
     value={formData.forceStatus}
     onChange={(event) => setFormData((current) => ({ ...current, forceStatus: event.target.value, correctionReason: '' }))}
   >
     <option value="">Automático (calculado por importe)</option>
     {Object.entries(STATUS_LABELS).map(([value, label]) => (
       <option key={value} value={value}>{label}</option>
     ))}
   </select>
 </label>

 {formData.forceStatus && STATUS_WARNINGS[formData.forceStatus] && (
   <div className="flex items-start gap-2 rounded-md border border-[var(--color-warn)] bg-[var(--color-bg-1)] px-3 py-2.5 text-xs text-[var(--color-warn)]">
     <AlertTriangle size={14} className="mt-0.5 shrink-0" />
     <span>{STATUS_WARNINGS[formData.forceStatus]}</span>
   </div>
 )}

 {formData.forceStatus && (
   <label className="block">
     <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">
       Motivo de corrección <span className="text-[var(--color-accent)]">*</span>
     </span>
     <textarea
       rows="2"
       required
       placeholder="Describí brevemente por qué se corrige el estado..."
       className={fieldClassName}
       value={formData.correctionReason}
       onChange={(event) => setFormData((current) => ({ ...current, correctionReason: event.target.value }))}
     />
   </label>
 )}
 </div>
 )}

 <div className="flex items-center justify-end gap-3 border-t border-[var(--color-line)] pt-4">
 <button
 type="button"
 onClick={onClose}
 className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-bg-1)] hover:text-[var(--color-fg-1)]"
 >
 Cancelar
 </button>
 <button
 type="submit"
 disabled={!canSubmit}
 className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-fg-1)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-bg-0)] transition-colors hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
 >
 {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
 Guardar cambios
 </button>
 </div>
 </form>
 </div>
 </div>
 );
};

export default CanonicalRecordModal;
