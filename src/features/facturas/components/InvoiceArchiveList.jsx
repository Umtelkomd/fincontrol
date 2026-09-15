/**
 * Archived invoice table: search + CXP/CXC filter chips over the documents
 * from useInvoiceDocuments. Row click selects a document for InvoiceViewer.
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import Table from '../../../components/ui/nexus/Table';
import { formatCurrency, formatDate } from '../../../utils/formatters';

const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'incoming', label: 'CXP' },
  { id: 'outgoing', label: 'CXC' },
];

const matchesSearch = (document, term) => {
  if (!term) return true;
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return (
    String(document.counterpartyName || '').toLowerCase().includes(needle) ||
    String(document.invoiceNumber || '').toLowerCase().includes(needle)
  );
};

const InvoiceArchiveList = ({ documents = [], loading = false, onSelect }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(
    () =>
      documents
        .filter((document) => filter === 'all' || document.direction === filter)
        .filter((document) => matchesSearch(document, search)),
    [documents, filter, search],
  );

  const rows = filtered.map((document) => ({ ...document, id: document.id }));

  const columns = [
    {
      key: 'issueDate',
      label: 'Fecha',
      render: (row) => (row.issueDate ? formatDate(row.issueDate) : '—'),
    },
    {
      key: 'direction',
      label: 'Tipo',
      render: (row) => (row.direction === 'incoming' ? 'CXP' : 'CXC'),
    },
    { key: 'counterpartyName', label: 'Contraparte' },
    { key: 'invoiceNumber', label: 'Nº' },
    {
      key: 'grossAmount',
      label: 'Bruto',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.grossAmount),
    },
    {
      key: 'links',
      label: 'Vínculos',
      align: 'right',
      render: (row) => (Array.isArray(row.links) ? row.links.length : 0),
    },
    { key: 'originalName', label: 'Archivo' },
  ];

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" size={16} />
          <input
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] py-2 pl-10 pr-4 text-sm text-[var(--color-fg-1)] outline-none transition-all placeholder:text-[var(--color-fg-4)] focus:border-[var(--color-line-s)]"
            placeholder="Buscar por contraparte o número"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar factura archivada"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
                filter === item.id
                  ? 'border-[var(--color-accent)] bg-[var(--color-bg-2)] text-[var(--color-accent)]'
                  : 'border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <Table
        columns={columns}
        rows={rows}
        loading={loading}
        onRowClick={(row) => onSelect?.(row)}
        rowKey="id"
        empty={
          <div className="px-4 py-12 text-center">
            <p className="label-mono text-[var(--color-fg-3)]">Aún no hay facturas archivadas.</p>
          </div>
        }
      />
    </div>
  );
};

export default InvoiceArchiveList;
