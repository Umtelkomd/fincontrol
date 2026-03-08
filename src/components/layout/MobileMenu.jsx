import { signOut } from 'firebase/auth';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../../services/firebase';
import {
  Briefcase, LayoutDashboard, ArrowUpCircle, ArrowDownCircle,
  ListFilter, DollarSign, BarChart3, Settings, Plus, LogOut, Menu, X,
  FileText, Target, Scale, Bell, History, Paperclip, RefreshCw,
  Upload, BookOpen, Folder, TrendingUp, Coins, Shield, Database
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard' },
      { path: '/alertas', label: 'Alertas', icon: Bell, permission: 'dashboard' },
    ],
  },
  {
    label: 'Operaciones',
    items: [
      { path: '/ingresos', label: 'Ingresos', icon: ArrowUpCircle, permission: 'cxc' },
      { path: '/gastos', label: 'Gastos', icon: ArrowDownCircle, permission: 'cxp' },
      { path: '/transactions', label: 'Transacciones', icon: ListFilter },
      { path: '/recurrencia', label: 'Recurrentes', icon: RefreshCw },
    ],
  },
  {
    label: 'Cuentas',
    items: [
      { path: '/cxc', label: 'Ctas por Cobrar', icon: FileText, permission: 'cxc' },
      { path: '/cxp', label: 'Ctas por Pagar', icon: FileText, permission: 'cxp' },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { path: '/presupuesto', label: 'Presupuesto', icon: Target, permission: 'reports' },
      { path: '/cashflow', label: 'Flujo de Caja', icon: DollarSign, permission: 'reports' },
      { path: '/proyeccion', label: 'Proyección', icon: TrendingUp, permission: 'reports' },
      { path: '/balance', label: 'Balance General', icon: BookOpen, permission: 'reports' },
      { path: '/proyectos', label: 'Por Proyecto', icon: Folder, permission: 'reports' },
      { path: '/reportes', label: 'Reportes', icon: BarChart3, permission: 'reports' },
    ],
  },
  {
    label: 'Administración',
    items: [
      { path: '/conciliacion', label: 'Conciliación', icon: Scale, permission: 'settings' },
      { path: '/import-export', label: 'Import/Export', icon: Upload, permission: 'settings' },
      { path: '/configuracion', label: 'Configuración', icon: Settings, permission: 'settings' },
    ],
  },
];

const MobileMenu = ({ isOpen, onClose, user, userRole, hasPermission, onNewTransaction }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error al cerrar sesion:', error);
    }
  };

  const handleNavigation = (path) => {
    navigate(path);
    onClose();
  };

  const handleNewTransactionClick = () => {
    onNewTransaction();
    onClose();
  };

  if (!isOpen) return null;

  const NavItem = ({ path, label, icon: Icon }) => {
    const isActive = location.pathname === path;
    return (
      <button
        onClick={() => handleNavigation(path)}
        className={`
          relative flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all
          ${isActive
            ? 'bg-[rgba(10,132,255,0.1)] text-white'
            : 'text-[#8e8e93] hover:bg-[rgba(255,255,255,0.05)] hover:text-white'}
        `}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#30d158] rounded-r" />
        )}
        <Icon size={18} className={isActive ? 'text-[#0a84ff]' : 'text-[#636366]'} />
        <span className="flex-1 text-left">{label}</span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={onClose} />
      <div className="absolute left-0 top-0 bottom-0 w-80 shadow-2xl flex flex-col animate-slideIn" style={{ background: 'rgba(28, 28, 30, 0.95)' }}>
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
          <button onClick={() => handleNavigation('/perfil')} className="mt-3 flex items-center gap-2 px-3 py-2 bg-[rgba(255,255,255,0.04)] rounded-lg hover:bg-[rgba(255,255,255,0.07)] transition-colors w-full text-left">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[rgba(191,90,242,0.15)] flex items-center justify-center flex-shrink-0">
                <span className="text-[11px] font-bold text-[#bf5af2]">{(user?.displayName || user?.email || '?')[0].toUpperCase()}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#c7c7cc] truncate">{user?.displayName || user?.email}</p>
            </div>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
              userRole === 'admin' ? 'bg-[rgba(191,90,242,0.12)] text-[#bf5af2]' : 'bg-[rgba(10,132,255,0.12)] text-[#0a84ff]'
            }`}>
              {userRole === 'admin' ? 'Admin' : userRole === 'manager' ? 'Mgr' : 'Edit'}
            </span>
          </button>
        </div>

        <nav className="flex-1 p-3 overflow-y-auto">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(item => !item.permission || hasPermission(item.permission));
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.label} className="mb-2">
                <p className="text-[9px] font-bold text-[#48484a] uppercase tracking-widest px-4 py-1.5">{section.label}</p>
                <div className="space-y-0.5">
                  {visibleItems.map(item => <NavItem key={item.path} {...item} />)}
                </div>
              </div>
            );
          })}
        </nav>

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
