import { useState, useEffect } from 'react';
import { X, Save, Loader2, Home } from 'lucide-react';
import { propertyDefaults, PROPERTY_TYPES, PROPERTY_USES } from '../../finance/assetSchemas';
import { Button } from '@/components/ui/nexus';

const PropertyFormModal = ({ isOpen, onClose, onSubmit, editingProperty }) => {
 const [form, setForm] = useState(propertyDefaults());
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState('');

 useEffect(() => {
 if (isOpen) {
 setForm(editingProperty ? { ...propertyDefaults(), ...editingProperty } : propertyDefaults());
 setError('');
 }
 }, [isOpen, editingProperty]);

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
 <Home size={18} className="text-[var(--color-fg-4)]" />
 <h2 className="text-lg font-medium text-[var(--color-fg-1)]">
 {editingProperty ? 'Editar vivienda' : 'Nueva vivienda'}
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
 placeholder="Ej: Apto Bassendorf"
 autoFocus
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Tipo</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.type}
 onChange={(e) => set('type', e.target.value)}
 >
 {PROPERTY_TYPES.map((t) => (
 <option key={t} value={t}>{t === 'rented' ? 'Alquilada' : t === 'owned' ? 'Propia' : 'Mixta'}</option>
 ))}
 </select>
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Uso</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.use}
 onChange={(e) => set('use', e.target.value)}
 >
 {PROPERTY_USES.map((u) => (
 <option key={u} value={u}>{u === 'housing' ? 'Vivienda' : u === 'office' ? 'Oficina' : u === 'storage' ? 'Almacén' : 'Mixto'}</option>
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
 <option value="active">Activa</option>
 <option value="inactive">Inactiva</option>
 </select>
 </label>
 <label className="block md:col-span-2">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Dirección</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.address}
 onChange={(e) => set('address', e.target.value)}
 placeholder="Ej: Bassendorf 21"
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Ciudad</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.city}
 onChange={(e) => set('city', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Código postal</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.postalCode}
 onChange={(e) => set('postalCode', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">m²</span>
 <input
 type="number"
 step="0.1"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.m2 || ''}
 onChange={(e) => set('m2', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Habitaciones</span>
 <input
 type="number"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.bedrooms || ''}
 onChange={(e) => set('bedrooms', e.target.value)}
 />
 </label>
 <label className="block md:col-span-2">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Propietario / Inquilino contraparte</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.landlordOrOwner}
 onChange={(e) => set('landlordOrOwner', e.target.value)}
 placeholder="Nombre que aparece en el banco al pagar"
 />
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
 {editingProperty ? 'Guardar cambios' : 'Crear vivienda'}
 </Button>
 </footer>
 </div>
 </div>
 );
};

export default PropertyFormModal;
