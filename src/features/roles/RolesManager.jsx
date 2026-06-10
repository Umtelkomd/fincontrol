import React from 'react';
import {
  Shield, Users, CheckSquare, Square, Info, Clock, Mail,
} from 'lucide-react';
import { USER_ROLES, ROLE_PERMISSIONS } from '../../constants/config';

const ROLE_META = {
  admin: { label: 'Administrador', description: 'Acceso total al sistema' },
  manager: { label: 'Gerente', description: 'Transacciones, CXP/CXC y reportes' },
  editor: { label: 'Editor', description: 'Dashboard y transacciones' },
};

const MODULE_LABELS = {
  dashboard: 'Dashboard',
  transactions: 'Transacciones',
  cxp: 'Cuentas por Pagar',
  cxc: 'Cuentas por Cobrar',
  reports: 'Reportes',
  cashflow: 'Flujo de Caja',
  settings: 'Configuración',
  budget: 'Presupuesto',
  audit: 'Auditoría',
  backup: 'Backup',
};

// Derived from the single source of truth so the display can never drift
// from the permissions the app actually enforces.
const AVAILABLE_ROLES = Object.keys(ROLE_PERMISSIONS).map((key) => ({
  key,
  label: ROLE_META[key]?.label || key,
  description: ROLE_META[key]?.description || '',
}));

const MODULES = [...new Set(Object.values(ROLE_PERMISSIONS).flat())].map((key) => ({
  key,
  label: MODULE_LABELS[key] || key,
}));

const DEFAULT_PERMISSION_MATRIX = ROLE_PERMISSIONS;

const KNOWN_USERS = [
  { email: 'jromero@umtelkomd.com', name: 'Jarl Romero', role: USER_ROLES['jromero@umtelkomd.com'] || 'admin' },
  { email: 'bsandoval@umtelkomd.com', name: 'Beatriz Sandoval', role: USER_ROLES['bsandoval@umtelkomd.com'] || 'manager' },
];

const getRoleLabel = (roleKey) => {
  const found = AVAILABLE_ROLES.find((r) => r.key === roleKey);
  if (found) return found.label;
  if (roleKey === 'manager') return 'Gerente Financiero';
  if (roleKey === 'editor') return 'Editor';
  return roleKey;
};

const getRoleColor = (roleKey) => {
  switch (roleKey) {
    case 'admin': return 'var(--color-warn)';
    case 'manager':
    case 'finance_manager': return 'var(--color-accent)';
    case 'project_manager': return 'var(--color-ok)';
    default: return 'var(--color-fg-3)';
  }
};

