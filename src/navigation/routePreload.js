const routeLoaders = {
  '/': () => import('../features/dashboard/Dashboard'),
  '/ingresos': () => import('../features/ingresos/Ingresos'),
  '/gastos': () => import('../features/gastos/Gastos'),
  '/transactions': () => import('../features/transactions/TransactionList'),
  '/cashflow': () => import('../features/cashflow/CashFlow'),
  '/tesoreria': () => import('../features/cashflow/CashFlow'),
  '/reportes': () => import('../features/reportes/ReportesUnified'),
  '/configuracion': () => import('../features/configuracion/ConfiguracionUnified'),
  '/cxc': () => import('../features/cxc/CXCIndependiente'),
  '/cxp': () => import('../features/cxp/CXPIndependiente'),
  '/presupuesto': () => import('../features/presupuesto/BudgetVsActual'),
  '/conciliacion': () => import('../features/conciliacion/Conciliacion'),
  '/alertas': () => import('../features/alertas/Alertas'),
  '/auditoria': () => import('../features/auditoria/AuditLog'),
  '/adjuntos': () => import('../features/adjuntos/Adjuntos'),
  '/recurrencia': () => import('../features/recurrencia/Recurrencia'),
  '/import-export': () => import('../features/importexport/ImportExport'),
  '/balance': () => import('../features/balance/BalanceGeneral'),
  '/proyectos': () => import('../features/proyectos/ProyectoDashboard'),
  '/proyeccion': () => import('../features/cashflow/ProyeccionCashflow'),
  '/multi-moneda': () => import('../features/multimoneda/MultiMoneda'),
  '/roles': () => import('../features/roles/RolesManager'),
  '/backup': () => import('../features/backup/BackupManager'),
  '/perfil': () => import('../features/perfil/UserProfile'),
};

const preloadCache = new Map();

export const preloadRoute = (path) => {
  const normalizedPath = path === '/tesoreria' ? '/cashflow' : path;
  if (!routeLoaders[normalizedPath]) return Promise.resolve(null);
  if (!preloadCache.has(normalizedPath)) {
    preloadCache.set(normalizedPath, routeLoaders[normalizedPath]().catch((error) => {
      preloadCache.delete(normalizedPath);
      throw error;
    }));
  }
  return preloadCache.get(normalizedPath);
};

export const preloadRoutes = (paths = []) => Promise.all(paths.map((path) => preloadRoute(path)));
