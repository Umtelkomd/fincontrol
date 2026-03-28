import { Suspense, lazy, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Landmark, Loader2 } from 'lucide-react';
import ErrorBoundary from './components/ui/ErrorBoundary';
import Sidebar from './components/layout/Sidebar';
import MobileMenu, { MobileMenuButton } from './components/layout/MobileMenu';
import { ToastProvider, useToast } from './contexts/ToastContext';
import Login from './features/auth/Login';
import { useAuth } from './hooks/useAuth';
import { useFilters } from './hooks/useFilters';
import { useTransactions } from './hooks/useTransactions';
import { useTreasuryMetrics } from './hooks/useTreasuryMetrics';
import { formatCurrency } from './utils/formatters';

const Dashboard = lazy(() => import('./features/dashboard/Dashboard'));
const Ingresos = lazy(() => import('./features/ingresos/Ingresos'));
const Gastos = lazy(() => import('./features/gastos/Gastos'));
const TransactionList = lazy(() => import('./features/transactions/TransactionList'));
const CashFlow = lazy(() => import('./features/cashflow/CashFlow'));
const ReportesUnified = lazy(() => import('./features/reportes/ReportesUnified'));
const ConfiguracionUnified = lazy(() => import('./features/configuracion/ConfiguracionUnified'));
const CXCIndependiente = lazy(() => import('./features/cxc/CXCIndependiente'));
const CXPIndependiente = lazy(() => import('./features/cxp/CXPIndependiente'));
const BudgetVsActual = lazy(() => import('./features/presupuesto/BudgetVsActual'));
const Conciliacion = lazy(() => import('./features/conciliacion/Conciliacion'));
const Alertas = lazy(() => import('./features/alertas/Alertas'));
const AuditLog = lazy(() => import('./features/auditoria/AuditLog'));
const Adjuntos = lazy(() => import('./features/adjuntos/Adjuntos'));
const Recurrencia = lazy(() => import('./features/recurrencia/Recurrencia'));
const ImportExport = lazy(() => import('./features/importexport/ImportExport'));
const BalanceGeneral = lazy(() => import('./features/balance/BalanceGeneral'));
const ProyectoDashboard = lazy(() => import('./features/proyectos/ProyectoDashboard'));
const ProyeccionCashflow = lazy(() => import('./features/cashflow/ProyeccionCashflow'));
const MultiMoneda = lazy(() => import('./features/multimoneda/MultiMoneda'));
const RolesManager = lazy(() => import('./features/roles/RolesManager'));
const WhatIf = lazy(() => import('./features/whatif/WhatIf'));
const BackupManager = lazy(() => import('./features/backup/BackupManager'));
const UserProfile = lazy(() => import('./features/perfil/UserProfile'));
const FinanceActionLauncher = lazy(() => import('./components/finance/FinanceActionLauncher'));

const VIEW_TITLES = {
  '/': 'Inicio',
  '/ingresos': 'Ingresos',
  '/gastos': 'Gastos',
  '/transactions': 'Transacciones',
  '/cashflow': 'Tesorería',
  '/tesoreria': 'Tesorería',
  '/reportes': 'Reportes',
  '/configuracion': 'Configuración',
  '/cxc': 'Cuentas por Cobrar',
  '/cxp': 'Cuentas por Pagar',
  '/presupuesto': 'Presupuesto',
  '/conciliacion': 'Conciliación Bancaria',
  '/alertas': 'Alertas',
  '/auditoria': 'Auditoría',
  '/adjuntos': 'Adjuntos',
  '/recurrencia': 'Recurrentes',
  '/import-export': 'Importación y Exportación',
  '/balance': 'Balance General',
  '/proyectos': 'Proyectos',
  '/proyeccion': 'Proyección',
  '/multi-moneda': 'Multi-moneda',
  '/roles': 'Roles',
  '/backup': 'Backup',
  '/perfil': 'Perfil',
};

