/**
 * Resumen — "Cómo va la empresa"
 *
 * ONE focused, scannable view that answers a single question: how is the
 * company doing? It is a presentational composition over existing engines
 * (useTreasuryMetrics, useForwardProjection, runway.js, payrollAllocation) plus
 * two tiny pure helpers (computeMonthlyResult, selectDueWithinDays).
 *
 * Four blocks, top to bottom:
 *   1. CAJA Y RUNWAY     — cash today + how long it lasts (the survival number)
 *   2. RESULTADO DEL MES — income vs expenses incl. payroll → profit or loss
 *   3. POR COBRAR / PAGAR — CXC/CXP totals, net, next upcoming due items
 *   4. MARGEN POR PROYECTO — which projects make money, labor already deducted
 *
 * Payroll data is gated to hasPermission('cxp') (firestore denies payrollPeriods
 * to editors). Without it, block 2 drops payroll honestly and block 4 shows
 * margins WITHOUT labor instead of breaking. UI copy is Spanish; identifiers and
 * comments are English. NEXUS.OS tokens only; accent reserved for highlights.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Wallet,
} from 'lucide-react';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { useForwardProjection } from '../../hooks/useForwardProjection';
import { useAuth } from '../../hooks/useAuth';
import { useEmployees } from '../../hooks/useEmployees';
import { useProjects } from '../../hooks/useProjects';
import { useTreasurySettings } from '../../hooks/useTreasurySettings';
import { usePayrollPeriods } from '../nominas/usePayrollPeriods';
import { allocatePayrollCost } from '../nominas/lib/payrollAllocation';
import { missingPayrollMonths } from '../nominas/lib/missingMonths';
import { agingBuckets, forecastWeeks } from '../../lib/finance';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { KPI, KPIGrid, Panel, Badge, EmptyState } from '@/components/ui/nexus';
import {
  computeMonthlyResult,
  selectDueWithinDays,
  selectUpcomingObligations,
} from './lib/resumenMetrics';
import { buildResumenAlerts } from './lib/alertsPanel';

const DUE_WINDOW_DAYS = 30;
const UPCOMING_LIMIT = 6;
const CRITICAL_RUNWAY_MONTHS = 3;

// Maps a payroll-kind tag to a short Spanish badge label. Unknown / null kinds
// produce no badge. Mirrors the labels used in payrollReminders.js.
const PAYROLL_KIND_LABEL = {
  krankenkasse: 'KK',
  tax: 'Lohnsteuer',
  wages: 'Nómina',
};

// First and last calendar day of the month containing `date`, as ISO strings.
const currentMonthRange = (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
};

// 'YYYY-MM' key for the current month, to match payrollPeriods.period.
const currentMonthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const toneForResult = (isProfit, result) => {
  if (result === 0) return 'default';
  return isProfit ? 'ok' : 'err';
};

const Resumen = ({ user }) => {
  const { hasPermission } = useAuth();
  const canSeePayroll = hasPermission('cxp');

  // ── Payroll → project allocation (verbatim wiring from Dashboard.jsx) ───────
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

  // Single treasury pass (ledger is memoized per user). Blocks 1/3/4 read the
  // full-range metrics; block 2 filters postedMovements to the current month
  // inline — cheaper and simpler than a second hook instance.
  const ledger = useFinanceLedgerContext();
  const metrics = useTreasuryMetrics({ user, payrollByProject, ledger });
  // Anchor-derived cash feeds the projection so "day zero" starts from the
  // reconciled balance, not the stale static one.
  const projection = useForwardProjection(user, 90, {
    startingBalance: metrics.loading ? undefined : metrics.currentCash,
  });
  const { alertBufferEur } = useTreasurySettings(user);

  const now = useMemo(() => new Date(), []);
  const monthRange = useMemo(() => currentMonthRange(now), [now]);
  const monthKey = useMemo(() => currentMonthKey(now), [now]);

  // ── Alerts: localized, action-routed, severity-sorted ──────────────────────
  const alerts = useMemo(() => {
    if (metrics.loading) return [];
    const todayIso = now.toISOString().slice(0, 10);
    const openReceivables = (metrics.receivables || []).filter(
      (r) => (r.openAmount || 0) > 0.005 && r.status !== 'cancelled',
    );
    const openPayables = (metrics.payables || []).filter(
      (p) => (p.openAmount || 0) > 0.005 && p.status !== 'cancelled',
    );
    const forecast = forecastWeeks({
      startBalance: metrics.currentCash ?? 0,
      today: todayIso,
      receivables: openReceivables,
      payables: openPayables,
      obligations: projection.obligations || [],
    });
    return buildResumenAlerts({
      position: { balance: metrics.currentCash ?? 0, anchor: metrics.cashMeta?.anchor ?? null },
      forecast,
      receivablesAging: agingBuckets({ docs: openReceivables, today: todayIso }),
      payablesAging: agingBuckets({ docs: openPayables, today: todayIso }),
      importGap: metrics.cashMeta?.importGap ?? { hasGap: false },
      missingMonths: canSeePayroll
        ? missingPayrollMonths(payrollPeriods, todayIso.slice(0, 7))
        : [],
      today: todayIso,
      config: {
        bufferEur: alertBufferEur,
        creditFloorEur: metrics.bankAccount?.creditLineLimit ?? 0,
      },
    });
  }, [alertBufferEur, canSeePayroll, metrics, now, payrollPeriods, projection.obligations]);

  // ── Block 1: cash + runway ─────────────────────────────────────────────────
  const currentCash = metrics.currentCash ?? 0;
  const runwayMonths = metrics.runwayMonths; // avg cash-burn estimate; null when no burn
  const firstNegativeDay = projection.firstNegativeDay; // { date, balance } | undefined

  // Prefer the COMMITTED-outflow wall: the forward projection buckets open
  // payables (incl. unpaid payroll) by dueDate, so the day cash hits 0 is the
  // real, payroll-aware runway. Fall back to the average-burn estimate only when
  // cash never goes negative within the projection horizon.
  const daysToNegative = firstNegativeDay
    ? Math.max(
        0,
        Math.round(
          (new Date(`${firstNegativeDay.date}T00:00:00Z`) -
            new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) /
            86400000,
        ),
      )
    : null;

  const runwayValue =
    daysToNegative != null
      ? `${Math.round(daysToNegative / 7)} sem.`
      : runwayMonths == null
        ? 'Sin gasto'
        : `${runwayMonths.toLocaleString('es-ES', { maximumFractionDigits: 1 })} meses`;
  const runwayMeta =
    daysToNegative != null
      ? 'Hasta caja en 0 (nómina y vencimientos incluidos)'
      : runwayMonths == null
        ? 'No hay salidas para proyectar'
        : 'Al ritmo de gasto promedio';
  const runwayCritical =
    daysToNegative != null
      ? daysToNegative < 60
      : runwayMonths != null && runwayMonths < CRITICAL_RUNWAY_MONTHS;

  // ── Block 2: monthly result WITH payroll ───────────────────────────────────
  const monthIncome = useMemo(
    () =>
      (metrics.postedMovements || [])
        .filter(
          (m) =>
            m.direction === 'in' &&
            m.postedDate >= monthRange.from &&
            m.postedDate <= monthRange.to,
        )
        .reduce((sum, m) => sum + (Number(m.amount) || 0), 0),
    [metrics.postedMovements, monthRange],
  );
  const monthExpenses = useMemo(
    () =>
      (metrics.postedMovements || [])
        .filter(
          (m) =>
            m.direction === 'out' &&
            m.postedDate >= monthRange.from &&
            m.postedDate <= monthRange.to,
        )
        .reduce((sum, m) => sum + (Number(m.amount) || 0), 0),
    [metrics.postedMovements, monthRange],
  );

  // Payroll counted EXACTLY ONCE, no double-count: payroll already PAID this
  // month is a cash 'out' already inside monthExpenses; we add only the still
  // UNPAID obligations of this month's period (their openAmount). Consistent
  // cash basis, no movement tagging needed.
  const currentPayrollPeriod = useMemo(
    () => (canSeePayroll ? payrollPeriods.find((p) => p.period === monthKey) : undefined),
    [canSeePayroll, payrollPeriods, monthKey],
  );
  const payrollPending = useMemo(() => {
    if (!currentPayrollPeriod) return 0;
    return (metrics.payables || [])
      .filter((p) => p.payrollPeriodId === currentPayrollPeriod.id)
      .reduce((sum, p) => sum + (Number(p.openAmount) || 0), 0);
  }, [metrics.payables, currentPayrollPeriod]);

  const monthlyResult = useMemo(
    () => computeMonthlyResult({ income: monthIncome, expenses: monthExpenses, payrollCost: payrollPending }),
    [monthIncome, monthExpenses, payrollPending],
  );

  const resultLabel = canSeePayroll ? 'Resultado del mes (nómina incluida)' : 'Resultado del mes';

  // ── Block 3: receivables / payables + next due ─────────────────────────────
  const pendingReceivables = metrics.pendingReceivables ?? 0;
  const pendingPayables = metrics.pendingPayables ?? 0;
  const netPosition = pendingReceivables - pendingPayables;

  // Feed the FULL open document sets (NOT the 14-day-capped upcoming* arrays) so
  // the 30-day window is real and payroll obligations due ~next month (Lohnsteuer
  // on the 10th, month-end Krankenkassen) actually appear.
  const upcomingPayables = useMemo(() => {
    const documents = selectDueWithinDays(
      (metrics.payables || []).filter((p) => (p.openAmount || 0) > 0 && p.status !== 'cancelled'),
      DUE_WINDOW_DAYS,
      now,
    );
    // Estimated fiscal obligations (IVA / SV / Lohnsteuer / nómina) that are
    // not yet materialized as payables join the same list, flagged "estimado".
    const estimated = selectUpcomingObligations(
      projection.obligations || [],
      DUE_WINDOW_DAYS,
      now,
    );
    return [...documents, ...estimated]
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
      .slice(0, UPCOMING_LIMIT);
  }, [metrics.payables, now, projection.obligations]);
  const upcomingReceivables = useMemo(
    () =>
      selectDueWithinDays(
        (metrics.receivables || []).filter((r) => (r.openAmount || 0) > 0 && r.status !== 'cancelled'),
        DUE_WINDOW_DAYS,
        now,
      ).slice(0, UPCOMING_LIMIT),
    [metrics.receivables, now],
  );

  // ── Block 4: project margins (labor already folded by buildProjectMargins) ──
  const projectMargins = metrics.projectMargins || [];

  if (metrics.loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Partial-data guard: a failed Firestore source must never render as
          authoritative €-figures. Every KPI below is suspect until it clears. */}
      {ledger.error && (
        <div className="flex items-start gap-3 rounded-md border border-[var(--color-err)] bg-[var(--color-bg-2)] px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-[var(--color-err)]" />
          <div>
            <p className="font-mono text-[12px] text-[var(--color-err)]">
              Datos incompletos — no confíes en estas cifras
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-fg-4)]">
              Falló la carga de: {Object.entries(ledger.sourceErrors || {})
                .filter(([, err]) => err)
                .map(([name]) => name)
                .join(', ')}. Recargá la página; si persiste, revisá la conexión o los permisos de Firestore.
            </p>
          </div>
        </div>
      )}

      {/* Page header */}
      <header>
        <p className="label-mono text-[var(--color-accent)] mb-2">§ Resumen</p>
        <h1 className="font-display text-[32px] font-light leading-[1.05] tracking-tight text-[var(--color-fg-1)] md:text-[40px]">
          Cómo va la <span className="text-[var(--color-accent)]">empresa</span>
        </h1>
        <p className="mt-2 label-mono text-[var(--color-fg-4)]">
          {now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </header>

      {/* ───────────────────────── ALERTAS ────────────────────────────────────── */}
      {alerts.length > 0 && (
        <Panel title="Alertas" meta={`${alerts.length} activa${alerts.length === 1 ? '' : 's'}`}>
          <ul className="divide-y divide-[var(--color-line)]">
            {alerts.map((alert) => {
              const severityColor =
                alert.severity === 'critical'
                  ? 'var(--color-err)'
                  : alert.severity === 'serious'
                    ? 'var(--color-warn)'
                    : 'var(--color-fg-3)';
              return (
                <li key={alert.id} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: severityColor }}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium" style={{ color: severityColor }}>
                        {alert.title}
                      </p>
                      <p className="mt-0.5 text-[12px] text-[var(--color-fg-4)]">{alert.detail}</p>
                    </div>
                  </div>
                  <Link
                    to={alert.href}
                    className="label-mono flex-shrink-0 text-[var(--color-accent)] transition-opacity hover:opacity-80"
                  >
                    Ver →
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {/* ───────────────────────── BLOCK 1 — CAJA Y RUNWAY ───────────────────── */}
      <Panel title="Caja y runway" meta="¿Cuánto aguantamos?">
        <KPIGrid cols={2}>
          <KPI
            label="Caja actual"
            value={formatCurrency(currentCash)}
            size="lg"
            tone={currentCash < 0 ? 'err' : 'default'}
            icon={Wallet}
            meta={
              metrics.cashSource === 'anchors' && metrics.cashMeta?.anchor
                ? `Conciliado al ${formatDate(metrics.cashMeta.anchor.date)} · últ. mov. ${
                    metrics.cashMeta.lastMovementDate
                      ? formatDate(metrics.cashMeta.lastMovementDate)
                      : '—'
                  }`
                : 'Sin conciliar — registra un ancla en Configuración → Tesorería'
            }
          />
          <KPI
            label="Runway"
            value={runwayValue}
            size="lg"
            tone={runwayCritical ? 'err' : 'default'}
            icon={CalendarClock}
            meta={runwayMeta}
          />
        </KPIGrid>

        {firstNegativeDay && (
          <div className="mt-4 flex items-start gap-3 rounded-md border border-[var(--color-err)]/40 bg-[var(--color-bg-2)] px-4 py-3">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-[var(--color-err)]" />
            <div>
              <p className="font-mono text-[12px] text-[var(--color-err)]">
                Caja en negativo el {formatDate(firstNegativeDay.date)}
              </p>
              <p className="mt-1 text-[12px] text-[var(--color-fg-4)]">
                Saldo proyectado {formatCurrency(firstNegativeDay.balance)} según vencimientos comprometidos.
              </p>
            </div>
          </div>
        )}
      </Panel>

      {/* ──────────────────────── BLOCK 2 — RESULTADO DEL MES ────────────────── */}
      <Panel title="Resultado del mes" meta={now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}>
        <div className="mb-4">
          <p className="label-mono text-[var(--color-fg-3)] mb-2">{resultLabel}</p>
          <p
            className="font-mono text-[40px] leading-[1] tabular-nums tracking-tight"
            style={{ color: monthlyResult.isProfit ? 'var(--color-ok)' : monthlyResult.result === 0 ? 'var(--color-fg-1)' : 'var(--color-err)' }}
          >
            {monthlyResult.result >= 0 ? '+' : '−'}
            {formatCurrency(Math.abs(monthlyResult.result))}
          </p>
          <p className="mt-2 text-[12px] text-[var(--color-fg-4)]">
            {monthlyResult.isProfit
              ? 'La empresa ganó dinero este mes (nómina incluida).'
              : monthlyResult.result === 0
                ? 'Mes en equilibrio.'
                : 'La empresa perdió dinero este mes.'}
          </p>
        </div>

        <KPIGrid cols={4}>
          <KPI label="Ingresos" value={formatCurrency(monthlyResult.income)} tone="ok" icon={ArrowUpRight} />
          <KPI
            label="Gastos (caja)"
            value={formatCurrency(monthlyResult.baseExpenses)}
            icon={ArrowDownRight}
            meta="Incluye nómina ya pagada"
          />
          <KPI
            label="Nómina pendiente"
            value={formatCurrency(monthlyResult.payrollCost)}
            tone={monthlyResult.payrollCost > 0 ? 'warn' : 'default'}
            meta={canSeePayroll ? 'Aún por pagar este mes' : 'Sin permiso'}
          />
          <KPI
            label="Gasto total"
            value={formatCurrency(monthlyResult.totalExpenses)}
            tone={toneForResult(monthlyResult.isProfit, monthlyResult.result)}
          />
        </KPIGrid>
      </Panel>

      {/* ────────────────── BLOCK 3 — POR COBRAR / POR PAGAR ─────────────────── */}
      <Panel title="Por cobrar / por pagar" meta={`Próximos ${DUE_WINDOW_DAYS} días`}>
        <KPIGrid cols={3}>
          <KPI label="Por cobrar (CXC)" value={formatCurrency(pendingReceivables)} tone="ok" />
          <KPI label="Por pagar (CXP)" value={formatCurrency(pendingPayables)} tone="warn" />
          <KPI
            label="Posición neta"
            value={`${netPosition >= 0 ? '+' : '−'}${formatCurrency(Math.abs(netPosition))}`}
            tone={netPosition >= 0 ? 'ok' : 'err'}
          />
        </KPIGrid>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <DueList
            title="Próximos pagos"
            items={upcomingPayables}
            emptyText="Sin pagos en la ventana."
            direction="out"
          />
          <DueList
            title="Próximos cobros"
            items={upcomingReceivables}
            emptyText="Sin cobros en la ventana."
            direction="in"
          />
        </div>
      </Panel>

      {/* ──────────────────── BLOCK 4 — MARGEN POR PROYECTO ──────────────────── */}
      <Panel
        title="Margen por proyecto"
        meta={canSeePayroll ? 'Mano de obra deducida' : 'Sin mano de obra (sin permiso)'}
      >
        {projectMargins.length === 0 ? (
          <EmptyState title="Sin proyectos" description="No hay movimientos por proyecto todavía." />
        ) : (
          <div className="divide-y divide-[var(--color-line)]">
            {projectMargins.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-[var(--color-fg-1)]">{p.name}</p>
                  <p className="label-mono text-[var(--color-fg-4)] mt-0.5">
                    Ingresos {formatCurrency(p.inflows)} · Costes {formatCurrency(p.outflows)}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="font-mono text-[11px] text-[var(--color-fg-4)] tabular-nums">
                    {p.margin.toLocaleString('es-ES', { maximumFractionDigits: 1 })}%
                  </span>
                  <span
                    className="font-mono text-[15px] tabular-nums tracking-tight"
                    style={{ color: p.net >= 0 ? 'var(--color-ok)' : 'var(--color-err)' }}
                  >
                    {p.net >= 0 ? '+' : '−'}
                    {formatCurrency(Math.abs(p.net))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};

// Compact list of upcoming due documents (payables or receivables). Payroll-kind
// rows get a small badge. Plain serializable item shape from selectDueWithinDays.
const DueList = ({ title, items, emptyText, direction }) => {
  const arrowColor = direction === 'in' ? 'var(--color-ok)' : 'var(--color-warn)';
  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <div className="border-b border-[var(--color-line)] px-4 py-2.5">
        <p className="label-mono text-[var(--color-fg-3)]">{title}</p>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-[var(--color-fg-4)]">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {items.map((item) => {
            const kindLabel = item.payrollKind ? PAYROLL_KIND_LABEL[item.payrollKind] : null;
            return (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] text-[var(--color-fg-1)]">
                      {item.counterpartyName || item.description || 'Documento'}
                    </p>
                    {kindLabel && (
                      <Badge variant="info" className="flex-shrink-0">
                        {kindLabel}
                      </Badge>
                    )}
                    {item.estimated && (
                      <Badge variant="neutral" className="flex-shrink-0">
                        estimado
                      </Badge>
                    )}
                  </div>
                  <p className="label-mono text-[var(--color-fg-4)] mt-0.5">{formatDate(item.dueDate)}</p>
                </div>
                <span
                  className="font-mono text-[13px] tabular-nums flex-shrink-0"
                  style={{ color: arrowColor }}
                >
                  {formatCurrency(item.openAmount)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default Resumen;
