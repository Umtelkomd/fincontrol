const routeLoaders = {
  '/ingresos': () => import('../features/ingresos/Ingresos'),
  '/gastos': () => import('../features/gastos/Gastos'),
  '/configuracion': () => import('../features/configuracion/ConfiguracionUnified'),
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
