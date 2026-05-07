import React, { useState } from 'react';
import {
 Shield, UserPlus, Users, CheckSquare, Square, Info, Loader2, Clock, Mail
} from 'lucide-react';
import { USER_ROLES, ROLE_PERMISSIONS } from '../../constants/config';
import { useToast } from '../../contexts/ToastContext';

const AVAILABLE_ROLES = [
 { key: 'admin', label: 'Administrador', description: 'Acceso total al sistema' },
 { key: 'finance_manager', label: 'Gerente Financiero', description: 'Transacciones, reportes, presupuestos' },
 { key: 'project_manager', label: 'Gerente de Proyecto', description: 'Dashboard, transacciones del proyecto' },
 { key: 'viewer', label: 'Solo lectura', description: 'Visualizacion sin edicion' },
];

const MODULES = [
 { key: 'dashboard', label: 'Dashboard' },
 { key: 'transactions', label: 'Transacciones' },
 { key: 'cxp', label: 'Cuentas por Pagar' },
 { key: 'cxc', label: 'Cuentas por Cobrar' },
 { key: 'reports', label: 'Reportes' },
 { key: 'cashflow', label: 'Flujo de Caja' },
 { key: 'settings', label: 'Configuracion' },
 { key: 'budget', label: 'Presupuesto' },
];

const DEFAULT_PERMISSION_MATRIX = {
 admin: ['dashboard', 'transactions', 'cxp', 'cxc', 'reports', 'cashflow', 'settings', 'budget'],
 finance_manager: ['dashboard', 'transactions', 'cxp', 'cxc', 'reports', 'cashflow', 'budget'],
 project_manager: ['dashboard', 'transactions', 'reports'],
 viewer: ['dashboard', 'reports'],
};

const KNOWN_USERS = [
 { email: 'jromero@umtelkomd.com', name: 'Jarl Romero', role: USER_ROLES['jromero@umtelkomd.com'] || 'admin' },
 { email: 'bsandoval@umtelkomd.com', name: 'Beatriz Sandoval', role: USER_ROLES['bsandoval@umtelkomd.com'] || 'manager' },
];

