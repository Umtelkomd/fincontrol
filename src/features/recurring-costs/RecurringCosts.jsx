import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Repeat, Search, ToggleLeft, ToggleRight, CalendarCheck2 } from 'lucide-react';
import { useRecurringCosts } from '../../hooks/useRecurringCosts';
import { useEmployees } from '../../hooks/useEmployees';
import { useProperties } from '../../hooks/useProperties';
import { useVehicles } from '../../hooks/useVehicles';
import { useInsurances } from '../../hooks/useInsurances';
import { useCostCenters } from '../../hooks/useCostCenters';
import { useProjects } from '../../hooks/useProjects';
import { monthlyEquivalent } from '../../finance/assetSchemas';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency } from '../../utils/formatters';
import RecurringCostFormModal from '../../components/ui/RecurringCostFormModal';
import GenerateMonthModal from '../../components/ui/GenerateMonthModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const OWNER_TYPE_LABELS = {
 employee: 'Empleado',
 property: 'Vivienda',
 vehicle: 'Vehículo',
 insurance: 'Seguro',
 general: 'General',
};

const FREQUENCY_LABELS = {
 monthly: 'Mensual',
 quarterly: 'Trimestral',
 yearly: 'Anual',
 biweekly: 'Quincenal',
 weekly: 'Semanal',
};

