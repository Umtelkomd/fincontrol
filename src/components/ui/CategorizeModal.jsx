import { useState, useEffect } from 'react';
import { X, Save, Tag } from 'lucide-react';
import { Button } from '@/components/ui/nexus';

/**
 * CategorizeModal — for "spontaneous" bank movements that are NOT tied to
 * a CXC/CXP. User picks category + cost center + project.
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
 });
 setError('');
 }
 }, [isOpen, movement]);

 if (!isOpen || !movement) return null;

 const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

 const handleSubmit = async (e) => {
 e.preventDefault();
 if (!form.categoryName.trim()) {
 setError('La categoría es obligatoria');
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

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Proyecto</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.projectId}
 onChange={(e) => {
 const id = e.target.value;
 const found = projects.find((p) => p.id === id);
 const name = String(found?.nombre || found?.name || found?.codigo || found?.code || '');
 setForm((f) => ({ ...f, projectId: id, projectName: name }));
 }}
 >
 <option value="">— Sin asignar —</option>
 {projects.map((p) => {
 const id = String(p.id || '');
 const label = String(p.nombre || p.name || p.codigo || p.code || id);
 return <option key={id} value={id}>{label}</option>;
 })}
 </select>
 </label>

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

export default CategorizeModal;
