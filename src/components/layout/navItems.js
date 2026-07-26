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

// Shared shell navigation. Keep route exposure decisions here so desktop and
// mobile cannot drift apart.
// Routes still in App.jsx but NOT exposed here (accessible by URL only):
//   /backup, /roles, /auditoria, /perfil, /proyeccion

export const NAV_GROUPS = [
  {
    key: 'operativo',
    label: 'Operativo',
    items: [
      { path: '/resumen', label: 'Resumen', icon: Home, permission: 'dashboard' },
      { path: '/clasificar', label: 'Bandeja', icon: Inbox, permission: 'settings' },
      { path: '/movimientos', label: 'Movimientos', icon: Database, permission: 'dashboard' },
      { path: '/cashflow', label: 'Tesoreria', icon: WalletCards, permission: 'reports' },
      { path: '/cxc', label: 'CXC', icon: ReceiptText, permission: 'cxc' },
      { path: '/cxp', label: 'CXP', icon: ReceiptText, permission: 'cxp' },
      { path: '/nominas', label: 'Nóminas', icon: WalletCards, permission: 'cxp' },
      { path: '/alertas-op', label: 'Alertas', icon: Bell, permission: 'dashboard' },
    ],
  },
  {
    key: 'reportes',
    label: 'Reportes',
    items: [
      { path: '/flujo-caja-anual', label: 'Flujo Anual', icon: TableProperties, permission: 'reports' },
      { path: '/reportes', label: 'Reportes', icon: BarChart3, permission: 'reports' },
      { path: '/proyectos', label: 'Proyectos', icon: FolderKanban, permission: 'reports' },
      { path: '/presupuesto', label: 'Presupuesto', icon: Briefcase, permission: 'reports' },
    ],
  },
  {
    key: 'maestros',
    label: 'Datos maestros',
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