const RolesManager = ({ userRole }) => {
 const { showToast } = useToast();
 const [permissions, setPermissions] = useState(DEFAULT_PERMISSION_MATRIX);
 const [inviteForm, setInviteForm] = useState({ email: '', role: 'viewer' });
 const [saving, setSaving] = useState(false);

 const isAdmin = userRole === 'admin';

 const togglePermission = (role, module) => {
 if (!isAdmin) return;
 setPermissions((prev) => {
 const current = prev[role] || [];
 const updated = current.includes(module)
 ? current.filter((m) => m !== module)
 : [...current, module];
 return { ...prev, [role]: updated };
 });
 };

 const handleInvite = () => {
 if (!inviteForm.email || !inviteForm.email.includes('@')) {
 showToast('Ingresa un email valido', 'error');
 return;
 }
 showToast('Las invitaciones requieren Firebase Auth Admin SDK. Configurar en Cloud Functions.', 'info');
 setInviteForm({ email: '', role: 'viewer' });
 };

 const handleSavePermissions = () => {
 setSaving(true);
 setTimeout(() => {
 setSaving(false);
 showToast('Matriz de permisos actualizada (solo en memoria). Para persistir, actualizar Firestore Security Rules.', 'info');
 }, 800);
 };

 const getRoleLabel = (roleKey) => {
 const found = AVAILABLE_ROLES.find((r) => r.key === roleKey);
 if (found) return found.label;
 // Map legacy roles
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
 case 'viewer': return 'var(--color-fg-3)';
 case 'editor': return 'var(--color-fg-3)';
 default: return 'var(--color-fg-3)';
 }
 };

 if (!isAdmin) {
 return (
 <div className="flex flex-col items-center justify-center py-16">
 <Shield className="text-[var(--color-fg-4)] mb-4" size={48} />
 <h3 className="text-lg font-medium text-[var(--color-fg-1)] mb-2">Acceso Restringido</h3>
 <p className="text-[var(--color-fg-3)] text-sm">Solo los administradores pueden gestionar roles y permisos.</p>
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
 <p className="text-sm text-[var(--color-fg-3)]">Gestiona usuarios, roles y permisos del sistema</p>
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
 <th className="pb-3 text-xs font-medium text-[var(--color-fg-3)] uppercase tracking-wide">Usuario</th>
 <th className="pb-3 text-xs font-medium text-[var(--color-fg-3)] uppercase tracking-wide">Email</th>
 <th className="pb-3 text-xs font-medium text-[var(--color-fg-3)] uppercase tracking-wide">Rol</th>
 <th className="pb-3 text-xs font-medium text-[var(--color-fg-3)] uppercase tracking-wide">Permisos</th>
 <th className="pb-3 text-xs font-medium text-[var(--color-fg-3)] uppercase tracking-wide">Ultima sesion</th>
 </tr>
 </thead>
 <tbody>
 {KNOWN_USERS.map((u) => {
 const rolePerms = ROLE_PERMISSIONS[u.role] || [];
 return (
 <tr key={u.email} className="border-b border-[var(--color-line)] hover:bg-[var(--color-bg-1)]">
 <td className="py-3 text-[var(--color-fg-1)] font-medium">{u.name}</td>
 <td className="py-3 text-[var(--color-fg-3)] text-sm">{u.email}</td>
 <td className="py-3">
 <span
 className="px-2.5 py-1 rounded-full text-xs font-medium"
 style={{
 color: getRoleColor(u.role),
 backgroundColor: 'var(--color-bg-2)',
 }}
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

 {/* Permission Matrix */}
 <div className="bg-[var(--color-bg-1)] rounded-lg p-6 border border-[var(--color-line)]">
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-2">
 <CheckSquare className="text-[var(--color-ok)]" size={20} />
 <h3 className="text-lg font-medium text-[var(--color-fg-1)]">Matriz de Permisos</h3>
 </div>
 <button
 onClick={handleSavePermissions}
 disabled={saving}
 className="flex items-center gap-2 px-4 py-2 bg-[var(--color-ok)] hover:opacity-80 text-[var(--color-fg-1)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
 >
 {saving ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
 {saving ? 'Guardando...' : 'Guardar Permisos'}
 </button>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-left">
 <thead>
 <tr className="border-b border-[var(--color-line)]">
 <th className="pb-3 text-xs font-medium text-[var(--color-fg-3)] uppercase tracking-wide">Modulo</th>
 {AVAILABLE_ROLES.map((role) => (
 <th key={role.key} className="pb-3 label-mono text-center" style={{ color: getRoleColor(role.key) }}>
 {role.label}
 </th>
 ))}
 </tr>
 </thead>
 <tbody>
 {MODULES.map((mod) => (
 <tr key={mod.key} className="border-b border-[var(--color-line)] hover:bg-[var(--color-bg-1)]">
 <td className="py-3 text-[var(--color-fg-1)] font-medium text-sm">{mod.label}</td>
 {AVAILABLE_ROLES.map((role) => {
 const hasPermission = (permissions[role.key] || []).includes(mod.key);
 return (
 <td key={role.key} className="py-3 text-center">
 <button
 onClick={() => togglePermission(role.key, mod.key)}
 className="p-1 hover:bg-[var(--color-bg-1)] rounded transition-colors"
 title={hasPermission ? 'Quitar permiso' : 'Otorgar permiso'}
 >
 {hasPermission ? (
 <CheckSquare className="text-[var(--color-ok)] mx-auto" size={20} />
 ) : (
 <Square className="text-[var(--color-fg-4)] mx-auto" size={20} />
 )}
 </button>
 </td>
 );
 })}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 {/* Invite User */}
 <div className="bg-[var(--color-bg-1)] rounded-lg p-6 border border-[var(--color-line)]">
 <div className="flex items-center gap-2 mb-4">
 <UserPlus className="text-[var(--color-fg-3)]" size={20} />
 <h3 className="text-lg font-medium text-[var(--color-fg-1)]">Invitar Usuario</h3>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
 <div>
 <label className="block text-sm font-medium text-[var(--color-fg-3)] mb-1">Email</label>
 <div className="relative">
 <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" size={16} />
 <input
 type="email"
 className="w-full pl-10 pr-4 py-2.5 bg-[var(--color-bg-2)] border border-[var(--color-line-s)] rounded-lg text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)]"
 value={inviteForm.email}
 onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
 placeholder="usuario@empresa.com"
 />
 </div>
 </div>
 <div>
 <label className="block text-sm font-medium text-[var(--color-fg-3)] mb-1">Rol</label>
 <select
 className="w-full px-4 py-2.5 bg-[var(--color-bg-2)] border border-[var(--color-line-s)] rounded-lg text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)]"
 value={inviteForm.role}
 onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
 >
 {AVAILABLE_ROLES.map((r) => (
 <option key={r.key} value={r.key}>{r.label}</option>
 ))}
 </select>
 </div>
 <div>
 <button
 onClick={handleInvite}
 className="flex items-center gap-2 px-6 py-2.5 bg-[var(--color-fg-3)] hover:bg-[var(--color-fg-3)] text-[var(--color-fg-1)] rounded-lg font-medium transition-colors w-full justify-center"
 >
 <UserPlus size={18} />
 Invitar
 </button>
 </div>
 </div>
 </div>

 {/* Available Roles Reference */}
 <div className="bg-[var(--color-bg-1)] rounded-lg p-6 border border-[var(--color-line)]">
 <h3 className="text-lg font-medium text-[var(--color-fg-1)] mb-4">Roles Disponibles</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {AVAILABLE_ROLES.map((role) => (
 <div key={role.key} className="flex items-center gap-3 p-3 bg-[var(--color-bg-2)] rounded-lg">
 <div
 className="w-3 h-3 rounded-full flex-shrink-0"
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

 {/* Info Box */}
 <div className="bg-transparent border border-[var(--color-line-s)] rounded-md p-4 flex items-start gap-3">
 <Info className="text-[var(--color-accent)] flex-shrink-0 mt-0.5" size={20} />
 <div>
 <p className="text-sm text-[var(--color-accent)] font-medium">Nota sobre seguridad</p>
 <p className="text-xs text-[var(--color-fg-3)] mt-1">
 Esta vista permite configurar la matriz de permisos visualmente. Para aplicar los permisos a nivel de base de datos, es necesario actualizar las Firestore Security Rules manualmente. Los cambios aqui solo afectan la interfaz del cliente.
 </p>
 </div>
 </div>
 </div>
 );
};

export default RolesManager;
