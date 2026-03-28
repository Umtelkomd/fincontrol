import { signOut } from 'firebase/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Briefcase,
  FolderKanban,
  Globe,
  Landmark,
  LayoutDashboard,
  LogOut,
  Plus,
  ReceiptText,
  Scale,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
} from 'lucide-react';
import { auth } from '../../services/firebase';
import { formatCurrency } from '../../utils/formatters';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard' },
  { path: '/cashflow', label: 'Tesoreria', icon: WalletCards, permission: 'reports' },
  { path: '/transactions', label: 'Transacciones', icon: Landmark, permission: 'dashboard' },
  { path: '/cxc', label: 'CXC', icon: ReceiptText, permission: 'cxc' },
  { path: '/cxp', label: 'CXP', icon: ReceiptText, permission: 'cxp' },
  { path: '/reportes', label: 'Reportes', icon: BarChart3, permission: 'reports' },
  { path: '/proyectos', label: 'Proyectos', icon: FolderKanban, permission: 'reports' },
  { path: '/whatif', label: 'Simulador', icon: SlidersHorizontal, permission: 'reports' },
  { path: '/configuracion', label: 'Configuracion', icon: Settings, permission: 'settings' },
];

const Sidebar = ({ user, userRole, hasPermission, onNewTransaction, bankBalanceData, bankAccount }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error al cerrar sesion:', error);
    }
  };

  return (
    <header className="hidden border-b border-[rgba(255,255,255,0.34)] bg-[linear-gradient(180deg,#24283a_0%,#22263a_100%)] text-white shadow-[0_10px_40px_rgba(24,28,50,0.22)] md:block">
      <div className="mx-auto max-w-[1280px] px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[16px] bg-[linear-gradient(145deg,#1cd0ff,#36b8ff)] shadow-[0_14px_34px_rgba(0,162,255,0.32)]">
              <Briefcase size={18} className="text-[#061224]" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-white">FinControl</h1>
              <p className="truncate text-[10px] uppercase tracking-[0.22em] text-[rgba(202,214,255,0.72)]">Operations Console</p>
            </div>
          </button>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {bankBalanceData && (
              <div className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-3.5 py-2 text-right">
                <p className="text-[9px] uppercase tracking-[0.18em] text-[rgba(202,214,255,0.68)]">Caja</p>
                <p className={`text-[12px] font-semibold ${bankBalanceData.currentBalance >= 0 ? 'text-[#9ff5ae]' : 'text-[#ffb0aa]'}`}>
                  €{formatCurrency(bankBalanceData.currentBalance)}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => navigate('/perfil')}
              className="inline-flex max-w-[220px] items-center gap-2.5 rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-3.5 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.08)]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-[12px] font-semibold text-[#8be3ff]">
                {(user?.displayName || user?.email || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-white">{user?.displayName || user?.email}</p>
                <p className="text-[9px] uppercase tracking-[0.16em] text-[#8be3ff]">{userRole === 'admin' ? 'Admin' : userRole === 'manager' ? 'Manager' : 'Editor'}</p>
              </div>
            </button>

            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-[rgba(232,237,255,0.86)] transition-colors hover:bg-[rgba(255,255,255,0.08)]"
              title={bankAccount?.name || bankAccount?.bankName || 'Cuenta principal'}
            >
              <Globe size={15} />
            </button>

            <button
              type="button"
              onClick={() => onNewTransaction()}
              className="inline-flex items-center gap-2.5 rounded-full border border-[rgba(132,224,255,0.52)] bg-[linear-gradient(135deg,#1b68ff_0%,#1ab8ff_100%)] px-4 py-2.5 text-[12px] font-semibold text-white shadow-[0_16px_36px_rgba(24,102,255,0.34)] transition hover:translate-y-[-1px] hover:shadow-[0_20px_40px_rgba(24,102,255,0.4)]"
              title="Crear registro financiero"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(255,255,255,0.18)]">
                <Plus size={13} />
              </span>
              Crear registro
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-[rgba(232,237,255,0.86)] transition-colors hover:bg-[rgba(255,255,255,0.08)]"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        <nav className="mt-4 flex flex-wrap items-center gap-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[12px] font-medium transition-all ${
                  active
                    ? 'border-[rgba(104,213,255,0.58)] bg-[rgba(88,110,173,0.28)] text-white shadow-[0_10px_24px_rgba(33,59,117,0.24)]'
                    : 'border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.02)] text-[rgba(232,237,255,0.86)] hover:bg-[rgba(255,255,255,0.06)]'
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
