import { useState, useEffect, useRef, useMemo } from 'react';
import { X, ArrowUpCircle, ArrowDownCircle, Save, Loader2, RefreshCw } from 'lucide-react';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../constants/categories';
import { useProjects } from '../../hooks/useProjects';

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
    recurringEndDate: ''
  });

  // Autocomplete state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const descriptionRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Filtrar solo proyectos activos para el selector
  const activeProjects = projects.filter(p => p.status === 'active');

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

  // Close suggestions on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
        descriptionRef.current && !descriptionRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (editingTransaction) {
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
        recurringEndDate: editingTransaction.recurringEndDate || ''
      });
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
        recurringEndDate: ''
      });
    }
    setShowSuggestions(false);
  }, [editingTransaction, isOpen, projects, defaultType]);

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
      amount: transaction.amount || formData.amount
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const amount = parseFloat(formData.amount);
    if (!formData.description?.trim()) return;
    if (!amount || amount <= 0 || amount > 999999999) {
      alert('El monto debe ser mayor a 0 y menor a 999.999.999');
      return;
    }
    if (formData.description.trim().length > 200) {
      alert('La descripción no puede exceder 200 caracteres');
      return;
    }
    if (!formData.project) {
      alert('Por favor selecciona un proyecto');
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

  const currentCategories = getCategoriesByType(formData.type);

  const frequencyOptions = [
    { value: 'weekly', label: 'Semanal' },
    { value: 'biweekly', label: 'Quincenal' },
    { value: 'monthly', label: 'Mensual' },
    { value: 'quarterly', label: 'Trimestral' },
    { value: 'yearly', label: 'Anual' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-[#1c1c1e] rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-scaleIn max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[rgba(255,255,255,0.08)] flex justify-between items-center bg-[#2c2c2e]">
          <div>
            <h3 className="font-bold text-xl text-[#e5e5ea]">
              {editingTransaction ? 'Editar Transacción' : 'Nueva Transacción'}
            </h3>
            <p className="text-sm text-[#8e8e93] mt-0.5">
              {editingTransaction ? 'Modifica los detalles de la transacción' : 'Ingresa los datos de la nueva transacción'}
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-[#636366] hover:text-[#98989d] hover:bg-[rgba(255,255,255,0.05)] rounded-xl transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Type Selector */}
          <div className="grid grid-cols-2 gap-3 p-1.5 bg-[#2c2c2e] rounded-2xl">
            <button
              type="button"
              onClick={() => handleTypeChange('income')}
              className={`
                flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl transition-all
                ${formData.type === 'income' 
                  ? 'bg-[#1c1c1e] text-[#30d158] shadow-md' 
                  : 'text-[#8e8e93] hover:text-[#c7c7cc]'}
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
                  ? 'bg-[#1c1c1e] text-[#ff453a] shadow-md' 
                  : 'text-[#8e8e93] hover:text-[#c7c7cc]'}
              `}
            >
              <ArrowDownCircle size={18} />
              Gasto
            </button>
          </div>

          {/* Date & Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">
                Fecha <span className="text-[#ff453a]">*</span>
              </label>
              <input
                type="date"
                required
                className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all"
                value={formData.date}
                onChange={e => setFormData({...formData, date: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">
                Monto (EUR) <span className="text-[#ff453a]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#636366] font-medium">€</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all"
                  value={formData.amount}
                  onChange={e => setFormData({...formData, amount: e.target.value})}
                />
              </div>
            </div>
          </div>

          {/* Description with Autocomplete */}
          <div className="relative">
            <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">
              Descripción <span className="text-[#ff453a]">*</span>
            </label>
            <input
              ref={descriptionRef}
              type="text"
              required
              placeholder={formData.type === 'income' 
                ? "ej. Venta de servicios, Factura #123..." 
                : "ej. Compra de materiales, Pago proveedor..."}
              className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all"
              value={formData.description}
              onChange={handleDescriptionChange}
              onKeyDown={handleDescriptionKeyDown}
              onFocus={() => formData.description.trim().length >= 2 && setShowSuggestions(true)}
              autoComplete="off"
            />
            {/* Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-10 left-0 right-0 mt-1 bg-[#1c1c1e] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-lg overflow-hidden"
              >
                {suggestions.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectSuggestion(s)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                      idx === activeSuggestionIndex ? 'bg-[#2c2c2e]' : 'hover:bg-[#111111]'
                    } ${idx > 0 ? 'border-t border-[rgba(255,255,255,0.08)]' : ''}`}
                  >
                    <span className="font-medium text-[#e5e5ea]">{s.description}</span>
                    <span className="text-xs text-[#636366] ml-2">
                      {s.category} · €{Number(s.amount).toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recurring Transaction Toggle */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={formData.isRecurring}
                  onChange={(e) => setFormData({ ...formData, isRecurring: e.target.checked })}
                />
                <div className="w-10 h-5 bg-[#2c2c2e] rounded-full peer-checked:bg-[rgba(48,209,88,0.12)] transition-colors"></div>
                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-[#1c1c1e] rounded-full shadow-sm transition-transform peer-checked:translate-x-5"></div>
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw size={16} className="text-[#8e8e93]" />
                <span className="text-sm font-semibold text-[#c7c7cc]">Transacción recurrente</span>
              </div>
            </label>

            {formData.isRecurring && (
              <div className="grid grid-cols-2 gap-4 pl-1 animate-fadeIn">
                <div>
                  <label className="block text-xs font-medium text-[#98989d] mb-1.5">Frecuencia</label>
                  <select
                    className="w-full px-3 py-2.5 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all text-sm"
                    value={formData.recurringFrequency}
                    onChange={e => setFormData({ ...formData, recurringFrequency: e.target.value })}
                  >
                    {frequencyOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#98989d] mb-1.5">Fecha fin (opcional)</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2.5 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all text-sm"
                    value={formData.recurringEndDate}
                    onChange={e => setFormData({ ...formData, recurringEndDate: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Project */}
          <div>
            <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">
              Proyecto <span className="text-[#ff453a]">*</span>
            </label>
            <div className="relative">
              {projectsLoading ? (
                <div className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl flex items-center gap-2 text-[#8e8e93]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Cargando proyectos...
                </div>
              ) : activeProjects.length === 0 ? (
                <div className="w-full px-4 py-3 bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.25)] rounded-xl text-[#ff9f0a] text-sm">
                  No hay proyectos activos. Crea uno primero en Configuración → Proyectos.
                </div>
              ) : (
                <select
                  required
                  className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all text-sm"
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

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">Categoría</label>
            <select
              className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all text-sm"
              value={formData.category}
              onChange={e => setFormData({...formData, category: e.target.value})}
            >
              {currentCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Cost Center - Solo para gastos */}
          {formData.type === 'expense' && (
            <div>
              <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">Centro de Costo</label>
              <select
                className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all text-sm"
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

          {/* Status */}
          <div>
            <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">Estado de Pago</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setFormData({...formData, status: 'pending'})}
                className={`
                  flex-1 py-3 px-4 rounded-xl text-sm font-medium border-2 transition-all
                  ${formData.status === 'pending'
                    ? 'border-amber-400 bg-[rgba(245,158,11,0.08)] text-[#ff9f0a]'
                    : 'border-[rgba(255,255,255,0.08)] text-[#98989d] hover:border-[rgba(245,158,11,0.25)]'}
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
                    ? 'border-emerald-400 bg-[rgba(16,185,129,0.08)] text-[#30d158]'
                    : 'border-[rgba(255,255,255,0.08)] text-[#98989d] hover:border-[rgba(16,185,129,0.25)]'}
                `}
              >
                Pagado
              </button>
            </div>
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm font-semibold text-[#c7c7cc] mb-2">
              Comentario {editingTransaction ? '(agregar nota)' : '(opcional)'}
            </label>
            <textarea
              rows="3"
              placeholder={editingTransaction 
                ? "Agregar comentario sobre esta modificación..." 
                : "Agregar comentario inicial (opcional)..."}
              className="w-full px-4 py-3 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#1c1c1e] outline-none transition-all text-sm resize-none"
              value={formData.comment}
              onChange={e => setFormData({...formData, comment: e.target.value})}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting || projectsLoading || activeProjects.length === 0}
            className={`
              w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-white
              transition-all duration-200 shadow-lg
              ${formData.type === 'income'
                ? 'bg-[#30d158] hover:bg-[#28c74e]'
                : 'bg-[#0a84ff] hover:bg-[#0070e0]'}
              ${(submitting || projectsLoading || activeProjects.length === 0) ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-xl transform hover:-translate-y-0.5'}
            `}
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {submitting ? 'Guardando...' : editingTransaction ? 'Guardar Cambios' : 'Crear Transacción'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default TransactionFormModal;
