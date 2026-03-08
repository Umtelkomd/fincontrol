import { signOut } from 'firebase/auth';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../../services/firebase';
import {
  Briefcase, LayoutDashboard, ArrowUpCircle, ArrowDownCircle,
  ListFilter, DollarSign, BarChart3, Settings, Plus, LogOut,
  FileText, Target, Scale, Bell, History, Paperclip, RefreshCw,
  Upload, BookOpen, Folder, TrendingUp, Coins, Shield, Database, Landmark
} from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';

const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard' },
      { path: '/alertas', label: 'Alertas', icon: Bell, permission: 'dashboard', color: '#ff9f0a' },
    ],
  },
  {
    label: 'Operaciones',
    items: [
      { path: '/ingresos', label: 'Ingresos', icon: ArrowUpCircle, permission: 'cxc', color: '#30d158' },
      { path: '/gastos', label: 'Gastos', icon: ArrowDownCircle, permission: 'cxp', color: '#ff453a' },
      { path: '/transactions', label: 'Transacciones', icon: ListFilter },
      { path: '/recurrencia', label: 'Recurrentes', icon: RefreshCw },
    ],
  },
  {
    label: 'Cuentas',
    items: [
      { path: '/cxc', label: 'Ctas por Cobrar', icon: FileText, permission: 'cxc', color: '#30d158' },
      { path: '/cxp', label: 'Ctas por Pagar', icon: FileText, permission: 'cxp', color: '#ff453a' },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { path: '/presupuesto', label: 'Presupuesto', icon: Target, permission: 'reports', color: '#0a84ff' },
      { path: '/cashflow', label: 'Flujo de Caja', icon: DollarSign, permission: 'reports' },
      { path: '/proyeccion', label: 'Proyección', icon: TrendingUp, permission: 'reports', color: '#bf5af2' },
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
      { path: '/adjuntos', label: 'Adjuntos', icon: Paperclip, permission: 'settings' },
      { path: '/multi-moneda', label: 'Multi-Moneda', icon: Coins, permission: 'settings' },
      { path: '/roles', label: 'Roles', icon: Shield, permission: 'settings' },
      { path: '/auditoria', label: 'Auditoría', icon: History, permission: 'settings' },
      { path: '/backup', label: 'Backup', icon: Database, permission: 'settings' },
      { path: '/configuracion', label: 'Configuración', icon: Settings, permission: 'settings' },
    ],
  },
];

const Sidebar = ({ user, userRole, hasPermission, onNewTransaction, bankBalanceData, bankAccount }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error al cerrar sesion:', error);
    }
  };

  const NavItem = ({ path, label, icon: Icon, color }) => {
    const isActive = location.pathname === path;

    return (
      <button
        onClick={() => navigate(path)}
        className={`
          relative flex items-center gap-2.5 w-full px-3 py-[7px] rounded-[10px] text-[13px] font-medium transition-all duration-150
          ${isActive
            ? 'bg-[rgba(255,255,255,0.08)] text-white'
            : 'text-[#8e8e93] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#c7c7cc]'}
        `}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-[#30d158] rounded-r-sm" />
        )}
        <Icon size={16} className={isActive ? (color || 'text-[#30d158]') : 'text-[#636366]'} style={isActive && color ? { color } : undefined} />
        <span className="flex-1 text-left truncate">{label}</span>
      </button>
    );
  };

  return (
    <aside className="hidden md:flex flex-col w-[250px] h-screen sticky top-0" style={{ background: 'rgba(28, 28, 30, 0.92)', backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', borderRight: '0.5px solid rgba(255,255,255,0.06)' }}>
      {/* Logo */}
      <div className="px-5 pt-5 pb-4 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-[#30d158] to-[#0a84ff] rounded-[9px] flex items-center justify-center shadow-lg">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-[14px] font-bold text-white tracking-tight leading-tight">FinControl</h1>
            <p className="text-[10px] text-[#636366] font-medium">UMTELKOMD GmbH</p>
          </div>
        </div>

        {/* User pill */}
        <div className="mt-3 flex items-center gap-2 px-2.5 py-2 bg-[rgba(255,255,255,0.04)] rounded-lg border border-[rgba(255,255,255,0.04)]">
          <div className="w-6 h-6 rounded-full bg-[rgba(191,90,242,0.15)] flex items-center justify-center">
            <span className="text-[10px] font-bold text-[#bf5af2]">
              {(user?.email || '?')[0].toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-[#c7c7cc] truncate">{user?.email}</p>
          </div>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
            userRole === 'admin' ? 'bg-[rgba(191,90,242,0.12)] text-[#bf5af2]' : 'bg-[rgba(10,132,255,0.12)] text-[#0a84ff]'
          }`}>
            {userRole === 'admin' ? 'Admin' : userRole === 'manager' ? 'Mgr' : 'Edit'}
          </span>
        </div>

        {/* Bank Balance Mini Badge */}
        {bankBalanceData && bankAccount && (
          <div className="mt-2 px-2.5 py-2 bg-[rgba(255,255,255,0.03)] rounded-lg border border-[rgba(255,255,255,0.04)]">
            <div className="flex items-center gap-2 mb-1">
              <Landmark size={12} className={bankBalanceData.currentBalance >= 0 ? 'text-[#30d158]' : 'text-[#ff453a]'} />
              <span className={`text-[12px] font-bold tabular-nums ${bankBalanceData.currentBalance >= 0 ? 'text-[#30d158]' : 'text-[#ff453a]'}`}>
                €{formatCurrency(bankBalanceData.currentBalance)}
              </span>
            </div>
            {bankBalanceData.creditLimit < 0 && (() => {
              const pct = Math.min(100, Math.max(0, (bankBalanceData.creditUsed / Math.abs(bankBalanceData.creditLimit)) * 100));
              return (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct > 80 ? '#ff453a' : pct > 50 ? '#ff9f0a' : '#30d158',
                      }}
                    />
                  </div>
                  <span className="text-[9px] text-[#636366] whitespace-nowrap">{pct.toFixed(0)}%</span>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter(item => !item.permission || hasPermission(item.permission));
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label} className="mb-2">
              <p className="text-[9px] font-bold text-[#48484a] uppercase tracking-widest px-3 py-1.5">{section.label}</p>
              <div className="space-y-0.5">
                {visibleItems.map(item => <NavItem key={item.path} {...item} />)}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Actions */}
      <div className="px-3 pb-3 space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
        <button
          onClick={onNewTransaction}
          className="flex items-center justify-center gap-2 w-full bg-[#30d158] hover:bg-[#28c74e] text-white px-4 py-2.5 rounded-[10px] text-[13px] font-semibold transition-all shadow-sm hover:shadow-md"
        >
          <Plus size={16} /> Nueva Transacción
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-2 w-full hover:bg-[rgba(255,255,255,0.05)] text-[#636366] hover:text-[#8e8e93] px-4 py-2 rounded-[10px] text-[12px] font-medium transition-all"
        >
          <LogOut size={14} /> Cerrar Sesión
        </button>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-[rgba(255,255,255,0.04)] text-center">
        <p className="text-[9px] text-[#3a3a3c]">
          Desarrollado por <span className="font-semibold text-[#48484a]">HMR NEXUS</span>
        </p>
      </div>
    </aside>
  );
};

export default Sidebar;
