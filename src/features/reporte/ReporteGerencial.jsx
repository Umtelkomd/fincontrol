import { useMemo } from 'react';
import { Printer } from 'lucide-react';
import { Badge, Button, Panel, Table } from '@/components/ui/nexus';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { usePartners } from '../../hooks/usePartners';
import { useAuth } from '../../hooks/useAuth';
import { useEmployees } from '../../hooks/useEmployees';
import { useProjects } from '../../hooks/useProjects';
import { usePayrollPeriods } from '../nominas/usePayrollPeriods';
import { allocatePayrollCost } from '../nominas/lib/payrollAllocation';
import {
  computeKpis,
  computeProjectMargins,
  computeTopRisks,
  formatMonthKeyEs,
  lastClosedMonthKey,
  projectMarginStatus,
} from '../../finance/managementReport';
import { formatCurrency } from '../../utils/formatters';

/**
 * ReporteGerencial — Sistema 5: reporte gerencial de 1 página.
 *
 * Vista imprimible para la junta de socios mensual: 7 KPIs con objetivo/alarma,
 * caja + proyección 13 semanas, top 3 riesgos auto-detectados y margen por obra.
 * Todo deriva de datos vivos (DATEV + CXC/CXP) vía el ledger compartido.
 */

const STATUS_META = {
  ok: { label: 'OK', color: 'var(--color-ok)', badge: 'ok' },
  warn: { label: 'Atención', color: 'var(--color-warn)', badge: 'warn' },
  alarm: { label: 'Alarma', color: 'var(--color-err)', badge: 'err' },
  'n/a': { label: 'Sin datos', color: 'var(--color-fg-4)', badge: 'neutral' },
};

const SEVERITY_BADGE = { critical: 'err', high: 'warn', medium: 'info' };
const SEVERITY_LABEL = { critical: 'Crítico', high: 'Alto', medium: 'Medio' };

const compactEur = (value) => {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1000) {
    return `${(numeric / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k`;
  }
  return numeric.toLocaleString('de-DE', { maximumFractionDigits: 0 });
};

// Print contract: only the report is visible, on white, remapping the Nexus
// tokens inside the report root so every panel/badge/table prints legibly.
// position:fixed lifts the report out of the app shell's overflow containers.
const PRINT_STYLES = `
@media print {
  @page { size: A4 portrait; margin: 9mm; }
  body * { visibility: hidden; }
  #reporte-gerencial, #reporte-gerencial * { visibility: visible; }
  #reporte-gerencial {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    margin: 0;
    padding: 0;
    background: #ffffff;
    font-size: 11px;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
    --color-bg-0: #ffffff;
    --color-bg-1: #ffffff;
    --color-bg-2: #f4f4f1;
    --color-bg-3: #ececea;
    --color-bg-4: #e2e2df;
    --color-line: #d7d7d2;
    --color-line-s: #c3c3be;
    --color-fg-1: #14161a;
    --color-fg-2: #3a3d42;
    --color-fg-3: #565962;
    --color-fg-4: #83868e;
    --color-ok: #15803d;
    --color-warn: #b45309;
    --color-err: #c2410c;
    --color-info: #1d4ed8;
    --color-accent: #d63d20;
  }
  #reporte-gerencial .rg-no-print { display: none !important; }
  #reporte-gerencial .panel { break-inside: avoid; }
  #reporte-gerencial h2 { font-size: 24px !important; }
}
`;

const KpiTile = ({ kpi }) => {
  const meta = STATUS_META[kpi.status] || STATUS_META['n/a'];
  return (
    <div className="bg-[var(--color-bg-1)] px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="label-mono text-[var(--color-fg-3)]">{kpi.label}</p>
        <span
          className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: meta.color }}
          title={meta.label}
        />
      </div>
      <p
        className="mt-1.5 font-mono text-[22px] tabular-nums tracking-tight"
        style={{ color: meta.color }}
      >
        {kpi.formatted}
      </p>
      <p className="mt-1 font-mono text-[10px] text-[var(--color-fg-4)]">
        obj {kpi.target} · alarma {kpi.alarm}
      </p>
      <p className="mt-1 font-mono text-[10px] leading-snug text-[var(--color-fg-3)]">{kpi.detail}</p>
    </div>
  );
};

