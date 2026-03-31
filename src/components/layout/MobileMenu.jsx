import { signOut } from 'firebase/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  Briefcase,
  Building2,
  FolderKanban,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ReceiptText,
  Scale,
  Settings,
  WalletCards,
  X,
} from 'lucide-react';
import { auth } from '../../services/firebase';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard' },
  { path: '/cashflow', label: 'Tesorería', icon: WalletCards, permission: 'reports' },
  { path: '/transactions', label: 'Transacciones', icon: Landmark, permission: 'dashboard' },
  { path: '/cxc', label: 'CXC', icon: ReceiptText, permission: 'cxc' },
  { path: '/cxp', label: 'CXP', icon: ReceiptText, permission: 'cxp' },
  { path: '/reportes', label: 'Reportes', icon: Briefcase, permission: 'reports' },
  { path: '/proyectos', label: 'Proyectos', icon: FolderKanban, permission: 'reports' },
  { path: '/presupuesto', label: 'Presupuesto', icon: Briefcase, permission: 'reports' },
  { path: '/conciliacion', label: 'Conciliación', icon: Scale, permission: 'cxp' },
  { path: '/import-export', label: 'Importar', icon: ArrowLeftRight, permission: 'settings' },
  { path: '/configuracion', label: 'Configuración', icon: Settings, permission: 'settings' },
  { path: '/partners', label: 'Partners', icon: Building2, permission: 'settings' },
];

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

  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <div className="fixed inset-0 z-[230] md:hidden">
      <div className="absolute inset-0 bg-[rgba(18,29,54,0.18)] backdrop-blur-md" onClick={onClose} />
      <div className="absolute left-0 top-0 bottom-0 flex w-[86vw] max-w-[340px] flex-col border-r border-[rgba(205,219,243,0.82)] bg-[radial-gradient(circle_at_top_right,rgba(185,248,238,0.32),transparent_26%),radial-gradient(circle_at_top_left,rgba(147,196,255,0.28),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.95),rgba(242,247,255,0.94))] px-4 py-5 text-[#16223f] shadow-[0_30px_100px_rgba(95,117,162,0.24)] backdrop-blur-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-[linear-gradient(145deg,#1cd0ff,#36b8ff)] shadow-[0_14px_34px_rgba(0,162,255,0.24)]">
              <Briefcase size={18} className="text-[#061224]" />
            </div>
            <div>
              <p className="text-[15px] font-extrabold text-[#101938]" style={{ letterSpacing: '-0.02em' }}>FinControl</p>
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#6980ac]">Operations Console</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/74 p-2 text-[#7b8cab]">
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            navigate('/perfil');
            onClose();
          }}
          className="mb-5 flex w-full items-center gap-3 rounded-[20px] border border-[rgba(205,219,243,0.82)] bg-white/74 px-3 py-3 text-left shadow-[0_12px_28px_rgba(124,148,191,0.08)]"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(90,141,221,0.12)] text-sm font-semibold text-[#3156d3]">
            {(user?.displayName || user?.email || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-[#101938]">{user?.displayName || user?.email}</p>
            <p className="truncate text-xs uppercase tracking-[0.16em] text-[#6980ac]">{userRole === 'admin' ? 'Administrador' : userRole === 'manager' ? 'Manager' : 'Editor'}</p>
          </div>
        </button>

        <div className="flex-1 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => {
                  navigate(item.path);
                  onClose();
                }}
                className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-all ${
                  active
                    ? 'border border-[rgba(90,141,221,0.26)] bg-[rgba(90,141,221,0.12)] text-[#101938]'
                    : 'text-[#62718f] hover:bg-white/68 hover:text-[#101938]'
                }`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-[14px] border border-[rgba(201,214,238,0.72)] bg-white/72">
                  <Icon size={16} />
                </span>
                <span className="text-[13px] font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 border-t border-[rgba(205,219,243,0.82)] pt-4">
          <button
            type="button"
            onClick={() => {
              onNewTransaction();
              onClose();
            }}
            className="inline-flex w-full items-center justify-center gap-2.5 rounded-[20px] border border-[rgba(132,224,255,0.52)] bg-[linear-gradient(135deg,#1b68ff_0%,#1ab8ff_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_38px_rgba(24,102,255,0.32)]"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(255,255,255,0.18)]">
              <Plus size={15} />
            </span>
            Crear registro
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[18px] border border-[rgba(205,219,243,0.82)] bg-white/72 px-4 py-3 text-sm font-medium text-[#62718f]"
            aria-label="Cerrar sesión"
          >
            <LogOut size={14} />
            Cerrar sesión
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
    className="rounded-2xl border border-[rgba(205,219,243,0.8)] bg-white/70 p-2 text-[#6b7a96] transition-colors hover:text-[#101938] md:hidden"
    aria-label="Abrir menú"
  >
    <Menu size={20} />
  </button>
);

export default MobileMenu;
