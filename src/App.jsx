import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ui/ErrorBoundary';
import ProtectedRoute from './components/layout/ProtectedRoute';
import Sidebar from './components/layout/Sidebar';
import MobileMenu, { MobileMenuButton } from './components/layout/MobileMenu';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { FinanceLedgerProvider, useFinanceLedgerContext } from './contexts/FinanceLedgerContext';
import Login from './features/auth/Login';
import { useAuth } from './hooks/useAuth';
import { useFilters } from './hooks/useFilters';
import { useTransactions } from './hooks/useTransactions';

const Resumen = lazy(() => import('./features/resumen/Resumen'));
const CashFlow = lazy(() => import('./features/cashflow/CashFlow'));
const FlujoCajaAnual = lazy(() => import('./features/cashflow/FlujoCajaAnual'));
const ReportesUnified = lazy(() => import('./features/reportes/ReportesUnified'));
const ConfiguracionUnified = lazy(() => import('./features/configuracion/ConfiguracionUnified'));
const CXCIndependiente = lazy(() => import('./features/cxc/CXCIndependiente'));
const BatchReconciliation = lazy(() => import('./features/cxc/BatchReconciliation'));
const CXPIndependiente = lazy(() => import('./features/cxp/CXPIndependiente'));
const BudgetVsActual = lazy(() => import('./features/presupuesto/BudgetVsActual'));
const AuditLog = lazy(() => import('./features/auditoria/AuditLog'));
const ProyectoDashboard = lazy(() => import('./features/proyectos/ProyectoDashboard'));
const ProyeccionCashflow = lazy(() => import('./features/cashflow/ProyeccionCashflow'));
const RolesManager = lazy(() => import('./features/roles/RolesManager'));
const BackupManager = lazy(() => import('./features/backup/BackupManager'));
const UserProfile = lazy(() => import('./features/perfil/UserProfile'));
const Employees = lazy(() => import('./features/employees/Employees'));
const Properties = lazy(() => import('./features/properties/Properties'));
const Vehicles = lazy(() => import('./features/vehicles/Vehicles'));
const Insurances = lazy(() => import('./features/insurances/Insurances'));
const DatevImport = lazy(() => import('./features/datev-import/DatevImport'));
const Classifier = lazy(() => import('./features/classifier/Classifier'));
const Movimientos = lazy(() => import('./features/movimientos/Movimientos'));
const Rules = lazy(() => import('./features/classification-rules/Rules'));
const AlertasOperativas = lazy(() => import('./features/alertas-op/AlertasOperativas'));
const Nominas = lazy(() => import('./features/nominas/Nominas'));
const FinanceActionLauncher = lazy(() => import('./components/finance/FinanceActionLauncher'));

const LoadingState = () => (
 <div className="flex items-center justify-center py-32 animate-fadeIn">
 <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
 Cargando…
 </p>
 </div>
);

