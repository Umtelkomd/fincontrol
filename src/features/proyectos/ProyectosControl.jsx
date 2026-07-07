/**
 * Control de Proyectos — PMP-style margin + overhead control.
 *
 * Composition over useProjectControl (ledger + payroll + catalog → pure
 * projectControl engine). Two tabs:
 *   Proyectos — portfolio table with EVM/margins per project + detail panel
 *   Overhead  — indirect pool composition + allocation by basis
 *
 * Route is admin-gated (permission 'budget'). UI copy is Spanish; identifiers
 * and comments are English. NEXUS.OS tokens only.
 */
import { useMemo, useState } from 'react';
import { FolderKanban } from 'lucide-react';
import { KPI, KPIGrid, Panel, Table, Tabs, Badge, EmptyState, Alert } from '@/components/ui/nexus';
import { useProjectControl } from './useProjectControl';
import { fmtMoney, fmtPct, fmtPctFraction, fmtRatio, DASH } from './controlFormat';
import ProjectDetailPanel from './ProjectDetailPanel';
import OverheadPanel from './OverheadPanel';

const HEALTH_BADGE = { ok: 'ok', warn: 'warn', err: 'err', neutral: 'neutral' };

const marginTone = (pct) => {
  if (pct == null) return 'default';
  if (pct < 0) return 'err';
  if (pct < 20) return 'warn';
  return 'ok';
};

const ProyectosControl = ({ user }) => {
  const {
    rows,
    summary,
    overheadDetail,
    loading,
    periodFilter,
    setPeriodFilter,
    availableYears,
    overheadBasis,
    setOverheadBasis,
    updateProject,
    curveMovements,
    curvePayables,
    projects,
    asOf,
  } = useProjectControl(user);

  const [tab, setTab] = useState('projects');
  const [selectedKey, setSelectedKey] = useState(null);

  const selectedRow = useMemo(
    () => rows.find((row) => row.key === selectedKey) || null,
    [rows, selectedKey],
  );

  const columns = useMemo(
    () => [
      {
        key: 'displayName',
        label: 'Proyecto',
        render: (row) => (
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0">
              <p className="truncate text-[13px] text-[var(--color-fg-1)]">
                {row.unknown ? row.name : row.code || row.name}
              </p>
              {!row.unknown && row.code && row.name && row.code !== row.name && (
                <p className="label-mono text-[var(--color-fg-4)] mt-0.5 truncate">{row.name}</p>
              )}
            </div>
            {row.unknown && <Badge variant="info">Sin catalogar</Badge>}
          </div>
        ),
      },
      { key: 'contractValue', label: 'Contrato', align: 'right', mono: true, render: (row) => fmtMoney(row.contractValue) },
      { key: 'bac', label: 'BAC', align: 'right', mono: true, render: (row) => fmtMoney(row.bac) },
      {
        key: 'percentComplete',
        label: 'Avance',
        align: 'right',
        mono: true,
        render: (row) => (row.percentComplete == null ? DASH : fmtPct(row.percentComplete, 0)),
      },
      { key: 'directCost', label: 'Costo real (AC)', align: 'right', mono: true, render: (row) => fmtMoney(row.directCost) },
      { key: 'cpi', label: 'CPI', align: 'right', mono: true, render: (row) => fmtRatio(row.evm?.cpi) },
      {
        key: 'netMarginToDate',
        label: 'Margen actual',
        align: 'right',
        mono: true,
        render: (row) => fmtPctFraction(row.netMarginToDate),
      },
      {
        key: 'marginForecast',
        label: 'Margen proy.',
        align: 'right',
        mono: true,
        render: (row) => fmtPctFraction(row.marginForecast),
      },
      {
        key: 'health',
        label: 'Estado',
        align: 'center',
        render: (row) => (
          <Badge variant={HEALTH_BADGE[row.health] || 'neutral'}>
            {row.healthReasons?.[0] || DASH}
          </Badge>
        ),
      },
    ],
    [],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
      </div>
    );
  }

  const periodSelector = (
    <select
      value={periodFilter}
      onChange={(event) => setPeriodFilter(event.target.value)}
      className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-1.5 text-xs text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-line-s)]"
      aria-label="Filtrar por periodo"
    >
      <option value="all">Todo el histórico</option>
      {availableYears.map((year) => (
        <option key={year} value={year}>
          {year}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-6 pb-16">
      <Panel
        title="Portafolio"
        meta={periodFilter === 'all' ? 'Todo el histórico' : `Año ${periodFilter}`}
        actions={periodSelector}
      >
        <KPIGrid cols={3}>
          <KPI label="Contratado" value={fmtMoney(summary.contractTotal)} meta="Valor de contratos" />
          <KPI label="Presupuesto (BAC)" value={fmtMoney(summary.bacTotal)} meta="Costo planificado" />
          <KPI label="Costo real (AC)" value={fmtMoney(summary.directCostTotal)} meta="Caja + comprometido + nómina" />
          <KPI
            label="Margen bruto"
            value={fmtPct(summary.grossMarginPct)}
            tone={marginTone(summary.grossMarginPct)}
            meta="Antes de overhead"
          />
          <KPI
            label="Tasa overhead"
            value={fmtPct(summary.overheadRate * 100)}
            meta={`Pool ${fmtMoney(summary.overheadPool)}`}
          />
          <KPI
            label="Margen neto"
            value={fmtPct(summary.netMarginPct)}
            tone={marginTone(summary.netMarginPct)}
            meta={summary.atRiskCount > 0 ? `${summary.atRiskCount} proyecto(s) en riesgo` : 'Overhead incluido'}
          />
        </KPIGrid>
      </Panel>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'projects', label: 'Proyectos' },
          { value: 'overhead', label: 'Overhead' },
        ]}
      />

      {tab === 'projects' && (
        <>
          {periodFilter !== 'all' && (
            <Alert variant="info">
              Indicadores EVM (CPI, EAC) disponibles solo en «Todo el histórico»: el avance físico
              y el baseline son acumulados de toda la vida del proyecto.
            </Alert>
          )}
          <Panel title="Margen por proyecto" meta="Click en una fila para ver el detalle EVM" padding={false}>
            <Table
              columns={columns}
              rows={rows}
              rowKey="key"
              onRowClick={(row) => setSelectedKey(row.key === selectedKey ? null : row.key)}
              empty={
                <EmptyState
                  icon={FolderKanban}
                  title="Sin proyectos"
                  description="Crea proyectos en Configuración y asigna movimientos para ver su control de costos."
                />
              }
            />
          </Panel>

          {selectedRow && (
            <ProjectDetailPanel
              key={selectedRow.key}
              row={selectedRow}
              movements={curveMovements}
              payables={curvePayables}
              projects={projects}
              asOf={asOf}
              onSave={updateProject}
            />
          )}
        </>
      )}

      {tab === 'overhead' && (
        <OverheadPanel
          rows={rows}
          overheadDetail={overheadDetail}
          overheadBasis={overheadBasis}
          onBasisChange={setOverheadBasis}
        />
      )}
    </div>
  );
};

export default ProyectosControl;
