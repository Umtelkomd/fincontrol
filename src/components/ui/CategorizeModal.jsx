import { useState, useEffect } from 'react';
import { X, Save, Tag, HardHat, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/nexus';
import { COST_SCOPE, normalizeCostScope, validateClassification } from '../../finance/costScope';

/**
 * CategorizeModal — for "spontaneous" bank movements that are NOT tied to
 * a CXC/CXP. User picks category + cost destination + cost center + project.
 *
 * The destination (Obra / Estructura) is the decision that drives the rest of
 * the form: most real spend — taxes, health insurance, fuel, leasing, telecom
 * — belongs to no project at all. Requiring a project on every expense left
 * ~93% of the ledger unclassified.
 *
 * The rule itself lives in `validateClassification`; this component never
 * re-implements it.
 */
const CategorizeModal = ({
 isOpen,
 onClose,
 onSubmit,
 movement,
 categories = [],
 costCenters = [],
 projects = [],
}) => {
 const [form, setForm] = useState({
 categoryName: '',
 costCenterId: '',
 projectId: '',
 projectName: '',
 costScope: '',
 });
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState('');

 useEffect(() => {
 if (isOpen && movement) {
 setForm({
 categoryName: movement.categoryName || '',
 costCenterId: movement.costCenterId || '',
 projectId: movement.projectId || '',
 projectName: movement.projectName || '',
 // Legacy documents have no `costScope`; derive it so reopening a
 // classified movement shows its current destination.
 costScope: normalizeCostScope(movement),
 });
 setError('');
 }
 }, [isOpen, movement]);

 if (!isOpen || !movement) return null;

 const isOutbound = movement.direction === 'out';
 const isOverhead = isOutbound && form.costScope === COST_SCOPE.OVERHEAD;
 const projectDisabled = isOutbound && form.costScope !== COST_SCOPE.PROJECT;

 const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

 const selectScope = (scope) => {
 setForm((f) => ({
 ...f,
 costScope: scope,
 // Structure costs must not keep a stale project.
 ...(scope === COST_SCOPE.OVERHEAD ? { projectId: '', projectName: '' } : {}),
 }));
 setError('');
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 const check = validateClassification(movement, form);
 if (!check.valid) {
 setError(check.error);
 return;
 }
 setSubmitting(true);
 const result = await onSubmit(form);
 setSubmitting(false);
 if (result?.success) onClose();
 else setError(result?.error?.message || 'Error al guardar');
 };

 // Filter categories by direction (income vs expense)
 const filtered = categories.filter((c) => {
 const type = c.tipo || c.type || '';
 if (movement.direction === 'in') return type === 'income' || type === '' || type === 'ingreso';
 return type === 'expense' || type === '' || type === 'gasto';
 });

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn" onClick={onClose}>
 <div className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
 <header className="px-6 py-4 border-b border-[var(--color-line)] flex items-center justify-between">
 <div className="flex items-center gap-3">
 <Tag size={18} className="text-[var(--color-fg-4)]" />
 <h2 className="text-lg font-medium text-[var(--color-fg-1)]">Categorizar movimiento</h2>
 </div>
 <button type="button" onClick={onClose} className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)]">
 <X size={20} />
 </button>
 </header>

 <div className="px-6 py-3 border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
 <p className="text-sm text-[var(--color-fg-1)] truncate">{movement.description || '—'}</p>
 <p className="mt-1 text-[12px] text-[var(--color-fg-3)]">
 {movement.postedDate} · {movement.counterpartyName || '—'} ·{' '}
 <span className={movement.direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}>
 {movement.direction === 'in' ? '+' : '-'}€{movement.amount?.toFixed(2)}
 </span>
 </p>
 </div>

 <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Categoría *</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={form.categoryName}
 onChange={(e) => set('categoryName', e.target.value)}
 autoFocus
 >
 <option value="">— Seleccionar —</option>
 {filtered.map((c) => {
 const id = String(c.id || c.codigo || c.code || c.nombre || c.name || '');
 const label = String(c.nombre || c.name || c.codigo || c.code || id);
 return (
 <option key={id} value={label}>{label}</option>
 );
 })}
 </select>
 </label>

 {isOutbound && (
 <CostScopeSelector value={form.costScope} onChange={selectScope} disabled={submitting} />
 )}

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Centro de costo</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.costCenterId}
 onChange={(e) => set('costCenterId', e.target.value)}
 >
 <option value="">— Sin asignar —</option>
 {costCenters.map((c) => {
 const id = String(c.id || c.codigo || c.code || '');
 const label = String(c.nombre || c.name || c.codigo || c.code || id);
 return <option key={id} value={id}>{label}</option>;
 })}
 </select>
 </label>

 {isOverhead ? (
 <p className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2.5 text-[12px] text-[var(--color-fg-3)]">
 Gasto de estructura — no se imputa a ninguna obra.
 </p>
 ) : (
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">
 Proyecto {isOutbound ? '*' : ''}
 </span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none disabled:opacity-50"
 value={form.projectId}
 disabled={projectDisabled}
 onChange={(e) => {
 const id = e.target.value;
 const found = projects.find((p) => p.id === id);
 const name = String(found?.nombre || found?.name || found?.codigo || found?.code || '');
 setForm((f) => ({ ...f, projectId: id, projectName: name }));
 }}
 >
 <option value="">
 {projectDisabled
 ? '— Elegí primero el destino —'
 : isOutbound
 ? '— Seleccionar proyecto —'
 : '— Sin asignar —'}
 </option>
 {projects.map((p) => {
 const id = String(p.id || '');
 const label = String(p.nombre || p.name || p.codigo || p.code || id);
 return <option key={id} value={id}>{label}</option>;
 })}
 </select>
 </label>
 )}

 {error && <p className="text-sm text-[var(--color-err)]">{error}</p>}

 <div className="flex justify-end gap-3 pt-3 border-t border-[var(--color-line)]">
 <Button variant="ghost" onClick={onClose} disabled={submitting} type="button">Cancelar</Button>
 <Button variant="primary" icon={Save} loading={submitting} disabled={submitting} type="submit">
 Guardar
 </Button>
 </div>
 </form>
 </div>
 </div>
 );
};

/**
 * The first and most prominent decision of the form: where the money lands.
 * Rendered as a two-option segmented control so it cannot be skipped the way
 * a select with a blank default can.
 */
const CostScopeSelector = ({ value, onChange, disabled }) => (
 <div>
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Destino del gasto *</span>
 <div className="grid grid-cols-2 gap-2">
 <Button
 variant={value === COST_SCOPE.PROJECT ? 'primary' : 'secondary'}
 icon={HardHat}
 disabled={disabled}
 aria-pressed={value === COST_SCOPE.PROJECT}
 className="w-full"
 onClick={() => onChange(COST_SCOPE.PROJECT)}
 >
 Obra
 </Button>
 <Button
 variant={value === COST_SCOPE.OVERHEAD ? 'primary' : 'secondary'}
 icon={Building2}
 disabled={disabled}
 aria-pressed={value === COST_SCOPE.OVERHEAD}
 className="w-full"
 onClick={() => onChange(COST_SCOPE.OVERHEAD)}
 >
 Estructura
 </Button>
 </div>
 <p className="mt-1.5 text-[12px] text-[var(--color-fg-4)]">
 Estructura = impuestos, seguros, combustible, leasing, telefonía, banco. No lleva proyecto.
 </p>
 </div>
);

export default CategorizeModal;
