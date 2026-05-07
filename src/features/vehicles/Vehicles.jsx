import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Car, Search, Fuel } from 'lucide-react';
import { useVehicles } from '../../hooks/useVehicles';
import { useEmployees } from '../../hooks/useEmployees';
import { useRecurringCosts } from '../../hooks/useRecurringCosts';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency } from '../../utils/formatters';
import VehicleFormModal from '../../components/ui/VehicleFormModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const TYPE_LABELS = { owned: 'Propio', leased: 'Leasing', rented: 'Alquilado' };
const STATUS_LABELS = { active: 'Activo', maintenance: 'Mantenimiento', inactive: 'Inactivo' };

const Vehicles = ({ user }) => {
 const { vehicles, loading, createVehicle, updateVehicle, deleteVehicle } = useVehicles(user);
 const { employees } = useEmployees(user);
 const { recurringCosts, totalMonthlyEquivalent } = useRecurringCosts(user);

 const [searchQuery, setSearchQuery] = useState('');
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [editingVehicle, setEditingVehicle] = useState(null);
 const [confirmDelete, setConfirmDelete] = useState(null);

 const drivers = useMemo(
 () => employees.filter((e) => e.status === 'active').map((e) => e.fullName).sort(),
 [employees],
 );

 const filtered = useMemo(() => {
 if (!searchQuery.trim()) return vehicles;
 const q = searchQuery.toLowerCase();
 return vehicles.filter(
 (v) =>
 v.name?.toLowerCase().includes(q) ||
 v.model?.toLowerCase().includes(q) ||
 v.plate?.toLowerCase().includes(q) ||
 v.assignedDriver?.toLowerCase().includes(q),
 );
 }, [vehicles, searchQuery]);

 const stats = useMemo(() => {
 const active = vehicles.filter((v) => v.status === 'active');
 const monthlyTotal = totalMonthlyEquivalent('vehicle');
 const fuelBudget = active.reduce((s, v) => s + (Number(v.fuelBudgetMonthly) || 0), 0);
 const costsByVehicle = recurringCosts.reduce((acc, c) => {
 if (c.ownerType === 'vehicle' && c.active) acc[c.ownerId] = (acc[c.ownerId] || 0) + 1;
 return acc;
 }, {});
 return {
 total: vehicles.length,
 active: active.length,
 owned: active.filter((v) => v.type === 'owned').length,
 leasedOrRented: active.filter((v) => v.type === 'leased' || v.type === 'rented').length,
 monthlyTotal,
 fuelBudget,
 costsByVehicle,
 };
 }, [vehicles, recurringCosts, totalMonthlyEquivalent]);

 const handleCreate = async (data) => createVehicle(data);
 const handleUpdate = async (data) => updateVehicle(editingVehicle.id, data);

 const handleDelete = async () => {
 if (!confirmDelete) return;
 await deleteVehicle(confirmDelete.id);
 setConfirmDelete(null);
 };

 const openEdit = (v) => {
 setEditingVehicle(v);
 setIsModalOpen(true);
 };

 const openCreate = () => {
 setEditingVehicle(null);
 setIsModalOpen(true);
 };

 return (
 <div className="space-y-6 pb-12">
 <header className="flex items-end justify-between gap-4 flex-wrap">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">Assets · Vehículos</p>
 <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
 Flota
 </h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
 Gestiona la flota y sus costos recurrentes (leasing, alquiler, seguros, combustible).
 </p>
 </div>
 <Button variant="primary" icon={Plus} onClick={openCreate}>
 Nuevo vehículo
 </Button>
 </header>

 <KPIGrid cols={4}>
 <KPI label="Activos" value={stats.active} meta={`${stats.total} totales`} icon={Car} />
 <KPI label="Propios" value={stats.owned} meta="Vehículos en propiedad" />
 <KPI label="Leasing/Alquiler" value={stats.leasedOrRented} meta="Mensual recurrente" />
 <KPI
 label="Costo mensual recurrente"
 value={formatCurrency(stats.monthlyTotal)}
 meta={`Combustible budget: ${formatCurrency(stats.fuelBudget)}`}
 tone="warn"
 icon={Fuel}
 />
 </KPIGrid>

 <Panel
 title="Lista de vehículos"
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
 icon={Car}
 title="Sin vehículos"
 description="Comienza creando tu primer vehículo."
 action={<Button variant="primary" icon={Plus} onClick={openCreate}>Nuevo vehículo</Button>}
 />
 ) : (
 <div className="overflow-x-auto">
 <table className="nx-table w-full">
 <thead>
 <tr>
 <th>Vehículo</th>
 <th>Modelo</th>
 <th>Matrícula</th>
 <th>Tipo</th>
 <th>Conductor</th>
 <th className="text-right">Km actual</th>
 <th className="text-center">Costos</th>
 <th className="text-center">Estado</th>
 <th className="text-right">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {filtered.map((v) => (
  <tr key={v.id} {...rowButtonProps(() => openEdit(v))}>
 <td className="font-medium text-[var(--color-fg-1)]">{v.name}</td>
 <td className="text-[var(--color-fg-3)]">{v.model || '—'}</td>
 <td className="font-mono text-[var(--color-fg-3)]">{v.plate || '—'}</td>
 <td>{TYPE_LABELS[v.type] || v.type}</td>
 <td className="text-[var(--color-fg-3)]">{v.assignedDriver || '—'}</td>
 <td className="text-right font-mono tabular-nums">{v.currentKm ? v.currentKm.toLocaleString('de-DE') + ' km' : '—'}</td>
 <td className="text-center">
 <Badge variant="neutral">{stats.costsByVehicle[v.id] || 0}</Badge>
 </td>
 <td className="text-center">
 <Badge
 variant={v.status === 'active' ? 'ok' : v.status === 'maintenance' ? 'warn' : 'neutral'}
 dot
 >
 {STATUS_LABELS[v.status] || v.status}
 </Badge>
 </td>
 <td className="text-right" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-end gap-2">
 <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(v)}>
 Editar
 </Button>
 <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(v)}>
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

 <VehicleFormModal
 isOpen={isModalOpen}
 onClose={() => setIsModalOpen(false)}
 onSubmit={editingVehicle ? handleUpdate : handleCreate}
 editingVehicle={editingVehicle}
 drivers={drivers}
 />

 <ConfirmModal
 isOpen={Boolean(confirmDelete)}
 onClose={() => setConfirmDelete(null)}
 onConfirm={handleDelete}
 title="Eliminar vehículo"
 message={`¿Seguro que querés eliminar "${confirmDelete?.name}"? Los costos recurrentes asociados quedarán huérfanos.`}
 confirmText="Eliminar"
 variant="danger"
 />
 </div>
 );
};

export default Vehicles;
