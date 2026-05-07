import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Shield, Search, AlertTriangle } from 'lucide-react';
import { useInsurances } from '../../hooks/useInsurances';
import { useVehicles } from '../../hooks/useVehicles';
import { useProperties } from '../../hooks/useProperties';
import { useEmployees } from '../../hooks/useEmployees';
import { useRecurringCosts } from '../../hooks/useRecurringCosts';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency } from '../../utils/formatters';
import InsuranceFormModal from '../../components/ui/InsuranceFormModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const TYPE_LABELS = {
 haftpflicht: 'Haftpflicht',
 kasko: 'Kasko',
 business: 'Empresa',
 health: 'Salud',
 life: 'Vida',
 property: 'Edificio',
 equipment: 'Equipos',
 liability: 'Profesional',
 other: 'Otro',
};

const STATUS_VARIANTS = { active: 'ok', expired: 'err', cancelled: 'neutral' };
const STATUS_LABELS = { active: 'Activo', expired: 'Expirado', cancelled: 'Cancelado' };

const daysUntil = (dateStr) => {
 if (!dateStr) return null;
 const d = new Date(dateStr);
 if (Number.isNaN(d.getTime())) return null;
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 return Math.floor((d - today) / (1000 * 60 * 60 * 24));
};

const Insurances = ({ user }) => {
 const { insurances, loading, createInsurance, updateInsurance, deleteInsurance } = useInsurances(user);
 const { vehicles } = useVehicles(user);
 const { properties } = useProperties(user);
 const { employees } = useEmployees(user);
 const { recurringCosts, totalMonthlyEquivalent } = useRecurringCosts(user);

 const [searchQuery, setSearchQuery] = useState('');
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [editingInsurance, setEditingInsurance] = useState(null);
 const [confirmDelete, setConfirmDelete] = useState(null);

 const filtered = useMemo(() => {
 if (!searchQuery.trim()) return insurances;
 const q = searchQuery.toLowerCase();
 return insurances.filter(
 (i) =>
 i.name?.toLowerCase().includes(q) ||
 i.insurer?.toLowerCase().includes(q) ||
 i.policyNumber?.toLowerCase().includes(q),
 );
 }, [insurances, searchQuery]);

 const stats = useMemo(() => {
 const active = insurances.filter((i) => i.status === 'active');
 const expiringSoon = active.filter((i) => {
 const days = daysUntil(i.renewalDate || i.endDate);
 return days !== null && days >= 0 && days <= 60;
 });
 const expired = insurances.filter((i) => {
 const days = daysUntil(i.endDate);
 return days !== null && days < 0;
 });
 const totalAnnual = active.reduce((s, i) => s + (Number(i.premiumAnnual) || 0), 0);
 const monthlyEqRecurring = totalMonthlyEquivalent('insurance');
 const costsByInsurance = recurringCosts.reduce((acc, c) => {
 if (c.ownerType === 'insurance' && c.active) acc[c.ownerId] = (acc[c.ownerId] || 0) + 1;
 return acc;
 }, {});

 return {
 total: insurances.length,
 active: active.length,
 expiringSoon: expiringSoon.length,
 expired: expired.length,
 totalAnnual,
 monthlyEqRecurring,
 costsByInsurance,
 };
 }, [insurances, recurringCosts, totalMonthlyEquivalent]);

 const handleCreate = async (data) => createInsurance(data);
 const handleUpdate = async (data) => updateInsurance(editingInsurance.id, data);

 const handleDelete = async () => {
 if (!confirmDelete) return;
 await deleteInsurance(confirmDelete.id);
 setConfirmDelete(null);
 };

 const openEdit = (i) => {
 setEditingInsurance(i);
 setIsModalOpen(true);
 };

 const openCreate = () => {
 setEditingInsurance(null);
 setIsModalOpen(true);
 };

 return (
 <div className="space-y-6 pb-12">
 <header className="flex items-end justify-between gap-4 flex-wrap">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">Assets · Seguros</p>
 <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
 Pólizas y seguros
 </h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
 Gestiona pólizas (responsabilidad civil, Kasko, equipos) y sus cuotas recurrentes.
 Pueden estar atadas a vehículos, viviendas o ser independientes.
 </p>
 </div>
 <Button variant="primary" icon={Plus} onClick={openCreate}>
 Nuevo seguro
 </Button>
 </header>

 <KPIGrid cols={4}>
 <KPI label="Activos" value={stats.active} meta={`${stats.total} totales`} icon={Shield} />
 <KPI
 label="Por renovar (60d)"
 value={stats.expiringSoon}
 meta="En los próximos 60 días"
 tone={stats.expiringSoon > 0 ? 'warn' : 'default'}
 icon={AlertTriangle}
 />
 <KPI
 label="Prima anual total"
 value={formatCurrency(stats.totalAnnual)}
 meta="Suma primas anuales activas"
 tone="warn"
 />
 <KPI
 label="Mensual eq."
 value={formatCurrency(stats.monthlyEqRecurring)}
 meta="Suma costos recurrentes activos"
 tone="warn"
 />
 </KPIGrid>

 <Panel
 title="Lista de seguros"
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
 icon={Shield}
 title="Sin seguros"
 description="Comienza creando tu primera póliza."
 action={<Button variant="primary" icon={Plus} onClick={openCreate}>Nuevo seguro</Button>}
 />
 ) : (
 <div className="overflow-x-auto">
 <table className="nx-table w-full">
 <thead>
 <tr>
 <th>Nombre</th>
 <th>Tipo</th>
 <th>Aseguradora</th>
 <th>Póliza</th>
 <th>Vence</th>
 <th className="text-right">Prima anual</th>
 <th className="text-center">Costos rec.</th>
 <th className="text-center">Estado</th>
 <th className="text-right">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {filtered.map((i) => {
 const days = daysUntil(i.renewalDate || i.endDate);
 const expiringSoon = days !== null && days >= 0 && days <= 60;
 const expired = days !== null && days < 0;
 return (
  <tr key={i.id} {...rowButtonProps(() => openEdit(i))}>
 <td className="font-medium text-[var(--color-fg-1)]">{i.name}</td>
 <td>{TYPE_LABELS[i.type] || i.type}</td>
 <td className="text-[var(--color-fg-3)]">{i.insurer || '—'}</td>
 <td className="font-mono text-[var(--color-fg-3)]">{i.policyNumber || '—'}</td>
 <td className="font-mono text-[var(--color-fg-3)]">
 {i.renewalDate || i.endDate || '—'}
 {expired && <Badge variant="err" className="ml-2">Vencido</Badge>}
 {!expired && expiringSoon && <Badge variant="warn" className="ml-2">{days}d</Badge>}
 </td>
 <td className="text-right font-mono tabular-nums">
 {i.premiumAnnual ? formatCurrency(i.premiumAnnual) : '—'}
 </td>
 <td className="text-center">
 <Badge variant="neutral">{stats.costsByInsurance[i.id] || 0}</Badge>
 </td>
 <td className="text-center">
 <Badge variant={STATUS_VARIANTS[i.status] || 'neutral'} dot>
 {STATUS_LABELS[i.status] || i.status}
 </Badge>
 </td>
 <td className="text-right" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-end gap-2">
 <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(i)}>
 Editar
 </Button>
 <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(i)}>
 Borrar
 </Button>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}
 </Panel>

 <InsuranceFormModal
 isOpen={isModalOpen}
 onClose={() => setIsModalOpen(false)}
 onSubmit={editingInsurance ? handleUpdate : handleCreate}
 editingInsurance={editingInsurance}
 vehicles={vehicles}
 properties={properties}
 employees={employees}
 />

 <ConfirmModal
 isOpen={Boolean(confirmDelete)}
 onClose={() => setConfirmDelete(null)}
 onConfirm={handleDelete}
 title="Eliminar seguro"
 message={`¿Seguro que querés eliminar "${confirmDelete?.name}"? Los costos recurrentes asociados quedarán huérfanos.`}
 confirmText="Eliminar"
 variant="danger"
 />
 </div>
 );
};

export default Insurances;
