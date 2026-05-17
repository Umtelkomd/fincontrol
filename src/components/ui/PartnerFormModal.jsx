import { useState, useEffect } from 'react';
import { X, Save, Loader2, User, Users } from 'lucide-react';
import { TAX_RATES } from '../../constants/config';
import { Button } from '@/components/ui/nexus';

const PartnerFormModal = ({
 isOpen,
 onClose,
 onSubmit,
 editingPartner,
}) => {
 const [submitting, setSubmitting] = useState(false);
 const [errors, setErrors] = useState({});

 const [formData, setFormData] = useState({
 name: '',
 type: 'both',
 legalName: '',
 taxId: '',
 email: '',
 phone: '',
 address: '',
 defaultPaymentMethod: '',
 defaultTaxRate: TAX_RATES.STANDARD,
 notes: '',
 status: 'active',
 });

 useEffect(() => {
 if (!isOpen) return;
 if (editingPartner) {
 setFormData({
 name: editingPartner.name || '',
 type: editingPartner.type || 'both',
 legalName: editingPartner.legalName || '',
 taxId: editingPartner.taxId || '',
 email: editingPartner.email || '',
 phone: editingPartner.phone || '',
 address: editingPartner.address || '',
 defaultPaymentMethod: editingPartner.defaultPaymentMethod || '',
 defaultTaxRate: editingPartner.defaultTaxRate ?? TAX_RATES.STANDARD,
 notes: editingPartner.notes || '',
 status: editingPartner.status || 'active',
 });
 } else {
 setFormData({
 name: '',
 type: 'both',
 legalName: '',
 taxId: '',
 email: '',
 phone: '',
 address: '',
 defaultPaymentMethod: '',
 defaultTaxRate: TAX_RATES.STANDARD,
 notes: '',
 status: 'active',
 });
 }
 setErrors({});
 }, [isOpen, editingPartner]);

 const validate = () => {
 const newErrors = {};
 if (!formData.name.trim()) {
 newErrors.name = 'El nombre es obligatorio';
 } else if (formData.name.trim().length < 2) {
 newErrors.name = 'El nombre debe tener al menos 2 caracteres';
 }
 if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
 newErrors.email = 'Formato de email inválido';
 }
 // German tax IDs: USt-IdNr (EU VAT) is DE + 9 digits, or Steuernummer is 10-11 digits
 if (formData.taxId) {
 const cleanTaxId = formData.taxId.replace(/\s|-/g, '');
 const isUstIdNr = /^DE[0-9]{9}$/.test(cleanTaxId);
 const isSteuernummer = /^[0-9]{10,11}$/.test(cleanTaxId);
 if (!isUstIdNr && !isSteuernummer) {
 newErrors.taxId = 'Formato inválido (DE + 9 dígitos o Steuernummer de 10-11 dígitos)';
 }
 }
 return newErrors;
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 const validationErrors = validate();
 if (Object.keys(validationErrors).length > 0) {
 setErrors(validationErrors);
 return;
 }

 setSubmitting(true);
 try {
 await onSubmit(formData);
 } finally {
 setSubmitting(false);
 }
 };

 const paymentMethods = [
 { value: '', label: 'No especificado' },
 { value: 'Transferencia', label: 'Transferencia bancaria' },
 { value: 'Efectivo', label: 'Efectivo' },
 { value: 'Domiciliación', label: 'Domiciliación (SEPA Lastschrift)' },
 { value: 'Tarjeta', label: 'Tarjeta' },
 { value: 'PayPal', label: 'PayPal' },
 ];

 if (!isOpen) return null;

 return (
 <div
 className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn"
 role="dialog"
 aria-modal="true"
 >
 <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] animate-scaleIn">
 {/* Header */}
 <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-bg-2)] px-6 py-5">
 <div>
 <h3 className="text-xl font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">
 {editingPartner ? 'Editar Geschäftspartner' : 'Nuevo Geschäftspartner'}
 </h3>
 <p className="mt-0.5 text-sm text-[var(--color-fg-3)]">
 {editingPartner
 ? 'Actualiza los datos del socio comercial'
 : 'Ingresa los datos del nuevo socio comercial'}
 </p>
 </div>
 <button
 onClick={onClose}
 className="rounded-lg p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-fg-4)]"
 aria-label="Cerrar"
 >
 <X size={20} />
 </button>
 </div>

 <form onSubmit={handleSubmit} className="p-6 space-y-5">
 {/* Type selector */}
 <div className="grid grid-cols-3 gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] p-1.5">
 {[
 { value: 'vendor', label: 'Proveedor', icon: User },
 { value: 'client', label: 'Cliente', icon: Users },
 { value: 'both', label: 'Ambos', icon: Users },
 ].map(({ value, label, icon: Icon }) => (
 <button
 key={value}
 type="button"
 onClick={() => setFormData({ ...formData, type: value })}
 className={`
 flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-md transition-all
 ${formData.type === value
 ? 'bg-[var(--color-bg-2)] text-[var(--color-fg-1)] '
 : 'text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)]'}
 `}
 >
 <Icon size={16} />
 {label}
 </button>
 ))}
 </div>

 {/* Divider */}
 <div className="flex items-center gap-2 pt-1">
 <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-fg-3)]">
 Datos principales
 </span>
 <div className="h-px flex-1 bg-[var(--color-line)]" />
 </div>

 {/* Name */}
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Nombre <span className="text-[var(--color-accent)]">*</span>
 </label>
 <input
 type="text"
 required
 placeholder="ej. Deutsche Telekom AG"
 className={`w-full rounded-lg border px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition ${
 errors.name
 ? 'border-[var(--color-accent)] bg-transparent'
 : 'border-[var(--color-line)] bg-[var(--color-bg-2)] focus:border-[var(--color-fg-1)]'
 }`}
 value={formData.name}
 onChange={(e) => setFormData({ ...formData, name: e.target.value })}
 />
 {errors.name && (
 <p className="mt-1 text-xs text-[var(--color-accent)]">{errors.name}</p>
 )}
 </div>

 {/* Legal Name */}
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Razón social (opcional)
 </label>
 <input
 type="text"
 placeholder="Nombre legal formal completo"
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.legalName}
 onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
 />
 </div>

 {/* Tax ID */}
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 NIF / USt-IdNr (opcional)
 </label>
 <input
 type="text"
 placeholder="DE123456789 o Steuernummer"
 className={`w-full rounded-lg border px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition ${
 errors.taxId
 ? 'border-[var(--color-accent)] bg-transparent'
 : 'border-[var(--color-line)] bg-[var(--color-bg-2)] focus:border-[var(--color-fg-1)]'
 }`}
 value={formData.taxId}
 onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
 />
 {errors.taxId && (
 <p className="mt-1 text-xs text-[var(--color-accent)]">{errors.taxId}</p>
 )}
 </div>

 {/* Divider */}
 <div className="flex items-center gap-2 pt-1">
 <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-fg-3)]">
 Contacto
 </span>
 <div className="h-px flex-1 bg-[var(--color-line)]" />
 </div>

 {/* Email */}
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Email (opcional)
 </label>
 <input
 type="email"
 placeholder="contacto@empresa.de"
 className={`w-full rounded-lg border px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition ${
 errors.email
 ? 'border-[var(--color-accent)] bg-transparent'
 : 'border-[var(--color-line)] bg-[var(--color-bg-2)] focus:border-[var(--color-fg-1)]'
 }`}
 value={formData.email}
 onChange={(e) => setFormData({ ...formData, email: e.target.value })}
 />
 {errors.email && (
 <p className="mt-1 text-xs text-[var(--color-accent)]">{errors.email}</p>
 )}
 </div>

 {/* Phone */}
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Teléfono (opcional)
 </label>
 <input
 type="tel"
 placeholder="+49 30 xxxxxxx"
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.phone}
 onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
 />
 </div>

 {/* Address */}
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Dirección (opcional)
 </label>
 <textarea
 rows="2"
 placeholder="Calle, número, CP, ciudad"
 className="w-full resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.address}
 onChange={(e) => setFormData({ ...formData, address: e.target.value })}
 />
 </div>

 {/* Divider */}
 <div className="flex items-center gap-2 pt-1">
 <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-fg-3)]">
 Preferencias de pago
 </span>
 <div className="h-px flex-1 bg-[var(--color-line)]" />
 </div>

 {/* Default Payment Method */}
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Método de pago predeterminado
 </label>
 <select
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.defaultPaymentMethod}
 onChange={(e) =>
 setFormData({ ...formData, defaultPaymentMethod: e.target.value })
 }
 >
 {paymentMethods.map((m) => (
 <option key={m.value} value={m.value}>
 {m.label}
 </option>
 ))}
 </select>
 </div>

 {/* Default Tax Rate */}
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Tasa IVA predeterminada
 </label>
 <select
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.defaultTaxRate}
 onChange={(e) =>
 setFormData({ ...formData, defaultTaxRate: parseFloat(e.target.value) })
 }
 >
 <option value={TAX_RATES.STANDARD}>19% Std. (Regular)</option>
 <option value={TAX_RATES.REDUCED}>7% Red. (Reducido)</option>
 <option value={TAX_RATES.ZERO}>0% Ex. (Exento)</option>
 </select>
 </div>

 {/* Notes */}
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Notas (opcional)
 </label>
 <textarea
 rows="2"
 placeholder="Notas internas sobre este socio..."
 className="w-full resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.notes}
 onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
 />
 </div>

 {/* Status toggle (only when editing) */}
 {editingPartner && (
 <div className="flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] p-4">
 <div className="flex items-center gap-2">
 <div className="relative">
 <input
 type="checkbox"
 className="sr-only peer"
 checked={formData.status === 'active'}
 onChange={(e) =>
 setFormData({
 ...formData,
 status: e.target.checked ? 'active' : 'inactive',
 })
 }
 />
 <div className="h-5 w-10 rounded-full bg-[var(--color-line)] transition-colors peer-checked:bg-transparent"></div>
 <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[var(--color-bg-1)] transition-transform peer-checked:translate-x-5"></div>
 </div>
 <span className="text-sm font-medium text-[var(--color-fg-4)]">Activo</span>
 </div>
 <span className="text-xs text-[var(--color-fg-3)]">
 {formData.status === 'active'
 ? 'Este socio aparece en transacciones y autocompletado'
 : 'Inactivo — oculto del autocompletado'}
 </span>
 </div>
 )}

 {/* Action buttons */}
 <div className="flex gap-3 pt-1">
 <button
 type="button"
 onClick={onClose}
 className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] py-3.5 font-medium text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-fg-4)]"
 >
 Cancelar
 </button>
 <Button
 type="submit"
 variant="primary"
 icon={Save}
 loading={submitting}
 disabled={submitting}
 className="flex-[2]"
 >
 {submitting
 ? 'Guardando...'
 : editingPartner
 ? 'Guardar cambios'
 : 'Crear Geschäftspartner'}
 </Button>
 </div>
 </form>
 </div>
 </div>
 );
};

export default PartnerFormModal;
