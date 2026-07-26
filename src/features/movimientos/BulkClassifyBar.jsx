import { useMemo, useState } from 'react';
import { Building2, HardHat, ListChecks, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/nexus';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { COST_SCOPE, validateClassification } from '../../finance/costScope';
import {
 buildBulkClassificationPayload,
 buildBulkValidationTarget,
 summarizeBulkImpact,
} from './bulkClassification';

const EMPTY_FORM = {
 categoryName: '',
 costScope: '',
 projectId: '',
 costCenterId: '',
};

const SCOPE_LABEL = {
 [COST_SCOPE.PROJECT]: 'Obra',
 [COST_SCOPE.OVERHEAD]: 'Estructura',
};

/** Human-readable recap of the payload, for the confirmation dialog. */
const describePayload = (payload) => {
 const parts = [];
 if (payload.categoryName !== undefined) parts.push(`Categoría: ${payload.categoryName || '—'}`);
 if (payload.costScope !== undefined) parts.push(`Destino: ${SCOPE_LABEL[payload.costScope] || '—'}`);
 if (payload.projectId !== undefined) parts.push(`Proyecto: ${payload.projectName || 'sin proyecto'}`);
 if (payload.costCenterId !== undefined) parts.push(`Centro: ${payload.costCenterId || '—'}`);
 return parts.join(' · ') || '—';
};

/**
 * BulkClassifyBar — assign a classification to every selected row in one write.
 *
 * 1464 unclassified movements concentrate in 257 counterparties, so bulk
 * assignment is how the backlog actually gets cleared.
 *
 * Blank fields are NOT written: `buildBulkClassificationPayload` drops every
 * key the user left empty, so a bulk edit meant to set a category can never
 * wipe the cost center of the selected rows. Validation goes through
 * `validateClassification` — the same rule the single-row modal uses.
 *
 * Applying always goes through a confirmation step. The write cannot be undone
 * from inside the app, so the dialog states how many movements are affected
 * and — the number that matters — how many of those ALREADY carry a
 * classification that would be replaced. When that count is above zero the
 * operator has to type the keyword, the same gate a single amount edit uses.
 */
const BulkClassifyBar = ({
 selectedMovements = [],
 categories = [],
 costCenters = [],
 projects = [],
 onApply,
 onClear,
 submitting = false,
}) => {
 const [form, setForm] = useState(EMPTY_FORM);
 const [error, setError] = useState('');
 const [pending, setPending] = useState(null);

 const target = useMemo(() => buildBulkValidationTarget(selectedMovements), [selectedMovements]);
 const isOutbound = target.direction === 'out';
 const isOverhead = isOutbound && form.costScope === COST_SCOPE.OVERHEAD;
 const projectDisabled = isOutbound && form.costScope !== COST_SCOPE.PROJECT;

 const options = useMemo(
 () =>
 (categories || []).filter((c) => (isOutbound ? c.type !== 'income' : c.type !== 'expense')),
 [categories, isOutbound],
 );

 const set = (key, value) => {
 setForm((f) => ({ ...f, [key]: value }));
 setError('');
 };

 const selectScope = (scope) => {
 setForm((f) => ({
 ...f,
 costScope: scope,
 // Structure costs must not keep a stale project.
 ...(scope === COST_SCOPE.OVERHEAD ? { projectId: '' } : {}),
 }));
 setError('');
 };

 // Nothing is written here — the request is parked until the operator
 // confirms it in the dialog below.
 const handleApply = () => {
 const check = validateClassification(target, form);
 if (!check.valid) {
 setError(check.error);
 return;
 }
 const payload = buildBulkClassificationPayload(form, projects);
 setPending({ payload, impact: summarizeBulkImpact(selectedMovements, payload) });
 };

 // The request is cleared BEFORE the write starts: the dialog closes on the
 // first confirm, so a double click cannot fire a second bulk write while the
 // first one is still in flight. Progress shows on the bar's own button.
 const confirmApply = async () => {
 if (!pending) return true;
 const { payload } = pending;
 setPending(null);
 const result = await onApply(payload);
 if (result?.success) {
 setForm(EMPTY_FORM);
 setError('');
 }
 return true;
 };

 const impact = pending?.impact || { total: 0, overwrites: 0 };
 const destructive = impact.overwrites > 0;

 return (
 <div className="rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-2)] px-5 py-4">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <p className="flex items-center gap-2 label-mono text-[var(--color-fg-1)]">
 <ListChecks size={14} className="text-[var(--color-accent)]" />
 {selectedMovements.length} movimiento(s) seleccionados
 </p>
 <Button variant="ghost" size="sm" icon={X} onClick={onClear} disabled={submitting}>
 Limpiar selección
 </Button>
 </div>

 <div className="mt-3 flex flex-wrap items-end gap-3">
 <label className="block min-w-[180px] flex-1">
 <span className="mb-1 block label-mono text-[var(--color-fg-4)]">Categoría *</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={form.categoryName}
 onChange={(e) => set('categoryName', e.target.value)}
 >
 <option value="">— Seleccionar —</option>
 {options.map((c) => (
 <option key={c.name} value={c.name}>{c.name}</option>
 ))}
 </select>
 </label>

 {isOutbound && (
 <div className="block">
 <span className="mb-1 block label-mono text-[var(--color-fg-4)]">Destino *</span>
 <div className="flex gap-2">
 <Button
 size="sm"
 variant={form.costScope === COST_SCOPE.PROJECT ? 'primary' : 'secondary'}
 icon={HardHat}
 aria-pressed={form.costScope === COST_SCOPE.PROJECT}
 disabled={submitting}
 onClick={() => selectScope(COST_SCOPE.PROJECT)}
 >
 Obra
 </Button>
 <Button
 size="sm"
 variant={form.costScope === COST_SCOPE.OVERHEAD ? 'primary' : 'secondary'}
 icon={Building2}
 aria-pressed={form.costScope === COST_SCOPE.OVERHEAD}
 disabled={submitting}
 onClick={() => selectScope(COST_SCOPE.OVERHEAD)}
 >
 Estructura
 </Button>
 </div>
 </div>
 )}

 {!isOverhead && (
 <label className="block min-w-[180px] flex-1">
 <span className="mb-1 block label-mono text-[var(--color-fg-4)]">
 Proyecto {isOutbound ? '*' : ''}
 </span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)] disabled:opacity-50"
 value={form.projectId}
 disabled={projectDisabled}
 onChange={(e) => set('projectId', e.target.value)}
 >
 <option value="">{projectDisabled ? '— Elegí primero el destino —' : '— Sin cambios —'}</option>
 {projects.map((p) => {
 const id = String(p.id || '');
 const label = String(p.nombre || p.name || p.codigo || p.code || id);
 return <option key={id} value={id}>{label}</option>;
 })}
 </select>
 </label>
 )}

 <label className="block min-w-[160px] flex-1">
 <span className="mb-1 block label-mono text-[var(--color-fg-4)]">Centro de costo</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={form.costCenterId}
 onChange={(e) => set('costCenterId', e.target.value)}
 >
 <option value="">— Sin cambios —</option>
 {costCenters.map((c) => {
 const id = String(c.id || c.codigo || c.code || '');
 const label = String(c.nombre || c.name || c.codigo || c.code || id);
 return <option key={id} value={id}>{label}</option>;
 })}
 </select>
 </label>

 <Button
 variant="primary"
 icon={Save}
 loading={submitting}
 disabled={submitting}
 onClick={handleApply}
 >
 Aplicar a {selectedMovements.length}
 </Button>
 </div>

 <p className="mt-2 text-[11px] text-[var(--color-fg-4)]">
 Los campos en blanco no se escriben. Elegir «Estructura» quita el proyecto de los movimientos seleccionados.
 </p>

 {error && <p className="mt-2 text-[12px] text-[var(--color-err)]">{error}</p>}

 <ConfirmModal
 isOpen={Boolean(pending)}
 onClose={() => setPending(null)}
 onConfirm={confirmApply}
 title="Confirmar clasificación en lote"
 message={
 destructive
 ? `Vas a escribir la misma clasificación en ${impact.total} movimiento(s). ${impact.overwrites} de ellos YA están clasificados y sus datos actuales se reemplazan.`
 : `Vas a escribir la misma clasificación en ${impact.total} movimiento(s). Ninguno tiene todavía datos en los campos que se escriben.`
 }
 confirmText={`Aplicar a ${impact.total}`}
 cancelText="Revisar"
 variant={destructive ? 'danger' : 'warning'}
 details={[
 { label: 'Movimientos afectados', value: String(impact.total), emphasis: true },
 {
 label: 'Ya clasificados (se sobrescriben)',
 value: String(impact.overwrites),
 emphasis: destructive,
 },
 { label: 'Se va a escribir', value: describePayload(pending?.payload || {}) },
 ]}
 warning={
 destructive
 ? `${impact.overwrites} movimiento(s) pierden su clasificación actual. Esto no se puede deshacer desde la app: el valor anterior sólo queda en el historial de cada movimiento.`
 : ''
 }
 confirmKeyword={destructive ? 'SOBRESCRIBIR' : ''}
 confirmKeywordLabel="Confirmación de sobrescritura"
 confirmKeywordPlaceholder="SOBRESCRIBIR"
 />
 </div>
 );
};

export default BulkClassifyBar;
