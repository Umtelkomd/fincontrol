import { useState, useEffect, useMemo } from 'react';
import { X, Save, HardHat, Briefcase, Wallet } from 'lucide-react';
import { useProjects } from '../../hooks/useProjects';
import {
 employeeDefaults,
 EMPLOYEE_TYPES,
 EMPLOYEE_STATUSES,
 TAX_CLASSES,
 KRANKENKASSEN,
} from '../../finance/assetSchemas';
import { Button } from '@/components/ui/nexus';

const TYPE_LABELS = {
 internal: 'Interno (con nómina)',
 external: 'Externo (sin nómina)',
 contractor: 'Contratista (factura)',
};

const STATUS_LABELS = {
 active: 'Activo',
 'on-leave': 'Permiso',
 inactive: 'Inactivo',
};

/**
 * EmployeeFormModal — create/edit employees.
 *
 * Internal employees show full payroll section (IBAN/BIC/StKl/Krankenkasse +
 * Brutto/Netto/Lst+KiSt/SV-AN/SV-AG/Gesamtkosten). External and contractor
 * types show only basic identity + bank for payments.
 */
const EmployeeFormModal = ({ isOpen, onClose, onSubmit, editingEmployee, user }) => {
 const { projects } = useProjects(user);

 const [form, setForm] = useState(employeeDefaults());
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState('');
 const [section, setSection] = useState('basic'); // basic | payroll | assignment

 useEffect(() => {
 if (isOpen) {
 setForm(editingEmployee ? { ...employeeDefaults(), ...editingEmployee } : employeeDefaults());
 setError('');
 setSection('basic');
 }
 }, [isOpen, editingEmployee]);

 const activeProjects = useMemo(
 () => projects.filter((p) => p.active !== false && p.activo !== false),
 [projects],
 );

 if (!isOpen) return null;

 const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
 const isInternal = form.type === 'internal';

 const handleSubmit = async (e) => {
 e?.preventDefault?.();
 const fullName = (form.fullName || `${form.firstName} ${form.lastName}`).trim();
 if (!fullName) {
 setError('El nombre completo es obligatorio');
 setSection('basic');
 return;
 }
 setSubmitting(true);
 const result = await onSubmit({ ...form, fullName });
 setSubmitting(false);
 if (result?.success) onClose();
 else setError(result?.error?.message || 'Error al guardar');
 };

 const toggleProject = (projectId) => {
 const current = Array.isArray(form.projectIds) ? form.projectIds : [];
 const next = current.includes(projectId)
 ? current.filter((id) => id !== projectId)
 : [...current, projectId];
 set('projectIds', next);
 };

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn" onClick={onClose}>
 <div className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
 <header className="px-6 py-4 border-b border-[var(--color-line)] flex items-center justify-between">
 <div className="flex items-center gap-3">
 <HardHat size={18} className="text-[var(--color-fg-4)]" />
 <h2 className="text-lg font-medium text-[var(--color-fg-1)]">
 {editingEmployee ? 'Editar empleado' : 'Nuevo empleado'}
 </h2>
 </div>
 <button type="button" onClick={onClose} className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)]">
 <X size={20} />
 </button>
 </header>

 {/* Tabs */}
 <div className="px-6 border-b border-[var(--color-line)]">
 <div className="nx-tabs">
 <button type="button" onClick={() => setSection('basic')} className={`nx-tab ${section === 'basic' ? 'active' : ''}`}>
 Datos básicos
 </button>
 {isInternal && (
 <button type="button" onClick={() => setSection('payroll')} className={`nx-tab ${section === 'payroll' ? 'active' : ''}`}>
 Nómina
 </button>
 )}
 <button type="button" onClick={() => setSection('assignment')} className={`nx-tab ${section === 'assignment' ? 'active' : ''}`}>
 Asignación
 </button>
 </div>
 </div>

 <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 flex-1 space-y-4">
 {/* ───── BASIC ───── */}
 {section === 'basic' && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <label className="block md:col-span-2">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Nombre completo *</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={form.fullName}
 onChange={(e) => set('fullName', e.target.value)}
 placeholder="Ej: Juan Dios Lesmes Linares"
 autoFocus
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Nombre</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.firstName}
 onChange={(e) => set('firstName', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Apellidos</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.lastName}
 onChange={(e) => set('lastName', e.target.value)}
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Tipo *</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.type}
 onChange={(e) => set('type', e.target.value)}
 >
 {EMPLOYEE_TYPES.map((t) => (
 <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
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
 {EMPLOYEE_STATUSES.map((s) => (
 <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
 ))}
 </select>
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Cargo / Rol</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.role}
 onChange={(e) => set('role', e.target.value)}
 placeholder="Ej: Técnico, Administración, Dirección"
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Email</span>
 <input
 type="email"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.email}
 onChange={(e) => set('email', e.target.value)}
 />
 </label>

 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Teléfono</span>
 <input
 type="tel"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.phone}
 onChange={(e) => set('phone', e.target.value)}
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
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Fin (si aplica)</span>
 <input
 type="date"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.endDate}
 onChange={(e) => set('endDate', e.target.value)}
 />
 </label>

 <label className="block md:col-span-2">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Aliases (separados por coma)</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={Array.isArray(form.aliases) ? form.aliases.join(', ') : ''}
 onChange={(e) => set('aliases', e.target.value.split(',').map((a) => a.trim()).filter(Boolean))}
 placeholder="Ej: Pedro, P. Pizarro"
 />
 </label>

 <label className="block md:col-span-2">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Notas</span>
 <textarea
 rows={3}
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.notes}
 onChange={(e) => set('notes', e.target.value)}
 />
 </label>
 </div>
 )}

 {/* ───── PAYROLL (solo internos) ───── */}
 {section === 'payroll' && isInternal && (
 <div className="space-y-5">
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
 <p className="label-mono text-[var(--color-fg-3)] flex items-center gap-2">
 <Wallet size={14} /> Datos bancarios
 </p>
 <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">IBAN</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono uppercase"
 value={form.iban}
 onChange={(e) => set('iban', e.target.value)}
 placeholder="DE00 0000 0000 0000 0000 00"
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">BIC</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono uppercase"
 value={form.bic}
 onChange={(e) => set('bic', e.target.value)}
 />
 </label>
 </div>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
 <p className="label-mono text-[var(--color-fg-3)] flex items-center gap-2">
 <Briefcase size={14} /> Datos fiscales y SS
 </p>
 <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Steuerklasse (StKl)</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.taxClass}
 onChange={(e) => set('taxClass', e.target.value)}
 >
 <option value="">— Sin asignar —</option>
 {TAX_CLASSES.map((t) => (
 <option key={t} value={t}>{t}</option>
 ))}
 </select>
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Krankenkasse</span>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.krankenkasse}
 onChange={(e) => set('krankenkasse', e.target.value)}
 >
 <option value="">— Sin asignar —</option>
 {KRANKENKASSEN.map((k) => (
 <option key={k} value={k}>{k}</option>
 ))}
 </select>
 </label>
 </div>
 </div>

 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
 <p className="label-mono text-[var(--color-fg-3)]">Salario mensual €</p>
 <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-4">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Brutto</span>
 <input
 type="number"
 step="0.01"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.bruttoMonthly || ''}
 onChange={(e) => set('bruttoMonthly', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Netto (al empleado)</span>
 <input
 type="number"
 step="0.01"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.nettoMonthly || ''}
 onChange={(e) => set('nettoMonthly', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">LSt + KiSt</span>
 <input
 type="number"
 step="0.01"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.lstKistMonthly || ''}
 onChange={(e) => set('lstKistMonthly', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">SV-AN</span>
 <input
 type="number"
 step="0.01"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.svAnMonthly || ''}
 onChange={(e) => set('svAnMonthly', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">SV-AG</span>
 <input
 type="number"
 step="0.01"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.svAgMonthly || ''}
 onChange={(e) => set('svAgMonthly', e.target.value)}
 />
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Gesamtkosten</span>
 <input
 type="number"
 step="0.01"
 min="0"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
 value={form.gesamtkostenMonthly || ''}
 onChange={(e) => set('gesamtkostenMonthly', e.target.value)}
 />
 </label>
 </div>
 <p className="mt-3 text-[11px] text-[var(--color-fg-4)] leading-relaxed">
 Estos valores son referencia. Los pagos reales se generan desde
 <span className="text-[var(--color-fg-3)]"> Costos recurrentes</span> con
 reglas tipo "Salario neto" / "SV BARMER" / etc.
 </p>
 </div>
 </div>
 )}

 {/* ───── ASSIGNMENT ───── */}
 {section === 'assignment' && (
 <div className="space-y-4">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Centro de costo por defecto</span>
 <input
 type="text"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
 value={form.defaultCostCenter}
 onChange={(e) => set('defaultCostCenter', e.target.value)}
 placeholder="Ej: CC-NOM, CC-OPE, OPE"
 />
 </label>

 <div>
 <span className="mb-2 block label-mono text-[var(--color-fg-4)]">Proyectos asignados</span>
 {activeProjects.length === 0 ? (
 <p className="text-[12px] text-[var(--color-fg-4)] italic">No hay proyectos activos para asignar.</p>
 ) : (
 <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
 {activeProjects.map((p) => {
 const checked = (form.projectIds || []).includes(p.id);
 return (
 <label key={p.id} className="flex items-center gap-2 cursor-pointer text-[13px] text-[var(--color-fg-1)]">
 <input
 type="checkbox"
 checked={checked}
 onChange={() => toggleProject(p.id)}
 className="h-4 w-4"
 />
 <span className="truncate">{p.nombre || p.name || p.codigo || p.code || p.id}</span>
 </label>
 );
 })}
 </div>
 )}
 </div>
 </div>
 )}

 {error && <p className="text-sm text-[var(--color-err)]">{error}</p>}
 </form>

 <footer className="px-6 py-4 border-t border-[var(--color-line)] flex justify-end gap-3">
 <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
 <Button variant="primary" icon={Save} loading={submitting} disabled={submitting} onClick={handleSubmit}>
 {editingEmployee ? 'Guardar cambios' : 'Crear empleado'}
 </Button>
 </footer>
 </div>
 </div>
 );
};

export default EmployeeFormModal;
