import React, { useState, useMemo } from 'react';
import { Search, Filter, Download, Plus, FileText, X, ArrowUpDown, ArrowUp, ArrowDown, CheckCircle, MessageSquare, Sparkles, Eye } from 'lucide-react';
import TransactionRow from '../../components/ui/TransactionRow';
import FilterPanel from '../../components/ui/FilterPanel';
import TransactionFormModal from '../../components/ui/TransactionFormModal';
import NotesModal from '../../components/ui/NotesModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import PartialPaymentModal from '../../components/ui/PartialPaymentModal';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useCategories } from '../../hooks/useCategories';
import { useCostCenters } from '../../hooks/useCostCenters';
import { exportTransactionsToPDF } from '../../utils/pdfExport';

const SortableHeader = ({ field, label, align = 'left', sortConfig, onSort }) => {
  const isActive = sortConfig.field === field;
  return (
    <th
      className={`px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider cursor-pointer hover:text-[#c7c7cc] transition-colors select-none ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onSort(field)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {isActive ? (
          sortConfig.direction === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />
        ) : (
          <ArrowUpDown size={14} className="opacity-40" />
        )}
      </span>
    </th>
  );
};

const TransactionList = ({
  transactions,
  userRole,
  searchTerm,
  setSearchTerm,
  filters,
  setFilters,
  applyFilters,
  user
}) => {
  const [showFilters, setShowFilters] = useState(false);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [transactionToDelete, setTransactionToDelete] = useState(null);
  const [sortConfig, setSortConfig] = useState({ field: 'date', direction: 'desc' });
  const [toast, setToast] = useState(null);
  const [quickFilter, setQuickFilter] = useState('all');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentTransaction, setPaymentTransaction] = useState(null);

  const {
    createTransaction,
    updateTransaction,
    deleteTransaction,
    toggleStatus,
    addNote,
    markAsRead,
    registerPayment
  } = useTransactionActions(user);

  const { expenseCategories, incomeCategories } = useCategories(user);
  const { costCenters } = useCostCenters(user);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Quick filter counts & filtered transactions
  const sevenDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  }, []);

  const quickFilterCounts = useMemo(() => {
    let nuevas = 0;
    let sinLeer = 0;
    let conComentarios = 0;
    for (const t of transactions) {
      const createdAt = t.createdAt?.toDate ? t.createdAt.toDate() : t.createdAt ? new Date(t.createdAt) : null;
      if (createdAt && createdAt >= sevenDaysAgo) nuevas++;
      if (t.hasUnreadUpdates) sinLeer++;
      if (t.notes?.some(n => n.type === 'comment')) conComentarios++;
    }
    return { all: transactions.length, nuevas, sinLeer, conComentarios };
  }, [transactions, sevenDaysAgo]);

  const filteredByQuick = useMemo(() => {
    if (quickFilter === 'all') return transactions;
    if (quickFilter === 'nuevas') {
      return transactions.filter(t => {
        const createdAt = t.createdAt?.toDate ? t.createdAt.toDate() : t.createdAt ? new Date(t.createdAt) : null;
        return createdAt && createdAt >= sevenDaysAgo;
      });
    }
    if (quickFilter === 'sinLeer') {
      return transactions.filter(t => t.hasUnreadUpdates === true);
    }
    if (quickFilter === 'conComentarios') {
      return transactions.filter(t => t.notes?.some(n => n.type === 'comment'));
    }
    return transactions;
  }, [transactions, quickFilter, sevenDaysAgo]);

  // Sorting logic
  const handleSort = (field) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedTransactions = useMemo(() => {
    return [...filteredByQuick].sort((a, b) => {
      if (sortConfig.field === 'date') {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return sortConfig.direction === 'desc' ? dateB - dateA : dateA - dateB;
      }
      if (sortConfig.field === 'amount') {
        return sortConfig.direction === 'desc' ? b.amount - a.amount : a.amount - b.amount;
      }
      return 0;
    });
  }, [filteredByQuick, sortConfig.field, sortConfig.direction]);

  const handleToggleStatus = async (transaction) => {
    if (userRole !== 'admin') return;
    await toggleStatus(transaction);
  };

  const handleDelete = (transaction) => {
    setTransactionToDelete(transaction);
    setIsConfirmModalOpen(true);
  };

  const confirmDelete = async () => {
    if (transactionToDelete) {
      await deleteTransaction(transactionToDelete.id);
      setTransactionToDelete(null);
    }
  };

  const handleEdit = (transaction) => {
    setEditingTransaction(transaction);
    setIsFormModalOpen(true);
    if (transaction.hasUnreadUpdates) {
      markAsRead(transaction.id);
    }
  };

  const handleViewNotes = (transaction) => {
    setSelectedTransaction(transaction);
    setIsNotesModalOpen(true);
    if (transaction.hasUnreadUpdates) {
      markAsRead(transaction.id);
    }
  };

  const handleFormSubmit = async (formData) => {
    if (editingTransaction) {
      await updateTransaction(editingTransaction.id, formData, editingTransaction.notes);
    } else {
      await createTransaction(formData);
    }
    setIsFormModalOpen(false);
    setEditingTransaction(null);
  };

  const handleAddNote = async (transaction, noteText) => {
    const result = await addNote(transaction, noteText);
    if (result?.success) {
      showToast('Comentario agregado correctamente');
      const updatedTransaction = {
        ...transaction,
        notes: [
          ...(transaction.notes || []),
          {
            text: noteText.trim(),
            timestamp: new Date().toISOString(),
            user: user.email,
            type: 'comment'
          }
        ]
      };
      setSelectedTransaction(updatedTransaction);
    }
  };

  const handleRegisterPayment = (transaction) => {
    setPaymentTransaction(transaction);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentSubmit = async (transaction, paymentData) => {
    const result = await registerPayment(transaction, paymentData);
    if (result?.success) {
      showToast('Pago registrado correctamente');
    }
  };

  const exportToPDF = () => {
    exportTransactionsToPDF(transactions, 'Todas las Transacciones');
  };

  // Contar filtros activos
  const activeFiltersCount = Object.values(filters).filter(v => v && v !== 'all').length;

  const quickFilterButtons = [
    { key: 'all', label: 'Todas', count: quickFilterCounts.all, icon: null },
    { key: 'nuevas', label: 'Nuevas', count: quickFilterCounts.nuevas, icon: Sparkles },
    { key: 'sinLeer', label: 'Sin leer', count: quickFilterCounts.sinLeer, icon: Eye },
    { key: 'conComentarios', label: 'Con comentarios', count: quickFilterCounts.conComentarios, icon: MessageSquare },
  ];

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-fadeIn ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>
          <CheckCircle size={16} />
          {toast.message}
        </div>
      )}

      {/* Header con búsqueda y acciones */}
      <div className="bg-[#1c1c1e] p-4 rounded-2xl shadow-sm border border-[rgba(255,255,255,0.08)]">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          {/* Search */}
          <div className="relative flex-1 w-full md:w-auto">
            <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-[#636366]" size={18} />
            <input
              type="text"
              placeholder="Buscar transacciones..."
              className="w-full pl-11 pr-4 py-2.5 bg-[#111111] border border-[rgba(255,255,255,0.08)] rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[#636366] hover:text-[#98989d]"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 w-full md:w-auto">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`
                flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all
                ${showFilters || activeFiltersCount > 0
                  ? 'bg-[rgba(59,130,246,0.12)] text-[#0a84ff] border-2 border-[rgba(59,130,246,0.25)]'
                  : 'bg-[#2c2c2e] text-[#c7c7cc] border-2 border-transparent hover:bg-[#2c2c2e]'}
              `}
            >
              <Filter size={18} />
              Filtros
              {activeFiltersCount > 0 && (
                <span className="bg-[rgba(10,132,255,0.12)] text-white text-xs px-2 py-0.5 rounded-full">
                  {activeFiltersCount}
                </span>
              )}
            </button>
            {userRole === 'admin' && (
              <button
                onClick={exportToPDF}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-[#2c2c2e] hover:bg-[#1c1c1e] text-white rounded-xl font-medium transition-all shadow-sm hover:shadow-md"
              >
                <Download size={18} /> Exportar
              </button>
            )}
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.08)] animate-fadeIn">
            <FilterPanel
              filters={filters}
              setFilters={setFilters}
              onApply={() => {
                applyFilters();
                setShowFilters(false);
              }}
            />
          </div>
        )}
      </div>

      {/* Quick Filter Pills */}
      <div className="flex flex-wrap gap-2 px-1">
        {quickFilterButtons.map(({ key, label, count, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setQuickFilter(key)}
            className={`
              inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-200
              ${quickFilter === key
                ? 'bg-[#2c2c2e] text-white shadow-sm'
                : 'bg-[#2c2c2e] text-[#98989d] hover:bg-[#2c2c2e]'}
            `}
          >
            {Icon && <Icon size={14} />}
            {label}
            <span className={`
              text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center
              ${quickFilter === key
                ? 'bg-[rgba(255,255,255,0.08)] text-white/80'
                : 'bg-[#2c2c2e] text-[#8e8e93]'}
            `}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Results Summary */}
      <div className="flex items-center justify-between px-2">
        <p className="text-sm text-[#8e8e93]">
          Mostrando <span className="font-semibold text-[#c7c7cc]">{filteredByQuick.length}</span> transacciones
          {quickFilter !== 'all' && (
            <span className="text-[#636366]"> de {transactions.length}</span>
          )}
        </p>
        {(activeFiltersCount > 0 || quickFilter !== 'all') && (
          <button
            onClick={() => {
              setQuickFilter('all');
              setFilters({
                dateFrom: '',
                dateTo: '',
                project: '',
                category: '',
                type: '',
                status: '',
                quickFilter: 'all'
              });
              applyFilters();
            }}
            className="text-sm text-[#0a84ff] hover:text-[#0a84ff] font-medium"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-[#1c1c1e] rounded-2xl shadow-sm border border-[rgba(255,255,255,0.08)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-[rgba(255,255,255,0.02)] border-b border-[rgba(255,255,255,0.08)]">
              <tr>
                <SortableHeader field="date" label="Fecha" sortConfig={sortConfig} onSort={handleSort} />
                <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider">Descripción</th>
                <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider hidden md:table-cell">Categoría</th>
                <SortableHeader field="amount" label="Monto" align="right" sortConfig={sortConfig} onSort={handleSort} />
                <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider text-center">Estado</th>
                <th className="px-4 py-4 text-xs font-semibold text-[#8e8e93] uppercase tracking-wider text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.08)]">
              {sortedTransactions.map((t, idx) => (
                <TransactionRow
                  key={t.id}
                  t={t}
                  
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  onViewNotes={handleViewNotes}
                  userRole={userRole}
                  searchTerm={searchTerm}
                />
              ))}
              {filteredByQuick.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-[#636366]">
                      <div className="w-16 h-16 bg-[#2c2c2e] rounded-full flex items-center justify-center">
                        <FileText className="w-8 h-8 text-[#636366]" />
                      </div>
                      <p className="text-sm">No se encontraron transacciones</p>
                      {(searchTerm || activeFiltersCount > 0 || quickFilter !== 'all') && (
                        <button
                          onClick={() => {
                            setSearchTerm('');
                            setQuickFilter('all');
                            setFilters({
                              dateFrom: '',
                              dateTo: '',
                              project: '',
                              category: '',
                              type: '',
                              status: '',
                              quickFilter: 'all'
                            });
                            applyFilters();
                          }}
                          className="text-sm text-[#0a84ff] hover:text-[#0a84ff] font-medium"
                        >
                          Limpiar búsqueda y filtros
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      <TransactionFormModal
        isOpen={isFormModalOpen}
        onClose={() => {
          setIsFormModalOpen(false);
          setEditingTransaction(null);
        }}
        onSubmit={handleFormSubmit}
        editingTransaction={editingTransaction}
        user={user}
        expenseCategories={expenseCategories}
        incomeCategories={incomeCategories}
        costCenters={costCenters}
        transactions={transactions}
      />

      <NotesModal
        isOpen={isNotesModalOpen}
        onClose={() => {
          setIsNotesModalOpen(false);
          setSelectedTransaction(null);
        }}
        transaction={selectedTransaction}
        onAddNote={handleAddNote}
      />

      <ConfirmModal
        isOpen={isConfirmModalOpen}
        onClose={() => {
          setIsConfirmModalOpen(false);
          setTransactionToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Eliminar Transacción"
        message={`¿Estás seguro de eliminar la transacción "${transactionToDelete?.description}"? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
      />

      <PartialPaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setPaymentTransaction(null);
        }}
        transaction={paymentTransaction}
        onSubmit={handlePaymentSubmit}
      />
    </div>
  );
};

export default TransactionList;