const SkeletonCard = () => (
  <div className="rounded-[26px] border border-[rgba(196,214,255,0.38)] bg-[rgba(255,255,255,0.72)] p-4 shadow-[0_18px_46px_rgba(124,148,191,0.14)] backdrop-blur-xl">
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <div className="skeleton mb-2 h-3 w-20" />
        <div className="skeleton h-6 w-24" />
      </div>
      <div className="skeleton h-10 w-10 rounded-lg" />
    </div>
  </div>
);

const LoadingState = () => (
  <div className="space-y-6 animate-fadeIn">
    <div className="flex items-center justify-center py-16">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-6 w-6 animate-spin text-[#4d74ff]" />
        <p className="text-[12px] text-[#5f7091]">Sincronizando control financiero...</p>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  </div>
);

function AppContent() {
  useToast();
  const { user, userRole, hasPermission, loading: authLoading } = useAuth();
  const { transactions, loading: transactionsLoading } = useTransactions(user);
  const treasury = useTreasuryMetrics({ user });
  const {
    searchTerm,
    setSearchTerm,
    filteredTransactions,
  } = useFilters(transactions);

  const navigate = useNavigate();
  const location = useLocation();

  const [isActionLauncherOpen, setIsActionLauncherOpen] = useState(false);
  const [launcherDefaultAction, setLauncherDefaultAction] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const loading = authLoading || transactionsLoading;
  const currentTitle = VIEW_TITLES[location.pathname] || 'Inicio';

  if (!user) {
    return <Login />;
  }

  const setView = (viewId) => {
    const pathMap = {
      dashboard: '/',
      cashflow: '/cashflow',
      treasury: '/cashflow',
      cxc: '/cxc',
      cxp: '/cxp',
      reportes: '/reportes',
      presupuesto: '/presupuesto',
      conciliacion: '/conciliacion',
      proyectos: '/proyectos',
      whatif: '/whatif',
      configuracion: '/configuracion',
    };
    navigate(pathMap[viewId] || '/');
  };

  const handleOpenLauncher = (defaultAction = null) => {
    setLauncherDefaultAction(defaultAction);
    setIsActionLauncherOpen(true);
  };

  const bankBalanceData = treasury.loading
    ? null
    : {
        currentBalance: treasury.currentCash,
        creditLimit: treasury.bankAccount.creditLineLimit,
        creditUsed: treasury.summary.creditUsed,
      };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(180,204,238,0.38),transparent_24%),radial-gradient(circle_at_top_right,rgba(233,240,250,0.5),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(216,225,241,0.72),transparent_28%),linear-gradient(180deg,#edf2f8_0%,#f3f6fa_42%,#edf1f6_100%)] font-sans text-[12px] text-[#16223f]">
      <Sidebar
        user={user}
        userRole={userRole}
        hasPermission={hasPermission}
        onNewTransaction={handleOpenLauncher}
        bankBalanceData={bankBalanceData}
        bankAccount={treasury.bankAccount}
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="z-20 flex-shrink-0 px-4 pb-0 pt-4 md:px-8 md:pt-6">
          <div className="mx-auto flex max-w-[1280px] items-center justify-between rounded-[30px] border border-[rgba(205,219,243,0.8)] bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(241,248,255,0.84))] px-5 py-4 shadow-[0_24px_70px_rgba(126,147,190,0.12)] backdrop-blur-2xl md:px-7">
            <div className="flex items-center gap-3">
              <MobileMenuButton onClick={() => setIsMobileMenuOpen(true)} />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#5a8ddd]">Control ejecutivo</p>
                <h2 className="mt-1.5 text-[22px] font-semibold tracking-tight text-[#101938] md:text-[28px]">
                  {currentTitle}
                </h2>
                <p className="mt-1.5 hidden text-[12px] text-[#5f7091] md:block">
                  {new Date().toLocaleDateString('es-ES', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
            </div>

            {!loading && (
              <div className="hidden items-center gap-3 md:flex">
                {bankBalanceData && (
                  <div className="flex items-center gap-2 rounded-full border border-[rgba(198,211,236,0.9)] bg-white/72 px-3.5 py-2">
                    <Landmark size={12} className={bankBalanceData.currentBalance >= 0 ? 'text-[#0f8f4b]' : 'text-[#d1463b]'} />
                    <span className={`text-[12px] font-semibold tabular-nums ${bankBalanceData.currentBalance >= 0 ? 'text-[#0f8f4b]' : 'text-[#d1463b]'}`}>
                      €{formatCurrency(bankBalanceData.currentBalance)}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 rounded-full border border-[rgba(198,211,236,0.9)] bg-white/72 px-3.5 py-2">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4d74ff]" />
                  <span className="text-[11px] text-[#5f7091]">
                    {transactions.length} registros históricos visibles
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-8 md:pb-10 md:pt-6">
          <div className="mx-auto max-w-[1280px]">
            {loading ? (
              <LoadingState />
            ) : (
              <Suspense fallback={<LoadingState />}>
                <Routes>
                  <Route
                    path="/"
                    element={
                      hasPermission('dashboard') ? (
                        <Dashboard user={user} setView={setView} onNewTransaction={handleOpenLauncher} />
                      ) : (
                        <Navigate to="/transactions" replace />
                      )
                    }
                  />
                  <Route path="/ingresos" element={<Ingresos userRole={userRole} user={user} onNewTransaction={handleOpenLauncher} />} />
                  <Route path="/gastos" element={<Gastos userRole={userRole} user={user} onNewTransaction={handleOpenLauncher} />} />
                  <Route
                    path="/transactions"
                    element={
                      <TransactionList
                        transactions={transactions}
                        userRole={userRole}
                        searchTerm={searchTerm}
                        setSearchTerm={setSearchTerm}
                        user={user}
                      />
                    }
                  />
                  <Route path="/cashflow" element={<CashFlow user={user} />} />
                  <Route path="/tesoreria" element={<Navigate to="/cashflow" replace />} />
                  <Route path="/reportes" element={<ReportesUnified user={user} />} />
                  <Route path="/configuracion" element={<ConfiguracionUnified user={user} transactions={filteredTransactions} />} />
                  <Route path="/cxc" element={<CXCIndependiente user={user} userRole={userRole} />} />
                  <Route path="/cxp" element={<CXPIndependiente user={user} userRole={userRole} />} />
                  <Route path="/presupuesto" element={<BudgetVsActual user={user} userRole={userRole} />} />
                  <Route path="/conciliacion" element={<Conciliacion user={user} userRole={userRole} />} />
                  <Route path="/alertas" element={<Alertas user={user} userRole={userRole} />} />
                  <Route path="/auditoria" element={<AuditLog user={user} userRole={userRole} />} />
                  <Route path="/adjuntos" element={<Adjuntos user={user} userRole={userRole} />} />
                  <Route path="/recurrencia" element={<Recurrencia user={user} userRole={userRole} />} />
                  <Route path="/import-export" element={<ImportExport user={user} userRole={userRole} />} />
                  <Route path="/balance" element={<BalanceGeneral user={user} userRole={userRole} />} />
                  <Route path="/whatif" element={<WhatIf user={user} />} />
                  <Route path="/proyectos" element={<ProyectoDashboard user={user} userRole={userRole} />} />
                  <Route path="/proyeccion" element={<ProyeccionCashflow user={user} userRole={userRole} />} />
                  <Route path="/multi-moneda" element={<MultiMoneda user={user} userRole={userRole} />} />
                  <Route path="/roles" element={<RolesManager user={user} userRole={userRole} />} />
                  <Route path="/backup" element={<BackupManager user={user} userRole={userRole} />} />
                  <Route path="/perfil" element={<UserProfile user={user} userRole={userRole} />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            )}
          </div>
        </div>
      </main>

      {isActionLauncherOpen && (
        <Suspense fallback={null}>
          <FinanceActionLauncher
            isOpen={isActionLauncherOpen}
            onClose={() => {
              setIsActionLauncherOpen(false);
              setLauncherDefaultAction(null);
            }}
            user={user}
            defaultAction={launcherDefaultAction}
          />
        </Suspense>
      )}

      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        user={user}
        userRole={userRole}
        hasPermission={hasPermission}
        onNewTransaction={handleOpenLauncher}
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
