import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import ErrorBoundary from './components/ui/ErrorBoundary';
import ProtectedRoute from './components/layout/ProtectedRoute';
import Sidebar from './components/layout/Sidebar';
import MobileMenu, { MobileMenuButton } from './components/layout/MobileMenu';
import NexusMark from './components/brand/NexusMark';
import { ToastProvider, useToast } from './contexts/ToastContext';
import Login from './features/auth/Login';
import { useAuth } from './hooks/useAuth';
import { useFilters } from './hooks/useFilters';
import { useTransactions } from './hooks/useTransactions';
import { useTreasuryMetrics } from './hooks/useTreasuryMetrics';
import { formatCurrency } from './utils/formatters';

const Resumen = lazy(() => import('./features/resumen/Resumen'));
const Ingresos = lazy(() => import('./features/ingresos/Ingresos'));
const Gastos = lazy(() => import('./features/gastos/Gastos'));
const ConfiguracionUnified = lazy(() => import('./features/configuracion/ConfiguracionUnified'));
const Employees = lazy(() => import('./features/employees/Employees'));
const DatevImport = lazy(() => import('./features/datev-import/DatevImport'));
const Classifier = lazy(() => import('./features/classifier/Classifier'));
const Movimientos = lazy(() => import('./features/movimientos/Movimientos'));
const Rules = lazy(() => import('./features/classification-rules/Rules'));
const Nominas = lazy(() => import('./features/nominas/Nominas'));
const FinanceActionLauncher = lazy(() => import('./components/finance/FinanceActionLauncher'));

const VIEW_TITLES = {
  '/': 'Resumen',
  '/resumen': 'Resumen',
  '/ingresos': 'Ingresos',
  '/gastos': 'Gastos',
  '/configuracion': 'Configuración',
  '/nominas': 'Nóminas',
  '/empleados': 'Empleados',
  '/datev': 'Importar DATEV',
  '/clasificar': 'Bandeja semanal',
  '/movimientos': 'Movimientos bancarios',
  '/reglas': 'Reglas de clasificación',
};

const LoadingState = () => (
 <div className="flex items-center justify-center py-32 animate-fadeIn">
 <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
 Cargando…
 </p>
 </div>
);

function AppContent() {
 useToast();
 const { user, userRole, hasPermission, loading: authLoading } = useAuth();
 const { transactions, loading: transactionsLoading } = useTransactions(user);
 const treasury = useTreasuryMetrics({ user });
 const {
 filteredTransactions,
 } = useFilters(transactions);

 const location = useLocation();

 const [isActionLauncherOpen, setIsActionLauncherOpen] = useState(false);
 const [launcherDefaultAction, setLauncherDefaultAction] = useState(null);
 const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

 const loading = authLoading || transactionsLoading;
 const currentTitle = VIEW_TITLES[location.pathname] || 'Inicio';

 const contentRef = useRef(null);
 const prevPathRef = useRef(location.pathname);
 useEffect(() => {
 if (prevPathRef.current !== location.pathname) {
 prevPathRef.current = location.pathname;
 const el = contentRef.current;
 if (el) {
 el.style.opacity = '0';
 requestAnimationFrame(() => {
 el.style.opacity = '1';
 });
 }
 }
 }, [location.pathname]);

 if (!user) {
 return <Login />;
 }

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
 <div className="relative flex h-full flex-col overflow-hidden bg-[var(--color-bg-0)] font-sans text-[14px] text-[var(--color-fg-1)]">
  <div aria-hidden="true" className="fixed inset-x-0 top-0 z-[300] h-[3px] bg-[var(--color-accent)]" />
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
  <div className="relative flex flex-wrap items-end justify-between gap-4 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-5 py-5">
  <div aria-hidden="true" className="absolute bottom-[-18px] right-5 font-display text-[86px] font-medium leading-none tracking-[-0.08em] text-[var(--color-fg-1)] opacity-[0.025] md:text-[124px]">
  NEXUS
  </div>
  <div className="relative flex items-center gap-4">
  <MobileMenuButton onClick={() => setIsMobileMenuOpen(true)} />
  <div className="hidden h-14 w-14 items-center justify-center rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-0)] md:flex">
  <NexusMark size={34} title="NEXUS" />
  </div>
  <div>
  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]">NEXUS.OS // UMTELKOMD FINANCE</p>
  <h1
  className="mt-1 font-display text-[34px] font-light leading-[0.95] tracking-[-0.04em] text-[var(--color-fg-1)] md:text-[46px]"
  >
  {currentTitle}
 </h1>
 <p className="mt-2 hidden font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-4)] md:block">
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
  <div className="relative hidden items-center gap-2 md:flex">
 {bankBalanceData && (
  <div className="flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3.5 py-2">
 <Landmark size={12} className={bankBalanceData.currentBalance >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'} />
 <span className={`font-mono text-[12px] font-medium tabular-nums ${bankBalanceData.currentBalance >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
 {formatCurrency(bankBalanceData.currentBalance)}
 </span>
 </div>
 )}
  <div className="flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3.5 py-2">
 <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-ok)]" />
 <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
 {transactions.length} registros
 </span>
 </div>
 </div>
 )}
 </div>
 </div>

 <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-8 md:pb-10 md:pt-6">
 <div ref={contentRef} className="transition-opacity duration-150">
 {loading ? (
 <LoadingState />
 ) : (
 <Suspense fallback={<LoadingState />}>
 <Routes>
 <Route
 path="/"
 element={
 hasPermission('dashboard') ? (
 <Resumen user={user} />
 ) : (
  <Navigate to="/ingresos" replace />
 )
 }
 />
 <Route
 path="/resumen"
 element={
 <ProtectedRoute hasPermission={hasPermission} permission="dashboard">
 <Resumen user={user} />
 </ProtectedRoute>
 }
 />
 <Route path="/ingresos" element={<ProtectedRoute hasPermission={hasPermission} permission="transactions"><Ingresos userRole={userRole} user={user} onNewTransaction={handleOpenLauncher} /></ProtectedRoute>} />
  <Route path="/gastos" element={<ProtectedRoute hasPermission={hasPermission} permission="transactions"><Gastos userRole={userRole} user={user} onNewTransaction={handleOpenLauncher} /></ProtectedRoute>} />
  <Route path="/configuracion" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><ConfiguracionUnified user={user} transactions={filteredTransactions} /></ProtectedRoute>} />
   <Route path="/empleados" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Employees user={user} userRole={userRole} /></ProtectedRoute>} />
  <Route path="/datev" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><DatevImport user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/clasificar" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Classifier user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/movimientos" element={<ProtectedRoute hasPermission={hasPermission} permission="dashboard"><Movimientos user={user} userRole={userRole} /></ProtectedRoute>} />
  <Route path="/reglas" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Rules user={user} userRole={userRole} /></ProtectedRoute>} />
  <Route path="/nominas" element={<ProtectedRoute hasPermission={hasPermission} permission="cxp"><Nominas user={user} userRole={userRole} /></ProtectedRoute>} />
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
