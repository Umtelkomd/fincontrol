import { useState, useEffect, useRef, useMemo } from 'react';
import { X, ArrowUpCircle, ArrowDownCircle, Save, Loader2, RefreshCw, Calculator, UserPlus, Building2, HardHat } from 'lucide-react';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../constants/categories';
import { useProjects } from '../../hooks/useProjects';
import { usePartners } from '../../hooks/usePartners';
import { useEmployees } from '../../hooks/useEmployees';
import { TAX_RATES } from '../../constants/config';
import { formatCurrency, formatTaxRate } from '../../utils/formatters';
import { Button } from '@/components/ui/nexus';

const TransactionFormModal = ({
 isOpen,
 onClose,
 onSubmit,
 editingTransaction,
 user,
 expenseCategories = EXPENSE_CATEGORIES,
 incomeCategories = INCOME_CATEGORIES,
 costCenters = [],
 transactions = [],
 defaultType = null
}) => {
 const { projects, loading: projectsLoading } = useProjects(user);
 const { partners, loading: partnersLoading } = usePartners(user);
 const { employees, loading: employeesLoading } = useEmployees(user);

 const [submitting, setSubmitting] = useState(false);

 const [formData, setFormData] = useState({
 date: new Date().toISOString().split('T')[0],
 description: '',
 amount: '',
 type: 'expense',
 category: expenseCategories[0] || '',
 project: '',
 projectId: '', // NEW: Firestore doc id of the project (stable reference)
 costCenter: 'Sin asignar',
 status: 'pending',
 comment: '',
 notes: [],
 isRecurring: false,
 recurringFrequency: 'monthly',
 recurringEndDate: '',
 taxRate: TAX_RATES.STANDARD, // Default 19% German VAT
 counterpartyId: '',
 counterpartyName: '',
 employeeIds: [], // NEW: array of employee doc ids attached to this transaction
 });

 // Description autocomplete state (legacy — kept for backward compat)
 const [showSuggestions, setShowSuggestions] = useState(false);
 const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
 const descriptionRef = useRef(null);
 const suggestionsRef = useRef(null);

 // Partner autocomplete state
 const [showPartnerSuggestions, setShowPartnerSuggestions] = useState(false);
 const [activePartnerIndex, setActivePartnerIndex] = useState(-1);
 const [partnerInput, setPartnerInput] = useState('');
 const partnerInputRef = useRef(null);
 const partnerSuggestionsRef = useRef(null);
 const [showCreateNewPartner, setShowCreateNewPartner] = useState(false);

 // Employee picker state (multi-select typeahead)
 const [employeeInput, setEmployeeInput] = useState('');
 const [showEmployeeSuggestions, setShowEmployeeSuggestions] = useState(false);
 const [activeEmployeeIndex, setActiveEmployeeIndex] = useState(-1);
 const employeeInputRef = useRef(null);
 const employeeSuggestionsRef = useRef(null);

 // Filtrar solo proyectos activos para el selector
 const activeProjects = useMemo(() => projects.filter(p => p.status === 'active'), [projects]);

 // Active employees, indexed for fast lookup
 const activeEmployees = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);
 const employeeById = useMemo(() => {
 const map = new Map();
 employees.forEach((e) => map.set(e.id, e));
 return map;
 }, [employees]);

 // Suggestions for the employee picker — filters out already-selected employees
 const employeeSuggestions = useMemo(() => {
 const q = employeeInput.trim().toLowerCase();
 if (!q || q.length < 1) return [];
 return activeEmployees
 .filter((e) => !formData.employeeIds.includes(e.id))
 .filter((e) => {
 if (e.fullName?.toLowerCase().includes(q)) return true;
 if (e.firstName?.toLowerCase().includes(q)) return true;
 if (e.lastName?.toLowerCase().includes(q)) return true;
 return (e.aliases || []).some((a) => a.toLowerCase().includes(q));
 })
 .slice(0, 8);
 }, [employeeInput, activeEmployees, formData.employeeIds]);

 const getCategoriesByType = (type) => {
 return type === 'income' ? incomeCategories : expenseCategories;
 };

 // Compute suggestions based on description input and transaction type
 const suggestions = useMemo(() => {
 const query = formData.description.trim().toLowerCase();
 if (!query || query.length < 2) return [];

 const seen = new Set();
 return transactions
 .filter(t => t.type === formData.type && t.description?.toLowerCase().includes(query))
 .filter(t => {
 const key = t.description.toLowerCase();
 if (seen.has(key)) return false;
 seen.add(key);
 return true;
 })
 .slice(0, 5);
 }, [formData.description, formData.type, transactions]);

 // Partner type filter: for income → client, for expense → vendor
 const partnerTypeFilter = formData.type === 'income' ? 'client' : 'vendor';

 // Compute active partners for autocomplete (filter by type + status active)
 const partnerSuggestions = useMemo(() => {
 const query = partnerInput.trim().toLowerCase();
 if (!query || query.length < 1) return [];
 return partners
 .filter(p => {
 const typeOk = p.type === partnerTypeFilter || p.type === 'both';
 return p.status === 'active' && typeOk && p.name.toLowerCase().includes(query);
 })
 .slice(0, 8);
 }, [partnerInput, partners, partnerTypeFilter]);

 // Whether user typed a name that doesn't exist as a partner
 const typedPartnerNotInList = useMemo(() => {
 const query = partnerInput.trim();
 if (!query || query.length < 2) return false;
 return !partners.some(p => p.name.toLowerCase() === query.toLowerCase());
 }, [partnerInput, partners]);

 // Close suggestions on click outside
 useEffect(() => {
 const handleClickOutside = (e) => {
 if (
 suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
 descriptionRef.current && !descriptionRef.current.contains(e.target)
 ) {
 setShowSuggestions(false);
 }
 if (
 partnerSuggestionsRef.current && !partnerSuggestionsRef.current.contains(e.target) &&
 partnerInputRef.current && !partnerInputRef.current.contains(e.target)
 ) {
 setShowPartnerSuggestions(false);
 setShowCreateNewPartner(false);
 }
 if (
 employeeSuggestionsRef.current && !employeeSuggestionsRef.current.contains(e.target) &&
 employeeInputRef.current && !employeeInputRef.current.contains(e.target)
 ) {
 setShowEmployeeSuggestions(false);
 }
 };
 document.addEventListener('mousedown', handleClickOutside);
 return () => document.removeEventListener('mousedown', handleClickOutside);
 }, []);

 useEffect(() => {
 if (editingTransaction) {
 // Backward compat: if taxRate is missing, default to 19%
 const existingTaxRate = editingTransaction.taxRate ?? TAX_RATES.STANDARD;
 setFormData({
 date: editingTransaction.date,
 description: editingTransaction.description,
 amount: editingTransaction.amount,
 type: editingTransaction.type,
 category: editingTransaction.category,
 project: editingTransaction.project || '',
 projectId: editingTransaction.projectId || '',
 costCenter: editingTransaction.costCenter || 'Sin asignar',
 status: editingTransaction.status,
 comment: '',
 notes: editingTransaction.notes || [],
 isRecurring: editingTransaction.isRecurring || false,
 recurringFrequency: editingTransaction.recurringFrequency || 'monthly',
 recurringEndDate: editingTransaction.recurringEndDate || '',
 taxRate: existingTaxRate,
 counterpartyId: editingTransaction.counterpartyId || '',
 counterpartyName: editingTransaction.counterpartyName || '',
 employeeIds: Array.isArray(editingTransaction.employeeIds) ? editingTransaction.employeeIds : [],
 });
 // Pre-fill partner input if editing a transaction with a known counterparty
 setPartnerInput(editingTransaction.counterpartyName || '');
 setShowPartnerSuggestions(false);
 setShowCreateNewPartner(false);
 } else {
 const firstProject = activeProjects[0];
 const firstProjectDisplay = firstProject?.displayName || (firstProject ? `${firstProject.code} (${firstProject.name})` : '');
 const initialType = defaultType || 'expense';
 const categories = initialType === 'income' ? incomeCategories : expenseCategories;
 setFormData({
 date: new Date().toISOString().split('T')[0],
 description: '',
 amount: '',
 type: initialType,
 category: categories[0] || '',
 project: firstProjectDisplay,
 projectId: firstProject?.id || '',
 costCenter: 'Sin asignar',
 status: 'pending',
 comment: '',
 notes: [],
 isRecurring: false,
 recurringFrequency: 'monthly',
 recurringEndDate: '',
 taxRate: TAX_RATES.STANDARD,
 counterpartyId: '',
 counterpartyName: '',
 employeeIds: [],
 });
 setPartnerInput('');
 setShowPartnerSuggestions(false);
 setShowCreateNewPartner(false);
 }
 setShowSuggestions(false);
 setEmployeeInput('');
 setShowEmployeeSuggestions(false);
 }, [isOpen, editingTransaction]);

 // Lazy resolution of projectId for legacy transactions: when editing an old
 // transaction that has `project` (string) but no `projectId`, try to match
 // against active projects and set the projectId. Re-runs when projects load.
 useEffect(() => {
 if (formData.projectId) return; // already set
 if (!formData.project) return; // nothing to resolve from
 if (activeProjects.length === 0) return; // projects not loaded yet
 const candidate = formData.project;
 const match = activeProjects.find((p) => {
 if (!p) return false;
 if (p.displayName === candidate) return true;
 if (p.code === candidate) return true;
 if (`${p.code} (${p.name})` === candidate) return true;
 return false;
 });
 if (match) {
 setFormData((prev) => ({ ...prev, projectId: match.id }));
 }
 }, [activeProjects, formData.project, formData.projectId]);

 const handleTypeChange = (newType) => {
 const categories = getCategoriesByType(newType);
 setFormData({
 ...formData,
 type: newType,
 category: categories[0],
 costCenter: newType === 'income' ? 'Sin asignar' : formData.costCenter
 });
 };

 const handleDescriptionChange = (e) => {
 const value = e.target.value;
 setFormData({ ...formData, description: value });
 setShowSuggestions(value.trim().length >= 2);
 setActiveSuggestionIndex(-1);
 };

 const handleSelectSuggestion = (transaction) => {
 setFormData({
 ...formData,
 description: transaction.description,
 category: transaction.category || formData.category,
 project: transaction.project || formData.project,
 amount: transaction.amount || formData.amount,
 // Carry forward tax rate from suggestion if available
 taxRate: transaction.taxRate ?? formData.taxRate ?? TAX_RATES.STANDARD,
 });
 setShowSuggestions(false);
 };

 const handleDescriptionKeyDown = (e) => {
 if (!showSuggestions || suggestions.length === 0) return;

 if (e.key === 'Escape') {
 setShowSuggestions(false);
 return;
 }
 if (e.key === 'ArrowDown') {
 e.preventDefault();
 setActiveSuggestionIndex(prev => Math.min(prev + 1, suggestions.length - 1));
 } else if (e.key === 'ArrowUp') {
 e.preventDefault();
 setActiveSuggestionIndex(prev => Math.max(prev - 1, 0));
 } else if (e.key === 'Enter' && activeSuggestionIndex >= 0) {
 e.preventDefault();
 handleSelectSuggestion(suggestions[activeSuggestionIndex]);
 }
 };

 const handlePartnerInputChange = (e) => {
 const value = e.target.value;
 setPartnerInput(value);
 setShowPartnerSuggestions(value.trim().length >= 1);
 setActivePartnerIndex(-1);
 setShowCreateNewPartner(false);
 // Clear counterparty if user clears the input
 if (!value.trim()) {
 setFormData(prev => ({ ...prev, counterpartyId: '', counterpartyName: '' }));
 }
 };

 const handleSelectPartner = (partner) => {
 setPartnerInput(partner.name);
 setFormData(prev => ({
 ...prev,
 counterpartyId: partner.id,
 counterpartyName: partner.name,
 // Auto-fill partner's default tax rate if current tax rate is still the default
 taxRate: prev.taxRate === TAX_RATES.STANDARD
 ? (partner.defaultTaxRate ?? TAX_RATES.STANDARD)
 : prev.taxRate,
 }));
 setShowPartnerSuggestions(false);
 setShowCreateNewPartner(false);
 };

 const handlePartnerKeyDown = (e) => {
 const totalItems = partnerSuggestions.length + (typedPartnerNotInList ? 1 : 0);
 if (!showPartnerSuggestions || totalItems === 0) return;

 if (e.key === 'Escape') {
 setShowPartnerSuggestions(false);
 setShowCreateNewPartner(false);
 return;
 }
 if (e.key === 'ArrowDown') {
 e.preventDefault();
 setActivePartnerIndex(prev => Math.min(prev + 1, totalItems - 1));
 } else if (e.key === 'ArrowUp') {
 e.preventDefault();
 setActivePartnerIndex(prev => Math.max(prev - 1, 0));
 } else if (e.key === 'Enter') {
 e.preventDefault();
 if (activePartnerIndex >= 0 && activePartnerIndex < partnerSuggestions.length) {
 handleSelectPartner(partnerSuggestions[activePartnerIndex]);
 } else if (activePartnerIndex === partnerSuggestions.length && typedPartnerNotInList) {
 // "Crear nuevo" selected via keyboard
 handleSelectPartner({
 id: '__new__',
 name: partnerInput.trim(),
 defaultTaxRate: TAX_RATES.STANDARD,
 });
 }
 }
 };

 const handleCreateNewPartner = () => {
 // Signal that user wants to create a new partner — store typed name
 setFormData(prev => ({
 ...prev,
 counterpartyId: '__new__',
 counterpartyName: partnerInput.trim(),
 }));
 setShowPartnerSuggestions(false);
 setShowCreateNewPartner(false);
 // Parent should detect counterpartyId === '__new__' and open partner creation modal
 // For now we just store the name; partner will be created on first transaction save
 };

 // ============================================
 // Employee picker handlers
 // ============================================
 const handleEmployeeInputChange = (e) => {
 const value = e.target.value;
 setEmployeeInput(value);
 setShowEmployeeSuggestions(value.trim().length >= 1);
 setActiveEmployeeIndex(-1);
 };

 const handleSelectEmployee = (employee) => {
 setFormData((prev) => ({
 ...prev,
 employeeIds: prev.employeeIds.includes(employee.id)
 ? prev.employeeIds
 : [...prev.employeeIds, employee.id],
 }));
 setEmployeeInput('');
 setShowEmployeeSuggestions(false);
 setActiveEmployeeIndex(-1);
 // Keep focus on the input so the user can keep adding employees fast
 setTimeout(() => employeeInputRef.current?.focus(), 0);
 };

 const handleRemoveEmployee = (employeeId) => {
 setFormData((prev) => ({
 ...prev,
 employeeIds: prev.employeeIds.filter((id) => id !== employeeId),
 }));
 };

 const handleEmployeeKeyDown = (e) => {
 if (!showEmployeeSuggestions || employeeSuggestions.length === 0) {
 // Backspace with empty input → remove the last selected chip
 if (e.key === 'Backspace' && !employeeInput && formData.employeeIds.length > 0) {
 handleRemoveEmployee(formData.employeeIds[formData.employeeIds.length - 1]);
 }
 return;
 }
 if (e.key === 'Escape') {
 setShowEmployeeSuggestions(false);
 return;
 }
 if (e.key === 'ArrowDown') {
 e.preventDefault();
 setActiveEmployeeIndex((prev) => Math.min(prev + 1, employeeSuggestions.length - 1));
 } else if (e.key === 'ArrowUp') {
 e.preventDefault();
 setActiveEmployeeIndex((prev) => Math.max(prev - 1, 0));
 } else if (e.key === 'Enter' && activeEmployeeIndex >= 0) {
 e.preventDefault();
 handleSelectEmployee(employeeSuggestions[activeEmployeeIndex]);
 }
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 if (submitting) return;

 const amount = parseFloat(formData.amount);
 if (!formData.description?.trim()) return;
 if (!amount || amount <= 0 || amount > 999999999) {
 return;
 }
 if (formData.description.trim().length > 200) {
 return;
 }
 if (!formData.projectId) {
 return;
 }

 setSubmitting(true);
 try {
 await onSubmit(formData);
 } finally {
 setSubmitting(false);
 }
 };

 if (!isOpen) return null;

 // Compute net amount from gross for display
 const grossAmount = parseFloat(formData.amount) || 0;
 const taxRate = formData.taxRate ?? TAX_RATES.STANDARD;
 const netAmount = taxRate > 0 ? grossAmount / (1 + taxRate) : grossAmount;
 const taxAmount = grossAmount - netAmount;

 const currentCategories = getCategoriesByType(formData.type);

 const frequencyOptions = [
 { value: 'weekly', label: 'Semanal' },
 { value: 'biweekly', label: 'Quincenal' },
 { value: 'monthly', label: 'Mensual' },
 { value: 'quarterly', label: 'Trimestral' },
 { value: 'yearly', label: 'Anual' }
 ];

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn" role="dialog" aria-modal="true">
 <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] animate-scaleIn">
 <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-bg-2)] px-6 py-5">
 <div>
 <h3 className="text-xl font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">
 {editingTransaction ? 'Editar transacción' : 'Nueva transacción'}
 </h3>
 <p className="mt-0.5 text-sm text-[var(--color-fg-3)]">
 {editingTransaction ? 'Actualiza los datos del registro seleccionado' : 'Ingresa los datos del nuevo registro'}
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
 <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] p-1.5">
 <button
 type="button"
 onClick={() => handleTypeChange('income')}
 className={`
 flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-md transition-all
  ${formData.type === 'income'
  ? 'bg-[var(--color-bg-2)] text-[var(--color-ok)]'
 : 'text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)]'}
 `}
 >
 <ArrowUpCircle size={18} />
 Ingreso
 </button>
 <button
 type="button"
 onClick={() => handleTypeChange('expense')}
 className={`
 flex items-center justify-center gap-2 py-3 text-sm font-medium rounded-md transition-all
  ${formData.type === 'expense'
  ? 'bg-[var(--color-bg-2)] text-[var(--color-accent)]'
 : 'text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)]'}
 `}
 >
 <ArrowDownCircle size={18} />
 Gasto
 </button>
 </div>

 <div className="flex items-center gap-2 pt-1">
 <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-fg-3)]">Detalles</span>
 <div className="h-px flex-1 bg-[var(--color-line)]" />
 </div>

 {/* Date & Amount & VAT */}
 <div className="grid grid-cols-3 gap-4">
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Fecha <span className="text-[var(--color-accent)]">*</span>
 </label>
 <input
 type="date"
 required
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.date}
 onChange={e => setFormData({...formData, date: e.target.value})}
 />
 </div>
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Bruto (EUR) <span className="text-[var(--color-accent)]">*</span>
 </label>
 <div className="relative">
 <span className="absolute left-4 top-1/2 -translate-y-1/2 font-medium text-[var(--color-fg-3)]">€</span>
 <input
 type="number"
 step="0.01"
 min="0.01"
 required
 placeholder="0.00"
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] py-3 pl-8 pr-4 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.amount}
 onChange={e => setFormData({...formData, amount: e.target.value})}
 />
 </div>
 </div>
 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 IVA (USt) <span className="text-[var(--color-accent)]">*</span>
 </label>
 <div className="relative">
 <select
 required
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.taxRate}
 onChange={e => setFormData({...formData, taxRate: parseFloat(e.target.value)})}
 >
 <option value={TAX_RATES.STANDARD}>19% Std.</option>
 <option value={TAX_RATES.REDUCED}>7% Red.</option>
 <option value={TAX_RATES.ZERO}>0% Ex.</option>
 </select>
 </div>
 </div>
 </div>

 {/* Net/Bruto breakdown — shown when amount > 0 and tax > 0 */}
 {grossAmount > 0 && taxRate > 0 && (
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
 <div className="mb-2 flex items-center gap-1.5">
 <Calculator size={13} className="text-[var(--color-fg-3)]" />
 <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--color-fg-3)]">Desglose IVA</span>
 </div>
 <div className="grid grid-cols-3 gap-3 text-sm">
 <div>
 <p className="text-[10px] text-[var(--color-fg-3)]]">Neto (netto)</p>
 <p className="font-medium text-[var(--color-fg-1)]">{formatCurrency(netAmount)}</p>
 </div>
 <div>
 <p className="text-[10px] text-[var(--color-fg-3)]]">IVA {formatTaxRate(taxRate)}</p>
 <p className="font-medium text-[var(--color-warn)]">{formatCurrency(taxAmount)}</p>
 </div>
 <div>
 <p className="text-[10px] text-[var(--color-fg-3)]]">Bruto (brutto)</p>
 <p className="font-medium text-[var(--color-fg-1)]">{formatCurrency(grossAmount)}</p>
 </div>
 </div>
 </div>
 )}

 {/* Partner / Geschäftspartner autocomplete */}
 <div className="relative">
 <label className="mb-2 flex items-center gap-2 block text-sm font-medium text-[var(--color-fg-4)]">
 <Building2 size={14} className="text-[var(--color-fg-3)]" />
 {formData.type === 'income' ? 'Cliente' : 'Proveedor'}
 <span className="text-xs font-normal text-[var(--color-fg-3)]">(opcional — autocompletado)</span>
 </label>
 {partnersLoading ? (
 <div className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-3)]">
 <Loader2 className="w-4 h-4 animate-spin" />
 Cargando partners...
 </div>
 ) : (
 <>
 <input
 ref={partnerInputRef}
 type="text"
 placeholder={
 formData.type === 'income'
 ? "Buscar o crear cliente..."
 : "Buscar o crear proveedor..."
 }
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={partnerInput}
 onChange={handlePartnerInputChange}
 onKeyDown={handlePartnerKeyDown}
 onFocus={() => partnerInput.trim().length >= 1 && setShowPartnerSuggestions(true)}
 autoComplete="off"
 />
 {showPartnerSuggestions && (partnerSuggestions.length > 0 || typedPartnerNotInList) && (
 <div
 ref={partnerSuggestionsRef}
 className="absolute left-0 right-0 z-[300] mt-1 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)]"
 style={{ boxShadow: 'none' }}
 >
 {partnerSuggestions.map((p, idx) => (
 <button
 key={p.id}
 type="button"
 onClick={() => handleSelectPartner(p)}
 className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
 idx === activePartnerIndex ? 'bg-transparent' : 'hover:bg-[var(--color-bg-1)]'
 } ${idx > 0 ? 'border-t border-[var(--color-bg-1)]' : ''}`}
 >
 <span className="font-medium text-[var(--color-fg-1)]">{p.name}</span>
 {p.email && <span className="ml-2 text-xs text-[var(--color-fg-3)]">{p.email}</span>}
 {p.defaultTaxRate != null && p.defaultTaxRate !== 0.19 && (
 <span className="ml-2 rounded bg-transparent px-1.5 py-0.5 text-xs text-[var(--color-warn)]">
 IVA {(p.defaultTaxRate * 100).toFixed(0)}%
 </span>
 )}
 </button>
 ))}
 {typedPartnerNotInList && (
 <button
 type="button"
 onClick={handleCreateNewPartner}
 className={`w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors border-t border-[var(--color-bg-1)] hover:bg-[var(--color-bg-1)] ${
 activePartnerIndex === partnerSuggestions.length ? 'bg-transparent' : ''
 }`}
 >
 <span className="flex items-center gap-2 font-medium text-[var(--color-fg-1)]">
 <UserPlus size={14} />
 Crear nuevo: "{partnerInput.trim()}"
 </span>
 <span className="ml-6 text-xs text-[var(--color-fg-3)]">
 Se creará automáticamente al guardar la transacción
 </span>
 </button>
 )}
 </div>
 )}
 </>
 )}
 </div>

 <div className="relative">
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Descripción <span className="text-[var(--color-accent)]">*</span>
 </label>
 <input
 ref={descriptionRef}
 type="text"
 required
 placeholder={formData.type === 'income' 
 ? "ej. Venta de servicios, Factura #123..." 
 : "ej. Compra de materiales, Pago proveedor..."}
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.description}
 onChange={handleDescriptionChange}
 onKeyDown={handleDescriptionKeyDown}
 onFocus={() => formData.description.trim().length >= 2 && setShowSuggestions(true)}
 autoComplete="off"
 />
 {showSuggestions && suggestions.length > 0 && (
 <div
 ref={suggestionsRef}
 className="absolute left-0 right-0 z-[300] mt-1 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)]"
 style={{ boxShadow: 'none' }}
 >
 {suggestions.map((s, idx) => (
 <button
 key={s.id}
 type="button"
 onClick={() => handleSelectSuggestion(s)}
 className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
 idx === activeSuggestionIndex ? 'bg-transparent' : 'hover:bg-[var(--color-bg-1)]'
 } ${idx > 0 ? 'border-t border-[var(--color-bg-1)]' : ''}`}
 >
 <span className="font-medium text-[var(--color-fg-1)]">{s.description}</span>
 <span className="ml-2 text-xs text-[var(--color-fg-3)]">
 {s.category} · €{Number(s.amount).toFixed(2)}
 </span>
 </button>
 ))}
 </div>
 )}
 </div>

 <div className="space-y-3">
 <label className="flex items-center gap-3 cursor-pointer group">
 <div className="relative">
 <input
 type="checkbox"
 className="sr-only peer"
 checked={formData.isRecurring}
 onChange={(e) => setFormData({ ...formData, isRecurring: e.target.checked })}
 />
 <div className="h-5 w-10 rounded-full bg-[var(--color-line)] transition-colors peer-checked:bg-transparent"></div>
 <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[var(--color-bg-1)] transition-transform peer-checked:translate-x-5"></div>
 </div>
 <div className="flex items-center gap-2">
 <RefreshCw size={16} className="text-[var(--color-fg-3)]" />
 <span className="text-sm font-medium text-[var(--color-fg-4)]">Transacción recurrente</span>
 </div>
 </label>

 {formData.isRecurring && (
 <div className="grid grid-cols-2 gap-4 pl-1 animate-fadeIn">
 <div>
 <label className="mb-1.5 block text-xs font-medium text-[var(--color-fg-3)]">Frecuencia</label>
 <select
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.recurringFrequency}
 onChange={e => setFormData({ ...formData, recurringFrequency: e.target.value })}
 >
 {frequencyOptions.map(opt => (
 <option key={opt.value} value={opt.value}>{opt.label}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="mb-1.5 block text-xs font-medium text-[var(--color-fg-3)]">Fecha fin (opcional)</label>
 <input
 type="date"
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.recurringEndDate}
 onChange={e => setFormData({ ...formData, recurringEndDate: e.target.value })}
 />
 </div>
 </div>
 )}
 </div>

 <div className="flex items-center gap-2 pt-1">
 <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-fg-3)]">Clasificación</span>
 <div className="h-px flex-1 bg-[var(--color-line)]" />
 </div>

 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Proyecto <span className="text-[var(--color-accent)]">*</span>
 </label>
 <div className="relative">
 {projectsLoading ? (
 <div className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-[var(--color-fg-3)]">
 <Loader2 className="w-4 h-4 animate-spin" />
 Cargando proyectos...
 </div>
 ) : activeProjects.length === 0 ? (
 <div className="w-full rounded-lg border border-[var(--color-line-s)] bg-transparent px-4 py-3 text-sm text-[var(--color-warn)]">
 No hay proyectos activos. Crea uno primero en Configuración → Proyectos.
 </div>
 ) : (
 <select
 required
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.projectId}
 onChange={(e) => {
 const id = e.target.value;
 const proj = activeProjects.find((p) => p.id === id);
 setFormData({
 ...formData,
 projectId: id,
 // Keep legacy `project` string in sync for backwards-compat
 project: proj ? (proj.displayName || `${proj.code} (${proj.name})`) : '',
 });
 }}
 >
 <option value="">Seleccionar proyecto...</option>
 {activeProjects.map((p) => {
 const opLabel = p.operator === 'INSYTE' ? 'Insyte' : p.operator === 'VANCOM' ? 'Vancom' : '';
 return (
 <option key={p.id} value={p.id}>
 {p.code} — {p.name}{opLabel ? ` · ${opLabel}` : ''}{p.zone ? ` · ${p.zone}` : ''}
 </option>
 );
 })}
 </select>
 )}
 {/* Legacy data warning: shown when editing an old transaction whose project string doesn't resolve to a current project */}
 {editingTransaction && formData.project && !formData.projectId && activeProjects.length > 0 && (
 <p className="mt-1 text-xs text-[var(--color-warn)]">
 ⚠ Esta transacción tiene un proyecto legacy (&ldquo;{formData.project}&rdquo;) que no coincide con ningún proyecto actual. Selecciona uno arriba para migrarla.
 </p>
 )}
 </div>
 </div>

 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">Categoría</label>
 <select
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.category}
 onChange={e => setFormData({...formData, category: e.target.value})}
 >
 {currentCategories.map(c => <option key={c} value={c}>{c}</option>)}
 </select>
 </div>

 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">Centro de costo</label>
 <select
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.costCenter}
 onChange={e => setFormData({...formData, costCenter: e.target.value})}
 >
 <option value="">Sin asignar</option>
 {costCenters.map(cc => (
 <option key={cc.id} value={cc.name}>{cc.name}</option>
 ))}
 </select>
 </div>

 {/* Employee picker — multi-select typeahead with chips */}
 <div className="relative">
 <label className="mb-2 flex items-center gap-2 block text-sm font-medium text-[var(--color-fg-4)]">
 <HardHat size={14} className="text-[var(--color-fg-3)]" />
 Técnicos / Empleados
 <span className="text-xs font-normal text-[var(--color-fg-3)]">(opcional — uno o varios)</span>
 </label>

 {/* Selected chips */}
 {formData.employeeIds.length > 0 && (
 <div className="mb-2 flex flex-wrap gap-1.5">
 {formData.employeeIds.map((id) => {
 const emp = employeeById.get(id);
 const label = emp?.fullName || `(empleado ${id.slice(0, 6)} eliminado)`;
 const isOrphan = !emp;
 return (
 <span
 key={id}
 className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
 isOrphan
 ? 'border-[var(--color-warn)] text-[var(--color-warn)]'
 : 'border-[var(--color-line-s)] bg-[var(--color-bg-2)] text-[var(--color-fg-1)]'
 }`}
 >
 {!isOrphan && <HardHat size={11} />}
 {label}
 {emp?.role && <span className="text-[var(--color-fg-3)]">· {emp.role}</span>}
 <button
 type="button"
 onClick={() => handleRemoveEmployee(id)}
 className="ml-0.5 rounded-full p-0.5 text-[var(--color-fg-3)] transition hover:text-[var(--color-accent)]"
 aria-label={`Quitar ${label}`}
 >
 <X size={11} />
 </button>
 </span>
 );
 })}
 </div>
 )}

 {employeesLoading ? (
 <div className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-3)]">
 <Loader2 className="w-4 h-4 animate-spin" />
 Cargando empleados...
 </div>
 ) : activeEmployees.length === 0 ? (
 <div className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-xs text-[var(--color-fg-3)]">
 Aún no hay empleados activos. Crea uno en /empleados para poder asociarlo.
 </div>
 ) : (
 <input
 ref={employeeInputRef}
 type="text"
 placeholder="Buscar técnico por nombre o alias..."
 className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)]"
 value={employeeInput}
 onChange={handleEmployeeInputChange}
 onKeyDown={handleEmployeeKeyDown}
 onFocus={() => employeeInput.trim().length >= 1 && setShowEmployeeSuggestions(true)}
 autoComplete="off"
 />
 )}

 {showEmployeeSuggestions && employeeSuggestions.length > 0 && (
 <div
 ref={employeeSuggestionsRef}
 className="absolute left-0 right-0 z-[300] mt-1 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)]"
 style={{ boxShadow: 'none' }}
 >
 {employeeSuggestions.map((emp, idx) => (
 <button
 key={emp.id}
 type="button"
 onClick={() => handleSelectEmployee(emp)}
 className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
 idx === activeEmployeeIndex ? 'bg-transparent' : 'hover:bg-[var(--color-bg-1)]'
 } ${idx > 0 ? 'border-t border-[var(--color-bg-1)]' : ''}`}
 >
 <div className="flex items-center gap-2">
 <HardHat size={12} className="text-[var(--color-fg-3)]" />
 <span className="font-medium text-[var(--color-fg-1)]">{emp.fullName}</span>
 <span className="text-[10px] uppercase tracking-wide text-[var(--color-fg-3)]">
 {emp.type === 'external' ? 'Externo' : 'Interno'}
 </span>
 {emp.role && <span className="text-xs text-[var(--color-fg-3)]">· {emp.role}</span>}
 </div>
 {emp.aliases && emp.aliases.length > 0 && (
 <p className="ml-5 text-[10px] text-[var(--color-fg-3)]">
 alias: {emp.aliases.slice(0, 3).join(', ')}
 </p>
 )}
 </button>
 ))}
 </div>
 )}
 </div>

 <div className="flex items-center gap-2 pt-1">
 <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-fg-3)]">Estado y notas</span>
 <div className="h-px flex-1 bg-[var(--color-line)]" />
 </div>

 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">Estado de pago</label>
 <div className="flex gap-3">
 <button
 type="button"
 onClick={() => setFormData({...formData, status: 'pending'})}
 className={`
 flex-1 py-3 px-4 rounded-md text-sm font-medium border-2 transition-all
 ${formData.status === 'pending'
 ? 'border-[var(--color-warn)] bg-transparent text-[var(--color-warn)]'
 : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:border-[var(--color-line-s)]'}
 `}
 >
 Pendiente
 </button>
 <button
 type="button"
 onClick={() => setFormData({...formData, status: 'paid'})}
 className={`
 flex-1 py-3 px-4 rounded-md text-sm font-medium border-2 transition-all
 ${formData.status === 'paid'
 ? 'border-[var(--color-ok)] bg-transparent text-[var(--color-ok)]'
 : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:border-[var(--color-line-s)]'}
 `}
 >
 Pagado
 </button>
 </div>
 </div>

 <div>
 <label className="mb-2 block text-sm font-medium text-[var(--color-fg-4)]">
 Comentario {editingTransaction ? '(agregar nota)' : '(opcional)'}
 </label>
 <textarea
 rows="3"
 placeholder={editingTransaction 
 ? "Agregar comentario sobre esta modificación..." 
 : "Agregar comentario inicial (opcional)..."}
 className="w-full resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={formData.comment}
 onChange={e => setFormData({...formData, comment: e.target.value})}
 />
 </div>

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
 disabled={submitting || projectsLoading || activeProjects.length === 0 || !formData.projectId}
 className="flex-[2]"
 >
 {submitting ? 'Guardando...' : editingTransaction ? 'Guardar cambios' : 'Crear transacción'}
 </Button>
 </div>
 </form>
 </div>
 </div>
 );
};

export default TransactionFormModal;
