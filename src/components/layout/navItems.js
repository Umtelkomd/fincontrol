import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Car,
  Database,
  FolderKanban,
  HardHat,
  Home,
  Inbox,
  ReceiptText,
  Repeat,
  Shield,
  Settings,
  SlidersHorizontal,
  TableProperties,
  WalletCards,
  Wand2,
} from 'lucide-react';

// Shared shell navigation. Keep route exposure decisions here so desktop and
// mobile cannot drift apart.
// Routes still in App.jsx but NOT exposed here (accessible by URL only):
//   /conciliacion — DATEV ya viene reconciliado, queda como herramienta avanzada
//   /import-export — reemplazado por /datev
//   /transactions — "Mesa central" legacy; las vistas operativas son CXC/CXP/DATEV
export const NAV_ITEMS = [
  // Operativo
  { path: '/resumen', label: 'Resumen', icon: Home, permission: 'dashboard' },
  { path: '/cfo', label: 'CFO', icon: Briefcase, permission: 'reports', accent: '.OS' },
  { path: '/clasificar', label: 'Bandeja', icon: Inbox, permission: 'settings' },
  { path: '/movimientos', label: 'Movimientos', icon: Database, permission: 'dashboard' },
  { path: '/cashflow', label: 'Tesoreria', icon: WalletCards, permission: 'reports' },
  { path: '/cxc', label: 'CXC', icon: ReceiptText, permission: 'cxc' },
  { path: '/cxp', label: 'CXP', icon: ReceiptText, permission: 'cxp' },
  { path: '/nominas', label: 'Nóminas', icon: WalletCards, permission: 'cxp' },
  { path: '/alertas-op', label: 'Alertas', icon: Bell, permission: 'dashboard' },
  // Reportes
  { path: '/flujo-caja-anual', label: 'Flujo Anual', icon: TableProperties, permission: 'reports' },
  { path: '/reportes', label: 'Reportes', icon: BarChart3, permission: 'reports' },
  { path: '/proyectos', label: 'Proyectos', icon: FolderKanban, permission: 'reports' },
  { path: '/presupuesto', label: 'Presupuesto', icon: Briefcase, permission: 'reports' },
  { path: '/whatif', label: 'Simulador', icon: SlidersHorizontal, permission: 'reports' },
  // Datos maestros
  { path: '/empleados', label: 'Empleados', icon: HardHat, permission: 'settings' },
  { path: '/vehiculos', label: 'Vehículos', icon: Car, permission: 'settings' },
  { path: '/viviendas', label: 'Viviendas', icon: Home, permission: 'settings' },
  { path: '/seguros', label: 'Seguros', icon: Shield, permission: 'settings' },
  { path: '/partners', label: 'Partners', icon: Building2, permission: 'settings' },
  // Configuración
  { path: '/costos-recurrentes', label: 'Recurrentes', icon: Repeat, permission: 'settings' },
  { path: '/reglas', label: 'Reglas', icon: Wand2, permission: 'settings' },
  { path: '/datev', label: 'DATEV', icon: Database, permission: 'settings' },
  { path: '/configuracion', label: 'Config', icon: Settings, permission: 'settings' },
];
