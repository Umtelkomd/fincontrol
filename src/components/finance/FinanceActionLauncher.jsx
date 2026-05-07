import { useEffect, useMemo, useState } from 'react';
import {
 ArrowDownLeft,
 ArrowUpRight,
 Banknote,
 BriefcaseBusiness,
 CalendarDays,
 FileDown,
 FileUp,
 Loader2,
 WalletCards,
 X,
} from 'lucide-react';
import { usePayables } from '../../hooks/usePayables';
import { useProjects } from '../../hooks/useProjects';
import { useReceivables } from '../../hooks/useReceivables';
import { useBankMovements } from '../../hooks/useBankMovements';
import { useToast } from '../../contexts/ToastContext';
import EmployeePicker from './EmployeePicker';
import { Button } from '@/components/ui/nexus';

// Helper: format a project for the dropdown option label.
// Shows code — name · operator · zone (when available).
const formatProjectOption = (p) => {
 const opLabel = p.operator === 'INSYTE' ? 'Insyte' : p.operator === 'VANCOM' ? 'Vancom' : '';
 const parts = [`${p.code || p.id} — ${p.name || p.displayName || ''}`];
 if (opLabel) parts.push(opLabel);
 if (p.zone) parts.push(p.zone);
 return parts.join(' · ');
};

const ACTIONS = [
 {
 id: 'register-collection',
 title: 'Registrar cobro',
 description: 'Entrada real de dinero, con o sin factura CXC asociada.',
 icon: ArrowUpRight,
 accent: 'var(--color-ok)',
 family: 'Caja real',
 },
 {
 id: 'register-payment',
 title: 'Registrar pago',
 description: 'Salida real de dinero, con o sin factura CXP asociada.',
 icon: ArrowDownLeft,
 accent: 'var(--color-accent)',
 family: 'Caja real',
 },
 {
 id: 'create-receivable',
 title: 'Crear factura CXC',
 description: 'Documento pendiente por cobrar que aun no afecta caja.',
 icon: FileUp,
 accent: 'var(--color-fg-3)',
 family: 'Documento',
 },
 {
 id: 'create-payable',
 title: 'Crear factura CXP',
 description: 'Documento pendiente por pagar que aun no afecta caja.',
 icon: FileDown,
 accent: 'var(--color-warn)',
 family: 'Documento',
 },
 {
 id: 'bank-adjustment',
 title: 'Ajuste bancario',
 description: 'Movimiento directo de tesoreria no ligado a CXC o CXP.',
 icon: WalletCards,
 accent: 'var(--color-fg-3)',
 family: 'Tesorería',
 },
];

const DEFAULT_ACTION_MAP = {
 income: 'create-receivable',
 expense: 'create-payable',
};

const initialIssueDate = () => new Date().toISOString().slice(0, 10);

const resolveProjectName = (projects, projectId) => {
 const project = projects.find((entry) => entry.id === projectId);
 return project?.name || project?.displayName || project?.code || '';
};

const Field = ({ label, children, optional = false }) => (
 <label className="block">
 <span className="mb-2 block label-mono text-[var(--color-fg-4)]">
 {label}
 {optional ? '' : ' *'}
 </span>
 {children}
 </label>
);

const inputClassName =
 'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition-all focus:border-[var(--color-line-s)] focus:bg-[var(--color-bg-1)] focus:';

const accentButtonMap = {
 'register-collection': 'bg-[var(--color-ok)] hover:bg-[var(--color-ok)] ',
 'register-payment': 'bg-[var(--color-accent)] hover:bg-[var(--color-accent)] ',
 'create-receivable': 'bg-[var(--color-fg-3)] hover:opacity-80 ',
 'create-payable': 'bg-[var(--color-warn)] hover:opacity-80 ',
 'bank-adjustment': 'bg-[var(--color-fg-3)] hover:opacity-80 ',
};