const SummaryTile = ({ kpis }) => {
  const counts = kpis.reduce(
    (acc, kpi) => {
      acc[kpi.status] = (acc[kpi.status] || 0) + 1;
      return acc;
    },
    { ok: 0, warn: 0, alarm: 0, 'n/a': 0 },
  );
  const worst = counts.alarm > 0 ? 'alarm' : counts.warn > 0 ? 'warn' : counts.ok > 0 ? 'ok' : 'n/a';
  const meta = STATUS_META[worst];
  return (
    <div className="bg-[var(--color-bg-1)] px-4 py-3">
      <p className="label-mono text-[var(--color-fg-3)]">Estado general</p>
      <p className="mt-1.5 font-mono text-[22px] tabular-nums tracking-tight" style={{ color: meta.color }}>
        {counts.ok}/{kpis.length} OK
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {counts.alarm > 0 && <Badge variant="err">{counts.alarm} alarma</Badge>}
        {counts.warn > 0 && <Badge variant="warn">{counts.warn} atención</Badge>}
        {counts['n/a'] > 0 && <Badge variant="neutral">{counts['n/a']} sin datos</Badge>}
        {counts.alarm === 0 && counts.warn === 0 && counts['n/a'] === 0 && (
          <Badge variant="ok">Todo en objetivo</Badge>
        )}
      </div>
    </div>
  );
};

