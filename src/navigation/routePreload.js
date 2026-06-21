const routeLoaders = {
  '/': () => import('../features/resumen/Resumen'),
  '/resumen': () => import('../features/resumen/Resumen'),
  '/ingresos': () => import('../features/ingresos/Ingresos'),
  '/gastos': () => import('../features/gastos/Gastos'),
  '/clasificar': () => import('../features/classifier/Classifier'),
  '/movimientos': () => import('../features/movimientos/Movimientos'),
  '/nominas': () => import('../features/nominas/Nominas'),
  '/empleados': () => import('../features/employees/Employees'),
  '/configuracion': () => import('../features/configuracion/ConfiguracionUnified'),
  '/reglas': () => import('../features/classification-rules/Rules'),
  '/datev': () => import('../features/datev-import/DatevImport'),
};

const preloadCache = new Map();

export const preloadRoute = (path) => {
  if (!routeLoaders[path]) return Promise.resolve(null);
  if (!preloadCache.has(path)) {
    preloadCache.set(path, routeLoaders[path]().catch((error) => {
      preloadCache.delete(path);
      throw error;
    }));
  }
  return preloadCache.get(path);
};

export const preloadRoutes = (paths = []) => Promise.all(paths.map((path) => preloadRoute(path)));
