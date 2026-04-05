import { signOut } from 'firebase/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import {
 ArrowLeftRight,
 BarChart3,
 Briefcase,
 Building2,
 FolderKanban,
 Globe,
 Landmark,
 LayoutDashboard,
 LogOut,
 Plus,
 ReceiptText,
 Scale,
 Settings,
 SlidersHorizontal,
 TableProperties,
 WalletCards,
} from 'lucide-react';
import { auth } from '../../services/firebase';
import { formatCurrency } from '../../utils/formatters';

const NAV_ITEMS = [
 { path: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard' },
 { path: '/cashflow', label: 'Tesoreria', icon: WalletCards, permission: 'reports' },
 { path: '/flujo-caja-anual', label: 'Flujo Anual', icon: TableProperties, permission: 'reports' },
 { path: '/transactions', label: 'Transacciones', icon: Landmark, permission: 'dashboard' },
 { path: '/cxc', label: 'CXC', icon: ReceiptText, permission: 'cxc' },
 { path: '/cxp', label: 'CXP', icon: ReceiptText, permission: 'cxp' },
 { path: '/reportes', label: 'Reportes', icon: BarChart3, permission: 'reports' },
 { path: '/proyectos', label: 'Proyectos', icon: FolderKanban, permission: 'reports' },
 { path: '/presupuesto', label: 'Presupuesto', icon: Briefcase, permission: 'reports' },
 { path: '/whatif', label: 'Simulador', icon: SlidersHorizontal, permission: 'reports' },
 { path: '/conciliacion', label: 'Conciliacion', icon: Scale, permission: 'cxp' },
 { path: '/import-export', label: 'Importar', icon: ArrowLeftRight, permission: 'settings' },
 { path: '/configuracion', label: 'Config', icon: Settings, permission: 'settings' },
 { path: '/partners', label: 'Partners', icon: Building2, permission: 'settings' },
];

const Sidebar = ({ user, userRole, hasPermission, onNewTransaction, bankBalanceData, bankAccount }) => {
 const navigate = useNavigate();
 const location = useLocation();
 const visibleItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

 const handleLogout = async () => {
 if (!window.confirm('¿Estás seguro que deseas cerrar sesión?')) return;
 try {
 await signOut(auth);
 } catch (error) {
 console.error('Error al cerrar sesión:', error);
 }
 };

 return (
 <header className="hidden border-b border-[var(--border)] bg-[var(--black)] text-[var(--text-primary)] md:block">
 <div className="mx-auto max-w-[1280px] px-5 py-4">
 {/* Top row: brand + actions */}
 <div className="flex items-center justify-between gap-4">
 <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-3">
 <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border-visible)] bg-[var(--surface)]">
 <Briefcase size={16} className="text-[var(--text-primary)]" />
 </div>
 <div className="min-w-0">
 <h1 className="truncate font-[Doto] text-[16px] font-bold uppercase tracking-[0.04em] text-[var(--text-display)]">
 FinControl
 </h1>
 <p className="truncate font-[Space_Mono] text-[9px] uppercase tracking-[0.18em] text-[var(--text-disabled)]">
 Operations Console
 </p>
 </div>
 </button>

 <div className="flex flex-wrap items-center justify-end gap-2">
 {bankBalanceData && (
 <div className="border border-[var(--border)] px-3.5 py-2 text-right rounded-lg">
 <p className="font-[Space_Mono] text-[9px] uppercase tracking-[0.18em] text-[var(--text-disabled)]">Caja</p>
 <p className={`font-[Space_Mono] text-[12px] font-bold tabular-nums ${
 bankBalanceData.currentBalance >= 0 ? 'text-[var(--success)]' : 'text-[var(--negative)]'
 }`}>
 {formatCurrency(bankBalanceData.currentBalance)}
 </p>
 </div>
 )}

 <button
 type="button"
 onClick={() => navigate('/perfil')}
 className="inline-flex max-w-[200px] items-center gap-2.5 border border-[var(--border)] px-3.5 py-2 text-left transition-colors hover:border-[var(--border-visible)] rounded-lg"
 >
 <div className="flex h-7 w-7 items-center justify-center border border-[var(--border-visible)] font-[Space_Mono] text-[11px] font-bold text-[var(--text-primary)] rounded-lg">
 {(user?.displayName || user?.email || '?')[0].toUpperCase()}
 </div>
 <div className="min-w-0">
 <p className="truncate text-[12px] text-[var(--text-primary)]">{user?.displayName || user?.email}</p>
 <p className="font-[Space_Mono] text-[9px] uppercase tracking-[0.16em] text-[var(--text-disabled)]">
 {userRole === 'admin' ? 'Admin' : userRole === 'manager' ? 'Manager' : 'Editor'}
 </p>
 </div>
 </button>

 <button
 type="button"
 className="flex h-9 w-9 items-center justify-center border border-[var(--border)] text-[var(--text-disabled)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-visible)] rounded-lg"
 title={bankAccount?.name || bankAccount?.bankName || 'Cuenta principal'}
 aria-label="Cuenta bancaria"
 >
 <Globe size={14} />
 </button>

 <button
 type="button"
 onClick={() => onNewTransaction()}
 className="inline-flex items-center gap-2 rounded-full bg-[var(--text-display)] px-5 py-2.5 font-[Space_Mono] text-[11px] uppercase tracking-[0.06em] text-[var(--black)] transition-opacity hover:opacity-85"
 title="Crear registro financiero"
 >
 <Plus size={14} />
 Crear
 </button>

 <button
 type="button"
 onClick={handleLogout}
 className="flex h-9 w-9 items-center justify-center border border-[var(--border)] text-[var(--text-disabled)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-visible)] rounded-lg"
 aria-label="Cerrar sesión"
 >
 <LogOut size={14} />
 </button>
 </div>
 </div>

 {/* Nav row */}
 <nav className="mt-4 flex flex-wrap items-center gap-0">
 {visibleItems.map((item) => {
 const Icon = item.icon;
 const active = location.pathname === item.path;
 return (
 <button
 key={item.path}
 type="button"
 onClick={() => navigate(item.path)}
 className={`inline-flex items-center gap-2 px-3 py-2 font-[Space_Mono] text-[11px] uppercase tracking-[0.06em] transition-colors ${
 active
 ? 'text-[var(--text-display)] border-b border-[var(--text-display)]'
 : 'text-[var(--text-disabled)] hover:text-[var(--text-primary)]'
 }`}
 >
 <Icon size={14} />
 {item.label}
 </button>
 );
 })}
 </nav>
 </div>
 </header>
 );
};

export default Sidebar;
