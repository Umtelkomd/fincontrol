import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Search, HardHat, Users, Briefcase, Wallet } from 'lucide-react';
import { useEmployees } from '../../hooks/useEmployees';
import { useRecurringCosts } from '../../hooks/useRecurringCosts';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency } from '../../utils/formatters';
import EmployeeFormModal from '../../components/ui/EmployeeFormModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const STATUS_LABELS = { active: 'Activo', 'on-leave': 'Permiso', inactive: 'Inactivo' };
const STATUS_VARIANTS = { active: 'ok', 'on-leave': 'warn', inactive: 'neutral' };
const TYPE_LABELS = {
 internal: 'Interno',
 external: 'Externo',
 contractor: 'Contratista',
};

const Employees = ({ user }) => {
 const {
 employees,
 loading,
 createEmployee,
 updateEmployee,
 deleteEmployee,
 } = useEmployees(user);
 const { recurringCosts, totalMonthlyEquivalent } = useRecurringCosts(user);

 const [activeTab, setActiveTab] = useState('internal'); // internal | external | all
 const [searchQuery, setSearchQuery] = useState('');
 const [showInactive, setShowInactive] = useState(false);
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [editingEmployee, setEditingEmployee] = useState(null);
 const [confirmDelete, setConfirmDelete] = useState(null);

 const counts = useMemo(() => {
 const filterActive = (e) => e.status !== 'inactive';
 const live = employees.filter(filterActive);
 return {
 internal: live.filter((e) => e.type === 'internal').length,
 external: live.filter((e) => e.type === 'external' || e.type === 'contractor').length,
 all: live.length,
 totalEmployees: employees.length,
 };
 }, [employees]);

 const filtered = useMemo(() => {
 let list = employees;

 if (activeTab === 'internal') list = list.filter((e) => e.type === 'internal');
 else if (activeTab === 'external')
 list = list.filter((e) => e.type === 'external' || e.type === 'contractor');

 if (!showInactive) list = list.filter((e) => e.status !== 'inactive');

 if (searchQuery.trim()) {
 const q = searchQuery.toLowerCase();
 list = list.filter(
 (e) =>
 e.fullName?.toLowerCase().includes(q) ||
 e.firstName?.toLowerCase().includes(q) ||
 e.lastName?.toLowerCase().includes(q) ||
 e.email?.toLowerCase().includes(q) ||
 e.role?.toLowerCase().includes(q) ||
 (e.aliases || []).some((a) => a.toLowerCase().includes(q)),
 );
 }
 return list;
 }, [employees, activeTab, showInactive, searchQuery]);

 const stats = useMemo(() => {
 const internal = employees.filter((e) => e.type === 'internal' && e.status === 'active');
 const external = employees.filter(
 (e) => (e.type === 'external' || e.type === 'contractor') && e.status === 'active',
 );

 const totalBrutto = internal.reduce((s, e) => s + (Number(e.bruttoMonthly) || 0), 0);
 const totalGesamtkosten = internal.reduce((s, e) => s + (Number(e.gesamtkostenMonthly) || 0), 0);
 const recurringMonthly = totalMonthlyEquivalent('employee');

 const costsByEmployee = recurringCosts.reduce((acc, c) => {
 if (c.ownerType === 'employee' && c.active) acc[c.ownerId] = (acc[c.ownerId] || 0) + 1;
 return acc;
 }, {});

 return {
 internalActive: internal.length,
 externalActive: external.length,
 totalBrutto,
 totalGesamtkosten,
 recurringMonthly,
 costsByEmployee,
 };
 }, [employees, recurringCosts, totalMonthlyEquivalent]);

 const handleCreate = async (data) => createEmployee(data);
 const handleUpdate = async (data) => updateEmployee(editingEmployee.id, data);

 const handleDelete = async () => {
 if (!confirmDelete) return;
 await deleteEmployee(confirmDelete.id);
 setConfirmDelete(null);
 };

 const openEdit = (e) => {
 setEditingEmployee(e);
 setIsModalOpen(true);
 };

 const openCreate = () => {
 setEditingEmployee(null);
 setIsModalOpen(true);
 };

 const tabs = [
 { key: 'internal', label: 'Internos (con nómina)', count: counts.internal, icon: HardHat },
 { key: 'external', label: 'Externos / Contratistas', count: counts.external, icon: Briefcase },
 { key: 'all', label: 'Todos', count: counts.all, icon: Users },
 ];

 const isInternalTab = activeTab === 'internal';

 return (
 <div className="space-y-6 pb-12">
 <header className="flex items-end justify-between gap-4 flex-wrap">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">Assets · Empleados</p>
 <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
 Personal
 </h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
 Equipo interno con nómina alemana (Brutto / Netto / SV) + colaboradores externos.
 Los costos mensuales se gestionan en <span className="text-[var(--color-fg-1)]">Costos recurrentes</span>.
 </p>
 </div>
 <Button variant="primary" icon={Plus} onClick={openCreate}>
 Nuevo empleado
 </Button>
 </header>

 <KPIGrid cols={4}>
 <KPI label="Internos activos" value={stats.internalActive} meta="Con nómina" icon={HardHat} />
 <KPI
 label="Externos activos"
 value={stats.externalActive}
 meta="Contratistas / facturadores"
 icon={Briefcase}
 />
 <KPI
 label="Brutto mensual"
 value={formatCurrency(stats.totalBrutto)}
 meta="Suma salarios brutos internos"
 tone="warn"
 icon={Wallet}
 />
 <KPI
 label="Gesamtkosten mensual"
 value={formatCurrency(stats.totalGesamtkosten)}
 meta={`Costos recurrentes: ${formatCurrency(stats.recurringMonthly)}`}
 tone="err"
 />
 </KPIGrid>

 {/* Tabs by type */}
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="nx-tabs">
 {tabs.map((t) => {
 const Icon = t.icon;
 return (
 <button
 key={t.key}
 type="button"
 onClick={() => setActiveTab(t.key)}
 className={`nx-tab ${activeTab === t.key ? 'active' : ''}`}
 >
 <span className="inline-flex items-center gap-2">
 <Icon size={12} />
 {t.label} <Badge variant="neutral">{t.count}</Badge>
 </span>
 </button>
 );
 })}
 </div>
 <label className="inline-flex items-center gap-2 cursor-pointer text-[12px] text-[var(--color-fg-3)]">
 <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
 Mostrar inactivos
 </label>
 </div>

 <Panel
 title={tabs.find((t) => t.key === activeTab)?.label || 'Empleados'}
 meta={`${filtered.length} ${filtered.length === 1 ? 'resultado' : 'resultados'}`}
 padding={false}
 actions={
 <div className="relative">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" size={14} />
 <input
 type="text"
 placeholder="Buscar..."
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-1.5 pl-8 pr-3 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 />
 </div>
 }
 >
 {loading ? (
 <div className="px-4 py-12 text-center"><p className="label-mono">Cargando...</p></div>
 ) : filtered.length === 0 ? (
 <EmptyState
 icon={HardHat}
 title="Sin empleados"
 description={
 isInternalTab
 ? 'Comienza creando tu primer empleado interno con nómina.'
 : activeTab === 'external'
 ? 'Comienza agregando colaboradores externos o contratistas.'
 : 'Comienza creando tu primer empleado.'
 }
 action={<Button variant="primary" icon={Plus} onClick={openCreate}>Nuevo empleado</Button>}
 />
 ) : (
 <div className="overflow-x-auto">
 <table className="nx-table w-full">
 <thead>
 <tr>
 <th>Nombre</th>
 <th>Tipo</th>
 <th>Cargo</th>
 {isInternalTab && (
 <>
 <th>StKl</th>
 <th>Krankenkasse</th>
 <th className="text-right">Brutto</th>
 <th className="text-right">Netto</th>
 <th className="text-right">Gesamtkosten</th>
 </>
 )}
 <th className="text-center">Costos rec.</th>
 <th className="text-center">Estado</th>
 <th className="text-right">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {filtered.map((e) => (
  <tr key={e.id} {...rowButtonProps(() => openEdit(e))}>
 <td className="font-medium text-[var(--color-fg-1)]">{e.fullName || '—'}</td>
 <td>
 <Badge variant={e.type === 'internal' ? 'info' : 'neutral'}>
 {TYPE_LABELS[e.type] || e.type}
 </Badge>
 </td>
 <td className="text-[var(--color-fg-3)]">{e.role || '—'}</td>
 {isInternalTab && (
 <>
 <td className="font-mono text-[var(--color-fg-3)]">{e.taxClass || '—'}</td>
 <td className="text-[var(--color-fg-3)]">{e.krankenkasse || '—'}</td>
 <td className="text-right font-mono tabular-nums">{e.bruttoMonthly ? formatCurrency(e.bruttoMonthly) : '—'}</td>
 <td className="text-right font-mono tabular-nums text-[var(--color-ok)]">{e.nettoMonthly ? formatCurrency(e.nettoMonthly) : '—'}</td>
 <td className="text-right font-mono tabular-nums text-[var(--color-warn)]">{e.gesamtkostenMonthly ? formatCurrency(e.gesamtkostenMonthly) : '—'}</td>
 </>
 )}
 <td className="text-center">
 <Badge variant="neutral">{stats.costsByEmployee[e.id] || 0}</Badge>
 </td>
 <td className="text-center">
 <Badge variant={STATUS_VARIANTS[e.status] || 'neutral'} dot>
 {STATUS_LABELS[e.status] || e.status}
 </Badge>
 </td>
 <td className="text-right" onClick={(ev) => ev.stopPropagation()}>
 <div className="flex items-center justify-end gap-2">
 <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(e)}>
 Editar
 </Button>
 <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(e)}>
 Borrar
 </Button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </Panel>

 <EmployeeFormModal
 isOpen={isModalOpen}
 onClose={() => setIsModalOpen(false)}
 onSubmit={editingEmployee ? handleUpdate : handleCreate}
 editingEmployee={editingEmployee}
 user={user}
 />

 <ConfirmModal
 isOpen={Boolean(confirmDelete)}
 onClose={() => setConfirmDelete(null)}
 onConfirm={handleDelete}
 title="Eliminar empleado"
 message={`¿Seguro que querés eliminar "${confirmDelete?.fullName}"? Los costos recurrentes asociados quedarán huérfanos.`}
 confirmText="Eliminar"
 variant="danger"
 />
 </div>
 );
};

export default Employees;
