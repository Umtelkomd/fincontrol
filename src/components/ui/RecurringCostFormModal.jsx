import { useState, useEffect, useMemo } from 'react';
import { X, Save, Repeat } from 'lucide-react';
import {
 recurringCostDefaults,
 COST_OWNER_TYPES,
 COST_FREQUENCIES,
 COST_CONCEPTS,
} from '../../finance/assetSchemas';
import { Button } from '@/components/ui/nexus';

const OWNER_TYPE_LABELS = {
 employee: 'Empleado',
 property: 'Vivienda',
 vehicle: 'Vehículo',
 insurance: 'Seguro',
 general: 'General',
};

const FREQUENCY_LABELS = {
 monthly: 'Mensual',
 quarterly: 'Trimestral',
 yearly: 'Anual',
 biweekly: 'Quincenal',
 weekly: 'Semanal',
};

const RecurringCostFormModal = ({
 isOpen,
 onClose,
 onSubmit,
 editingCost,
 employees = [],
 properties = [],
 vehicles = [],
 insurances = [],
 costCenters = [],
 projects = [],
}) => {
 const [form, setForm] = useState(recurringCostDefaults());
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState('');

 useEffect(() => {
 if (isOpen) {
 setForm(editingCost ? { ...recurringCostDefaults(), ...editingCost } : recurringCostDefaults());
 setError('');
 }
 }, [isOpen, editingCost]);

 const ownerOptions = useMemo(() => {
 if (form.ownerType === 'employee') return employees.map((e) => ({ id: e.id, name: e.fullName }));
 if (form.ownerType === 'property') return properties.map((p) => ({ id: p.id, name: p.name }));
 if (form.ownerType === 'vehicle') return vehicles.map((v) => ({ id: v.id, name: v.name }));
 if (form.ownerType === 'insurance') return insurances.map((i) => ({ id: i.id, name: i.name }));
 return [];
 }, [form.ownerType, employees, properties, vehicles, insurances]);

 const conceptSuggestions = COST_CONCEPTS[form.ownerType] || [];

 if (!isOpen) return null;

 const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

 const setOwner = (ownerId) => {
 const opt = ownerOptions.find((o) => o.id === ownerId);
 setForm((f) => ({ ...f, ownerId, ownerName: opt?.name || '' }));
 };

 const setOwnerType = (ownerType) => {
 setForm((f) => ({
 ...f,
 ownerType,
 ownerId: ownerType === 'general' ? null : '',
 ownerName: ownerType === 'general' ? 'General' : '',
 }));
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 if (form.ownerType !== 'general' && !form.ownerId) {
 setError('Selecciona el propietario del costo');
 return;
 }
 if (!form.concept.trim()) {
 setError('El concepto es obligatorio');
 return;
 }
 if (!form.amount || form.amount <= 0) {
 setError('El monto debe ser mayor a cero');
 return;
 }
 // Vehicle / property / insurance recurrents must hit a project for obra costeo.
 if (['vehicle', 'property', 'insurance'].includes(form.ownerType) && !form.projectId) {
 setError('El proyecto es obligatorio para costos de flota, vivienda o seguro');
 return;
 }
 setSubmitting(true);
 const result = await onSubmit(form);
 setSubmitting(false);
 if (result?.success) onClose();
 else setError(result?.error?.message || 'Error al guardar');
 };

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn" onClick={onClose}>
 <div className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
 <header className="px-6 py-4 border-b border-[var(--color-line)] flex items-center justify-between">
 <div className="flex items-center gap-3">
 <Repeat size={18} className="text-[var(--color-fg-4)]" />
 <h2 className="text-lg font-medium text-[var(--color-fg-1)]">
 {editingCost ? 'Editar costo recurrente' : 'Nuevo costo recurrente'}
 </h2>
 </div>
 <button type="button" onClick={onClose} className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)]">
 <X size={20} />
 </button>
 </header>

 <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 flex-1 space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Tipo de propietario *</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.ownerType}
 onChange={(e) => setOwnerType(e.target.value)}
 >
 {COST_OWNER_TYPES.map((t) => (
 <option key={t} value={t}>{OWNER_TYPE_LABELS[t]}</option>
 ))}
 </select>
 </label>

 {form.ownerType !== 'general' && (
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">{OWNER_TYPE_LABELS[form.ownerType]} *</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.ownerId || ''}
 onChange={(e) => setOwner(e.target.value)}
 >
 <option value="">— Seleccionar —</option>
 {ownerOptions.map((o) => (
 <option key={o.id} value={o.id}>{o.name}</option>
 ))}
 </select>
 </label>
 )}

 <label className="block md:col-span-2">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Concepto *</span>
 <input
 list="concept-suggestions"
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={form.concept}
 onChange={(e) => set('concept', e.target.value)}
 placeholder="Ej: Salario neto, Leasing, Alquiler, Seguro Kasko"
 />
 <datalist id="concept-suggestions">
 {conceptSuggestions.map((c) => (
 <option key={c} value={c} />
 ))}
 </datalist>
 </label>

 <label className="block md:col-span-2">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Contraparte (a quién se paga)</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.counterpartyName}
 onChange={(e) => set('counterpartyName', e.target.value)}
 placeholder="Ej: Sixt, BARMER, Bank Deutsches Kraftfahrzeuggewerbe"
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Monto € *</span>
 <input
 type="number"
 step="0.01"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.amount || ''}
 onChange={(e) => set('amount', e.target.value)}
 placeholder="0.00"
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Frecuencia</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.frequency}
 onChange={(e) => set('frequency', e.target.value)}
 >
 {COST_FREQUENCIES.map((f) => (
 <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
 ))}
 </select>
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Día de pago (1–31)</span>
 <input
 type="number"
 min="1"
 max="31"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.dayOfMonth || 1}
 onChange={(e) => set('dayOfMonth', e.target.value)}
 />
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
 return (
 <option key={id} value={id}>{label}</option>
 );
 })}
 </select>
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">
 Proyecto {['vehicle', 'property', 'insurance'].includes(form.ownerType) ? '*' : ''}
 </span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.projectId}
 onChange={(e) => set('projectId', e.target.value)}
 >
 <option value="">— Sin asignar —</option>
 {projects.map((p) => {
 const id = String(p.id || '');
 const label = String(p.nombre || p.name || p.codigo || p.code || id);
 return (
 <option key={id} value={id}>{label}</option>
 );
 })}
 </select>
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Inicio</span>
 <input
 type="date"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.startDate}
 onChange={(e) => set('startDate', e.target.value)}
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Fin (opcional)</span>
 <input
 type="date"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.endDate}
 onChange={(e) => set('endDate', e.target.value)}
 />
 </label>

 <label className="flex items-center gap-3 cursor-pointer md:col-span-2 mt-2">
 <input
 type="checkbox"
 className="h-4 w-4"
 checked={form.active}
 onChange={(e) => set('active', e.target.checked)}
 />
 <span className="text-sm text-[var(--color-fg-1)]">
 Activo (genera instancias mensuales)
 </span>
 </label>
 </div>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Notas</span>
 <textarea
 rows={2}
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.notes}
 onChange={(e) => set('notes', e.target.value)}
 />
 </label>

 {error && <p className="text-sm text-[var(--color-err)]">{error}</p>}
 </form>

 <footer className="px-6 py-4 border-t border-[var(--color-line)] flex justify-end gap-3">
 <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
 <Button variant="primary" icon={Save} loading={submitting} disabled={submitting} onClick={handleSubmit}>
 {editingCost ? 'Guardar cambios' : 'Crear costo'}
 </Button>
 </footer>
 </div>
 </div>
 );
};

export default RecurringCostFormModal;