const FinanceActionLauncher = ({ isOpen, onClose, user, defaultAction }) => {
 const { showToast } = useToast();
 const { projects } = useProjects(user);
 const { receivables, registerPayment: registerReceivablePayment, createReceivable } = useReceivables(user);
 const { payables, registerPayment: registerPayablePayment, createPayable } = usePayables(user);
 const { createBankMovement } = useBankMovements(user);

 const [activeAction, setActiveAction] = useState(DEFAULT_ACTION_MAP[defaultAction] || defaultAction || ACTIONS[0].id);
 const [submitting, setSubmitting] = useState(false);

 const [receivableForm, setReceivableForm] = useState({
 invoiceNumber: '',
 client: '',
 description: '',
 amount: '',
 issueDate: initialIssueDate(),
 dueDate: initialIssueDate(),
 projectId: '',
 });
 const [payableForm, setPayableForm] = useState({
 invoiceNumber: '',
 vendor: '',
 description: '',
 amount: '',
 issueDate: initialIssueDate(),
 dueDate: initialIssueDate(),
 projectId: '',
 employeeIds: [], // NEW (Phase 2A): technicians the CXP is for
 });
 const [collectionForm, setCollectionForm] = useState({
 receivableId: '',
 amount: '',
 date: initialIssueDate(),
 method: 'Transferencia',
 counterpartyName: '',
 description: '',
 projectId: '',
 note: '',
 });
 const [paymentForm, setPaymentForm] = useState({
 payableId: '',
 amount: '',
 date: initialIssueDate(),
 method: 'Transferencia',
 counterpartyName: '',
 description: '',
 projectId: '',
 note: '',
 employeeIds: [], // NEW (Phase 2A): technicians this payment is for
 });
 const [adjustmentForm, setAdjustmentForm] = useState({
 direction: 'in',
 amount: '',
 date: initialIssueDate(),
 description: '',
 counterpartyName: '',
 projectId: '',
 employeeIds: [], // NEW (Phase 2A): technicians this adjustment is for
 });

 useEffect(() => {
 if (!isOpen) return;
 setActiveAction(DEFAULT_ACTION_MAP[defaultAction] || defaultAction || ACTIONS[0].id);
 }, [defaultAction, isOpen]);

 useEffect(() => {
 if (!isOpen) return undefined;

 const handleKeyDown = (event) => {
 if (event.key === 'Escape') {
 onClose();
 }
 };

 window.addEventListener('keydown', handleKeyDown);
 return () => window.removeEventListener('keydown', handleKeyDown);
 }, [isOpen, onClose]);

 const openReceivables = useMemo(
 () => receivables.filter((entry) => ['issued', 'partial', 'overdue'].includes(entry.status)),
 [receivables],
 );
 const openPayables = useMemo(
 () => payables.filter((entry) => ['issued', 'partial', 'overdue'].includes(entry.status)),
 [payables],
 );

 if (!isOpen) return null;

 const submitReceivable = async () => {
 const projectName = resolveProjectName(projects, receivableForm.projectId);
 const result = await createReceivable({
 ...receivableForm,
 projectName,
 amount: Number(receivableForm.amount),
 });
 if (!result.success) throw new Error('No se pudo crear la factura CXC');
 showToast('Factura CXC creada');
 };

 const submitPayable = async () => {
 const projectName = resolveProjectName(projects, payableForm.projectId);
 const result = await createPayable({
 ...payableForm,
 projectName,
 amount: Number(payableForm.amount),
 employeeIds: payableForm.employeeIds, // NEW (Phase 2A)
 });
 if (!result.success) throw new Error('No se pudo crear la factura CXP');
 showToast('Factura CXP creada');
 };

 const submitCollection = async () => {
 const linkedReceivable = openReceivables.find((entry) => entry.id === collectionForm.receivableId);
 if (linkedReceivable) {
 const result = await registerReceivablePayment(linkedReceivable, {
 amount: Number(collectionForm.amount),
 date: collectionForm.date,
 method: collectionForm.method,
 note: collectionForm.note,
 });
 if (!result.success) throw new Error('No se pudo registrar el cobro');
 } else {
 const projectName = resolveProjectName(projects, collectionForm.projectId);
 const result = await createBankMovement({
 kind: 'collection',
 direction: 'in',
 amount: Number(collectionForm.amount),
 postedDate: collectionForm.date,
 description: collectionForm.description,
 counterpartyName: collectionForm.counterpartyName,
 projectId: collectionForm.projectId,
 projectName,
 });
 if (!result.success) throw new Error('No se pudo registrar el cobro');
 }
 showToast('Cobro registrado');
 };

 const submitPayment = async () => {
 const linkedPayable = openPayables.find((entry) => entry.id === paymentForm.payableId);
 if (linkedPayable) {
 const result = await registerPayablePayment(linkedPayable, {
 amount: Number(paymentForm.amount),
 date: paymentForm.date,
 method: paymentForm.method,
 note: paymentForm.note,
 });
 if (!result.success) throw new Error('No se pudo registrar el pago');
 } else {
 const projectName = resolveProjectName(projects, paymentForm.projectId);
 const result = await createBankMovement({
 kind: 'payment',
 direction: 'out',
 amount: Number(paymentForm.amount),
 postedDate: paymentForm.date,
 description: paymentForm.description,
 counterpartyName: paymentForm.counterpartyName,
 projectId: paymentForm.projectId,
 projectName,
 employeeIds: paymentForm.employeeIds, // NEW (Phase 2A)
 });
 if (!result.success) throw new Error('No se pudo registrar el pago');
 }
 showToast('Pago registrado');
 };

 const submitAdjustment = async () => {
 const projectName = resolveProjectName(projects, adjustmentForm.projectId);
 const result = await createBankMovement({
 kind: 'adjustment',
 direction: adjustmentForm.direction,
 amount: Number(adjustmentForm.amount),
 postedDate: adjustmentForm.date,
 description: adjustmentForm.description,
 counterpartyName: adjustmentForm.counterpartyName,
 projectId: adjustmentForm.projectId,
 projectName,
 employeeIds: adjustmentForm.employeeIds, // NEW (Phase 2A)
 });
 if (!result.success) throw new Error('No se pudo crear el ajuste bancario');
 showToast('Ajuste bancario registrado');
 };

 const handleSubmit = async (event) => {
 event.preventDefault();
 if (submitting) return;

 setSubmitting(true);
 try {
 if (activeAction === 'create-receivable') await submitReceivable();
 if (activeAction === 'create-payable') await submitPayable();
 if (activeAction === 'register-collection') await submitCollection();
 if (activeAction === 'register-payment') await submitPayment();
 if (activeAction === 'bank-adjustment') await submitAdjustment();
 onClose();
 } catch (error) {
 console.error(error);
 showToast(error.message || 'No se pudo completar la operacion', 'error');
 } finally {
 setSubmitting(false);
 }
 };

 const activeMeta = ACTIONS.find((entry) => entry.id === activeAction);
 const submitLabel = activeMeta?.title || 'Guardar registro';
 const submitButtonClassName = accentButtonMap[activeAction] || 'bg-[var(--color-fg-1)] hover:opacity-85 ';

 return (
 <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[var(--color-bg-1)] p-4 ">
 <div className="relative flex max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] ">
 <button
 type="button"
 aria-label="Cerrar panel de registro"
 onClick={onClose}
 className="absolute right-5 top-5 z-10 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-2 text-[var(--color-fg-3)] transition-colors hover:text-[var(--color-fg-1)]"
 >
 <X size={18} />
 </button>

 <aside className="hidden w-[360px] shrink-0 border-r border-[var(--color-line)] bg-[var(--color-bg-0)] p-6 lg:block">
 <div className="mb-8">
 <p className="mb-3 label-mono text-[var(--color-fg-4)]">
 Operación
 </p>
 <h3 className="text-[26px] font-medium tracking-tight text-[var(--color-fg-1)]">Centro operativo</h3>
 <p className="mt-2 text-sm leading-6 text-[var(--color-fg-3)]">
 Registra cobros, pagos, facturas y ajustes desde un solo panel, con una estructura clara para el equipo.
 </p>
 </div>

 <div className="space-y-3">
 {ACTIONS.map((action) => {
 const Icon = action.icon;
 const isActive = action.id === activeAction;
 return (
 <button
 key={action.id}
 type="button"
 onClick={() => setActiveAction(action.id)}
 className={`w-full rounded-md border px-4 py-4 text-left transition-all ${
 isActive
 ? 'border-[var(--color-line-s)] bg-[var(--color-bg-1)] '
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)] hover:bg-[var(--color-bg-1)]'
 }`}
 >
 <div className="mb-3 flex items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <div
 className="flex h-11 w-11 items-center justify-center rounded-lg"
 style={{ backgroundColor: `${action.accent}20`, color: action.accent }}
 >
 <Icon size={18} />
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">{action.title}</p>
 <p className="text-xs text-[var(--color-fg-3)]">{action.description}</p>
 </div>
 </div>
 {isActive && (
 <span className="rounded-full bg-[var(--color-bg-1)] px-2 py-1 label-mono text-[var(--color-fg-1)]">
 Activo
 </span>
 )}
 </div>
 <div className="flex items-center gap-2">
 <div
 className="h-2.5 w-2.5 rounded-full"
 style={{ backgroundColor: action.accent }}
 >
 </div>
 <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-3)]">{action.family}</span>
 </div>
 </button>
 );
 })}
 </div>
 </aside>

 <section className="flex min-h-[760px] flex-1 flex-col overflow-y-auto">
 <div className="border-b border-[var(--color-line)] px-6 py-6 lg:px-8">
 <div className="flex flex-wrap items-center gap-3">
 <div
 className="flex h-12 w-12 items-center justify-center rounded-lg"
 style={{ backgroundColor: `${activeMeta.accent}20`, color: activeMeta.accent }}
 >
 <activeMeta.icon size={20} />
 </div>
 <div className="min-w-0">
 <p className="label-mono text-[var(--color-fg-4)]">
 Flujo activo
 </p>
 <h2 className="text-[24px] font-medium tracking-tight text-[var(--color-fg-1)]">{activeMeta.title}</h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">{activeMeta.description}</p>
 <div className="mt-3 flex flex-wrap items-center gap-2">
 <span className="rounded-full bg-[var(--color-bg-1)] px-3 py-1 label-mono text-[var(--color-fg-1)]">
 {activeMeta.family}
 </span>
 <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-1 label-mono text-[var(--color-fg-3)]">
 Registro guiado
 </span>
 </div>
 </div>
 </div>

 <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:hidden">
 {ACTIONS.map((action) => {
 const Icon = action.icon;
 const isActive = action.id === activeAction;
 return (
 <button
 key={action.id}
 type="button"
 onClick={() => setActiveAction(action.id)}
 className={`rounded-lg border px-4 py-3 text-left transition-all ${
 isActive
 ? 'border-[var(--color-line-s)] bg-[var(--color-bg-1)] '
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)]'
 }`}
 >
 <div className="flex items-start gap-3">
 <div
 className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg"
 style={{ backgroundColor: `${action.accent}20`, color: action.accent }}
 >
 <Icon size={17} />
 </div>
 <div className="min-w-0">
 <p className="text-sm font-medium text-[var(--color-fg-1)]">{action.title}</p>
 <p className="mt-1 text-xs leading-5 text-[var(--color-fg-3)]">{action.description}</p>
 </div>
 </div>
 </button>
 );
 })}
 </div>
 </div>

 <form onSubmit={handleSubmit} className="flex-1 px-6 py-6 lg:px-8">
 <div className="grid gap-5 xl:grid-cols-2">
 {activeAction === 'create-receivable' && (
 <>
 <Field label="Cliente">
 <input
 required
 className={inputClassName}
 value={receivableForm.client}
 onChange={(event) => setReceivableForm((state) => ({ ...state, client: event.target.value }))}
 />
 </Field>
 <Field label="Factura" optional>
 <input
 className={inputClassName}
 value={receivableForm.invoiceNumber}
 onChange={(event) => setReceivableForm((state) => ({ ...state, invoiceNumber: event.target.value }))}
 />
 </Field>
 <Field label="Descripcion">
 <input
 required
 className={inputClassName}
 value={receivableForm.description}
 onChange={(event) => setReceivableForm((state) => ({ ...state, description: event.target.value }))}
 />
 </Field>
 <Field label="Proyecto" optional>
 <select
 className={inputClassName}
 value={receivableForm.projectId}
 onChange={(event) => setReceivableForm((state) => ({ ...state, projectId: event.target.value }))}
 >
 <option value="">Sin proyecto</option>
 {projects.map((project) => (
 <option key={project.id} value={project.id}>
 {formatProjectOption(project)}
 </option>
 ))}
 </select>
 </Field>
 <Field label="Importe">
 <input
 required
 type="number"
 min="0.01"
 step="0.01"
 className={inputClassName}
 value={receivableForm.amount}
 onChange={(event) => setReceivableForm((state) => ({ ...state, amount: event.target.value }))}
 />
 </Field>
 <Field label="Fecha emision">
 <input
 required
 type="date"
 className={inputClassName}
 value={receivableForm.issueDate}
 onChange={(event) => setReceivableForm((state) => ({ ...state, issueDate: event.target.value }))}
 />
 </Field>
 <Field label="Vencimiento">
 <input
 required
 type="date"
 className={inputClassName}
 value={receivableForm.dueDate}
 onChange={(event) => setReceivableForm((state) => ({ ...state, dueDate: event.target.value }))}
 />
 </Field>
 </>
 )}

 {activeAction === 'create-payable' && (
 <>
 <Field label="Proveedor">
 <input
 required
 className={inputClassName}
 value={payableForm.vendor}
 onChange={(event) => setPayableForm((state) => ({ ...state, vendor: event.target.value }))}
 />
 </Field>
 <Field label="Factura" optional>
 <input
 className={inputClassName}
 value={payableForm.invoiceNumber}
 onChange={(event) => setPayableForm((state) => ({ ...state, invoiceNumber: event.target.value }))}
 />
 </Field>
 <Field label="Descripcion">
 <input
 required
 className={inputClassName}
 value={payableForm.description}
 onChange={(event) => setPayableForm((state) => ({ ...state, description: event.target.value }))}
 />
 </Field>
 <Field label="Proyecto" optional>
 <select
 className={inputClassName}
 value={payableForm.projectId}
 onChange={(event) => setPayableForm((state) => ({ ...state, projectId: event.target.value }))}
 >
 <option value="">Sin proyecto</option>
 {projects.map((project) => (
 <option key={project.id} value={project.id}>
 {formatProjectOption(project)}
 </option>
 ))}
 </select>
 </Field>
 <Field label="Importe">
 <input
 required
 type="number"
 min="0.01"
 step="0.01"
 className={inputClassName}
 value={payableForm.amount}
 onChange={(event) => setPayableForm((state) => ({ ...state, amount: event.target.value }))}
 />
 </Field>
 <Field label="Fecha emision">
 <input
 required
 type="date"
 className={inputClassName}
 value={payableForm.issueDate}
 onChange={(event) => setPayableForm((state) => ({ ...state, issueDate: event.target.value }))}
 />
 </Field>
 <Field label="Vencimiento">
 <input
 required
 type="date"
 className={inputClassName}
 value={payableForm.dueDate}
 onChange={(event) => setPayableForm((state) => ({ ...state, dueDate: event.target.value }))}
 />
 </Field>
 <div className="xl:col-span-2">
 <EmployeePicker
 user={user}
 value={payableForm.employeeIds}
 onChange={(ids) => setPayableForm((state) => ({ ...state, employeeIds: ids }))}
 />
 </div>
 </>
 )}

 {activeAction === 'register-collection' && (
 <>
 <Field label="Factura asociada" optional>
 <select
 className={inputClassName}
 value={collectionForm.receivableId}
 onChange={(event) => {
 const receivableId = event.target.value;
 const linked = openReceivables.find((entry) => entry.id === receivableId);
 setCollectionForm((state) => ({
 ...state,
 receivableId,
 counterpartyName: linked?.counterpartyName || state.counterpartyName,
 description: linked?.description || state.description,
 projectId: linked?.projectId || state.projectId,
 amount: linked ? String(linked.openAmount) : state.amount,
 }));
 }}
 >
 <option value="">Cobro libre</option>
 {openReceivables.map((entry) => (
 <option key={entry.id} value={entry.id}>
 {entry.counterpartyName} · {entry.documentNumber || 'Sin factura'} · {entry.openAmount.toFixed(2)} EUR
 </option>
 ))}
 </select>
 </Field>
 <Field label="Importe">
 <input
 required
 type="number"
 min="0.01"
 step="0.01"
 className={inputClassName}
 value={collectionForm.amount}
 onChange={(event) => setCollectionForm((state) => ({ ...state, amount: event.target.value }))}
 />
 </Field>
 <Field label="Fecha">
 <input
 required
 type="date"
 className={inputClassName}
 value={collectionForm.date}
 onChange={(event) => setCollectionForm((state) => ({ ...state, date: event.target.value }))}
 />
 </Field>
 <Field label="Metodo">
 <select
 className={inputClassName}
 value={collectionForm.method}
 onChange={(event) => setCollectionForm((state) => ({ ...state, method: event.target.value }))}
 >
 <option>Transferencia</option>
 <option>Efectivo</option>
 <option>Tarjeta</option>
 </select>
 </Field>
 <Field label="Contraparte">
 <input
 required={!collectionForm.receivableId}
 className={inputClassName}
 value={collectionForm.counterpartyName}
 onChange={(event) =>
 setCollectionForm((state) => ({ ...state, counterpartyName: event.target.value }))
 }
 />
 </Field>
 <Field label="Descripcion">
 <input
 required
 className={inputClassName}
 value={collectionForm.description}
 onChange={(event) => setCollectionForm((state) => ({ ...state, description: event.target.value }))}
 />
 </Field>
 <Field label="Proyecto" optional>
 <select
 className={inputClassName}
 value={collectionForm.projectId}
 onChange={(event) => setCollectionForm((state) => ({ ...state, projectId: event.target.value }))}
 >
 <option value="">Sin proyecto</option>
 {projects.map((project) => (
 <option key={project.id} value={project.id}>
 {formatProjectOption(project)}
 </option>
 ))}
 </select>
 </Field>
 </>
 )}

 {activeAction === 'register-payment' && (
 <>
 <Field label="Factura asociada" optional>
 <select
 className={inputClassName}
 value={paymentForm.payableId}
 onChange={(event) => {
 const payableId = event.target.value;
 const linked = openPayables.find((entry) => entry.id === payableId);
 setPaymentForm((state) => ({
 ...state,
 payableId,
 counterpartyName: linked?.counterpartyName || state.counterpartyName,
 description: linked?.description || state.description,
 projectId: linked?.projectId || state.projectId,
 // NEW (Phase 2A): inherit technicians from the linked CXP. User can still
 // edit them after pre-fill if the payment covers a different subset.
 employeeIds: Array.isArray(linked?.employeeIds) && linked.employeeIds.length > 0
 ? linked.employeeIds
 : state.employeeIds,
 amount: linked ? String(linked.openAmount) : state.amount,
 }));
 }}
 >
 <option value="">Pago libre</option>
 {openPayables.map((entry) => (
 <option key={entry.id} value={entry.id}>
 {entry.counterpartyName} · {entry.documentNumber || 'Sin factura'} · {entry.openAmount.toFixed(2)} EUR
 </option>
 ))}
 </select>
 </Field>
 <Field label="Importe">
 <input
 required
 type="number"
 min="0.01"
 step="0.01"
 className={inputClassName}
 value={paymentForm.amount}
 onChange={(event) => setPaymentForm((state) => ({ ...state, amount: event.target.value }))}
 />
 </Field>
 <Field label="Fecha">
 <input
 required
 type="date"
 className={inputClassName}
 value={paymentForm.date}
 onChange={(event) => setPaymentForm((state) => ({ ...state, date: event.target.value }))}
 />
 </Field>
 <Field label="Metodo">
 <select
 className={inputClassName}
 value={paymentForm.method}
 onChange={(event) => setPaymentForm((state) => ({ ...state, method: event.target.value }))}
 >
 <option>Transferencia</option>
 <option>Efectivo</option>
 <option>Tarjeta</option>
 </select>
 </Field>
 <Field label="Contraparte">
 <input
 required={!paymentForm.payableId}
 className={inputClassName}
 value={paymentForm.counterpartyName}
 onChange={(event) => setPaymentForm((state) => ({ ...state, counterpartyName: event.target.value }))}
 />
 </Field>
 <Field label="Descripcion">
 <input
 required
 className={inputClassName}
 value={paymentForm.description}
 onChange={(event) => setPaymentForm((state) => ({ ...state, description: event.target.value }))}
 />
 </Field>
 <Field label="Proyecto" optional>
 <select
 className={inputClassName}
 value={paymentForm.projectId}
 onChange={(event) => setPaymentForm((state) => ({ ...state, projectId: event.target.value }))}
 >
 <option value="">Sin proyecto</option>
 {projects.map((project) => (
 <option key={project.id} value={project.id}>
 {formatProjectOption(project)}
 </option>
 ))}
 </select>
 </Field>
 <div className="xl:col-span-2">
 <EmployeePicker
 user={user}
 value={paymentForm.employeeIds}
 onChange={(ids) => setPaymentForm((state) => ({ ...state, employeeIds: ids }))}
 />
 </div>
 </>
 )}

 {activeAction === 'bank-adjustment' && (
 <>
 <Field label="Direccion">
 <select
 className={inputClassName}
 value={adjustmentForm.direction}
 onChange={(event) => setAdjustmentForm((state) => ({ ...state, direction: event.target.value }))}
 >
 <option value="in">Entrada</option>
 <option value="out">Salida</option>
 </select>
 </Field>
 <Field label="Importe">
 <input
 required
 type="number"
 min="0.01"
 step="0.01"
 className={inputClassName}
 value={adjustmentForm.amount}
 onChange={(event) => setAdjustmentForm((state) => ({ ...state, amount: event.target.value }))}
 />
 </Field>
 <Field label="Fecha">
 <input
 required
 type="date"
 className={inputClassName}
 value={adjustmentForm.date}
 onChange={(event) => setAdjustmentForm((state) => ({ ...state, date: event.target.value }))}
 />
 </Field>
 <Field label="Descripcion">
 <input
 required
 className={inputClassName}
 value={adjustmentForm.description}
 onChange={(event) => setAdjustmentForm((state) => ({ ...state, description: event.target.value }))}
 />
 </Field>
 <Field label="Contraparte" optional>
 <input
 className={inputClassName}
 value={adjustmentForm.counterpartyName}
 onChange={(event) =>
 setAdjustmentForm((state) => ({ ...state, counterpartyName: event.target.value }))
 }
 />
 </Field>
 <Field label="Proyecto" optional>
 <select
 className={inputClassName}
 value={adjustmentForm.projectId}
 onChange={(event) => setAdjustmentForm((state) => ({ ...state, projectId: event.target.value }))}
 >
 <option value="">Sin proyecto</option>
 {projects.map((project) => (
 <option key={project.id} value={project.id}>
 {formatProjectOption(project)}
 </option>
 ))}
 </select>
 </Field>
 <div className="xl:col-span-2">
 <EmployeePicker
 user={user}
 value={adjustmentForm.employeeIds}
 onChange={(ids) => setAdjustmentForm((state) => ({ ...state, employeeIds: ids }))}
 />
 </div>
 </>
 )}
 </div>

 <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-4">
 <div className="flex items-center gap-3 text-[var(--color-fg-3)]">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-bg-1)] text-[var(--color-fg-1)]">
 <CalendarDays size={16} />
 </div>
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Registro operativo</p>
 <p className="text-xs">Confirma el flujo activo y guarda el registro con el botón principal.</p>
 </div>
 </div>
 <div className="flex gap-3">
 <button
 type="button"
 onClick={onClose}
 className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3 text-sm font-medium text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-bg-1)] hover:text-[var(--color-fg-1)]"
 >
 Cancelar
 </button>
 <Button
 type="submit"
 variant="primary"
 icon={BriefcaseBusiness}
 loading={submitting}
 disabled={submitting}
 >
 {submitting ? 'Guardando...' : submitLabel}
 </Button>
 </div>
 </div>
 </form>
 </section>
 </div>
 </div>
 );
};

export default FinanceActionLauncher;
