import { signOut } from 'firebase/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LogOut,
  Menu,
  Plus,
  X,
} from 'lucide-react';
import NexusMark from '../brand/NexusMark';
import { auth } from '../../services/firebase';
import { NAV_GROUPS } from './navItems';

const MobileMenu = ({ isOpen, onClose, user, userRole, hasPermission, onNewTransaction }) => {
  const navigate = useNavigate();
  const location = useLocation();

  if (!isOpen) return null;

  const handleLogout = async () => {
    if (!window.confirm('¿Estás seguro que deseas cerrar sesión?')) return;
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  };

  const visibleGroups = NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || hasPermission(item.permission)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="fixed inset-0 z-[230] md:hidden">
      <div className="absolute inset-0 bg-[rgba(7,8,10,0.86)]" onClick={onClose} />

      <div className="absolute bottom-0 left-0 top-0 flex w-[86vw] max-w-[340px] animate-slideIn flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-0)] px-4 py-5 text-[var(--color-fg-1)]">
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-2)]">
              <NexusMark size={22} title="NEXUS" />
            </div>
            <div>
              <p className="text-[16px] leading-none text-[var(--color-fg-1)]" style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.02em' }}>
                NEXUS<span style={{ color: 'var(--color-accent)' }}>.OS</span>
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
                Finance Operations Console
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] transition-colors hover:text-[var(--color-fg-1)]"
          >
            <X size={16} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => { navigate('/perfil'); onClose(); }}
          className="mb-6 flex w-full items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-line-s)] bg-[var(--color-bg-3)] font-mono text-[12px] font-medium text-[var(--color-fg-1)]">
            {(user?.displayName || user?.email || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-[var(--color-fg-1)]">{user?.displayName || user?.email}</p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
              {userRole === 'admin' ? 'Admin' : userRole === 'manager' ? 'Manager' : 'Editor'}
            </p>
          </div>
        </button>

        <div className="flex-1 overflow-y-auto">
          {visibleGroups.map((group) => (
            <div key={group.key} className="mb-3">
              <p className="label-mono px-3 pb-1 pt-2 text-[9px] text-[var(--color-fg-4)]">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => { navigate(item.path); onClose(); }}
                    className={`relative flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors ${
                      active
                        ? 'bg-[var(--color-bg-3)] text-[var(--color-fg-1)]'
                        : 'text-[var(--color-fg-3)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-2 left-0 w-[2px] bg-[var(--color-accent)]"
                      />
                    )}
                    <Icon size={16} />
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em]">
                      {item.label}
                      {item.accent && (
                        <span style={{ color: 'var(--color-accent)' }}>{item.accent}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-3 border-t border-[var(--color-line)] pt-4">
          <button
            type="button"
            onClick={() => { onNewTransaction(); onClose(); }}
            className="nx-btn nx-btn-primary w-full justify-center"
          >
            <Plus size={14} />
            <span>Crear registro</span>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="nx-btn nx-btn-ghost w-full justify-center"
            aria-label="Cerrar sesión"
          >
            <LogOut size={14} />
            <span>Cerrar sesion</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const MobileMenuButton = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] transition-colors hover:text-[var(--color-fg-1)] md:hidden"
    aria-label="Abrir menu"
  >
    <Menu size={18} />
  </button>
);

export default MobileMenu;