// AppContent — only rendered when user is authenticated (provider already mounted).
function AppContent({ user, userRole, hasPermission }) {
 useToast();
 // The legacy `transactions` collection only feeds Configuración; the shell
 // must not wait for it. Screens gate themselves on `ledger.loading`.
 const { transactions } = useTransactions(user);
 // Header balance comes from the shared ledger (no extra listeners needed here).
 const ledger = useFinanceLedgerContext();
 const {
 filteredTransactions,
 } = useFilters(transactions);

 const [isActionLauncherOpen, setIsActionLauncherOpen] = useState(false);
 const [launcherDefaultAction, setLauncherDefaultAction] = useState(null);
 const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

 const handleOpenLauncher = (defaultAction = null) => {
 setLauncherDefaultAction(defaultAction);
 setIsActionLauncherOpen(true);
 };

 // Cmd+K / Ctrl+K global shortcut to open the action launcher
 useEffect(() => {
 const handleKeyDown = (event) => {
 if (!(event.metaKey || event.ctrlKey) || event.key !== 'k') return;
 // Don't fire while the user is typing in a form element
 const tag = document.activeElement?.tagName?.toLowerCase();
 if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
 // Don't fire if a modal is already open (check for common aria-modal)
 if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
 event.preventDefault();
 handleOpenLauncher();
 };
 window.addEventListener('keydown', handleKeyDown);
 return () => window.removeEventListener('keydown', handleKeyDown);
 }, [isActionLauncherOpen]);

 const bankBalanceData = ledger.loading
 ? null
 : {
 currentBalance: ledger.summary.currentCash,
 creditLimit: ledger.bankAccount.creditLineLimit,
 creditUsed: ledger.summary.creditUsed,
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
 bankAccount={ledger.bankAccount}
 />

 <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
  {/* Mobile top row: the desktop top bar is hidden below `md`, so the menu
      button lives here. Every page renders its own <PageHeader>. */}
  <div className="flex flex-shrink-0 items-center gap-3 px-4 pt-4 md:hidden">
  <MobileMenuButton onClick={() => setIsMobileMenuOpen(true)} />
  <p
  className="text-[16px] leading-none text-[var(--color-fg-1)]"
  style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.02em' }}
  >
  NEXUS<span style={{ color: 'var(--color-accent)' }}>.OS</span>
  </p>
  </div>

 <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-8 md:pb-10 md:pt-6">
 <Suspense fallback={<LoadingState />}>
 <Routes>
 <Route path="/" element={<Navigate to="/resumen" replace />} />
 <Route
 path="/resumen"
 element={
 <ProtectedRoute hasPermission={hasPermission} permission="dashboard">
 <Resumen user={user} />
 </ProtectedRoute>
 }
 />
 <Route path="/cashflow" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><CashFlow user={user} /></ProtectedRoute>} />
             <Route path="/flujo-caja-anual" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><FlujoCajaAnual user={user} /></ProtectedRoute>} />
 <Route path="/tesoreria" element={<Navigate to="/cashflow" replace />} />
 <Route path="/reportes" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><ReportesUnified user={user} /></ProtectedRoute>} />
 <Route path="/configuracion" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><ConfiguracionUnified user={user} transactions={filteredTransactions} /></ProtectedRoute>} />
 <Route path="/cxc" element={<ProtectedRoute hasPermission={hasPermission} permission="cxc"><CXCIndependiente user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/cxc/remesas" element={<ProtectedRoute hasPermission={hasPermission} permission="cxc"><BatchReconciliation user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/cxp" element={<ProtectedRoute hasPermission={hasPermission} permission="cxp"><CXPIndependiente user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/presupuesto" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><BudgetVsActual user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/auditoria" element={<ProtectedRoute hasPermission={hasPermission} permission="audit"><AuditLog user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/proyectos" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><ProyectoDashboard user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/proyeccion" element={<ProtectedRoute hasPermission={hasPermission} permission="reports"><ProyeccionCashflow user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/roles" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><RolesManager user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/backup" element={<ProtectedRoute hasPermission={hasPermission} permission="backup"><BackupManager user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/perfil" element={<UserProfile user={user} userRole={userRole} />} />
 <Route path="/empleados" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Employees user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/viviendas" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Properties user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/vehiculos" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Vehicles user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/seguros" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Insurances user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/datev" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><DatevImport user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/clasificar" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Classifier user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/movimientos" element={<ProtectedRoute hasPermission={hasPermission} permission="dashboard"><Movimientos user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/reglas" element={<ProtectedRoute hasPermission={hasPermission} permission="settings"><Rules user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/alertas-op" element={<ProtectedRoute hasPermission={hasPermission} permission="dashboard"><AlertasOperativas user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="/nominas" element={<ProtectedRoute hasPermission={hasPermission} permission="cxp"><Nominas user={user} userRole={userRole} /></ProtectedRoute>} />
 <Route path="*" element={<Navigate to="/" replace />} />
 </Routes>
 </Suspense>
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

// AppGate — resolves auth state. Shows Login until user is present, then mounts
// FinanceLedgerProvider (so Firestore listeners only open after authentication)
// and hands off to AppContent.
function AppGate() {
 useToast();
 const { user, userRole, hasPermission, loading: authLoading } = useAuth();

 if (authLoading) {
 return <LoadingState />;
 }

 if (!user) {
 return <Login />;
 }

 return (
 <FinanceLedgerProvider user={user}>
 <AppContent user={user} userRole={userRole} hasPermission={hasPermission} />
 </FinanceLedgerProvider>
 );
}

function App() {
 return (
 <ErrorBoundary>
 <ToastProvider>
 <AppGate />
 </ToastProvider>
 </ErrorBoundary>
 );
}

export default App;
