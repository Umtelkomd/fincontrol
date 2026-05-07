import { signOut } from 'firebase/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import {
 Globe,
 LogOut,
 Plus,
} from 'lucide-react';
import NexusMark from '../brand/NexusMark';
import { auth } from '../../services/firebase';
import { formatCurrency } from '../../utils/formatters';
import { NAV_ITEMS } from './navItems';

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
  <header className="relative hidden border-b border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-1)] md:block">
  <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px] bg-[var(--color-accent)]" />
  <div className="mx-auto max-w-[1280px] px-5 py-4">
 {/* Top row: brand + actions */}
 <div className="flex items-center justify-between gap-4">
  <button type="button" onClick={() => navigate('/')} className="group flex min-w-0 items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 transition-colors hover:border-[var(--color-line-s)]">
  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-2)]">
  <NexusMark size={30} title="NEXUS" />
  </div>
  <div className="min-w-0 text-left">
  <h1
  className="truncate text-[22px] leading-none text-[var(--color-fg-1)]"
 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.02em' }}
 >
 NEXUS<span style={{ color: 'var(--color-accent)' }}>.OS</span>
 </h1>
  <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-accent)]">
  Rebuilt around software
 </p>
 </div>
 </button>

 <div className="flex flex-wrap items-center justify-end gap-2">
 {bankBalanceData && (
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3.5 py-2 text-right">
 <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">Caja</p>
 <p className={`font-mono text-[12px] font-medium tabular-nums ${
 bankBalanceData.currentBalance >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'
 }`}>
 {formatCurrency(bankBalanceData.currentBalance)}
 </p>
 </div>
 )}

 <button
 type="button"
 onClick={() => navigate('/perfil')}
 className="inline-flex max-w-[200px] items-center gap-2.5 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3.5 py-2 text-left transition-colors hover:border-[var(--color-line-s)]"
 >
 <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-line-s)] bg-[var(--color-bg-3)] font-mono text-[11px] font-medium text-[var(--color-fg-1)]">
 {(user?.displayName || user?.email || '?')[0].toUpperCase()}
 </div>
 <div className="min-w-0">
 <p className="truncate text-[12px] text-[var(--color-fg-1)]">{user?.displayName || user?.email}</p>
 <p className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
 {userRole === 'admin' ? 'Admin' : userRole === 'manager' ? 'Manager' : 'Editor'}
 </p>
 </div>
 </button>

 <button
 type="button"
 className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] transition-colors hover:border-[var(--color-line-s)] hover:text-[var(--color-fg-1)]"
 title={bankAccount?.name || bankAccount?.bankName || 'Cuenta principal'}
 aria-label="Cuenta bancaria"
 >
 <Globe size={14} />
 </button>

 <button
 type="button"
 onClick={() => onNewTransaction()}
 className="nx-btn nx-btn-primary"
 title="Crear registro financiero"
 >
 <Plus size={14} />
 <span>Crear</span>
 </button>

 <button
 type="button"
 onClick={handleLogout}
 className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] transition-colors hover:border-[var(--color-line-s)] hover:text-[var(--color-fg-1)]"
 aria-label="Cerrar sesión"
 >
 <LogOut size={14} />
 </button>
 </div>
 </div>

 {/* Nav row */}
  <nav className="relative -mx-5 mt-4 border-t border-[var(--color-line)] px-5 pt-2">
 {/* Right-side fade hint that there is more to scroll */}
 <span aria-hidden="true" className="pointer-events-none absolute right-0 top-2 bottom-0 w-12 bg-gradient-to-l from-[var(--color-bg-0)] to-transparent z-10" />
  <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-fg-4)]">NEXUS ROUTES</div>
  <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-0.5">
 {visibleItems.map((item) => {
 const Icon = item.icon;
 const active = location.pathname === item.path;
 return (
 <button
 key={item.path}
 type="button"
 onClick={() => navigate(item.path)}
 className={`relative inline-flex flex-shrink-0 items-center gap-2 rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
 active
 ? 'bg-[var(--color-bg-3)] text-[var(--color-fg-1)]'
 : 'text-[var(--color-fg-3)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
 }`}
 >
 <Icon size={13} />
 <span>
 {item.label}
 {item.accent && (
 <span style={{ color: 'var(--color-accent)' }}>{item.accent}</span>
 )}
 </span>
 {active && (
 <span
 aria-hidden="true"
 className="pointer-events-none absolute inset-x-3 -bottom-[9px] h-[2px] bg-[var(--color-accent)]"
 />
 )}
 </button>
 );
 })}
 </div>
 </nav>
 </div>
 </header>
 );
};

export default Sidebar;
