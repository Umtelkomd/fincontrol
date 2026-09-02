import {
  BarChart3,
  Bell,
  Briefcase,
  Car,
  Database,
  FolderKanban,
  HardHat,
  Home,
  Inbox,
  ReceiptText,
  Shield,
  Settings,
  TableProperties,
  WalletCards,
  Wand2,
} from 'lucide-react';

// Shared shell navigation, grouped by routine: what you DO every week
// (Operar), what you LOOK AT (Ver), the master data behind it (Maestros) and
// the switches (Configuración). Keep route exposure decisions here so desktop
// and mobile cannot drift apart.
// Routes still in App.jsx but NOT exposed here (accessible by URL only):
//   /backup, /roles, /auditoria, /perfil, /proyeccion

export const DEFAULT_GROUP_KEY = 'operativo';

export const NAV_GROUPS = [
  {
    key: 'operativo',
    label: 'Operar',
    items: [
      { path: '/resumen', label: 'Resumen', icon: Home, permission: 'dashboard' },
      { path: '/clasificar', label: 'Bandeja', icon: Inbox, permission: 'settings' },
      { path: '/movimientos', label: 'Movimientos', icon: Database, permission: 'dashboard' },
      { path: '/cashflow', label: 'Tesorería', icon: WalletCards, permission: 'reports' },
      { path: '/cxc', label: 'CXC', icon: ReceiptText, permission: 'cxc' },
      { path: '/cxp', label: 'CXP', icon: ReceiptText, permission: 'cxp' },
      { path: '/nominas', label: 'Nóminas', icon: WalletCards, permission: 'cxp' },
      { path: '/alertas-op', label: 'Alertas', icon: Bell, permission: 'dashboard' },
    ],
  },
  {
    key: 'reportes',
    label: 'Ver',
    items: [
      { path: '/flujo-caja-anual', label: 'Flujo Anual', icon: TableProperties, permission: 'reports' },
      { path: '/reportes', label: 'Reportes', icon: BarChart3, permission: 'reports' },
      { path: '/proyectos', label: 'Proyectos', icon: FolderKanban, permission: 'reports' },
      { path: '/presupuesto', label: 'Presupuesto', icon: Briefcase, permission: 'reports' },
    ],
  },
  {
    key: 'maestros',
    label: 'Maestros',
    items: [
      { path: '/empleados', label: 'Empleados', icon: HardHat, permission: 'settings' },
      { path: '/vehiculos', label: 'Vehículos', icon: Car, permission: 'settings' },
      { path: '/viviendas', label: 'Viviendas', icon: Home, permission: 'settings' },
      { path: '/seguros', label: 'Seguros', icon: Shield, permission: 'settings' },
    ],
  },
  {
    key: 'configuracion',
    label: 'Configuración',
    items: [
      { path: '/reglas', label: 'Reglas', icon: Wand2, permission: 'settings' },
      { path: '/datev', label: 'DATEV', icon: Database, permission: 'settings' },
      { path: '/configuracion', label: 'Config', icon: Settings, permission: 'settings' },
    ],
  },
];

// Flat list for consumers that don't need group metadata (backward compat)
export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/** Path without query/hash and without a trailing slash; `/` stays `/`. */
const normalizePath = (value) => {
  const bare = String(value ?? '').split('?')[0].split('#')[0];
  if (bare.length > 1 && bare.endsWith('/')) return bare.slice(0, -1);
  return bare || '/';
};

/**
 * isItemActive — prefix match on PATH BOUNDARIES.
 *
 * `/cxc/remesas` activates the `/cxc` item; `/cxcx` does not. The old shell
 * used exact matching, so nested routes lit up nothing in the nav.
 */
export const isItemActive = (pathname, item) => {
  if (!item?.path) return false;
  const current = normalizePath(pathname);
  const target = normalizePath(item.path);
  if (target === '/') return current === '/';
  return current === target || current.startsWith(`${target}/`);
};

/**
 * activeGroupKey — the group owning the longest item path that matches the
 * current route. Routes no item owns (`/`, `/perfil`) fall back to Operar.
 */
export const activeGroupKey = (pathname, groups = NAV_GROUPS) => {
  let bestKey = null;
  let bestLength = -1;
  (groups || []).forEach((group) => {
    (group.items || []).forEach((item) => {
      if (isItemActive(pathname, item) && item.path.length > bestLength) {
        bestKey = group.key;
        bestLength = item.path.length;
      }
    });
  });
  return bestKey ?? DEFAULT_GROUP_KEY;
};

/**
 * visibleNavGroups — the permission filter desktop and mobile both apply:
 * keep the items the role may open, drop the groups that end up empty.
 * Returns new objects; NAV_GROUPS is never mutated.
 */
export const visibleNavGroups = (hasPermission, groups = NAV_GROUPS) => {
  const allowed = (item) =>
    !item.permission || (typeof hasPermission === 'function' && hasPermission(item.permission));
  return (groups || [])
    .map((group) => ({ ...group, items: (group.items || []).filter(allowed) }))
    .filter((group) => group.items.length > 0);
};
