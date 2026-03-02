import { signOut } from 'firebase/auth';
import { auth } from '../../services/firebase';
import {
  Briefcase,
  LayoutDashboard,
  ArrowUpCircle,
  ArrowDownCircle,
  ListFilter,
  DollarSign,
  BarChart3,
  Settings,
  Plus,
  LogOut,
  Menu,
  X
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard' },
  { id: 'ingresos', label: 'Ingresos', icon: ArrowUpCircle, permission: 'cxc' },
  { id: 'gastos', label: 'Gastos', icon: ArrowDownCircle, permission: 'cxp' },
  { id: 'transactions', label: 'Transacciones', icon: ListFilter },
  { id: 'cashflow', label: 'Flujo de Caja', icon: DollarSign, permission: 'reports' },
  { id: 'reportes', label: 'Reportes', icon: BarChart3, permission: 'reports' },
  { id: 'configuracion', label: 'Configuración', icon: Settings, permission: 'settings' },
];

const MobileMenu = ({ isOpen, onClose, user, userRole, hasPermission, view, setView, onNewTransaction }) => {
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error al cerrar sesion:', error);
    }
  };

  const handleNavigation = (newView) => {
    setView(newView);
    onClose();
  };

  const handleNewTransactionClick = () => {
    onNewTransaction();
    onClose();
  };

  if (!isOpen) return null;

  const NavItem = ({ id, label, icon: Icon }) => {
    const isActive = view === id;
    return (
      <button
        onClick={() => handleNavigation(id)}
        className={`
          relative flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-all
          ${isActive
            ? 'bg-[rgba(10,132,255,0.1)] text-white'
            : 'text-[#8e8e93] hover:bg-[rgba(255,255,255,0.05)] hover:text-white'}
        `}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#30d158] rounded-r" />
        )}
        <Icon size={20} className={isActive ? 'text-[#0a84ff]' : 'text-[#636366]'} />
        <span className="flex-1 text-left">{label}</span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={onClose} />

      {/* Menu Panel */}
      <div className="absolute left-0 top-0 bottom-0 w-80 shadow-2xl flex flex-col animate-slideIn" style={{ background: 'rgba(28, 28, 30, 0.95)' }}>
        {/* Header */}
        <div className="p-5 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-gradient-to-br from-[#30d158] to-[#0a84ff] rounded-[10px] flex items-center justify-center shadow-lg">
                <Briefcase className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-[15px] font-bold text-white">FinControl</h1>
                <p className="text-[10px] text-[#636366] font-medium">UMTELKOMD GmbH</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 text-[#636366] hover:text-white hover:bg-[rgba(255,255,255,0.05)] rounded-xl transition-all">
              <X size={22} />
            </button>
          </div>

          {/* User Info */}
          <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-[rgba(255,255,255,0.04)] rounded-lg">
            <div className="w-7 h-7 rounded-full bg-[rgba(191,90,242,0.15)] flex items-center justify-center">
              <span className="text-[11px] font-bold text-[#bf5af2]">{(user?.email || '?')[0].toUpperCase()}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#c7c7cc] truncate">{user?.email}</p>
            </div>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
              userRole === 'admin' ? 'bg-[rgba(191,90,242,0.12)] text-[#bf5af2]' : 'bg-[rgba(10,132,255,0.12)] text-[#0a84ff]'
            }`}>
              {userRole === 'admin' ? 'Admin' : userRole === 'manager' ? 'Mgr' : 'Edit'}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            if (item.permission && !hasPermission(item.permission)) return null;
            return <NavItem key={item.id} {...item} />;
          })}
        </nav>

        {/* Actions */}
        <div className="p-4 border-t border-[rgba(255,255,255,0.06)] space-y-2">
          <button
            onClick={handleNewTransactionClick}
            className="flex items-center justify-center gap-2 w-full bg-[#30d158] hover:bg-[#28c74e] text-white px-4 py-3 rounded-xl font-semibold transition-all shadow-sm"
          >
            <Plus size={18} /> Nueva Transacción
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full hover:bg-[rgba(255,255,255,0.05)] text-[#636366] hover:text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
          >
            <LogOut size={18} /> Cerrar Sesión
          </button>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[rgba(255,255,255,0.04)] text-center">
          <p className="text-[9px] text-[#3a3a3c]">
            Desarrollado por <span className="font-semibold text-[#48484a]">HMR NEXUS</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export const MobileMenuButton = ({ onClick }) => (
  <button
    onClick={onClick}
    className="md:hidden p-2 text-[#98989d] hover:text-white hover:bg-[rgba(255,255,255,0.05)] rounded-lg transition-all"
  >
    <Menu size={22} />
  </button>
);

export default MobileMenu;
