import React, { useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { useAuth } from './hooks/useAuth';
import { useTransactions } from './hooks/useTransactions';
import { useAllTransactions } from './hooks/useAllTransactions';
import { useTransactionActions } from './hooks/useTransactionActions';
import { useFilters } from './hooks/useFilters';
import { useCategories } from './hooks/useCategories';
import { useCostCenters } from './hooks/useCostCenters';
import { useBankAccount } from './hooks/useBankAccount';
import { ToastProvider, useToast } from './contexts/ToastContext';
import Login from './features/auth/Login';
import Sidebar from './components/layout/Sidebar';
import MobileMenu, { MobileMenuButton } from './components/layout/MobileMenu';
// Sprint 1
import Dashboard from './features/dashboard/Dashboard';
import Ingresos from './features/ingresos/Ingresos';
import Gastos from './features/gastos/Gastos';
import TransactionList from './features/transactions/TransactionList';
import CashFlow from './features/cashflow/CashFlow';
import ReportesUnified from './features/reportes/ReportesUnified';
import ConfiguracionUnified from './features/configuracion/ConfiguracionUnified';
import CXCIndependiente from './features/cxc/CXCIndependiente';
import CXPIndependiente from './features/cxp/CXPIndependiente';
import BudgetVsActual from './features/presupuesto/BudgetVsActual';
// Sprint 2
import Conciliacion from './features/conciliacion/Conciliacion';
import Alertas from './features/alertas/Alertas';
import AuditLog from './features/auditoria/AuditLog';
// Sprint 3
import Adjuntos from './features/adjuntos/Adjuntos';
import Recurrencia from './features/recurrencia/Recurrencia';
import ImportExport from './features/importexport/ImportExport';
// Sprint 4
import BalanceGeneral from './features/balance/BalanceGeneral';
import ProyectoDashboard from './features/proyectos/ProyectoDashboard';
import ProyeccionCashflow from './features/cashflow/ProyeccionCashflow';
// Sprint 5
import MultiMoneda from './features/multimoneda/MultiMoneda';
import RolesManager from './features/roles/RolesManager';
import BackupManager from './features/backup/BackupManager';
import UserProfile from './features/perfil/UserProfile';

import TransactionFormModal from './components/ui/TransactionFormModal';
import { formatCurrency } from './utils/formatters';
import { Loader2, Landmark } from 'lucide-react';

const VIEW_TITLES = {
  '/': 'Dashboard',
  '/ingresos': 'Ingresos',
  '/gastos': 'Gastos',
  '/transactions': 'Transacciones',
  '/cashflow': 'Flujo de Caja',
  '/reportes': 'Reportes',
  '/configuracion': 'Configuración',
  '/cxc': 'Cuentas por Cobrar',
  '/cxp': 'Cuentas por Pagar',
  '/presupuesto': 'Presupuesto vs Real',
  '/conciliacion': 'Conciliación Bancaria',
  '/alertas': 'Centro de Alertas',
  '/auditoria': 'Registro de Auditoría',
  '/adjuntos': 'Documentos Adjuntos',
  '/recurrencia': 'Transacciones Recurrentes',
  '/import-export': 'Import / Export',
  '/balance': 'Balance General',
  '/proyectos': 'Dashboard por Proyecto',
  '/proyeccion': 'Proyección de Cashflow',
  '/multi-moneda': 'Multi-Moneda',
  '/roles': 'Roles y Permisos',
  '/backup': 'Backup y Restauración',
  '/perfil': 'Mi Perfil',
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
  const { bankAccount, calculateRealBalance } = useBankAccount(user);
  const {
    searchTerm,
    setSearchTerm,
    filters,
    setFilters,
    applyFilters,
    filteredTransactions
  } = useFilters(transactions);

  const navigate = useNavigate();
  const location = useLocation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalDefaultType, setModalDefaultType] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  let toastCtx;
  try { toastCtx = useToast(); } catch { toastCtx = null; }
  const showToast = toastCtx?.showToast;

  const loading = authLoading || transactionsLoading;

  const allTxSource = allTransactions && allTransactions.length > 0 ? allTransactions : [];
  const bankBalanceData = bankAccount ? calculateRealBalance(allTxSource) : null;

  if (!user) {
    return <Login />;
  }

  // Bridge: setView for backward compatibility with Dashboard
  const setView = (viewId) => {
    const pathMap = {
      dashboard: '/',
      ingresos: '/ingresos',
      gastos: '/gastos',
      transactions: '/transactions',
      cashflow: '/cashflow',
      reportes: '/reportes',
      configuracion: '/configuracion',
      cxc: '/cxc',
      cxp: '/cxp',
      presupuesto: '/presupuesto',
      conciliacion: '/conciliacion',
      alertas: '/alertas',
      auditoria: '/auditoria',
      adjuntos: '/adjuntos',
      recurrencia: '/recurrencia',
      'import-export': '/import-export',
      balance: '/balance',
      proyectos: '/proyectos',
      proyeccion: '/proyeccion',
      'multi-moneda': '/multi-moneda',
      roles: '/roles',
      backup: '/backup',
      perfil: '/perfil',
    };
    navigate(pathMap[viewId] || '/');
  };

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

  const currentTitle = VIEW_TITLES[location.pathname] || 'Dashboard';

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

  return (
    <div className="flex h-full bg-black font-sans text-white overflow-hidden">
      <Sidebar
        user={user}
        userRole={userRole}
        hasPermission={hasPermission}
        onNewTransaction={handleNewTransaction}
        bankBalanceData={bankBalanceData}
        bankAccount={bankAccount}
      />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top Header */}
        <div className="flex-shrink-0 bg-[rgba(28,28,30,0.9)] backdrop-blur-xl border-b border-[rgba(255,255,255,0.06)] px-4 md:px-8 py-3 z-30">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileMenuButton onClick={() => setIsMobileMenuOpen(true)} />
              <div>
                <h2 className="text-[17px] md:text-[19px] font-semibold text-white tracking-tight">
                  {currentTitle}
                </h2>
                <p className="text-[11px] text-[#636366] hidden md:block mt-0.5">
                  {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>

            {!loading && (
              <div className="hidden md:flex items-center gap-3">
                {bankBalanceData && (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[rgba(255,255,255,0.04)] rounded-lg border border-[rgba(255,255,255,0.04)]">
                    <Landmark size={12} className={bankBalanceData.currentBalance >= 0 ? 'text-[#30d158]' : 'text-[#ff453a]'} />
                    <span className={`text-[12px] font-semibold tabular-nums ${bankBalanceData.currentBalance >= 0 ? 'text-[#30d158]' : 'text-[#ff453a]'}`}>
                      €{formatCurrency(bankBalanceData.currentBalance)}
                    </span>
                  </div>
                )}
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
            {loading ? <LoadingState /> : (
              <Routes>
                {/* Sprint 1 */}
                <Route path="/" element={
                  hasPermission('dashboard') ? (
                    <Dashboard transactions={filteredTransactions} allTransactions={allTransactions} user={user} setView={setView} />
                  ) : <Navigate to="/transactions" replace />
                } />
                <Route path="/ingresos" element={<Ingresos transactions={filteredTransactions} allTransactions={allTransactions} userRole={userRole} user={user} onNewTransaction={handleNewTransaction} />} />
                <Route path="/gastos" element={<Gastos transactions={filteredTransactions} allTransactions={allTransactions} userRole={userRole} user={user} onNewTransaction={handleNewTransaction} />} />
                <Route path="/transactions" element={<TransactionList {...commonProps} />} />
                <Route path="/cashflow" element={<CashFlow user={user} />} />
                <Route path="/reportes" element={<ReportesUnified transactions={filteredTransactions} allTransactions={allTransactions} />} />
                <Route path="/configuracion" element={<ConfiguracionUnified user={user} transactions={filteredTransactions} />} />
                <Route path="/cxc" element={<CXCIndependiente user={user} userRole={userRole} />} />
                <Route path="/cxp" element={<CXPIndependiente user={user} userRole={userRole} />} />
                <Route path="/presupuesto" element={<BudgetVsActual user={user} userRole={userRole} />} />
                {/* Sprint 2 */}
                <Route path="/conciliacion" element={<Conciliacion user={user} userRole={userRole} />} />
                <Route path="/alertas" element={<Alertas user={user} userRole={userRole} />} />
                <Route path="/auditoria" element={<AuditLog user={user} userRole={userRole} />} />
                {/* Sprint 3 */}
                <Route path="/adjuntos" element={<Adjuntos user={user} userRole={userRole} />} />
                <Route path="/recurrencia" element={<Recurrencia user={user} userRole={userRole} />} />
                <Route path="/import-export" element={<ImportExport user={user} userRole={userRole} />} />
                {/* Sprint 4 */}
                <Route path="/balance" element={<BalanceGeneral user={user} userRole={userRole} />} />
                <Route path="/proyectos" element={<ProyectoDashboard user={user} userRole={userRole} />} />
                <Route path="/proyeccion" element={<ProyeccionCashflow user={user} userRole={userRole} />} />
                {/* Sprint 5 */}
                <Route path="/multi-moneda" element={<MultiMoneda user={user} userRole={userRole} />} />
                <Route path="/roles" element={<RolesManager user={user} userRole={userRole} />} />
                <Route path="/backup" element={<BackupManager user={user} userRole={userRole} />} />
                {/* Perfil */}
                <Route path="/perfil" element={<UserProfile user={user} userRole={userRole} />} />
                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
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
