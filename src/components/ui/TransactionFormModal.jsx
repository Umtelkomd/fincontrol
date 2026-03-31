import { useState, useEffect, useRef, useMemo } from 'react';
import { X, ArrowUpCircle, ArrowDownCircle, Save, Loader2, RefreshCw, Calculator, UserPlus, Building2 } from 'lucide-react';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../constants/categories';
import { useProjects } from '../../hooks/useProjects';
import { usePartners } from '../../hooks/usePartners';
import { TAX_RATES } from '../../constants/config';
import { formatCurrency, formatTaxRate } from '../../utils/formatters';

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

  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    amount: '',
    type: 'expense',
    category: expenseCategories[0] || '',
    project: '',
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

  // Filtrar solo proyectos activos para el selector
  const activeProjects = useMemo(() => projects.filter(p => p.status === 'active'), [projects]);

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
      });
      // Pre-fill partner input if editing a transaction with a known counterparty
      setPartnerInput(editingTransaction.counterpartyName || '');
      setShowPartnerSuggestions(false);
      setShowCreateNewPartner(false);
    } else {
      const firstProject = activeProjects[0]?.displayName || activeProjects[0]?.name || '';
      const initialType = defaultType || 'expense';
      const categories = initialType === 'income' ? incomeCategories : expenseCategories;
      setFormData({
        date: new Date().toISOString().split('T')[0],
        description: '',
        amount: '',
        type: initialType,
        category: categories[0] || '',
        project: firstProject,
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
      });
      setPartnerInput('');
      setShowPartnerSuggestions(false);
      setShowCreateNewPartner(false);
    }
    setShowSuggestions(false);
  }, [isOpen, editingTransaction]);

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
    if (!formData.project) {
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[30px] border border-[#dce6f8] bg-[rgba(255,255,255,0.96)] shadow-[0_35px_120px_rgba(15,23,42,0.24)] animate-scaleIn">
        <div className="flex items-center justify-between border-b border-[#e2ebfb] bg-[rgba(245,248,255,0.94)] px-6 py-5">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-[#1f2a44]">
              {editingTransaction ? 'Editar transacción' : 'Nueva transacción'}
            </h3>
            <p className="mt-0.5 text-sm text-[#6b7a99]">
              {editingTransaction ? 'Actualiza los datos del registro seleccionado' : 'Ingresa los datos del nuevo registro'}
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
          <div className="grid grid-cols-2 gap-3 rounded-[22px] border border-[#dce6f8] bg-[rgba(245,248,255,0.94)] p-1.5">
            <button
              type="button"
              onClick={() => handleTypeChange('income')}
              className={`
                flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl transition-all
                ${formData.type === 'income' 
                  ? 'bg-white text-[#0f9f6e] shadow-sm' 
                  : 'text-[#6b7a99] hover:text-[#1f2a44]'}
              `}
            >
              <ArrowUpCircle size={18} />
              Ingreso
            </button>
            <button
              type="button"
              onClick={() => handleTypeChange('expense')}
              className={`
                flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl transition-all
                ${formData.type === 'expense' 
                  ? 'bg-white text-[#d04c36] shadow-sm' 
                  : 'text-[#6b7a99] hover:text-[#1f2a44]'}
              `}
            >
              <ArrowDownCircle size={18} />
              Gasto
            </button>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#93a0b6]">Detalles</span>
            <div className="h-px flex-1 bg-[#e2ebfb]" />
          </div>

          {/* Date & Amount & VAT */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
                Fecha <span className="text-[#ff453a]">*</span>
              </label>
              <input
                type="date"
                required
                className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
                value={formData.date}
                onChange={e => setFormData({...formData, date: e.target.value})}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
                Bruto (EUR) <span className="text-[#ff453a]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-medium text-[#7a879d]">€</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] py-3 pl-8 pr-4 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
                  value={formData.amount}
                  onChange={e => setFormData({...formData, amount: e.target.value})}
                />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
                IVA (USt) <span className="text-[#ff453a]">*</span>
              </label>
              <div className="relative">
                <select
                  required
                  className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-3 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
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
            <div className="rounded-2xl border border-[#d8e3f7] bg-[rgba(245,248,255,0.94)] px-4 py-3">
              <div className="mb-2 flex items-center gap-1.5">
                <Calculator size={13} className="text-[#70819f]" />
                <span className="text-[11px] font-semibold uppercase tracking-widest text-[#70819f]">Desglose IVA</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-[10px] text-[#93a0b6]]">Neto (netto)</p>
                  <p className="font-semibold text-[#22304f]">{formatCurrency(netAmount)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#93a0b6]]">IVA {formatTaxRate(taxRate)}</p>
                  <p className="font-semibold text-[#d97706]">{formatCurrency(taxAmount)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#93a0b6]]">Bruto (brutto)</p>
                  <p className="font-semibold text-[#22304f]">{formatCurrency(grossAmount)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Partner / Geschäftspartner autocomplete */}
          <div className="relative">
            <label className="mb-2 flex items-center gap-2 block text-sm font-semibold text-[#4b5d83]">
              <Building2 size={14} className="text-[#70819f]" />
              {formData.type === 'income' ? 'Cliente' : 'Proveedor'}
              <span className="text-xs font-normal text-[#93a0b6]">(opcional — autocompletado)</span>
            </label>
            {partnersLoading ? (
              <div className="flex w-full items-center gap-2 rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#6b7a99]">
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
                  className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
                  value={partnerInput}
                  onChange={handlePartnerInputChange}
                  onKeyDown={handlePartnerKeyDown}
                  onFocus={() => partnerInput.trim().length >= 1 && setShowPartnerSuggestions(true)}
                  autoComplete="off"
                />
                {showPartnerSuggestions && (partnerSuggestions.length > 0 || typedPartnerNotInList) && (
                  <div
                    ref={partnerSuggestionsRef}
                    className="absolute left-0 right-0 z-[300] mt-1 overflow-hidden rounded-2xl border border-[#dce6f8] bg-white/98"
                    style={{ boxShadow: '0 18px 48px rgba(87, 112, 153, 0.18)' }}
                  >
                    {partnerSuggestions.map((p, idx) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectPartner(p)}
                        className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                          idx === activePartnerIndex ? 'bg-[rgba(59,130,246,0.08)]' : 'hover:bg-[rgba(241,246,255,0.86)]'
                        } ${idx > 0 ? 'border-t border-[#eef2fb]' : ''}`}
                      >
                        <span className="font-medium text-[#1f2a44]">{p.name}</span>
                        {p.email && <span className="ml-2 text-xs text-[#70819f]">{p.email}</span>}
                        {p.defaultTaxRate != null && p.defaultTaxRate !== 0.19 && (
                          <span className="ml-2 rounded bg-[rgba(214,149,44,0.1)] px-1.5 py-0.5 text-xs text-[#c98717]">
                            IVA {(p.defaultTaxRate * 100).toFixed(0)}%
                          </span>
                        )}
                      </button>
                    ))}
                    {typedPartnerNotInList && (
                      <button
                        type="button"
                        onClick={handleCreateNewPartner}
                        className={`w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors border-t border-[#eef2fb] hover:bg-[rgba(241,246,255,0.86)] ${
                          activePartnerIndex === partnerSuggestions.length ? 'bg-[rgba(59,130,246,0.08)]' : ''
                        }`}
                      >
                        <span className="flex items-center gap-2 font-medium text-[#3156d3]">
                          <UserPlus size={14} />
                          Crear nuevo: "{partnerInput.trim()}"
                        </span>
                        <span className="ml-6 text-xs text-[#70819f]">
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
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Descripción <span className="text-[#ff453a]">*</span>
            </label>
            <input
              ref={descriptionRef}
              type="text"
              required
              placeholder={formData.type === 'income' 
                ? "ej. Venta de servicios, Factura #123..." 
                : "ej. Compra de materiales, Pago proveedor..."}
              className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
              value={formData.description}
              onChange={handleDescriptionChange}
              onKeyDown={handleDescriptionKeyDown}
              onFocus={() => formData.description.trim().length >= 2 && setShowSuggestions(true)}
              autoComplete="off"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute left-0 right-0 z-[300] mt-1 overflow-hidden rounded-2xl border border-[#dce6f8] bg-white/98"
                style={{ boxShadow: '0 18px 48px rgba(87, 112, 153, 0.18)' }}
              >
                {suggestions.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectSuggestion(s)}
                    className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                      idx === activeSuggestionIndex ? 'bg-[rgba(59,130,246,0.08)]' : 'hover:bg-[rgba(241,246,255,0.86)]'
                    } ${idx > 0 ? 'border-t border-[#eef2fb]' : ''}`}
                  >
                    <span className="font-medium text-[#1f2a44]">{s.description}</span>
                    <span className="ml-2 text-xs text-[#70819f]">
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
                <div className="h-5 w-10 rounded-full bg-[#d7e3f6] transition-colors peer-checked:bg-[rgba(15,159,110,0.24)]"></div>
                <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"></div>
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw size={16} className="text-[#6b7a99]" />
                <span className="text-sm font-semibold text-[#4b5d83]">Transacción recurrente</span>
              </div>
            </label>

            {formData.isRecurring && (
              <div className="grid grid-cols-2 gap-4 pl-1 animate-fadeIn">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#70819f]">Frecuencia</label>
                  <select
                    className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-3 py-2.5 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
                    value={formData.recurringFrequency}
                    onChange={e => setFormData({ ...formData, recurringFrequency: e.target.value })}
                  >
                    {frequencyOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#70819f]">Fecha fin (opcional)</label>
                  <input
                    type="date"
                    className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-3 py-2.5 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
                    value={formData.recurringEndDate}
                    onChange={e => setFormData({ ...formData, recurringEndDate: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#93a0b6]">Clasificación</span>
            <div className="h-px flex-1 bg-[#e2ebfb]" />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Proyecto <span className="text-[#ff453a]">*</span>
            </label>
            <div className="relative">
              {projectsLoading ? (
                <div className="flex w-full items-center gap-2 rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-[#6b7a99]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Cargando proyectos...
                </div>
              ) : activeProjects.length === 0 ? (
                <div className="w-full rounded-2xl border border-[rgba(214,149,44,0.24)] bg-[rgba(255,248,234,0.94)] px-4 py-3 text-sm text-[#c98717]">
                  No hay proyectos activos. Crea uno primero en Configuración → Proyectos.
                </div>
              ) : (
                <select
                  required
                  className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
                  value={formData.project}
                  onChange={e => setFormData({...formData, project: e.target.value})}
                >
                  <option value="">Seleccionar proyecto...</option>
                  {activeProjects.map(p => (
                    <option key={p.id} value={p.displayName || `${p.code} (${p.name})`}>
                      {p.code} - {p.name} {p.client ? `| ${p.client}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">Categoría</label>
            <select
              className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
              value={formData.category}
              onChange={e => setFormData({...formData, category: e.target.value})}
            >
              {currentCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {formData.type === 'expense' && (
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">Centro de costo</label>
              <select
                className="w-full rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
                value={formData.costCenter}
                onChange={e => setFormData({...formData, costCenter: e.target.value})}
              >
                <option value="Sin asignar">Sin asignar</option>
                {costCenters.map(cc => (
                  <option key={cc.id} value={cc.name}>{cc.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#93a0b6]">Estado y notas</span>
            <div className="h-px flex-1 bg-[#e2ebfb]" />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">Estado de pago</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setFormData({...formData, status: 'pending'})}
                className={`
                  flex-1 py-3 px-4 rounded-xl text-sm font-medium border-2 transition-all
                  ${formData.status === 'pending'
                    ? 'border-[#e0b460] bg-[rgba(214,149,44,0.08)] text-[#c98717]'
                    : 'border-[#d8e3f7] text-[#6b7a99] hover:border-[rgba(214,149,44,0.25)]'}
                `}
              >
                Pendiente
              </button>
              <button
                type="button"
                onClick={() => setFormData({...formData, status: 'paid'})}
                className={`
                  flex-1 py-3 px-4 rounded-xl text-sm font-medium border-2 transition-all
                  ${formData.status === 'paid'
                    ? 'border-[#7fcfb5] bg-[rgba(15,159,110,0.08)] text-[#0f9f6e]'
                    : 'border-[#d8e3f7] text-[#6b7a99] hover:border-[rgba(15,159,110,0.25)]'}
                `}
              >
                Pagado
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-[#4b5d83]">
              Comentario {editingTransaction ? '(agregar nota)' : '(opcional)'}
            </label>
            <textarea
              rows="3"
              placeholder={editingTransaction 
                ? "Agregar comentario sobre esta modificación..." 
                : "Agregar comentario inicial (opcional)..."}
              className="w-full resize-none rounded-2xl border border-[#d8e3f7] bg-[rgba(247,250,255,0.95)] px-4 py-3 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.12)]"
              value={formData.comment}
              onChange={e => setFormData({...formData, comment: e.target.value})}
            />
          </div>

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
              disabled={submitting || projectsLoading || activeProjects.length === 0}
              className={`
                flex-[2] flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-white
                transition-all duration-200 shadow-lg
                ${formData.type === 'income'
                  ? 'bg-[#0f9f6e] hover:bg-[#0c875d]'
                  : 'bg-[#2563eb] hover:bg-[#1f56cf]'}
                ${(submitting || projectsLoading || activeProjects.length === 0) ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-xl'}
              `}
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              {submitting ? 'Guardando...' : editingTransaction ? 'Guardar cambios' : 'Crear transacción'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TransactionFormModal;
