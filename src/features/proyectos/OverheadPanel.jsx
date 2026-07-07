/**
 * Overhead tab — indirect pool composition and its allocation across projects.
 *
 * The basis selector persists company-wide via useOverheadConfig (a shared
 * accounting decision, not a per-session toggle).
 */
import { useMemo } from 'react';
import { KPI, KPIGrid, Panel, Table, EmptyState } from '@/components/ui/nexus';
import { formatCurrency } from '../../utils/formatters';
import { fmtMoney, fmtPct, fmtPctFraction, DASH } from './controlFormat';

const BASIS_OPTIONS = [
  { value: 'directCost', label: 'Costos directos' },
  { value: 'revenue', label: 'Ingresos' },
];

const OverheadPanel = ({ rows, overheadDetail, overheadBasis, onBasisChange }) => {
  const { pool, allocation, composition } = overheadDetail;

  const projectRows = useMemo(() => rows.filter((row) => row.bucket === 'project'), [rows]);

  const measureOf = (row) => (overheadBasis === 'revenue' ? row.revenueAccrued : row.directCost);

  const compositionColumns = [
    { key: 'label', label: 'Concepto' },
    { key: 'amount', label: 'Importe', align: 'right', mono: true, render: (row) => formatCurrency(row.amount) },
  ];

  const allocationColumns = [
    { key: 'displayName', label: 'Proyecto' },
    { key: 'base', label: 'Base', align: 'right', mono: true, render: (row) => formatCurrency(measureOf(row)) },
    {
      key: 'share',
      label: '% participación',
      align: 'right',
      mono: true,
      render: (row) => (allocation.base > 0 ? fmtPct((measureOf(row) / allocation.base) * 100) : DASH),
    },
    {
      key: 'overheadAllocated',
      label: 'Overhead asignado',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.overheadAllocated),
    },
    {
      key: 'burdenedCost',
      label: 'Costo cargado',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.burdenedCost),
    },
    {
      key: 'netMarginToDate',
      label: 'Margen neto',
      align: 'right',
      mono: true,
      render: (row) => fmtPctFraction(row.netMarginToDate),
    },
  ];

  const basisSelector = (
    <div className="flex items-center gap-1.5">
      {BASIS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onBasisChange(option.value)}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
            overheadBasis === option.value
              ? 'border-[var(--color-line-s)] bg-[var(--color-bg-2)] text-[var(--color-accent)]'
              : 'border-[var(--color-line)] text-[var(--color-fg-4)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <Panel
        title="Pool de indirectos"
        meta="Tasa predeterminada = pool de indirectos / base de asignación (PMP)"
        actions={basisSelector}
      >
        <KPIGrid cols={4}>
          <KPI label="Pool total" value={fmtMoney(pool.total)} meta="A recuperar vía tasa" />
          <KPI label="Costos indirectos" value={fmtMoney(pool.indirectCosts)} meta="Gasto sin proyecto" />
          <KPI
            label="Nómina sin asignar"
            value={fmtMoney(pool.unallocatedLabor)}
            tone={pool.unallocatedLabor > 0 ? 'warn' : 'default'}
            meta="Empleados sin proyectos"
          />
          <KPI
            label="Tasa de asignación"
            value={fmtPct(allocation.rate * 100)}
            meta={overheadBasis === 'revenue' ? 'Sobre ingresos devengados' : 'Sobre costos directos'}
          />
        </KPIGrid>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Composición del pool" meta="Por categoría" padding={false}>
          <Table
            columns={compositionColumns}
            rows={composition.map((entry) => ({ ...entry, id: entry.label }))}
            empty={
              <EmptyState
                title="Sin indirectos"
                description="No hay gasto sin proyecto ni nómina sin asignar en el periodo."
              />
            }
          />
        </Panel>

        <Panel title="Asignación por proyecto" meta={`Base ${fmtMoney(allocation.base)}`} padding={false}>
          <Table
            columns={allocationColumns}
            rows={projectRows}
            rowKey="key"
            empty={
              <EmptyState
                title="Sin base de asignación"
                description="Los proyectos aún no tienen costos o ingresos que absorban overhead."
              />
            }
          />
        </Panel>
      </div>
    </div>
  );
};

export default OverheadPanel;