const RolesManager = ({ userRole }) => {
  const isAdmin = userRole === 'admin';

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Shield className="text-[var(--color-fg-4)] mb-4" size={48} />
        <h3 className="text-lg font-medium text-[var(--color-fg-1)] mb-2">Acceso Restringido</h3>
        <p className="text-[var(--color-fg-3)] text-sm">Solo los administradores pueden ver roles y permisos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-transparent rounded-md">
          <Shield className="text-[var(--color-warn)]" size={24} />
        </div>
        <div>
          <h2 className="text-xl font-medium text-[var(--color-fg-1)]">Roles y Permisos</h2>
          <p className="text-sm text-[var(--color-fg-3)]">Usuarios activos y matriz de permisos del sistema</p>
        </div>
      </div>

      {/* Read-only notice */}
      <div className="flex items-start gap-3 rounded-md border border-[var(--color-line-s)] bg-transparent p-4">
        <Info className="text-[var(--color-info)] flex-shrink-0 mt-0.5" size={18} />
        <div>
          <p className="text-sm font-medium text-[var(--color-info)]">Vista de solo lectura</p>
          <p className="mt-1 text-xs text-[var(--color-fg-3)]">
            La matriz de permisos está definida en el código fuente
            (<span className="font-mono text-[var(--color-fg-2)]">src/constants/config.js</span> —
            <span className="font-mono text-[var(--color-fg-2)]"> ROLE_PERMISSIONS</span>).
            Para modificar permisos se requiere un despliegue nuevo.
          </p>
        </div>
      </div>

      {/* Current Users */}
      <div className="bg-[var(--color-bg-1)] rounded-lg p-6 border border-[var(--color-line)]">
        <div className="flex items-center gap-2 mb-4">
          <Users className="text-[var(--color-accent)]" size={20} />
          <h3 className="text-lg font-medium text-[var(--color-fg-1)]">Usuarios Activos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className="pb-3 label-mono text-[var(--color-fg-3)]">Usuario</th>
                <th className="pb-3 label-mono text-[var(--color-fg-3)]">Email</th>
                <th className="pb-3 label-mono text-[var(--color-fg-3)]">Rol</th>
                <th className="pb-3 label-mono text-[var(--color-fg-3)]">Permisos</th>
                <th className="pb-3 label-mono text-[var(--color-fg-3)]">Última sesión</th>
              </tr>
            </thead>
            <tbody>
              {KNOWN_USERS.map((u) => {
                const rolePerms = ROLE_PERMISSIONS[u.role] || [];
                return (
                  <tr key={u.email} className="border-b border-[var(--color-line)]">
                    <td className="py-3 text-[var(--color-fg-1)] font-medium">{u.name}</td>
                    <td className="py-3 text-[var(--color-fg-3)] text-sm">
                      <div className="flex items-center gap-1.5">
                        <Mail size={12} className="text-[var(--color-fg-4)]" />
                        {u.email}
                      </div>
                    </td>
                    <td className="py-3">
                      <span
                        className="nx-badge"
                        style={{ color: getRoleColor(u.role), backgroundColor: 'var(--color-bg-2)', border: '1px solid var(--color-line-s)' }}
                      >
                        {getRoleLabel(u.role)}
                      </span>
                    </td>
                    <td className="py-3 text-[var(--color-fg-3)] text-sm">
                      {rolePerms.length > 0 ? rolePerms.join(', ') : 'Sin permisos definidos'}
                    </td>
                    <td className="py-3 text-[var(--color-fg-4)] text-sm">
                      <span className="flex items-center gap-1">
                        <Clock size={14} />
                        —
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permission Matrix — read-only */}
      <div className="bg-[var(--color-bg-1)] rounded-lg p-6 border border-[var(--color-line)]">
        <div className="flex items-center gap-2 mb-4">
          <CheckSquare className="text-[var(--color-ok)]" size={20} />
          <h3 className="text-lg font-medium text-[var(--color-fg-1)]">Matriz de Permisos</h3>
          <span className="nx-badge nx-badge-neutral ml-2">Solo lectura</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className="pb-3 label-mono text-[var(--color-fg-3)]">Módulo</th>
                {AVAILABLE_ROLES.map((role) => (
                  <th key={role.key} className="pb-3 label-mono text-center" style={{ color: getRoleColor(role.key) }}>
                    {role.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((mod) => (
                <tr key={mod.key} className="border-b border-[var(--color-line)]">
                  <td className="py-3 text-[var(--color-fg-1)] font-medium text-sm">{mod.label}</td>
                  {AVAILABLE_ROLES.map((role) => {
                    const hasPermission = (DEFAULT_PERMISSION_MATRIX[role.key] || []).includes(mod.key);
                    return (
                      <td key={role.key} className="py-3 text-center">
                        {hasPermission ? (
                          <CheckSquare className="text-[var(--color-ok)] mx-auto" size={18} />
                        ) : (
                          <Square className="text-[var(--color-fg-4)] mx-auto" size={18} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Roles reference */}
      <div className="bg-[var(--color-bg-1)] rounded-lg p-6 border border-[var(--color-line)]">
        <h3 className="text-lg font-medium text-[var(--color-fg-1)] mb-4">Roles Disponibles</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {AVAILABLE_ROLES.map((role) => (
            <div key={role.key} className="flex items-center gap-3 p-3 bg-[var(--color-bg-2)] rounded-md">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: getRoleColor(role.key) }}
              />
              <div>
                <p className="text-sm font-medium text-[var(--color-fg-1)]">{role.label}</p>
                <p className="text-xs text-[var(--color-fg-4)]">{role.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RolesManager;
