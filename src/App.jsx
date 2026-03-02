import React, { useState } from 'react';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { useAuth } from './hooks/useAuth';
import { useTransactions } from './hooks/useTransactions';
import { useAllTransactions } from './hooks/useAllTransactions';
import { useTransactionActions } from './hooks/useTransactionActions';
import { useFilters } from './hooks/useFilters';
import { useCategories } from './hooks/useCategories';
import { useCostCenters } from './hooks/useCostCenters';
import { ToastProvider, useToast } from './contexts/ToastContext';
import Login from './features/auth/Login';
import Sidebar from './components/layout/Sidebar';
import MobileMenu, { MobileMenuButton } from './components/layout/MobileMenu';
import Dashboard from './features/dashboard/Dashboard';
import Ingresos from './features/ingresos/Ingresos';
import Gastos from './features/gastos/Gastos';
import TransactionList from './features/transactions/TransactionList';
import CashFlow from './features/cashflow/CashFlow';
import ReportesUnified from './features/reportes/ReportesUnified';
import ConfiguracionUnified from './features/configuracion/ConfiguracionUnified';
import TransactionFormModal from './components/ui/TransactionFormModal';
import { Loader2 } from 'lucide-react';

const VIEW_TITLES = {
  'dashboard': 'Dashboard',
  'ingresos': 'Ingresos',
  'gastos': 'Gastos',
  'transactions': 'Transacciones',
  'cashflow': 'Flujo de Caja',
  'reportes': 'Reportes',
  'configuracion': 'Configuración',
};

// Skeleton Loading Component
const SkeletonCard = () => (
  <div className="bg-[rgba(28,28,30,0.8)] p-5 rounded-xl border border-[rgba(255,255,255,0.06)]">
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <div className="skeleton h-3 w-20 mb-2"></div>
        <div className="skeleton h-7 w-28"></div>
      </div>
      <div className="skeleton w-10 h-10 rounded-lg"></div>
    </div>
  </div>
);

const LoadingState = () => (
  <div className="space-y-6 animate-fadeIn">
    <div className="flex items-center justify-center py-12">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-7 h-7 text-[#30d158] animate-spin" />
        <p className="text-[#8e8e93] text-sm">Cargando datos financieros...</p>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  </div>
);

function AppContent() {
  const { user, userRole, hasPermission, loading: authLoading } = useAuth();
  const { transactions, loading: transactionsLoading } = useTransactions(user);
  const { allTransactions, loading: allTxLoading } = useAllTransactions(user);
  const { createTransaction } = useTransactionActions(user);
  const { expenseCategories, incomeCategories } = useCategories(user);
  const { costCenters } = useCostCenters(user);
  const {
    searchTerm,
    setSearchTerm,
    filters,
    setFilters,
    applyFilters,
    filteredTransactions
  } = useFilters(transactions);

  const [view, setView] = useState('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalDefaultType, setModalDefaultType] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  let toastCtx;
  try { toastCtx = useToast(); } catch { toastCtx = null; }
  const showToast = toastCtx?.showToast;

  const loading = authLoading || transactionsLoading;

  if (!user) {
    return <Login />;
  }

  const handleNewTransaction = (defaultType) => {
    setModalDefaultType(defaultType || null);
    setIsModalOpen(true);
  };

  const handleTransactionSubmit = async (formData) => {
    const result = await createTransaction(formData);
    if (result.success) {
      showToast?.('Transacción creada exitosamente ✅');
    } else {
      showToast?.('Error al crear la transacción', 'error');
    }
    setIsModalOpen(false);
    setModalDefaultType(null);
  };

  const renderView = () => {
    if (loading) return <LoadingState />;

    const commonProps = {
      transactions: filteredTransactions,
      userRole,
      user,
      searchTerm,
      setSearchTerm,
      filters,
      setFilters,
      applyFilters
    };

    switch (view) {
      case 'dashboard':
        return hasPermission('dashboard') ? (
          <Dashboard
            transactions={filteredTransactions}
            allTransactions={allTransactions}
            user={user}
            setView={setView}
          />
        ) : null;
      case 'ingresos':
        return (
          <Ingresos
            transactions={filteredTransactions}
            allTransactions={allTransactions}
            userRole={userRole}
            user={user}
            onNewTransaction={handleNewTransaction}
          />
        );
      case 'gastos':
        return (
          <Gastos
            transactions={filteredTransactions}
            allTransactions={allTransactions}
            userRole={userRole}
            user={user}
            onNewTransaction={handleNewTransaction}
          />
        );
      case 'transactions':
        return <TransactionList {...commonProps} />;
      case 'cashflow':
        return <CashFlow user={user} />;
      case 'reportes':
        return <ReportesUnified transactions={filteredTransactions} allTransactions={allTransactions} />;
      case 'configuracion':
        return <ConfiguracionUnified user={user} transactions={filteredTransactions} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full bg-black font-sans text-white overflow-hidden">
      <Sidebar
        user={user}
        userRole={userRole}
        hasPermission={hasPermission}
        view={view}
        setView={setView}
        onNewTransaction={handleNewTransaction}
      />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top Header */}
        <div className="flex-shrink-0 bg-[rgba(28,28,30,0.9)] backdrop-blur-xl border-b border-[rgba(255,255,255,0.06)] px-4 md:px-8 py-3 z-30">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileMenuButton onClick={() => setIsMobileMenuOpen(true)} />
              <div>
                <h2 className="text-[17px] md:text-[19px] font-semibold text-white tracking-tight">
                  {VIEW_TITLES[view] || 'Dashboard'}
                </h2>
                <p className="text-[11px] text-[#636366] hidden md:block mt-0.5">
                  {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>

            {!loading && (
              <div className="hidden md:flex items-center gap-3">
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[rgba(255,255,255,0.04)] rounded-lg border border-[rgba(255,255,255,0.04)]">
                  <div className="w-1.5 h-1.5 bg-[#30d158] rounded-full animate-pulse"></div>
                  <span className="text-[11px] text-[#8e8e93]">
                    {filteredTransactions.length} transacciones
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-7xl mx-auto">
            {renderView()}
          </div>
        </div>
      </main>

      {/* Transaction Modal */}
      <TransactionFormModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setModalDefaultType(null); }}
        onSubmit={handleTransactionSubmit}
        editingTransaction={null}
        user={user}
        expenseCategories={expenseCategories}
        incomeCategories={incomeCategories}
        costCenters={costCenters}
        defaultType={modalDefaultType}
      />

      {/* Mobile Menu */}
      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        user={user}
        userRole={userRole}
        hasPermission={hasPermission}
        view={view}
        setView={setView}
        onNewTransaction={handleNewTransaction}
      />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
