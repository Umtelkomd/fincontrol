import React, { useState } from 'react';
import {
 Briefcase,
 Plus,
 Edit2,
 Trash2,
 X,
 Check,
 Search,
 Calendar,
 User,
 Power,
 CheckCircle2,
 AlertCircle,
 Building2,
 MapPin,
 Download,
} from 'lucide-react';
import { useProjects } from '../../hooks/useProjects';
import { formatDate } from '../../utils/formatters';
import ConfirmModal from '../../components/ui/ConfirmModal';
import Toast from '../../components/ui/Toast';
import { Button } from '@/components/ui/nexus';
import { LUMEN_CANONICAL_PROJECT_SEED } from '../../finance/lumenContract';
import { canonicalizeProjectCode } from '../../finance/projectCodeAliases';

// ============================================
// Operators (Auftraggeber) — known UMTELKOMD project owners.
// Add new operators here as the company onboards more clients.
// ============================================
const OPERATORS = [
 { value: 'INSYTE', label: 'Insyte' },
 { value: 'VANCOM', label: 'Vancom' },
];

// ============================================
// Default project catalog — Lumen-canonical codes (S1).
// "Importar predefinidos" is idempotent by `code`.
// ============================================
const DEFAULT_PROJECTS = LUMEN_CANONICAL_PROJECT_SEED;

const operatorColor = (value) => {
  if (value === 'INSYTE') return 'text-[var(--color-ok)] border-[var(--color-line-s)]';
  if (value === 'VANCOM') return 'text-[var(--color-accent)] border-[var(--color-line-s)]';
  return 'text-[var(--color-fg-3)] border-[var(--color-line)]';
};