const ReporteGerencial = ({ user }) => {
  const ledger = useFinanceLedgerContext();
  const metrics = useTreasuryMetrics({ user, ledger });
  const { partners, loading: partnersLoading, error: partnersError } = usePartners(user);

  // Payroll → project allocation (mirrors Resumen.jsx) so 'Margen por obra'
  // folds labor cost into project cost basis instead of DATEV-only movements.
  const { hasPermission } = useAuth();
  const canSeePayroll = hasPermission('cxp');
  const { periods: payrollPeriods } = usePayrollPeriods(canSeePayroll ? user : null);
  const { employees } = useEmployees(user);
  const { projects } = useProjects(user);
  const payrollByProject = useMemo(() => {
    if (!canSeePayroll) return {};
    const employeesById = {};
    employees.forEach((e) => {
      employeesById[e.id] = e;
    });
    const projectNamesById = {};
    projects.forEach((p) => {
      projectNamesById[p.id] = p.name;
    });
    return allocatePayrollCost({ periods: payrollPeriods, employeesById, projectNamesById }).byProject;
  }, [canSeePayroll, payrollPeriods, employees, projects]);

  const referenceDate = useMemo(() => new Date(), []);

  const kpis = useMemo(
    () =>
      computeKpis({
        receivables: metrics.receivables,
        movements: metrics.postedMovements,
        currentCash: metrics.currentCash,
        avgMonthlyOutflows: metrics.avgMonthlyOutflows,
        weeklyProjection: metrics.weeklyProjection,
        payrollByProject,
        referenceDate,
      }),
    [metrics, payrollByProject, referenceDate],
  );

  const risks = useMemo(
    () =>
      computeTopRisks({
        receivables: metrics.receivables,
        payables: metrics.payables,
        partners,
        currentCash: metrics.currentCash,
        avgMonthlyOutflows: metrics.avgMonthlyOutflows,
        weeklyProjection: metrics.weeklyProjection,
        referenceDate,
      }).slice(0, 3),
    [metrics, partners, referenceDate],
  );

  const marginRows = useMemo(
    () =>
      computeProjectMargins(metrics.postedMovements, { payrollByProject })
        .filter((row) => row.revenue > 0)
        .slice(0, 7)
        .map((row) => ({ id: row.name, ...row })),
    [metrics.postedMovements, payrollByProject],
  );

  const maxProjectedAbs = useMemo(
    () =>
      Math.max(
        1,
        ...(metrics.weeklyProjection || []).map((week) => Math.abs(Number(week.projectedBalance) || 0)),
      ),
    [metrics.weeklyProjection],
  );

  if (metrics.loading || partnersLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
      </div>
    );
  }

  const monthLabel = referenceDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const closedMonthLabel = formatMonthKeyEs(lastClosedMonthKey(referenceDate));
  const todayLabel = referenceDate.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const firstNegativeWeek = (metrics.weeklyProjection || []).find(
    (week) => Number(week.projectedBalance) < 0,
  );

  return (
    <div id="reporte-gerencial" className="space-y-5 pb-10">
      <style>{PRINT_STYLES}</style>

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-3)]">
            § Sistema 5 · Junta de socios
          </p>
          <h2
            className="mt-1 text-[28px] leading-none text-[var(--color-fg-1)] md:text-[36px]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 300, letterSpacing: '-0.03em' }}
          >
            Reporte <em className="not-italic text-[var(--color-accent)]">gerencial</em>
          </h2>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-4)]">
            FinControl<span className="text-[var(--color-accent)]">.OS</span> · {monthLabel} · KPIs
            mensuales: {closedMonthLabel} · datos al {todayLabel}
          </p>
        </div>
        <div className="rg-no-print">
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>
            Imprimir / PDF
          </Button>
        </div>
      </header>

      {(metrics.error || partnersError) && (
        <div className="nx-alert nx-alert-warn rg-no-print">
          Datos parciales: una fuente no cargó correctamente. Verificá las cifras antes de presentar.
          {partnersError ? ' / proveedores no disponibles' : ''}
        </div>
      )}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiTile key={kpi.key} kpi={kpi} />
        ))}
        <SummaryTile kpis={kpis} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Caja y cobertura" meta="Proyección 13 semanas">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label-mono text-[var(--color-fg-3)]">Caja actual</p>
              <p
                className={`mt-1 font-mono text-[26px] tabular-nums tracking-tight ${
                  metrics.currentCash >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'
                }`}
              >
                € {formatCurrency(metrics.currentCash)}
              </p>
            </div>
            <div className="text-right">
              <p className="label-mono text-[var(--color-fg-3)]">Salida media mensual</p>
              <p className="mt-1 font-mono text-[15px] tabular-nums text-[var(--color-fg-1)]">
                € {formatCurrency(metrics.avgMonthlyOutflows)}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p className="label-mono text-[var(--color-fg-3)]">Saldo comprometido por semana</p>
            <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
              {(metrics.weeklyProjection || []).map((week) => {
                const balance = Number(week.projectedBalance) || 0;
                const negative = balance < 0;
                const height = Math.max(3, Math.round((Math.abs(balance) / maxProjectedAbs) * 34));
                return (
                  <div key={week.week} className="flex flex-col items-center gap-1" title={week.label}>
                    <div className="flex h-9 w-full items-end">
                      <div
                        className="w-full rounded-sm"
                        style={{
                          height,
                          background: negative ? 'var(--color-err)' : 'var(--color-line-s)',
                        }}
                      />
                    </div>
                    <span className="font-mono text-[8px] text-[var(--color-fg-4)]">{week.week}</span>
                    <span
                      className={`font-mono text-[8px] tabular-nums ${
                        negative ? 'text-[var(--color-err)]' : 'text-[var(--color-fg-3)]'
                      }`}
                    >
                      {compactEur(balance)}
                    </span>
                  </div>
                );
              })}
            </div>
            {firstNegativeWeek ? (
              <p className="mt-2 font-mono text-[10px] text-[var(--color-err)]">
                Saldo proyectado negativo desde {firstNegativeWeek.week} ({firstNegativeWeek.label})
              </p>
            ) : (
              <p className="mt-2 font-mono text-[10px] text-[var(--color-fg-4)]">
                Sin semanas negativas en el horizonte comprometido (CXC/CXP con vencimiento)
              </p>
            )}
          </div>
        </Panel>

        <Panel title="Top 3 riesgos" meta="Detección automática">
          {risks.length === 0 ? (
            <p className="label-mono py-4 text-[var(--color-fg-4)]">
              Sin riesgos detectados con los datos actuales
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {risks.map((risk, index) => (
                <li key={risk.key} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="mt-0.5 font-mono text-[18px] font-light leading-none text-[var(--color-fg-4)]">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-medium text-[var(--color-fg-1)]">{risk.title}</p>
                      <Badge variant={SEVERITY_BADGE[risk.severity] || 'neutral'}>
                        {SEVERITY_LABEL[risk.severity] || risk.severity}
                      </Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-3)]">{risk.detail}</p>
                  </div>
                  <span className="flex-shrink-0 font-mono text-[13px] tabular-nums text-[var(--color-fg-1)]">
                    {risk.formattedAmount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Margen por obra"
        meta={`YTD ${referenceDate.getFullYear()} · movimientos DATEV con proyecto`}
        padding={false}
      >
        <Table
          columns={[
            { key: 'name', label: 'Obra' },
            {
              key: 'revenue',
              label: 'Ingresos',
              align: 'right',
              mono: true,
              render: (row) => `€ ${formatCurrency(row.revenue)}`,
            },
            {
              key: 'cost',
              label: 'Costos',
              align: 'right',
              mono: true,
              render: (row) => `€ ${formatCurrency(row.cost)}`,
            },
            {
              key: 'marginPct',
              label: 'Margen',
              align: 'right',
              mono: true,
              render: (row) =>
                row.marginPct == null
                  ? '—'
                  : `${row.marginPct.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`,
            },
            {
              key: 'status',
              label: 'Estado',
              align: 'right',
              render: (row) => {
                const status = projectMarginStatus(row.marginPct);
                const meta = STATUS_META[status] || STATUS_META['n/a'];
                return <Badge variant={meta.badge}>{meta.label}</Badge>;
              },
            },
          ]}
          rows={marginRows}
          empty={
            <div className="px-4 py-8 text-center">
              <p className="label-mono text-[var(--color-fg-4)]">
                Sin movimientos {referenceDate.getFullYear()} con proyecto asignado
              </p>
            </div>
          }
        />
      </Panel>

      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-fg-4)]">
        Generado desde datos vivos (DATEV · CXC · CXP · partners) · Sistema 5 — Modelo gerencial UMTELKOMD
      </p>
    </div>
  );
};

export default ReporteGerencial;
