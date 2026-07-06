import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
 History, User, FileText, Edit3, Trash2, Plus, Search, X
} from 'lucide-react';
import { useAuditLog } from '../../hooks/useAuditLog';

const ACTION_STYLES = {
 create: { color: 'var(--color-ok)', bg: 'rgba(74, 222, 128, 0.12)', label: 'Creación', icon: Plus },
 update: { color: 'var(--color-accent)', bg: 'rgba(107, 166, 255, 0.12)', label: 'Edición', icon: Edit3 },
 delete: { color: 'var(--color-accent)', bg: 'rgba(255, 77, 46, 0.12)', label: 'Eliminación', icon: Trash2 },
 payment: { color: 'var(--color-warn)', bg: 'rgba(255, 176, 32, 0.12)', label: 'Pago', icon: FileText },
 status_change: { color: 'var(--color-fg-3)', bg: 'var(--color-bg-2)', label: 'Cambio Estado', icon: Edit3 },
 cancel: { color: 'var(--color-warn)', bg: 'rgba(255, 176, 32, 0.12)', label: 'Cancelación', icon: Trash2 },
 void: { color: 'var(--color-accent)', bg: 'rgba(255, 77, 46, 0.12)', label: 'Anulación', icon: Trash2 },
};

const AuditLog = ({ user }) => {
 const [searchParams, setSearchParams] = useSearchParams();
 const { logs, loading } = useAuditLog(user);
 const presetSearch = searchParams.get('search') || '';
 const presetEntityType = searchParams.get('entityType') || 'all';
 const presetEntityId = searchParams.get('entityId') || '';
 const presetLabel = searchParams.get('label') || '';
 const [searchTerm, setSearchTerm] = useState(presetSearch);
 const [filterAction, setFilterAction] = useState('all');
 const [filterUser, setFilterUser] = useState('all');

 const filtered = useMemo(() => {
 let items = logs;
 if (presetEntityType !== 'all') items = items.filter(l => l.entityType === presetEntityType);
 if (presetEntityId) items = items.filter(l => l.entityId === presetEntityId);
 if (filterAction !== 'all') items = items.filter(l => l.action === filterAction);
 if (filterUser !== 'all') items = items.filter(l => l.user === filterUser);
 if (searchTerm) {
 const term = searchTerm.toLowerCase();
 items = items.filter(l =>
 (l.description || '').toLowerCase().includes(term) ||
 (l.entityType || '').toLowerCase().includes(term) ||
 (l.user || '').toLowerCase().includes(term)
 );
 }
 return items;
 }, [logs, filterAction, filterUser, presetEntityId, presetEntityType, searchTerm]);

 const uniqueUsers = useMemo(() => [...new Set(logs.map(l => l.user))], [logs]);
 const clearContextFilter = () => setSearchParams({});

 if (loading) {
 return <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-[var(--color-fg-3)] border-t-transparent rounded-full animate-spin" /></div>;
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 <div>
 <h2 className="text-xl font-medium text-[var(--color-fg-1)] tracking-tight">Registro de Auditoría</h2>
 <p className="text-[13px] text-[var(--color-fg-4)] mt-0.5">Últimos 200 eventos · historial inmutable de acciones</p>
 </div>

 {presetEntityId && (
 <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">Contexto activo</p>
 <p className="mt-1 text-[13px] font-medium text-[var(--color-fg-1)]">
 {presetLabel || presetEntityId}
 </p>
 <p className="mt-1 text-[11px] text-[var(--color-fg-4)]">
 {presetEntityType} #{presetEntityId.slice(0, 8)}
 </p>
 </div>
 <button
 type="button"
 onClick={clearContextFilter}
 className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line)] px-3 py-2 text-[12px] font-medium text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-bg-1)]"
 >
 <X size={14} />
 Quitar filtro
 </button>
 </div>
 )}

 {/* Stats */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 {Object.entries(ACTION_STYLES).slice(0, 4).map(([key, style]) => {
 const count = logs.filter(l => l.action === key).length;
 const IconComp = style.icon;
 return (
 <div key={key} className="bg-[var(--color-bg-1)] rounded-md p-4 border border-[var(--color-line)]">
 <div className="flex items-center gap-2 mb-2">
 <div className="p-1.5 rounded-lg" style={{ background: style.bg }}>
 <IconComp size={14} style={{ color: style.color }} />
 </div>
 <p className="text-[11px] font-medium text-[var(--color-fg-3)] uppercase">{style.label}</p>
 </div>
 <p className="text-[22px] font-medium text-[var(--color-fg-1)]">{count}</p>
 </div>
 );
 })}
 </div>

 {/* Filters */}
 <div className="flex flex-wrap gap-3 items-center">
 <div className="relative flex-1 max-w-xs">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" />
 <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Buscar..."
 className="w-full bg-[var(--color-bg-2)] border border-[var(--color-line)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--color-fg-1)] focus:outline-none focus:border-[var(--color-line-s)]" />
 </div>
 <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
 className="bg-[var(--color-bg-2)] border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-1)] focus:outline-none">
 <option value="all">Todas las acciones</option>
 {Object.entries(ACTION_STYLES).map(([key, style]) => (
 <option key={key} value={key}>{style.label}</option>
 ))}
 </select>
 <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
 className="bg-[var(--color-bg-2)] border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-1)] focus:outline-none">
 <option value="all">Todos los usuarios</option>
 {uniqueUsers.map(u => <option key={u} value={u}>{u}</option>)}
 </select>
 </div>

 {/* Log List */}
 <div className="bg-[var(--color-bg-1)] rounded-lg border border-[var(--color-line)] overflow-hidden">
 <div className="px-5 py-3 border-b border-[var(--color-line)] flex items-center justify-between">
 <h4 className="text-[13px] font-medium text-[var(--color-fg-3)]">Registros</h4>
 <span className="text-[11px] text-[var(--color-fg-4)]">{filtered.length} de {logs.length}</span>
 </div>
 <div className="divide-y divide-[var(--color-line)]">
 {filtered.slice(0, 100).map((log) => {
 const style = ACTION_STYLES[log.action] || ACTION_STYLES.update;
 const IconComp = style.icon;
 const timestamp = log.timestamp ? new Date(log.timestamp) : null;

 return (
 <div key={log.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--color-bg-1)] transition-colors">
 <div className="p-2 rounded-lg flex-shrink-0 mt-0.5" style={{ background: style.bg }}>
 <IconComp size={14} style={{ color: style.color }} />
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-[13px] font-medium text-[var(--color-fg-1)]">{log.description}</span>
 <span className="px-2 py-0.5 rounded text-[9px] font-medium uppercase" style={{ background: style.bg, color: style.color }}>
 {style.label}
 </span>
 </div>
 <div className="flex items-center gap-3 mt-1">
 <span className="text-[11px] text-[var(--color-fg-4)] flex items-center gap-1">
 <User size={10} /> {log.user}
 </span>
 {log.entityType && (
 <span className="text-[11px] text-[var(--color-fg-4)]">
 {log.entityType} {log.entityId ? `#${log.entityId.substring(0, 8)}` : ''}
 </span>
 )}
 {timestamp && (
 <span className="text-[11px] text-[var(--color-fg-4)]">
 {timestamp.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })} {timestamp.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
 </span>
 )}
 </div>
 </div>
 </div>
 );
 })}
 {filtered.length === 0 && (
 <div className="text-center py-16">
 <History className="w-8 h-8 text-[var(--color-fg-4)] mx-auto mb-3" />
 <p className="text-sm text-[var(--color-fg-4)]">No hay registros de auditoría</p>
 <p className="text-[11px] text-[var(--color-fg-4)] mt-1">Las acciones se registrarán automáticamente</p>
 </div>
 )}
 </div>
 </div>
 </div>
 );
};

export default AuditLog;
