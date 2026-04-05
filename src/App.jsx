import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import ErrorBoundary from './components/ui/ErrorBoundary';
import ProtectedRoute from './components/layout/ProtectedRoute';
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
const FlujoCajaAnual = lazy(() => import('./features/cashflow/FlujoCajaAnual'));
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
const Partners = lazy(() => import('./features/partners/Partners'));
const FinanceActionLauncher = lazy(() => import('./components/finance/FinanceActionLauncher'));

const VIEW_TITLES = {
 '/': 'Inicio',
 '/ingresos': 'Ingresos',
 '/gastos': 'Gastos',
 '/transactions': 'Transacciones',
 '/cashflow': 'Tesorería',
 '/flujo-caja-anual': 'Flujo Anual',
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
 '/whatif': 'Simulación',
 '/partners': 'Partners',
};

const LoadingState = () => (
 <div className="flex items-center justify-center py-32 animate-fadeIn">
 <p className="font-[Space_Mono] text-[13px] uppercase tracking-[0.08em] text-[var(--text-disabled)]">
 [CARGANDO...]
 </p>
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
 <div className="flex h-full flex-col overflow-hidden bg-[var(--black)] font-sans text-[14px] text-[var(--text-primary)]">
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
 <div className="mx-auto flex max-w-[1280px] items-center justify-between border-b border-[var(--border)] px-2 pb-4 md:px-0">
 <div className="flex items-center gap-3">
 <MobileMenuButton onClick={() => setIsMobileMenuOpen(true)} />
 <div>
 <p className="font-[Space_Mono] text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">Control ejecutivo</p>
 <h2 className="mt-1 text-[22px] font-bold tracking-tight text-[var(--text-display)] md:text-[28px]">
 {currentTitle}
 </h2>
 <p className="mt-1 hidden font-[Space_Mono] text-[11px] text-[var(--text-disabled)] md:block">
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
 <div className="flex items-center gap-2 border border-[var(--border)] px-3.5 py-2 rounded-lg">
 <Landmark size={12} className={bankBalanceData.currentBalance >= 0 ? 'text-[var(--success)]' : 'text-[var(--negative)]'} />
 <span className={`font-[Space_Mono] text-[12px] font-bold tabular-nums ${bankBalanceData.currentBalance >= 0 ? 'text-[var(--success)]' : 'text-[var(--negative)]'}`}>
 {formatCurrency(bankBalanceData.currentBalance)}
 </span>
 </div>
 )}
 <div className="flex items-center gap-2 border border-[var(--border)] px-3.5 py-2 rounded-lg">
 <div className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
 <span className="font-[Space_Mono] text-[11px] text-[var(--text-disabled)]">
 {transactions.length} registros
 </span>
 </div>
 </div>
 )}
 </div>
 </div>

 <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-8 md:pb-10 md:pt-6">
 <div ref={contentRef} className="mx-auto max-w-[1280px] transition-opacity duration-150">
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
 <Route path="/ingresos" element={<ProtectedRoute hasPermission={hasPermission} permission="transactions"><Ingresos userRole={userRole} user={user} onNewTransaction={handleOpenLauncher} /></ProtectedRoute>} />
 <Route path="/gastos" element={<ProtectedRoute hasPermission={hasPermission} permission="transactions"><Gastos userRole={userRole} user={user} onNewTransaction={handleOpenLauncher} /></ProtectedRoute>} />
 <Route
 path="/transactions"
 element={
 <ProtectedRoute hasPermission={hasPermission} permission="dashboard">
 <TransactionList
 transactions={transactions}
 userRole={userRole}
 searchTerm={searchTerm}
 setSearchTerm={setSearchTerm}
 user={user}
 />
 </ProtectedRoute>
 }
 />
 <Route path="/cashflow" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><CashFlow user={user} /></ProtectedRoute>} />
             <Route path="/flujo-caja-anual" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><FlujoCajaAnual user={user} /></ProtectedRoute>} />
 <Route path="/tesoreria" element={<Navigate to="/cashflow" replace />} />
 <Route path="/reportes" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><ReportesUnified user={user} /></ProtectedRoute>} />
 <Route path="/configuracion" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><ConfiguracionUnified user={user} transactions={filteredTransactions} /></ProtectedRoute>} />
 <Route path="/cxc" element={<ProtectedRoute hasPermission={hasPermission} permission="cxc"><CXCIndependiente user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/cxp" element={<ProtectedRoute hasPermission={hasPermission} permission="cxp"><CXPIndependiente user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/presupuesto" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><BudgetVsActual user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/conciliacion" element={<ProtectedRoute hasPermission={hasPermission} permission="cxp"><Conciliacion user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/alertas" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><Alertas user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/auditoria" element={<ProtectedRoute hasPermission={hasPermission} permission="audit"><AuditLog user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/adjuntos" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Adjuntos user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/recurrencia" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Recurrencia user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/import-export" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><ImportExport user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/balance" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><BalanceGeneral user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/whatif" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><WhatIf user={user} /></ProtectedRoute>} />
 <Route path="/proyectos" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><ProyectoDashboard user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/proyeccion" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><ProyeccionCashflow user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/multi-moneda" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><MultiMoneda user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/roles" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><RolesManager user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/backup" element={<ProtectedRoute hasPermission={hasPermission} permission="backup"><BackupManager user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/perfil" element={<UserProfile user={user} userRole={userRole} />} />
 <Route path="/partners" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Partners user={user} userRole={userRole} /></ProtectedRoute>} />
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
