import {
  ArrowDownCircle,
  ArrowUpCircle,
  Database,
  HardHat,
  Home,
  Inbox,
  Settings,
  WalletCards,
  Wand2,
} from 'lucide-react';

// Shared shell navigation. Keep route exposure decisions here so desktop and
// mobile cannot drift apart.
export const NAV_ITEMS = [
  // Operativo
  { path: '/resumen', label: 'Resumen', icon: Home, permission: 'dashboard' },
  { path: '/ingresos', label: 'Ingresos', icon: ArrowUpCircle, permission: 'transactions' },
  { path: '/gastos', label: 'Gastos', icon: ArrowDownCircle, permission: 'transactions' },
  { path: '/clasificar', label: 'Bandeja', icon: Inbox, permission: 'settings' },
  { path: '/movimientos', label: 'Movimientos', icon: Database, permission: 'dashboard' },
  { path: '/nominas', label: 'Nóminas', icon: WalletCards, permission: 'cxp' },
  // Datos maestros
  { path: '/empleados', label: 'Empleados', icon: HardHat, permission: 'settings' },
  // Configuración
  { path: '/reglas', label: 'Reglas', icon: Wand2, permission: 'settings' },
  { path: '/datev', label: 'DATEV', icon: Database, permission: 'settings' },
  { path: '/configuracion', label: 'Config', icon: Settings, permission: 'settings' },
];
