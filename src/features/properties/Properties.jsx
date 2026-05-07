import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Home, Search, Building2 } from 'lucide-react';
import { useProperties } from '../../hooks/useProperties';
import { useRecurringCosts } from '../../hooks/useRecurringCosts';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency } from '../../utils/formatters';
import PropertyFormModal from '../../components/ui/PropertyFormModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const TYPE_LABELS = { rented: 'Alquilada', owned: 'Propia', mixed: 'Mixta' };
const USE_LABELS = { housing: 'Vivienda', office: 'Oficina', storage: 'Almacén', mixed: 'Mixto' };

const Properties = ({ user }) => {
 const { properties, loading, createProperty, updateProperty, deleteProperty } = useProperties(user);
 const { recurringCosts, totalMonthlyEquivalent } = useRecurringCosts(user);

 const [searchQuery, setSearchQuery] = useState('');
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [editingProperty, setEditingProperty] = useState(null);
 const [confirmDelete, setConfirmDelete] = useState(null);

 const filtered = useMemo(() => {
 if (!searchQuery.trim()) return properties;
 const q = searchQuery.toLowerCase();
 return properties.filter(
 (p) =>
 p.name?.toLowerCase().includes(q) ||
 p.address?.toLowerCase().includes(q) ||
 p.city?.toLowerCase().includes(q) ||
 p.landlordOrOwner?.toLowerCase().includes(q),
 );
 }, [properties, searchQuery]);

 const stats = useMemo(() => {
 const active = properties.filter((p) => p.status === 'active');
 const monthlyTotal = totalMonthlyEquivalent('property');
 // Count costs per property
 const costsByProperty = recurringCosts.reduce((acc, c) => {
 if (c.ownerType === 'property' && c.active) acc[c.ownerId] = (acc[c.ownerId] || 0) + 1;
 return acc;
 }, {});
 return {
 total: properties.length,
 active: active.length,
 rented: active.filter((p) => p.type === 'rented').length,
 owned: active.filter((p) => p.type === 'owned').length,
 monthlyTotal,
 costsByProperty,
 };
 }, [properties, recurringCosts, totalMonthlyEquivalent]);

 const handleCreate = async (data) => createProperty(data);
 const handleUpdate = async (data) => updateProperty(editingProperty.id, data);

 const handleDelete = async () => {
 if (!confirmDelete) return;
 await deleteProperty(confirmDelete.id);
 setConfirmDelete(null);
 };

 const openEdit = (p) => {
 setEditingProperty(p);
 setIsModalOpen(true);
 };

 const openCreate = () => {
 setEditingProperty(null);
 setIsModalOpen(true);
 };

 return (
 <div className="space-y-6 pb-12">
 <header className="flex items-end justify-between gap-4 flex-wrap">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">Assets · Viviendas</p>
 <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
 Viviendas y oficinas
 </h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
 Gestiona inmuebles activos y sus costos recurrentes (alquiler, servicios, impuestos).
 </p>
 </div>
 <Button variant="primary" icon={Plus} onClick={openCreate}>
 Nueva vivienda
 </Button>
 </header>

 <KPIGrid cols={4}>
 <KPI label="Activas" value={stats.active} meta={`${stats.total} totales`} icon={Home} />
 <KPI label="Alquiladas" value={stats.rented} meta="Inmuebles rentados" />
 <KPI label="Propias" value={stats.owned} meta="Inmuebles en propiedad" />
 <KPI
 label="Gasto mensual"
 value={formatCurrency(stats.monthlyTotal)}
 meta="Suma costos recurrentes activos"
 tone="warn"
 icon={Building2}
 />
 </KPIGrid>

 <Panel
 title="Lista de viviendas"
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
 icon={Home}
 title="Sin viviendas"
 description="Comienza creando tu primera vivienda u oficina."
 action={<Button variant="primary" icon={Plus} onClick={openCreate}>Nueva vivienda</Button>}
 />
 ) : (
 <div className="overflow-x-auto">
 <table className="nx-table w-full">
 <thead>
 <tr>
 <th>Nombre</th>
 <th>Tipo</th>
 <th>Uso</th>
 <th>Dirección</th>
 <th className="text-center">Costos activos</th>
 <th className="text-center">Estado</th>
 <th className="text-right">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {filtered.map((p) => (
  <tr key={p.id} {...rowButtonProps(() => openEdit(p))}>
 <td className="font-medium text-[var(--color-fg-1)]">{p.name}</td>
 <td>{TYPE_LABELS[p.type] || p.type}</td>
 <td>{USE_LABELS[p.use] || p.use}</td>
 <td className="text-[var(--color-fg-3)]">{[p.address, p.city].filter(Boolean).join(', ') || '—'}</td>
 <td className="text-center">
 <Badge variant="neutral">{stats.costsByProperty[p.id] || 0}</Badge>
 </td>
 <td className="text-center">
 <Badge variant={p.status === 'active' ? 'ok' : 'neutral'} dot>
 {p.status === 'active' ? 'Activa' : 'Inactiva'}
 </Badge>
 </td>
 <td className="text-right" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-end gap-2">
 <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(p)}>
 Editar
 </Button>
 <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(p)}>
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

 <PropertyFormModal
 isOpen={isModalOpen}
 onClose={() => setIsModalOpen(false)}
 onSubmit={editingProperty ? handleUpdate : handleCreate}
 editingProperty={editingProperty}
 />

 <ConfirmModal
 isOpen={Boolean(confirmDelete)}
 onClose={() => setConfirmDelete(null)}
 onConfirm={handleDelete}
 title="Eliminar vivienda"
 message={`¿Seguro que querés eliminar "${confirmDelete?.name}"? Los costos recurrentes asociados quedarán huérfanos.`}
 confirmText="Eliminar"
 variant="danger"
 />
 </div>
 );
};

export default Properties;
