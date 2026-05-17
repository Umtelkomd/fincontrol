import { useState, useMemo } from 'react';
import {
 Plus,
 Search,
 Loader2,
 Pencil,
 ToggleLeft,
 ToggleRight,
 ExternalLink,
 Users,
 UserCheck,
 User,
 Building2,
} from 'lucide-react';
import { usePartners } from '../../hooks/usePartners';
import { useTransactions } from '../../hooks/useTransactions';
import PartnerFormModal from '../../components/ui/PartnerFormModal';

const TYPE_LABELS = {
 vendor: 'Proveedor',
 client: 'Cliente',
 both: 'Ambos',
};

const TYPE_COLORS = {
 vendor: 'text-[var(--color-accent)] bg-transparent border-[var(--color-line-s)]',
 client: 'text-[var(--color-ok)] bg-transparent border-[var(--color-line-s)]',
 both: 'text-[var(--color-fg-1)] bg-[var(--color-bg-1)] border-[var(--color-line-s)]',
};

const Partners = ({ user }) => {
 const { partners, loading, getFilteredPartners, createPartner, updatePartner, togglePartnerStatus } =
 usePartners(user);
 const { transactions } = useTransactions(user);

 const [activeTab, setActiveTab] = useState('all'); // 'all' | 'client' | 'vendor'
 const [searchQuery, setSearchQuery] = useState('');
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [editingPartner, setEditingPartner] = useState(null);
 const [, setSubmitting] = useState(false);
 const [actionLoading, setActionLoading] = useState(null); // partnerId of partner being toggled

 // Filter partners by tab + search
 const displayedPartners = useMemo(() => {
 let filtered =
 activeTab === 'all'
 ? partners
 : getFilteredPartners(activeTab === 'clients' ? 'client' : 'vendor', null);

 if (searchQuery.trim()) {
 const q = searchQuery.toLowerCase();
 filtered = filtered.filter(
 (p) =>
 p.name.toLowerCase().includes(q) ||
 p.email?.toLowerCase().includes(q) ||
 p.taxId?.toLowerCase().includes(q) ||
 p.notes?.toLowerCase().includes(q),
 );
 }
 return filtered;
 }, [activeTab, partners, getFilteredPartners, searchQuery]);

 // Count by type (for tab badges)
 const counts = useMemo(() => {
 const active = partners.filter((p) => p.status === 'active');
 return {
 all: active.length,
 clients: active.filter((p) => p.type === 'client' || p.type === 'both').length,
 vendors: active.filter((p) => p.type === 'vendor' || p.type === 'both').length,
 };
 }, [partners]);

 const handleOpenCreate = () => {
 setEditingPartner(null);
 setIsModalOpen(true);
 };

 const handleOpenEdit = (partner) => {
 setEditingPartner(partner);
 setIsModalOpen(true);
 };

 const handleCloseModal = () => {
 setIsModalOpen(false);
 setEditingPartner(null);
 };

 const handleSubmit = async (formData) => {
 setSubmitting(true);
 try {
 if (editingPartner) {
 await updatePartner(editingPartner.id, formData);
 } else {
 await createPartner(formData);
 }
 handleCloseModal();
 } finally {
 setSubmitting(false);
 }
 };

 const handleToggleStatus = async (partner) => {
 setActionLoading(partner.id);
 try {
 await togglePartnerStatus(partner);
 } finally {
 setActionLoading(null);
 }
 };

 // Count transactions for a partner
 const getTransactionCount = (partnerName) => {
 if (!transactions || !partnerName) return 0;
 return transactions.filter(
 (t) =>
 t.counterpartyName?.toLowerCase() === partnerName.toLowerCase() ||
 t.description?.toLowerCase().includes(partnerName.toLowerCase()),
 ).length;
 };

 if (loading) {
 return (
 <div className="flex items-center justify-center py-20">
 <Loader2 className="h-8 w-8 animate-spin text-[var(--color-fg-1)]" />
 </div>
 );
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 {/* Header + Add button */}
 <div className="flex flex-wrap items-center justify-between gap-4">
 <div className="flex items-center gap-3">
 <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)]">
 <Building2 size={18} className="text-[var(--color-fg-1)]" />
 </div>
 <div>
 <p className="label-monost text-[var(--color-fg-3)]">
 Master data
 </p>
 <h3 className="text-xl font-medium tracking-tight text-[var(--color-fg-1)]">
 Geschäftspartner
 </h3>
 </div>
 </div>

 <button
 type="button"
 onClick={handleOpenCreate}
 className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-5 py-2.5 text-sm font-medium text-[var(--color-fg-1)] transition hover:"
 >
 <Plus size={15} />
 Nuevo Partner
 </button>
 </div>

 {/* Tabs + Search */}
 <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-2 ">
 {/* Tabs */}
 <div className="flex items-center gap-1">
 {[
 { key: 'all', label: 'Todos', icon: Users, count: counts.all },
 { key: 'client', label: 'Clientes', icon: UserCheck, count: counts.clients },
 { key: 'vendor', label: 'Proveedores', icon: User, count: counts.vendors },
 ].map(({ key, label, icon: Icon, count }) => {
 const isActive = activeTab === key;
 return (
 <button
 key={key}
 type="button"
 onClick={() => setActiveTab(key)}
 className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
 isActive
 ? 'border border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-1)] '
 : 'text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)] hover:bg-[var(--color-bg-1)]'
 }`}
 >
 <Icon size={15} />
 {label}
 <span
 className={`rounded-full px-2 py-0.5 text-xs font-medium ${
 isActive
 ? 'bg-[var(--color-bg-1)] text-[var(--color-fg-1)]'
 : 'bg-[var(--color-bg-1)] text-[var(--color-fg-3)]'
 }`}
 >
 {count}
 </span>
 </button>
 );
 })}
 </div>

 {/* Search */}
 <div className="relative">
 <Search
 size={15}
 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-fg-3)]"
 />
 <input
 type="text"
 placeholder="Buscar por nombre, email, NIF..."
 className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] py-2.5 pl-10 pr-4 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)] "
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 />
 </div>
 </div>

 {/* Table */}
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] overflow-hidden">
 {displayedPartners.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16 text-center">
 <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-transparent">
 <Building2 size={28} className="text-[var(--color-fg-3)]" />
 </div>
 <p className="text-base font-medium text-[var(--color-fg-4)]">
 {searchQuery ? 'Sin resultados' : 'Sin Geschäftspartner registrados'}
 </p>
 <p className="mt-1 text-sm text-[var(--color-fg-3)]">
 {searchQuery
 ? `No se encontraron partners para "${searchQuery}"`
 : 'Crea tu primer Geschäftspartner para gestionar tus proveedores y clientes.'}
 </p>
 {!searchQuery && (
 <button
 type="button"
 onClick={handleOpenCreate}
 className="mt-4 inline-flex items-center gap-2 rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg-1)] transition hover:bg-[var(--color-bg-1)]"
 >
 <Plus size={15} />
 Crear primer partner
 </button>
 )}
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-[var(--color-line)]">
 <th className="px-5 py-3.5 text-left label-monost text-[var(--color-fg-3)]">
 Nombre
 </th>
 <th className="px-4 py-3.5 text-left label-monost text-[var(--color-fg-3)]">
 Tipo
 </th>
 <th className="px-4 py-3.5 text-left label-monost text-[var(--color-fg-3)]">
 Email
 </th>
 <th className="px-4 py-3.5 text-left label-monost text-[var(--color-fg-3)]">
 Teléfono
 </th>
 <th className="px-4 py-3.5 text-left label-monost text-[var(--color-fg-3)]">
 IVA default
 </th>
 <th className="px-4 py-3.5 text-center label-monost text-[var(--color-fg-3)]">
 Estado
 </th>
 <th className="px-4 py-3.5 text-center label-monost text-[var(--color-fg-3)]">
 Transacciones
 </th>
 <th className="px-4 py-3.5 text-right label-monost text-[var(--color-fg-3)]">
 Acciones
 </th>
 </tr>
 </thead>
 <tbody>
 {displayedPartners.map((partner, idx) => {
 const txCount = getTransactionCount(partner.name);
 const isInactive = partner.status === 'inactive';
 return (
 <tr
 key={partner.id}
 className={`border-b border-[var(--color-line)] transition-colors ${
 isInactive
 ? 'bg-[var(--color-bg-2)]'
 : idx % 2 === 0
 ? 'bg-[var(--color-bg-1)]'
 : 'bg-[var(--color-bg-2)]'
 } hover:bg-[var(--color-bg-2)]`}
 >
 {/* Name */}
 <td className="px-5 py-3.5">
 <div>
 <p
 className={`font-medium ${
 isInactive ? 'text-[var(--color-fg-3)] line-through' : 'text-[var(--color-fg-1)]'
 }`}
 >
 {partner.name}
 </p>
 {partner.legalName && partner.legalName !== partner.name && (
 <p className="text-xs text-[var(--color-fg-3)]">{partner.legalName}</p>
 )}
 {partner.taxId && (
 <p className="text-xs text-[var(--color-fg-3)]">NIF: {partner.taxId}</p>
 )}
 </div>
 </td>

 {/* Type */}
 <td className="px-4 py-3.5">
 <span
 className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
 TYPE_COLORS[partner.type] || TYPE_COLORS.both
 }`}
 >
 {TYPE_LABELS[partner.type] || 'Ambos'}
 </span>
 </td>

 {/* Email */}
 <td className="px-4 py-3.5">
 {partner.email ? (
 <a
 href={`mailto:${partner.email}`}
 className="text-[var(--color-fg-1)] hover:underline"
 >
 {partner.email}
 </a>
 ) : (
 <span className="text-[var(--color-fg-3)]">—</span>
 )}
 </td>

 {/* Phone */}
 <td className="px-4 py-3.5">
 {partner.phone ? (
 <span className="text-[var(--color-fg-4)]">{partner.phone}</span>
 ) : (
 <span className="text-[var(--color-fg-3)]">—</span>
 )}
 </td>

 {/* Default Tax Rate */}
 <td className="px-4 py-3.5">
 {partner.defaultTaxRate != null ? (
 <span className="rounded-full bg-transparent px-2.5 py-1 text-xs font-medium text-[var(--color-warn)]">
 {(partner.defaultTaxRate * 100).toFixed(0)}%
 </span>
 ) : (
 <span className="text-[var(--color-fg-3)]">19%</span>
 )}
 </td>

 {/* Status */}
 <td className="px-4 py-3.5 text-center">
 <button
 type="button"
 onClick={() => handleToggleStatus(partner)}
 disabled={actionLoading === partner.id}
 className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
 isInactive
 ? 'bg-[var(--color-bg-1)] text-[var(--color-fg-3)]'
 : 'bg-transparent text-[var(--color-ok)]'
 }`}
 title={isInactive ? 'Activar' : 'Desactivar'}
 >
 {actionLoading === partner.id ? (
 <Loader2 size={13} className="animate-spin" />
 ) : isInactive ? (
 <ToggleLeft size={15} />
 ) : (
 <ToggleRight size={15} />
 )}
 {isInactive ? 'Inactivo' : 'Activo'}
 </button>
 </td>

 {/* Transaction count */}
 <td className="px-4 py-3.5 text-center">
 {txCount > 0 ? (
 <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-1)] px-2.5 py-1 text-xs font-medium text-[var(--color-fg-1)]">
 {txCount} transacción{txCount !== 1 ? 'es' : ''}
 </span>
 ) : (
 <span className="text-[var(--color-fg-3)]">—</span>
 )}
 </td>

 {/* Actions */}
 <td className="px-4 py-3.5">
 <div className="flex items-center justify-end gap-1.5">
 <button
 type="button"
 onClick={() => handleOpenEdit(partner)}
 className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] transition-colors hover:border-[var(--color-fg-1)] hover:text-[var(--color-fg-1)]"
 title="Editar"
 >
 <Pencil size={13} />
 </button>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}
 </div>

 {/* Partner Modal */}
 <PartnerFormModal
 isOpen={isModalOpen}
 onClose={handleCloseModal}
 onSubmit={handleSubmit}
 editingPartner={editingPartner}
 user={user}
 />
 </div>
 );
};

export default Partners;
