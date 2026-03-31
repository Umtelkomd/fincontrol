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
  vendor: 'text-[#d04c36] bg-[rgba(208,76,54,0.08)] border-[rgba(208,76,54,0.18)]',
  client: 'text-[#0f9f6e] bg-[rgba(15,159,110,0.08)] border-[rgba(15,159,110,0.18)]',
  both: 'text-[#3156d3] bg-[rgba(49,86,211,0.08)] border-[rgba(49,86,211,0.18)]',
};

const Partners = ({ user, userRole }) => {
  const { partners, loading, getFilteredPartners, createPartner, updatePartner, togglePartnerStatus } =
    usePartners(user);
  const { transactions } = useTransactions(user);

  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'client' | 'vendor'
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState(null);
  const [submitting, setSubmitting] = useState(false);
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
        <Loader2 className="h-8 w-8 animate-spin text-[#4d74ff]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header + Add button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-[rgba(90,141,221,0.24)] bg-[rgba(90,141,221,0.08)]">
            <Building2 size={18} className="text-[#3156d3]" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#5a8ddd]">
              Master data
            </p>
            <h3 className="text-xl font-semibold tracking-tight text-[#101938]">
              Geschäftspartner
            </h3>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 rounded-full border border-[rgba(132,224,255,0.52)] bg-[linear-gradient(135deg,#1b68ff_0%,#1ab8ff_100%)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(24,102,255,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_40px_rgba(24,102,255,0.36)]"
        >
          <Plus size={15} />
          Nuevo Partner
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(244,248,255,0.84))] p-2 shadow-[0_20px_48px_rgba(126,147,190,0.1)]">
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
                    ? 'border border-[rgba(90,141,221,0.28)] bg-[rgba(90,141,221,0.12)] text-[#3156d3] shadow-[0_10px_24px_rgba(90,141,221,0.12)]'
                    : 'text-[#6b7a96] hover:text-[#101938] hover:bg-white'
                }`}
              >
                <Icon size={15} />
                {label}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    isActive
                      ? 'bg-[rgba(49,86,211,0.14)] text-[#3156d3]'
                      : 'bg-[rgba(94,115,159,0.1)] text-[#6b7a96]'
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
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#70819f]"
          />
          <input
            type="text"
            placeholder="Buscar por nombre, email, NIF..."
            className="rounded-2xl border border-[rgba(205,219,243,0.8)] bg-white/80 py-2.5 pl-10 pr-4 text-sm text-[#22304f] outline-none transition focus:border-[#7aa2ff] focus:ring-2 focus:ring-[rgba(59,130,246,0.1)]"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[24px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(246,249,255,0.88))] shadow-[0_20px_48px_rgba(126,147,190,0.1)] overflow-hidden">
        {displayedPartners.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(94,115,159,0.08)]">
              <Building2 size={28} className="text-[#70819f]" />
            </div>
            <p className="text-base font-semibold text-[#4b5d83]">
              {searchQuery ? 'Sin resultados' : 'Sin Geschäftspartner registrados'}
            </p>
            <p className="mt-1 text-sm text-[#70819f]">
              {searchQuery
                ? `No se encontraron partners para "${searchQuery}"`
                : 'Crea tu primer Geschäftspartner para gestionar tus proveedores y clientes.'}
            </p>
            {!searchQuery && (
              <button
                type="button"
                onClick={handleOpenCreate}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[rgba(49,86,211,0.24)] bg-[rgba(49,86,211,0.06)] px-4 py-2.5 text-sm font-semibold text-[#3156d3] transition hover:bg-[rgba(49,86,211,0.12)]"
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
                <tr className="border-b border-[rgba(205,219,243,0.72)]">
                  <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-widest text-[#70819f]">
                    Nombre
                  </th>
                  <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-widest text-[#70819f]">
                    Tipo
                  </th>
                  <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-widest text-[#70819f]">
                    Email
                  </th>
                  <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-widest text-[#70819f]">
                    Teléfono
                  </th>
                  <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-widest text-[#70819f]">
                    IVA default
                  </th>
                  <th className="px-4 py-3.5 text-center text-xs font-bold uppercase tracking-widest text-[#70819f]">
                    Estado
                  </th>
                  <th className="px-4 py-3.5 text-center text-xs font-bold uppercase tracking-widest text-[#70819f]">
                    Transacciones
                  </th>
                  <th className="px-4 py-3.5 text-right text-xs font-bold uppercase tracking-widest text-[#70819f]">
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
                      className={`border-b border-[rgba(205,219,243,0.5)] transition-colors ${
                        isInactive
                          ? 'bg-[rgba(245,248,255,0.5)]'
                          : idx % 2 === 0
                          ? 'bg-white'
                          : 'bg-[rgba(245,248,255,0.4)]'
                      } hover:bg-[rgba(245,248,255,0.8)]`}
                    >
                      {/* Name */}
                      <td className="px-5 py-3.5">
                        <div>
                          <p
                            className={`font-semibold ${
                              isInactive ? 'text-[#70819f] line-through' : 'text-[#1f2a44]'
                            }`}
                          >
                            {partner.name}
                          </p>
                          {partner.legalName && partner.legalName !== partner.name && (
                            <p className="text-xs text-[#70819f]">{partner.legalName}</p>
                          )}
                          {partner.taxId && (
                            <p className="text-xs text-[#70819f]">NIF: {partner.taxId}</p>
                          )}
                        </div>
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
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
                            className="text-[#3156d3] hover:underline"
                          >
                            {partner.email}
                          </a>
                        ) : (
                          <span className="text-[#93a0b6]">—</span>
                        )}
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3.5">
                        {partner.phone ? (
                          <span className="text-[#4b5d83]">{partner.phone}</span>
                        ) : (
                          <span className="text-[#93a0b6]">—</span>
                        )}
                      </td>

                      {/* Default Tax Rate */}
                      <td className="px-4 py-3.5">
                        {partner.defaultTaxRate != null ? (
                          <span className="rounded-full bg-[rgba(214,149,44,0.08)] px-2.5 py-1 text-xs font-semibold text-[#c98717]">
                            {(partner.defaultTaxRate * 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-[#93a0b6]">19%</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(partner)}
                          disabled={actionLoading === partner.id}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                            isInactive
                              ? 'bg-[rgba(94,115,159,0.1)] text-[#70819f]'
                              : 'bg-[rgba(15,159,110,0.1)] text-[#0f9f6e]'
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
                          <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(49,86,211,0.08)] px-2.5 py-1 text-xs font-semibold text-[#3156d3]">
                            {txCount} transacción{txCount !== 1 ? 'es' : ''}
                          </span>
                        ) : (
                          <span className="text-[#93a0b6]">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(partner)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-[rgba(205,219,243,0.8)] bg-white text-[#70819f] transition-colors hover:border-[#7aa2ff] hover:text-[#3156d3]"
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