const Projects = ({ user }) => {
 const { projects, loading, createProject, updateProject, deleteProject } = useProjects(user);
 const [searchTerm, setSearchTerm] = useState('');
 const [showAddModal, setShowAddModal] = useState(false);
 const [editingProject, setEditingProject] = useState(null);
 const [projectToDelete, setProjectToDelete] = useState(null);
 const [toast, setToast] = useState(null);

 const [formData, setFormData] = useState({
 code: '',
 name: '',
 client: '',
 operator: 'INSYTE',
 zone: '',
 description: '',
 startDate: '',
 endDate: '',
 budget: '',
 status: 'active'
 });

 const resetForm = () => {
 setFormData({
 code: '',
 name: '',
 client: '',
 operator: 'INSYTE',
 zone: '',
 description: '',
 startDate: '',
 endDate: '',
 budget: '',
 status: 'active'
 });
 };

 const handleOpenAdd = () => {
 resetForm();
 setEditingProject(null);
 setShowAddModal(true);
 };

 const handleOpenEdit = (project) => {
 setEditingProject(project);
 setFormData({
 code: project.code || '',
 name: project.name || '',
 client: project.client || '',
 operator: project.operator || 'INSYTE',
 zone: project.zone || '',
 description: project.description || '',
 startDate: project.startDate || '',
 endDate: project.endDate || '',
 budget: project.budget || '',
 status: project.status || 'active'
 });
 setShowAddModal(true);
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 
 if (!formData.code.trim() || !formData.name.trim()) {
 setToast({ message: 'Código y nombre son requeridos', type: 'error' });
 return;
 }

 const projectData = {
 code: formData.code.trim().toUpperCase(),
 name: formData.name.trim(),
 client: formData.client.trim(),
 operator: formData.operator || 'INSYTE',
 zone: formData.zone.trim(),
 description: formData.description.trim(),
 startDate: formData.startDate,
 endDate: formData.endDate,
 budget: parseFloat(formData.budget) || 0,
 status: formData.status,
 displayName: `${formData.code.trim().toUpperCase()} (${formData.name.trim()})`
 };

 if (editingProject) {
 const result = await updateProject(editingProject.id, projectData);
 if (result.success) {
 setToast({ message: 'Proyecto actualizado exitosamente', type: 'success' });
 } else {
 setToast({ message: 'Error al actualizar el proyecto', type: 'error' });
 }
 } else {
 const result = await createProject(projectData);
 if (result.success) {
 setToast({ message: 'Proyecto creado exitosamente', type: 'success' });
 } else {
 setToast({ message: 'Error al crear el proyecto', type: 'error' });
 }
 }

 setShowAddModal(false);
 resetForm();
 };

 const handleDelete = async () => {
 if (projectToDelete) {
 const result = await deleteProject(projectToDelete.id);
 if (result.success) {
 setToast({ message: 'Proyecto eliminado exitosamente', type: 'success' });
 } else {
 setToast({ message: 'Error al eliminar el proyecto', type: 'error' });
 }
 setProjectToDelete(null);
 }
 };

 const handleToggleStatus = async (project) => {
 const newStatus = project.status === 'active' ? 'inactive' : 'active';
 const result = await updateProject(project.id, { status: newStatus });
 if (result.success) {
 setToast({
 message: `Proyecto ${newStatus === 'active' ? 'activado' : 'desactivado'}`,
 type: 'success'
 });
 }
 };

 // ============================================
 // Inline edit (operator + zone) — saves directly to Firestore on change/blur.
 // Used to enrich legacy projects with operator/zone metadata without opening
 // the full edit modal for each one.
 // ============================================
 const [zoneDrafts, setZoneDrafts] = useState({}); // { [projectId]: 'draft text' }

 const handleInlineOperatorChange = async (project, newOperator) => {
 if ((project.operator || '') === newOperator) return;
 const result = await updateProject(project.id, { operator: newOperator });
 if (result.success) {
 setToast({ message: `${project.code}: operador → ${newOperator || 'ninguno'}`, type: 'success' });
 } else {
 setToast({ message: `Error al cambiar operador de ${project.code}`, type: 'error' });
 }
 };

 const handleInlineZoneBlur = async (project) => {
 const draft = zoneDrafts[project.id];
 if (draft == null) return; // never edited
 const trimmed = draft.trim();
 if (trimmed === (project.zone || '')) {
 // No change — just clear the draft
 setZoneDrafts((prev) => {
 const next = { ...prev };
 delete next[project.id];
 return next;
 });
 return;
 }
 const result = await updateProject(project.id, { zone: trimmed });
 if (result.success) {
 setToast({ message: `${project.code}: zona → ${trimmed || '(vacía)'}`, type: 'success' });
 setZoneDrafts((prev) => {
 const next = { ...prev };
 delete next[project.id];
 return next;
 });
 } else {
 setToast({ message: `Error al cambiar zona de ${project.code}`, type: 'error' });
 }
 };

 // Idempotent bootstrap: Lumen-canonical codes. Existing projects are never
 // overwritten — only missing codes are created (S1 master alignment).
 const [importing, setImporting] = useState(false);
 const handleImportDefaults = async () => {
 if (importing) return;
 if (!window.confirm(
 `Importar ${DEFAULT_PROJECTS.length} proyectos con código canónico Lumen (QFF, NE4, …)? Solo se crean los que faltan.`,
 )) return;
 setImporting(true);
 const existingCodes = new Set(
 projects.map((p) => canonicalizeProjectCode(p.code || p.name || '')).filter(Boolean),
 );
 let created = 0;
 let skipped = 0;
 for (const def of DEFAULT_PROJECTS) {
 const code = canonicalizeProjectCode(def.code);
 if (existingCodes.has(code)) {
 skipped += 1;
 continue;
 }
 const result = await createProject({
 ...def,
 code,
 client: '',
 description: '',
 startDate: '',
 endDate: '',
 budget: 0,
 status: 'active',
 displayName: `${code} (${def.name})`,
 });
 if (result.success) {
 created += 1;
 existingCodes.add(code);
 }
 }
 setImporting(false);
 setToast({
 message: `Códigos Lumen: ${created} creados, ${skipped} ya existían`,
 type: created > 0 ? 'success' : 'info',
 });
 };

 const filteredProjects = projects.filter(p => {
 const q = searchTerm.toLowerCase();
 return (
 p.name?.toLowerCase().includes(q) ||
 p.code?.toLowerCase().includes(q) ||
 p.client?.toLowerCase().includes(q) ||
 p.operator?.toLowerCase().includes(q) ||
 p.zone?.toLowerCase().includes(q)
 );
 });

 const activeProjects = filteredProjects.filter(p => p.status === 'active');
 const inactiveProjects = filteredProjects.filter(p => p.status !== 'active');

 if (loading) {
 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex items-center justify-center py-12">
 <div className="flex flex-col items-center gap-4">
  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[var(--color-fg-3)]"></div>
  <p className="text-[var(--color-fg-3)]">Cargando proyectos…</p>
 </div>
 </div>
 </div>
 );
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
  <p className="label-mono text-[var(--color-fg-1)]">Configuración operativa</p>
  <h2 className="mt-2 font-display text-[24px] font-light tracking-[-0.03em] text-[var(--color-fg-1)]">Proyectos</h2>
  <p className="mt-1 text-sm text-[var(--color-fg-3)]">
 Administra el catálogo de proyectos para reportes, cobros, pagos y seguimiento financiero.
 </p>
 </div>
 <div className="flex flex-wrap gap-2">
 <Button
 variant="secondary"
 icon={Download}
 disabled={importing}
 loading={importing}
 onClick={handleImportDefaults}
 title="Crear catálogo canónico Lumen (QFF, NE4, …) — idempotente"
 >
 {importing ? 'Importando…' : 'Importar códigos Lumen'}
 </Button>
 <Button variant="primary" icon={Plus} onClick={handleOpenAdd}>
 Nuevo proyecto
 </Button>
 </div>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <div className="flex items-center gap-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-transparent">
  <Briefcase className="h-5 w-5 text-[var(--color-fg-1)]" />
 </div>
 <div>
  <p className="label-mono text-[var(--color-fg-3)]">Total proyectos</p>
  <p className="font-display text-[28px] font-light tabular-nums tracking-[-0.03em] text-[var(--color-fg-1)]">{projects.length}</p>
 </div>
 </div>
 </div>
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <div className="flex items-center gap-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-transparent">
  <CheckCircle2 className="h-5 w-5 text-[var(--color-ok)]" />
 </div>
 <div>
  <p className="label-mono text-[var(--color-fg-3)]">Activos</p>
  <p className="font-display text-[28px] font-light tabular-nums tracking-[-0.03em] text-[var(--color-ok)]">{activeProjects.length}</p>
 </div>
 </div>
 </div>
  <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <div className="flex items-center gap-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-transparent">
  <AlertCircle className="h-5 w-5 text-[var(--color-fg-3)]" />
 </div>
 <div>
  <p className="label-mono text-[var(--color-fg-3)]">Inactivos</p>
  <p className="font-display text-[28px] font-light tabular-nums tracking-[-0.03em] text-[var(--color-fg-3)]">{inactiveProjects.length}</p>
 </div>
 </div>
 </div>
 </div>

 {/* Operator breakdown — small line under the stats cards */}
 {projects.length > 0 && (
  <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-5 py-3">
  <Building2 size={14} className="text-[var(--color-fg-3)]" />
  <span className="label-mono text-[var(--color-fg-3)]">Por operador:</span>
 {OPERATORS.map((op) => {
 const count = projects.filter((p) => p.operator === op.value && p.status === 'active').length;
 return (
 <span
 key={op.value}
  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${operatorColor(op.value)}`}
 >
 {op.label}: {count}
 </span>
 );
 })}
 {(() => {
 const unassigned = projects.filter((p) => !p.operator && p.status === 'active').length;
 if (unassigned === 0) return null;
 return (
  <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs font-medium text-[var(--color-fg-3)]">
 Sin operador: {unassigned}
 </span>
 );
 })()}
 </div>
 )}

 <div className="relative">
  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-fg-3)]" size={18} />
 <input
 type="text"
 placeholder="Buscar proyectos por código, nombre o cliente..."
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-3 pl-12 pr-4 text-sm text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 />
 </div>

  <div className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)]">
 <div className="overflow-x-auto">
 <table className="w-full">
  <thead className="border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
 <tr>
  <th className="px-6 py-4 text-left label-mono text-[var(--color-fg-3)]">Código</th>
  <th className="px-6 py-4 text-left label-mono text-[var(--color-fg-3)]">Nombre</th>
  <th className="hidden px-6 py-4 text-left label-mono text-[var(--color-fg-3)] md:table-cell">Operador</th>
  <th className="hidden px-6 py-4 text-left label-mono text-[var(--color-fg-3)] lg:table-cell">Cliente</th>
  <th className="hidden px-6 py-4 text-left label-mono text-[var(--color-fg-3)] sm:table-cell">Fechas</th>
  <th className="px-6 py-4 text-center label-mono text-[var(--color-fg-3)]">Estado</th>
  <th className="px-6 py-4 text-right label-mono text-[var(--color-fg-3)]">Acciones</th>
 </tr>
 </thead>
  <tbody className="divide-y divide-[var(--color-line)]">
 {activeProjects.map((project) => (
  <tr key={project.id} className="transition-colors hover:bg-[var(--color-bg-2)]">
 <td className="px-6 py-4">
  <span className="inline-flex items-center rounded-md bg-transparent px-2.5 py-1 text-sm font-medium text-[var(--color-fg-1)]">
 {project.code}
 </span>
  <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--color-fg-3)]">
 <MapPin size={10} />
 <input
 type="text"
 placeholder="zona…"
 value={zoneDrafts[project.id] ?? project.zone ?? ''}
 onChange={(e) => setZoneDrafts((prev) => ({ ...prev, [project.id]: e.target.value }))}
 onBlur={() => handleInlineZoneBlur(project)}
 onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
  className="w-[110px] bg-transparent text-[10px] text-[var(--color-fg-3)] outline-none border-b border-transparent hover:border-[var(--color-line)] focus:border-[var(--color-line-s)] focus:text-[var(--color-fg-1)]"
 title="Click para editar zona, Enter o blur para guardar"
 />
 </div>
 </td>
 <td className="px-6 py-4">
 <div>
  <p className="font-medium text-[var(--color-fg-1)]">{project.name}</p>
 {project.description && (
  <p className="mt-0.5 max-w-xs truncate text-xs text-[var(--color-fg-3)]">{project.description}</p>
 )}
 </div>
 </td>
 <td className="px-6 py-4 hidden md:table-cell">
 <select
 value={project.operator || ''}
 onChange={(e) => handleInlineOperatorChange(project, e.target.value)}
  className={`rounded-md border bg-transparent px-2 py-1 text-xs font-medium outline-none transition focus:border-[var(--color-line-s)] ${operatorColor(project.operator)}`}
 title="Cambiar operador (se guarda automáticamente)"
 >
 <option value="">— sin operador</option>
 {OPERATORS.map((op) => (
 <option key={op.value} value={op.value}>{op.label}</option>
 ))}
 </select>
 </td>
 <td className="px-6 py-4 hidden lg:table-cell">
 <div className="flex items-center gap-2">
  <User className="h-4 w-4 text-[var(--color-fg-3)]" />
  <span className="text-sm text-[var(--color-fg-4)]">{project.client || '-'}</span>
 </div>
 </td>
 <td className="px-6 py-4 hidden sm:table-cell">
  <div className="flex items-center gap-2 text-sm text-[var(--color-fg-3)]">
 <Calendar className="h-4 w-4" />
 <span>
 {project.startDate ? formatDate(project.startDate) : '-'}
 {project.endDate && ` → ${formatDate(project.endDate)}`}
 </span>
 </div>
 </td>
 <td className="px-6 py-4 text-center">
  <span className="inline-flex items-center gap-1 rounded-md bg-transparent px-3 py-1 text-xs font-medium text-[var(--color-ok)]">
 <CheckCircle2 className="h-3 w-3" />
 Activo
 </span>
 </td>
 <td className="px-6 py-4 text-right">
 <div className="flex items-center justify-end gap-1">
 <button
 onClick={() => handleToggleStatus(project)}
  className="rounded-md p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-fg-4)]"
 title="Desactivar"
 >
 <Power className="h-4 w-4" />
 </button>
 <button
 onClick={() => handleOpenEdit(project)}
  className="rounded-md p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-fg-1)]"
 title="Editar"
 >
 <Edit2 className="h-4 w-4" />
 </button>
 <button
 onClick={() => setProjectToDelete(project)}
  className="rounded-md p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-accent)]"
 title="Eliminar"
 >
 <Trash2 className="h-4 w-4" />
 </button>
 </div>
 </td>
 </tr>
 ))}
 
 {/* Inactive Projects */}
 {inactiveProjects.map((project) => (
  <tr key={project.id} className="bg-[var(--color-bg-1)] transition-colors hover:bg-[var(--color-bg-2)]">
 <td className="px-6 py-4">
  <span className="inline-flex items-center rounded-md bg-transparent px-2.5 py-1 text-sm font-medium text-[var(--color-fg-3)]">
 {project.code}
 </span>
  <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--color-fg-3)] opacity-60">
 <MapPin size={10} />
 <input
 type="text"
 placeholder="zona…"
 value={zoneDrafts[project.id] ?? project.zone ?? ''}
 onChange={(e) => setZoneDrafts((prev) => ({ ...prev, [project.id]: e.target.value }))}
 onBlur={() => handleInlineZoneBlur(project)}
 onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
  className="w-[110px] bg-transparent text-[10px] text-[var(--color-fg-3)] outline-none border-b border-transparent hover:border-[var(--color-line)] focus:border-[var(--color-line-s)] focus:text-[var(--color-fg-1)]"
 />
 </div>
 </td>
 <td className="px-6 py-4">
 <div>
  <p className="font-medium text-[var(--color-fg-4)] line-through">{project.name}</p>
 {project.description && (
  <p className="mt-0.5 max-w-xs truncate text-xs text-[var(--color-fg-3)]">{project.description}</p>
 )}
 </div>
 </td>
 <td className="px-6 py-4 hidden md:table-cell">
 <select
 value={project.operator || ''}
 onChange={(e) => handleInlineOperatorChange(project, e.target.value)}
  className={`rounded-md border bg-transparent px-2 py-1 text-xs font-medium outline-none transition focus:border-[var(--color-line-s)] opacity-60 ${operatorColor(project.operator)}`}
 title="Cambiar operador (se guarda automáticamente)"
 >
 <option value="">— sin operador</option>
 {OPERATORS.map((op) => (
 <option key={op.value} value={op.value}>{op.label}</option>
 ))}
 </select>
 </td>
 <td className="px-6 py-4 hidden lg:table-cell">
 <div className="flex items-center gap-2">
  <User className="h-4 w-4 text-[var(--color-fg-3)]" />
  <span className="text-sm text-[var(--color-fg-3)]">{project.client || '-'}</span>
 </div>
 </td>
 <td className="px-6 py-4 hidden sm:table-cell">
  <div className="flex items-center gap-2 text-sm text-[var(--color-fg-3)]">
 <Calendar className="h-4 w-4" />
 <span>
 {project.startDate ? formatDate(project.startDate) : '-'} 
 {project.endDate && ` → ${formatDate(project.endDate)}`}
 </span>
 </div>
 </td>
 <td className="px-6 py-4 text-center">
  <span className="inline-flex items-center gap-1 rounded-md bg-transparent px-3 py-1 text-xs font-medium text-[var(--color-fg-3)]">
 Inactivo
 </span>
 </td>
 <td className="px-6 py-4 text-right">
 <div className="flex items-center justify-end gap-1">
 <button
 onClick={() => handleToggleStatus(project)}
  className="rounded-md p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-ok)]"
 title="Activar"
 >
 <Power className="h-4 w-4" />
 </button>
 <button
 onClick={() => handleOpenEdit(project)}
  className="rounded-md p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-fg-1)]"
 title="Editar"
 >
 <Edit2 className="h-4 w-4" />
 </button>
 <button
 onClick={() => setProjectToDelete(project)}
  className="rounded-md p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-accent)]"
 title="Eliminar"
 >
 <Trash2 className="h-4 w-4" />
 </button>
 </div>
 </td>
 </tr>
 ))}
 
 {filteredProjects.length === 0 && (
 <tr>
 <td colSpan="7" className="px-6 py-12 text-center">
  <div className="flex flex-col items-center gap-3 text-[var(--color-fg-4)]">
 <div className="flex h-16 w-16 items-center justify-center rounded-full bg-transparent">
  <Briefcase className="h-8 w-8 text-[var(--color-fg-3)]" />
 </div>
  <p className="text-sm text-[var(--color-fg-3)]">No se encontraron proyectos</p>
 {searchTerm && (
 <button
 onClick={() => setSearchTerm('')}
  className="text-sm font-medium text-[var(--color-fg-1)]"
 >
 Limpiar búsqueda
 </button>
 )}
 </div>
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </div>

 {/* Add/Edit Modal */}
 {showAddModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.62)] p-4 animate-fadeIn">
  <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] animate-scaleIn">
  <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-bg-2)] px-6 py-5">
 <div>
  <p className="label-mono text-[var(--color-fg-1)]">Ficha de proyecto</p>
  <h3 className="text-xl font-medium tracking-[-0.03em] text-[var(--color-fg-1)]">
 {editingProject ? 'Editar proyecto' : 'Nuevo proyecto'}
 </h3>
 </div>
 <button 
 onClick={() => setShowAddModal(false)} 
  className="rounded-md p-2 text-[var(--color-fg-3)] transition hover:bg-transparent hover:text-[var(--color-fg-1)]"
 >
 <X size={20} />
 </button>
 </div>

 <form onSubmit={handleSubmit} className="p-6 space-y-5">
 <div className="grid grid-cols-2 gap-4">
 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">
  Código <span className="text-[var(--color-accent)]">*</span>
 </label>
 <input
 type="text"
 required
 placeholder="PROY-001"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm uppercase text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={formData.code}
 onChange={e => setFormData({...formData, code: e.target.value})}
 />
 </div>
 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">
  Nombre <span className="text-[var(--color-accent)]">*</span>
 </label>
 <input
 type="text"
 required
 placeholder="Nombre del proyecto"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={formData.name}
 onChange={e => setFormData({...formData, name: e.target.value})}
 />
 </div>
 </div>

 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">
  Operador (Auftraggeber) <span className="text-[var(--color-accent)]">*</span>
 </label>
 <div className="grid grid-cols-2 gap-3">
 {OPERATORS.map((op) => {
 const selected = formData.operator === op.value;
 return (
 <button
 key={op.value}
 type="button"
 onClick={() => setFormData({ ...formData, operator: op.value })}
 className={`flex items-center justify-center gap-2 rounded-md border-2 px-4 py-3 text-sm font-medium transition-all ${
 selected
 ? `bg-transparent ${operatorColor(op.value)}`
  : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:border-[var(--color-line-s)]'
 }`}
 >
 <Building2 size={14} />
 {op.label}
 </button>
 );
 })}
 </div>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">
 Zona
 </label>
 <input
 type="text"
 placeholder="Bayern, Baden-Württemberg, ..."
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={formData.zone}
 onChange={e => setFormData({...formData, zone: e.target.value})}
 />
 </div>
 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">
 Cliente final
 </label>
 <input
 type="text"
 placeholder="Cliente / contratante directo"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={formData.client}
 onChange={e => setFormData({...formData, client: e.target.value})}
 />
 </div>
 </div>

 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">
 Descripción
 </label>
 <textarea
 rows="2"
 placeholder="Descripción breve del proyecto..."
  className="w-full resize-none rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={formData.description}
 onChange={e => setFormData({...formData, description: e.target.value})}
 />
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">
 Fecha inicio
 </label>
 <input
 type="date"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-line-s)]"
 value={formData.startDate}
 onChange={e => setFormData({...formData, startDate: e.target.value})}
 />
 </div>
 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">
 Fecha fin
 </label>
 <input
 type="date"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-line-s)]"
 value={formData.endDate}
 onChange={e => setFormData({...formData, endDate: e.target.value})}
 />
 </div>
 </div>

 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">
 Presupuesto (EUR)
 </label>
 <div className="relative">
  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-medium text-[var(--color-fg-3)]">€</span>
 <input
 type="number"
 step="0.01"
 min="0"
 placeholder="0.00"
  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] py-3 pl-8 pr-4 text-sm text-[var(--color-fg-1)] outline-none transition placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
 value={formData.budget}
 onChange={e => setFormData({...formData, budget: e.target.value})}
 />
 </div>
 </div>

 <div>
  <label className="mb-2 block label-mono text-[var(--color-fg-3)]">Estado</label>
 <div className="flex gap-3">
 <button
 type="button"
 onClick={() => setFormData({...formData, status: 'active'})}
 className={`
 flex-1 py-3 px-4 rounded-md text-sm font-medium border-2 transition-all
 ${formData.status === 'active'
  ? 'border-[var(--color-ok)] bg-transparent text-[var(--color-ok)]'
  : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:border-[var(--color-line-s)]'}
 `}
 >
 Activo
 </button>
 <button
 type="button"
 onClick={() => setFormData({...formData, status: 'inactive'})}
 className={`
 flex-1 py-3 px-4 rounded-md text-sm font-medium border-2 transition-all
 ${formData.status === 'inactive'
  ? 'border-[var(--color-line)] bg-transparent text-[var(--color-fg-4)]'
  : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:border-[var(--color-line)]'}
 `}
 >
 Inactivo
 </button>
 </div>
 </div>

 <Button type="submit" variant="primary" icon={Check} className="w-full">
 {editingProject ? 'Guardar cambios' : 'Crear proyecto'}
 </Button>
 </form>
 </div>
 </div>
 )}

 {/* Delete Confirmation */}
 <ConfirmModal
 isOpen={!!projectToDelete}
 onClose={() => setProjectToDelete(null)}
 onConfirm={handleDelete}
 title="Eliminar Proyecto"
 message={`¿Estás seguro de eliminar el proyecto "${projectToDelete?.name}" (${projectToDelete?.code})? Esta acción no se puede deshacer.`}
 confirmText="Eliminar"
 cancelText="Cancelar"
 variant="danger"
 />

 {/* Toast */}
 {toast && (
 <Toast
 message={toast.message}
 type={toast.type}
 onClose={() => setToast(null)}
 />
 )}
 </div>
 );
};

export default Projects;