const RecurringCosts = ({ user }) => {
 const {
 recurringCosts,
 loading,
 createRecurringCost,
 updateRecurringCost,
 deleteRecurringCost,
 toggleActive,
 totalMonthlyEquivalent,
 } = useRecurringCosts(user);

 const { employees } = useEmployees(user);
 const { properties } = useProperties(user);
 const { vehicles } = useVehicles(user);
 const { insurances } = useInsurances(user);
 const { costCenters } = useCostCenters(user);
 const { projects } = useProjects(user);

 const [filter, setFilter] = useState('all'); // all | employee | property | vehicle | general
 const [searchQuery, setSearchQuery] = useState('');
 const [showInactive, setShowInactive] = useState(false);
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [isGenerateOpen, setIsGenerateOpen] = useState(false);
 const [editingCost, setEditingCost] = useState(null);
 const [confirmDelete, setConfirmDelete] = useState(null);

 const filtered = useMemo(() => {
 let list = recurringCosts;
 if (filter !== 'all') list = list.filter((c) => c.ownerType === filter);
 if (!showInactive) list = list.filter((c) => c.active);
 if (searchQuery.trim()) {
 const q = searchQuery.toLowerCase();
 list = list.filter(
 (c) =>
 c.concept?.toLowerCase().includes(q) ||
 c.ownerName?.toLowerCase().includes(q) ||
 c.counterpartyName?.toLowerCase().includes(q) ||
 c.notes?.toLowerCase().includes(q),
 );
 }
 return list;
 }, [recurringCosts, filter, showInactive, searchQuery]);

 const stats = useMemo(() => {
 const counts = { all: 0, employee: 0, property: 0, vehicle: 0, insurance: 0, general: 0 };
 recurringCosts.forEach((c) => {
 if (!c.active) return;
 counts.all++;
 counts[c.ownerType] = (counts[c.ownerType] || 0) + 1;
 });
 return {
 counts,
 totalMonthly: totalMonthlyEquivalent(),
 monthlyByType: {
 employee: totalMonthlyEquivalent('employee'),
 property: totalMonthlyEquivalent('property'),
 vehicle: totalMonthlyEquivalent('vehicle'),
 insurance: totalMonthlyEquivalent('insurance'),
 general: totalMonthlyEquivalent('general'),
 },
 };
 }, [recurringCosts, totalMonthlyEquivalent]);

 const handleCreate = async (data) => createRecurringCost(data);
 const handleUpdate = async (data) => updateRecurringCost(editingCost.id, data);

 const handleDelete = async () => {
 if (!confirmDelete) return;
 await deleteRecurringCost(confirmDelete.id);
 setConfirmDelete(null);
 };

 const openEdit = (c) => {
 setEditingCost(c);
 setIsModalOpen(true);
 };

 const openCreate = () => {
 setEditingCost(null);
 setIsModalOpen(true);
 };

 const filterChips = [
 { key: 'all', label: 'Todos', count: stats.counts.all },
 { key: 'employee', label: 'Empleados', count: stats.counts.employee || 0 },
 { key: 'property', label: 'Viviendas', count: stats.counts.property || 0 },
 { key: 'vehicle', label: 'Vehículos', count: stats.counts.vehicle || 0 },
 { key: 'insurance', label: 'Seguros', count: stats.counts.insurance || 0 },
 { key: 'general', label: 'Generales', count: stats.counts.general || 0 },
 ];

 return (
 <div className="space-y-6 pb-12">
 <header className="flex items-end justify-between gap-4 flex-wrap">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">Proyección · Costos recurrentes</p>
 <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
 Costos mensuales fijos
 </h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
 Reglas que generan cuentas por pagar automáticas cada período.
 Aplican a empleados, viviendas, vehículos o costos generales.
 </p>
 </div>
 <div className="flex items-center gap-2">
 <Button variant="secondary" icon={CalendarCheck2} onClick={() => setIsGenerateOpen(true)}>
 Generar mes
 </Button>
 <Button variant="primary" icon={Plus} onClick={openCreate}>
 Nuevo costo
 </Button>
 </div>
 </header>

 <KPIGrid cols={4}>
 <KPI
 label="Total mensual"
 value={formatCurrency(stats.totalMonthly)}
 meta="Proyección de salida mensual"
 tone="warn"
 icon={Repeat}
 />
 <KPI
 label="Empleados"
 value={formatCurrency(stats.monthlyByType.employee)}
 meta={`${stats.counts.employee || 0} reglas activas`}
 />
 <KPI
 label="Viviendas"
 value={formatCurrency(stats.monthlyByType.property)}
 meta={`${stats.counts.property || 0} reglas activas`}
 />
 <KPI
 label="Vehículos + Seguros"
 value={formatCurrency(stats.monthlyByType.vehicle + stats.monthlyByType.insurance)}
 meta={`${(stats.counts.vehicle || 0) + (stats.counts.insurance || 0)} reglas activas`}
 />
 </KPIGrid>

 <div className="flex items-center justify-between gap-4 flex-wrap">
 <div className="flex flex-wrap items-center gap-2">
 {filterChips.map((c) => (
 <button
 key={c.key}
 type="button"
 onClick={() => setFilter(c.key)}
  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all ${
 filter === c.key
 ? 'border border-[var(--color-accent)] bg-transparent text-[var(--color-accent)]'
 : 'border border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)]'
 }`}
 >
 {c.label}
 <Badge variant="neutral">{c.count}</Badge>
 </button>
 ))}
 </div>
 <label className="inline-flex items-center gap-2 cursor-pointer text-[12px] text-[var(--color-fg-3)]">
 <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
 Mostrar inactivos
 </label>
 </div>

 <Panel
 title="Lista de costos recurrentes"
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
 icon={Repeat}
 title="Sin costos recurrentes"
 description="Comienza agregando una regla. Por ejemplo: salario neto de un empleado, leasing de un vehículo, alquiler de una vivienda."
 action={<Button variant="primary" icon={Plus} onClick={openCreate}>Nuevo costo</Button>}
 />
 ) : (
 <div className="overflow-x-auto">
 <table className="nx-table w-full">
 <thead>
 <tr>
 <th>Concepto</th>
 <th>Tipo</th>
 <th>Asociado a</th>
 <th>Contraparte</th>
 <th className="text-right">Monto</th>
 <th>Frecuencia</th>
 <th className="text-right">Mensual eq.</th>
 <th className="text-center">Estado</th>
 <th className="text-right">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {filtered.map((c) => (
  <tr key={c.id} {...rowButtonProps(() => openEdit(c))}>
 <td className="font-medium text-[var(--color-fg-1)]">{c.concept || '—'}</td>
 <td>{OWNER_TYPE_LABELS[c.ownerType] || c.ownerType}</td>
 <td className="text-[var(--color-fg-3)]">{c.ownerName || '—'}</td>
 <td className="text-[var(--color-fg-3)]">{c.counterpartyName || '—'}</td>
 <td className="text-right font-mono tabular-nums">{formatCurrency(c.amount)}</td>
 <td>{FREQUENCY_LABELS[c.frequency] || c.frequency}</td>
 <td className="text-right font-mono tabular-nums text-[var(--color-warn)]">
 {formatCurrency(monthlyEquivalent(c))}
 </td>
 <td className="text-center">
 <Badge variant={c.active ? 'ok' : 'neutral'} dot>
 {c.active ? 'Activo' : 'Inactivo'}
 </Badge>
 </td>
 <td className="text-right" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-end gap-2">
 <Button
 variant="ghost"
 size="sm"
 icon={c.active ? ToggleRight : ToggleLeft}
 onClick={() => toggleActive(c)}
 >
 {c.active ? 'Desactivar' : 'Activar'}
 </Button>
 <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(c)}>
 Editar
 </Button>
 <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(c)}>
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

 <RecurringCostFormModal
 isOpen={isModalOpen}
 onClose={() => setIsModalOpen(false)}
 onSubmit={editingCost ? handleUpdate : handleCreate}
 editingCost={editingCost}
 employees={employees}
 properties={properties}
 vehicles={vehicles}
 insurances={insurances}
 costCenters={costCenters}
 projects={projects}
 />

 <ConfirmModal
 isOpen={Boolean(confirmDelete)}
 onClose={() => setConfirmDelete(null)}
 onConfirm={handleDelete}
 title="Eliminar costo recurrente"
 message={`¿Seguro que querés eliminar "${confirmDelete?.concept}"? Las cuentas por pagar ya generadas NO se borran.`}
 confirmText="Eliminar"
 variant="danger"
 />

 <GenerateMonthModal
 isOpen={isGenerateOpen}
 onClose={() => setIsGenerateOpen(false)}
 user={user}
 />
 </div>
 );
};

export default RecurringCosts;
