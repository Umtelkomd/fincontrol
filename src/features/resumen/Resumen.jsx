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
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Wallet,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { useForwardProjection } from '../../hooks/useForwardProjection';
import { useAuth } from '../../hooks/useAuth';
import { useEmployees } from '../../hooks/useEmployees';
import { useProjects } from '../../hooks/useProjects';
import { usePayrollPeriods } from '../nominas/usePayrollPeriods';
import { allocatePayrollCost } from '../nominas/lib/payrollAllocation';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { KPI, KPIGrid, Panel, Badge, EmptyState } from '@/components/ui/nexus';
import { computeMonthlyResult, selectDueWithinDays, buildMonthlyCashFlowSeries } from './lib/resumenMetrics';

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
  const metrics = useTreasuryMetrics({ user, payrollByProject });
  const projection = useForwardProjection(user);

  const now = useMemo(() => new Date(), []);
  const monthRange = useMemo(() => currentMonthRange(now), [now]);
  const monthKey = useMemo(() => currentMonthKey(now), [now]);

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
  const upcomingPayables = useMemo(
    () =>
      selectDueWithinDays(
        (metrics.payables || []).filter((p) => (p.openAmount || 0) > 0 && p.status !== 'cancelled'),
        DUE_WINDOW_DAYS,
        now,
      ).slice(0, UPCOMING_LIMIT),
    [metrics.payables, now],
  );
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

  // ── Block 5: monthly cash-flow series for the charts ───────────────────────
  // Year filter: 'trailing' = 12 months ending current month, or a specific
  // year (e.g. 2026) = Jan–Dec of that year. startingBalance is computed so
  // the running balance ends at currentCash for trailing mode, or at the
  // end-of-year balance for specific-year mode.
  const [cashFlowYear, setCashFlowYear] = useState('trailing');

  const availableYears = useMemo(() => {
    const years = new Set();
    (metrics.postedMovements || []).forEach((m) => {
      const y = (m.postedDate || '').slice(0, 4);
      if (y) years.add(Number(y));
    });
    years.add(now.getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [metrics.postedMovements, now]);

  const monthlySeries = useMemo(() => {
    if (cashFlowYear === 'trailing') {
      const windowStart = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const inWindow = (metrics.postedMovements || []).filter((m) => {
        const key = (m.postedDate || '').slice(0, 7);
        return key >= windowStart;
      });
      const netInWindow = inWindow.reduce((sum, m) => {
        const amt = Number(m.amount) || 0;
        return sum + (m.direction === 'in' ? amt : -amt);
      }, 0);
      const startingBalance = (metrics.currentCash ?? 0) - netInWindow;
      return buildMonthlyCashFlowSeries({
        postedMovements: metrics.postedMovements || [],
        referenceDate: now,
        monthsCount: 12,
        startingBalance,
      });
    }
    // Specific year: Jan–Dec. referenceDate = Dec 1 of that year → buckets Jan..Dec.
    const yearEnd = new Date(Date.UTC(Number(cashFlowYear), 11, 1));
    const windowStart = `${cashFlowYear}-01`;
    const inWindow = (metrics.postedMovements || []).filter((m) => {
      const key = (m.postedDate || '').slice(0, 7);
      return key >= windowStart;
    });
    const netInWindow = inWindow.reduce((sum, m) => {
      const amt = Number(m.amount) || 0;
      return sum + (m.direction === 'in' ? amt : -amt);
    }, 0);
    const startingBalance = (metrics.currentCash ?? 0) - netInWindow;
    return buildMonthlyCashFlowSeries({
      postedMovements: metrics.postedMovements || [],
      referenceDate: yearEnd,
      monthsCount: 12,
      startingBalance,
    });
  }, [metrics.postedMovements, metrics.currentCash, now, cashFlowYear]);

  const receivablesAging = metrics.receivablesAging || [];
  const payablesAging = metrics.payablesAging || [];

  if (metrics.loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
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

      {/* ───────────────────────── BLOCK 1 — CAJA Y RUNWAY ───────────────────── */}
      <Panel title="Caja y runway" meta="¿Cuánto aguantamos?">
        <KPIGrid cols={2}>
          <KPI
            label="Caja actual"
            value={formatCurrency(currentCash)}
            size="lg"
            tone={currentCash < 0 ? 'err' : 'default'}
            icon={Wallet}
            meta="Saldo real en banco hoy"
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

      {/* ──────────────────── BLOCK 5 — FLUJO DE CAJA MENSUAL ─────────────────── */}
      <Panel
        title="Flujo de caja"
        meta={cashFlowYear === 'trailing' ? 'Últimos 12 meses' : `Año ${cashFlowYear}`}
      >
        {/* Year filter pills + period summary */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCashFlowYear('trailing')}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                cashFlowYear === 'trailing'
                  ? 'border-[var(--color-line-s)] bg-[var(--color-bg-2)] text-[var(--color-accent)]'
                  : 'border-[var(--color-line)] text-[var(--color-fg-4)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
              }`}
            >
              12 meses
            </button>
            {availableYears.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setCashFlowYear(y)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                  cashFlowYear === y
                    ? 'border-[var(--color-line-s)] bg-[var(--color-bg-2)] text-[var(--color-accent)]'
                    : 'border-[var(--color-line)] text-[var(--color-fg-4)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 text-[12px]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[var(--color-ok)]" />
              <span className="text-[var(--color-fg-4)]">Ingresos</span>
              <span className="font-mono tabular-nums text-[var(--color-fg-1)]">
                {formatCurrency(monthlySeries.reduce((s, b) => s + b.inflows, 0))}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[var(--color-err)]" />
              <span className="text-[var(--color-fg-4)]">Gastos</span>
              <span className="font-mono tabular-nums text-[var(--color-fg-1)]">
                {formatCurrency(monthlySeries.reduce((s, b) => s + b.outflows, 0))}
              </span>
            </span>
          </div>
        </div>

        <div
          style={{ width: '100%', height: 300, minHeight: 300, minWidth: 0 }}
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-4"
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart
              data={monthlySeries}
              margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
              barGap={2}
              barCategoryGap="22%"
            >
              <defs>
                <linearGradient id="inflowBarFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-ok)" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="var(--color-ok)" stopOpacity={0.55} />
                </linearGradient>
                <linearGradient id="outflowBarFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-err)" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="var(--color-err)" stopOpacity={0.55} />
                </linearGradient>
                <linearGradient id="cashBalanceArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 6" stroke="var(--color-line)" vertical={false} strokeOpacity={0.6} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--color-fg-4)', fontFamily: 'var(--font-mono)' }}
                interval="preserveStartEnd"
                minTickGap={20}
                axisLine={{ stroke: 'var(--color-line)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--color-fg-4)', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                width={48}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CashFlowTooltip />} cursor={{ fill: 'var(--color-bg-3)', stroke: 'var(--color-line-s)' }} />
              <Bar dataKey="inflows" name="Ingresos" fill="url(#inflowBarFill)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="outflows" name="Gastos" fill="url(#outflowBarFill)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line
                type="monotone"
                dataKey="balance"
                name="Caja"
                stroke="var(--color-accent)"
                strokeWidth={2}
                dot={{ r: 2.5, fill: 'var(--color-accent)', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: 'var(--color-accent)', strokeWidth: 2, stroke: 'var(--color-bg-2)' }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-fg-4)]">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-[var(--color-ok)]" />
            Ingresos mensuales
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-[var(--color-err)]" />
            Gastos mensuales
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-[var(--color-accent)]" />
            Evolución de caja
          </span>
        </div>
      </Panel>

      {/* ──────────────────── BLOCK 6 — AGING POR COBRAR / PAGAR ──────────────── */}
      <Panel title="Aging de cartera" meta="Días de vencimiento">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <AgingBuckets title="Por cobrar (CXC)" buckets={receivablesAging} tone="ok" />
          <AgingBuckets title="Por pagar (CXP)" buckets={payablesAging} tone="warn" />
        </div>
      </Panel>
    </div>
  );
};

// Dark-themed tooltip for the cash-flow chart. Reads the bucket payload.
const CashFlowTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const net = d.inflows - d.outflows;
  return (
    <div className="rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] px-4 py-3 shadow-lg">
      <p className="label-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-4)] mb-2">{d.label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-[11px] text-[var(--color-fg-3)]">
            <span className="h-2 w-2 rounded-sm bg-[var(--color-ok)]" />
            Ingresos
          </span>
          <span className="font-mono text-[12px] tabular-nums text-[var(--color-ok)]">
            {formatCurrency(d.inflows)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-[11px] text-[var(--color-fg-3)]">
            <span className="h-2 w-2 rounded-sm bg-[var(--color-err)]" />
            Gastos
          </span>
          <span className="font-mono text-[12px] tabular-nums text-[var(--color-err)]">
            {formatCurrency(d.outflows)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-[var(--color-line)] pt-1.5 mt-1.5">
          <span className="text-[11px] text-[var(--color-fg-3)]">Neto</span>
          <span
            className="font-mono text-[12px] tabular-nums font-medium"
            style={{ color: net >= 0 ? 'var(--color-ok)' : 'var(--color-err)' }}
          >
            {net >= 0 ? '+' : '−'}
            {formatCurrency(Math.abs(net))}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-[11px] text-[var(--color-fg-3)]">
            <span className="h-0.5 w-3 rounded-full bg-[var(--color-accent)]" />
            Caja
          </span>
          <span className="font-mono text-[12px] tabular-nums text-[var(--color-accent)]">
            {formatCurrency(d.balance)}
          </span>
        </div>
      </div>
    </div>
  );
};

// Compact aging buckets card. `buckets` comes from useTreasuryMetrics
// (receivablesAging / payablesAging): [{ label, total }, …] (4 buckets).
const AgingBuckets = ({ title, buckets, tone }) => {
  const accent = tone === 'ok' ? 'var(--color-ok)' : 'var(--color-warn)';
  const total = buckets.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-2.5">
        <p className="label-mono text-[var(--color-fg-3)]">{title}</p>
        <p className="font-mono text-[12px] tabular-nums" style={{ color: total > 0 ? accent : 'var(--color-fg-4)' }}>
          {formatCurrency(total)}
        </p>
      </div>
      <div className="grid grid-cols-4 divide-x divide-[var(--color-line)]">
        {buckets.map((b) => (
          <div key={b.label} className="px-3 py-4 text-center">
            <p className="label-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-4)]">{b.label}</p>
            <p
              className="mt-1.5 font-mono text-[14px] tabular-nums font-medium"
              style={{ color: b.total > 0 ? accent : 'var(--color-fg-4)' }}
            >
              {formatCurrency(b.total)}
            </p>
          </div>
        ))}
      </div>
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
