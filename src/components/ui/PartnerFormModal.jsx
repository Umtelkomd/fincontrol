import { useState, useEffect } from 'react';
import { X, Save, Loader2, User, Users } from 'lucide-react';
import { TAX_RATES } from '../../constants/config';

const PartnerFormModal = ({
  isOpen,
  onClose,
  onSubmit,
  editingPartner,
  user,
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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[30px] border border-[#dce6f8] bg-[rgba(255,255,255,0.96)] shadow-[0_35px_120px_rgba(15,23,42,0.24)] animate-scaleIn">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e2ebfb] bg-[rgba(245,248,255,0.94)] px-6 py-5">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-[#1f2a44]">
              {editingPartner ? 'Editar Geschäftspartner' : 'Nuevo Geschäftspartner'}
            </h3>
            <p className="mt-0.5 text-sm text-[#6b7a99]">
              {editingPartner
                ? 'Actualiza los datos del socio comercial'
                : 'Ingresa los datos del nuevo socio comercial'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl p-2 text-[#7a879d] transition hover:bg-[rgba(94,115,159,0.08)] hover:text-[#5f6f8d]"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Type selector */}
          <div className="grid grid-cols-3 gap-3 rounded-[22px] border border-[#dce6f8] bg-[rgba(245,248,255,0.94)] p-1.5">
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
                  flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl transition-all
                  ${formData.type === value
                    ? 'bg-white text-[#3156d3] shadow-sm'
                    : 'text-[#6b7a99] hover:text-[#1f2a44]'}
                `}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#93a0b6]">
              Datos principales
            </span>
            <div className="h-px flex-1 bg-[#e2ebfb]" />
          </div>

          {/* Name */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Nombre <span className="text-[#ff453a]">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="ej. Deutsche Telekom AG"
              className={`w-full rounded-2xl border px-4 py-3 text-sm text-[#22304f] outline-none transition focus:ring-2 focus:ring-[rgba(59,130,246,0.12)] ${
                errors.name
                  ? 'border-[#ff453a] bg-[rgba(255,69,58,0.04)]'
                  : 'border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] focus:border-[#7aa2ff]'
              }`}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-[#ff453a]">{errors.name}</p>
            )}
          </div>

          {/* Legal Name */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Razón social (opcional)
            </label>
            <input
              type="text"
              placeholder="Nombre legal formal completo"
              className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
              value={formData.legalName}
              onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
            />
          </div>

          {/* Tax ID */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              NIF / USt-IdNr (opcional)
            </label>
            <input
              type="text"
              placeholder="DE123456789 o Steuernummer"
              className={`w-full rounded-2xl border px-4 py-3 text-sm text-[#22304f] outline-none transition focus:ring-2 focus:ring-[rgba(59,130,246,0.12)] ${
                errors.taxId
                  ? 'border-[#ff453a] bg-[rgba(255,69,58,0.04)]'
                  : 'border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] focus:border-[#7aa2ff]'
              }`}
              value={formData.taxId}
              onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
            />
            {errors.taxId && (
              <p className="mt-1 text-xs text-[#ff453a]">{errors.taxId}</p>
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#93a0b6]">
              Contacto
            </span>
            <div className="h-px flex-1 bg-[#e2ebfb]" />
          </div>

          {/* Email */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Email (opcional)
            </label>
            <input
              type="email"
              placeholder="contacto@empresa.de"
              className={`w-full rounded-2xl border px-4 py-3 text-sm text-[#22304f] outline-none transition focus:ring-2 focus:ring-[rgba(59,130,246,0.12)] ${
                errors.email
                  ? 'border-[#ff453a] bg-[rgba(255,69,58,0.04)]'
                  : 'border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] focus:border-[#7aa2ff]'
              }`}
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-[#ff453a]">{errors.email}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Teléfono (opcional)
            </label>
            <input
              type="tel"
              placeholder="+49 30 xxxxxxx"
              className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>

          {/* Address */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Dirección (opcional)
            </label>
            <textarea
              rows="2"
              placeholder="Calle, número, CP, ciudad"
              className="w-full resize-none rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#93a0b6]">
              Preferencias de pago
            </span>
            <div className="h-px flex-1 bg-[#e2ebfb]" />
          </div>

          {/* Default Payment Method */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Método de pago predeterminado
            </label>
            <select
              className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
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
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Tasa IVA predeterminada
            </label>
            <select
              className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
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
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Notas (opcional)
            </label>
            <textarea
              rows="2"
              placeholder="Notas internas sobre este socio..."
              className="w-full resize-none rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          {/* Status toggle (only when editing) */}
          {editingPartner && (
            <div className="flex items-center gap-3 rounded-2xl border border-[#dce6f8] bg-[rgba(245,248,255,0.94)] p-4">
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
                  <div className="h-5 w-10 rounded-full bg-[#d7e3f6] transition-colors peer-checked:bg-[rgba(15,159,110,0.24)]"></div>
                  <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"></div>
                </div>
                <span className="text-sm font-semibold text-[#4b5d83]">Activo</span>
              </div>
              <span className="text-xs text-[#70819f]">
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
              className="flex-1 rounded-2xl border border-[#d8e3f7] bg-[rgba(245,248,255,0.94)] py-3.5 font-semibold text-[#6b7a99] transition hover:bg-[rgba(94,115,159,0.08)] hover:text-[#5f6f8d]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`
                flex-[2] flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-white
                transition-all duration-200 shadow-lg
                bg-[#3156d3] hover:bg-[#2644b8]
                ${submitting ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-xl'}
              `}
            >
              {submitting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Save size={18} />
              )}
              {submitting
                ? 'Guardando...'
                : editingPartner
                ? 'Guardar cambios'
                : 'Crear Geschäftspartner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PartnerFormModal;
