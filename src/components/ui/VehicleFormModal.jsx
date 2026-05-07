import { useState, useEffect } from 'react';
import { X, Save, Car } from 'lucide-react';
import { vehicleDefaults, VEHICLE_TYPES, VEHICLE_STATUSES } from '../../finance/assetSchemas';
import { Button } from '@/components/ui/nexus';

const TYPE_LABELS = { owned: 'Propio', leased: 'Leasing', rented: 'Alquilado' };
const STATUS_LABELS = { active: 'Activo', maintenance: 'Mantenimiento', inactive: 'Inactivo' };

const VehicleFormModal = ({ isOpen, onClose, onSubmit, editingVehicle, drivers = [] }) => {
 const [form, setForm] = useState(vehicleDefaults());
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState('');

 useEffect(() => {
 if (isOpen) {
 setForm(editingVehicle ? { ...vehicleDefaults(), ...editingVehicle } : vehicleDefaults());
 setError('');
 }
 }, [isOpen, editingVehicle]);

 if (!isOpen) return null;

 const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

 const handleSubmit = async (e) => {
 e.preventDefault();
 if (!form.name.trim()) {
 setError('El nombre es obligatorio');
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
 <Car size={18} className="text-[var(--color-fg-4)]" />
 <h2 className="text-lg font-medium text-[var(--color-fg-1)]">
 {editingVehicle ? 'Editar vehículo' : 'Nuevo vehículo'}
 </h2>
 </div>
 <button type="button" onClick={onClose} className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)]">
 <X size={20} />
 </button>
 </header>

 <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 flex-1 space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Nombre *</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={form.name}
 onChange={(e) => set('name', e.target.value)}
 placeholder="Ej: Trafic, Opel Combo"
 autoFocus
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Modelo</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.model}
 onChange={(e) => set('model', e.target.value)}
 placeholder="Ej: Renault Trafic 2.0 dCi"
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Matrícula</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none uppercase"
 value={form.plate}
 onChange={(e) => set('plate', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Tipo</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.type}
 onChange={(e) => set('type', e.target.value)}
 >
 {VEHICLE_TYPES.map((t) => (
 <option key={t} value={t}>{TYPE_LABELS[t]}</option>
 ))}
 </select>
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Estado</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.status}
 onChange={(e) => set('status', e.target.value)}
 >
 {VEHICLE_STATUSES.map((s) => (
 <option key={s} value={s}>{STATUS_LABELS[s]}</option>
 ))}
 </select>
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Conductor asignado</span>
 {drivers.length > 0 ? (
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.assignedDriver}
 onChange={(e) => set('assignedDriver', e.target.value)}
 >
 <option value="">— Sin asignar —</option>
 {drivers.map((d) => (
 <option key={d} value={d}>{d}</option>
 ))}
 </select>
 ) : (
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.assignedDriver}
 onChange={(e) => set('assignedDriver', e.target.value)}
 />
 )}
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Km inicial</span>
 <input
 type="number"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.initialKm || ''}
 onChange={(e) => set('initialKm', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Km actual</span>
 <input
 type="number"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.currentKm || ''}
 onChange={(e) => set('currentKm', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Inicio leasing/alquiler</span>
 <input
 type="date"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.leaseStart}
 onChange={(e) => set('leaseStart', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Fin leasing/alquiler</span>
 <input
 type="date"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.leaseEnd}
 onChange={(e) => set('leaseEnd', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Presupuesto combustible/mes (€)</span>
 <input
 type="number"
 step="0.01"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.fuelBudgetMonthly || ''}
 onChange={(e) => set('fuelBudgetMonthly', e.target.value)}
 placeholder="500.00"
 />
 </label>
 </div>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Notas</span>
 <textarea
 rows={3}
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
 {editingVehicle ? 'Guardar cambios' : 'Crear vehículo'}
 </Button>
 </footer>
 </div>
 </div>
 );
};

export default VehicleFormModal;
