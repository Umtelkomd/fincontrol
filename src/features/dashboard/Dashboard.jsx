import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarRange,
  ChevronRight,
  Clock3,
  FileDown,
  FileUp,
  Landmark,
  Shield,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import HelpButton from '../../components/ui/HelpButton';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { summarizeVAT } from '../../finance/reporting';

const getGreeting = () => { const h = new Date().getHours(); if (h < 12) return 'Buenos días'; if (h < 18) return 'Buenas tardes'; return 'Buenas noches'; };

const kpiCardClassName =
  'relative overflow-hidden rounded-[28px] border border-[rgba(205,219,243,0.74)] bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(245,248,253,0.82))] p-5 shadow-[0_18px_44px_rgba(124,148,191,0.1)]';

const TooltipCard = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-[rgba(205,219,243,0.74)] bg-[rgba(255,255,255,0.96)] px-3 py-3 shadow-[0_14px_32px_rgba(124,148,191,0.12)]">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#7184a8]">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
};

const HeroCard = ({ title, value, subtitle, accent, icon, onClick, help }) => {
  const IconComponent = icon;
  return (
    <div
      className={`${kpiCardClassName} ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:shadow-[0_22px_50px_rgba(126,147,190,0.16)] transition-transform duration-200' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div
        className="absolute -right-10 top-[-28px] h-28 w-28 rounded-full blur-3xl"
        style={{ background: `${accent}35` }}
      />
      <div className="relative">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7184a8]">{title}</p>
              {help}
            </div>
            <p className="mt-1 text-[25px] font-semibold tracking-tight text-[#15213c]">{value}</p>
          </div>
          <div
            className="flex h-11 w-11 items-center justify-center rounded-2xl"
            style={{ backgroundColor: `${accent}20`, color: accent }}
          >
            <IconComponent size={18} />
          </div>
        </div>
        <p className="text-[13px] leading-6 text-[#62718f]">{subtitle}</p>
      </div>
    </div>
  );
};

const SectionCard = ({ title, eyebrow, action, children }) => (
  <section className="rounded-[28px] border border-[rgba(205,219,243,0.78)] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(244,248,253,0.84))] p-5 shadow-[0_20px_56px_rgba(124,148,191,0.12)]">
    <div className="mb-5 flex items-center justify-between gap-3">
      <div>
        {eyebrow && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7184a8]">{eyebrow}</p>}
        <h3 className="text-[17px] font-semibold tracking-tight text-[#101938]">{title}</h3>
      </div>
      {action}
    </div>
    {children}
  </section>
);

const Dashboard = ({ user, setView, onNewTransaction }) => {
  const metrics = useTreasuryMetrics({ user });

  // Compute VAT summary from posted movements
  const vatSummary = summarizeVAT(metrics.postedMovements || []);

  const overdueExposure =
    metrics.overdueReceivables.reduce((sum, entry) => sum + entry.openAmount, 0) +
    metrics.overduePayables.reduce((sum, entry) => sum + entry.openAmount, 0);
  const health = metrics.runwayMonths!=null && metrics.runwayMonths<3 ? {label:'CRÍTICA',color:'#dc2626'} : ((metrics.runwayMonths!=null && metrics.runwayMonths<6)||overdueExposure>10000) ? {label:'ALERTA',color:'#d97706'} : {label:'ESTABLE',color:'#16a34a'};
  const netMarginPct = metrics.cashInflows > 0 ? ((metrics.cashInflows - metrics.avgMonthlyOutflows) / metrics.cashInflows * 100).toFixed(1) : '0.0';

  const upcomingRows = [...metrics.upcomingReceivables, ...metrics.upcomingPayables]
    .sort((left, right) => (left.dueDate || '').localeCompare(right.dueDate || ''))
    .slice(0, 8)
    .map((entry) => ({
      ...entry,
      direction: entry.kind === 'receivable' ? 'in' : 'out',
    }));

  const quickActions = [
    {
      id: 'register-collection',
      title: 'Registrar cobro',
      description: 'Entrada real de dinero en cuenta.',
      icon: ArrowUpRight,
      accent: '#0f9f6e',
    },
    {
      id: 'register-payment',
      title: 'Registrar pago',
      description: 'Salida real de dinero ya ejecutada.',
      icon: ArrowDownRight,
      accent: '#d04c36',
    },
    {
      id: 'create-receivable',
      title: 'Crear factura CXC',
      description: 'Documento por cobrar sin afectar caja.',
      icon: FileUp,
      accent: '#1990cc',
    },
    {
      id: 'create-payable',
      title: 'Crear factura CXP',
      description: 'Documento por pagar sin afectar caja.',
      icon: FileDown,
      accent: '#c98717',
    },
    {
      id: 'bank-adjustment',
      title: 'Ajuste bancario',
      description: 'Movimiento directo de tesorería.',
      icon: Wallet,
      accent: '#5e5ce6',
    },
  ];

  if (metrics.loading) {
    return (
      <div className="flex items-center justify-center py-28">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#4d74ff] border-t-transparent" />
          <p className="text-sm text-[#62718f]">Construyendo la posicion de tesoreria...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <section className="relative overflow-hidden rounded-[34px] border border-[rgba(205,219,243,0.82)] bg-[radial-gradient(circle_at_top_left,rgba(168,193,235,0.26),transparent_28%),radial-gradient(circle_at_top_right,rgba(226,233,245,0.62),transparent_22%),linear-gradient(160deg,rgba(247,249,252,0.98)_0%,rgba(236,241,248,0.96)_100%)] px-6 py-7 shadow-[0_24px_74px_rgba(124,148,191,0.12)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm text-[#5b78a8] mb-1">{getGreeting()}</p>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#5b78a8]">
              Inicio operativo
            </p>
            <h2 className="max-w-2xl text-[30px] font-semibold leading-[1.08] tracking-tight text-[#101938]">
              Liquidez real, vencimientos y proyeccion semanal en una sola vista.
            </h2>
            <p className="mt-4 max-w-2xl text-[14px] leading-7 text-[#5f7091]">
              La caja ya sale de movimientos bancarios y los compromisos abiertos permanecen fuera del saldo hasta su cobro o pago real.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-3 rounded-full px-3 py-1 text-xs font-semibold" style={{backgroundColor: health.color+'18', color: health.color}}>● Salud financiera: {health.label}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[460px]">
            <div
              className="rounded-[24px] border border-[rgba(205,219,243,0.74)] bg-[rgba(255,255,255,0.84)] px-4 py-4 cursor-pointer hover:scale-[1.02] hover:shadow-[0_22px_50px_rgba(126,147,190,0.16)] transition-transform duration-200"
              onClick={() => setView?.('cashflow')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView?.('cashflow'); } }}
            >
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#7184a8]">Caja actual</p>
              <p className={`mt-2 text-[26px] font-semibold ${metrics.currentCash >= 0 ? 'text-[#1f4fd1]' : 'text-[#c25d42]'}`}>{formatCurrency(metrics.currentCash)}</p>
            </div>
            <div
              className="rounded-[24px] border border-[rgba(205,219,243,0.74)] bg-[rgba(255,255,255,0.84)] px-4 py-4 cursor-pointer hover:scale-[1.02] hover:shadow-[0_22px_50px_rgba(126,147,190,0.16)] transition-transform duration-200"
              onClick={() => setView?.('cxc')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView?.('cxc'); } }}
            >
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#7184a8]">CXC abierta</p>
              <p className="mt-2 text-[26px] font-semibold text-[#3e68d9]">{formatCurrency(metrics.pendingReceivables)}</p>
            </div>
            <div
              className="rounded-[24px] border border-[rgba(205,219,243,0.74)] bg-[rgba(255,255,255,0.84)] px-4 py-4 cursor-pointer hover:scale-[1.02] hover:shadow-[0_22px_50px_rgba(126,147,190,0.16)] transition-transform duration-200"
              onClick={() => setView?.('cxp')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView?.('cxp'); } }}
            >
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#7184a8]">CXP abierta</p>
              <p className="mt-2 text-[26px] font-semibold text-[#bd7a2f]">{formatCurrency(metrics.pendingPayables)}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <HeroCard
          title="Caja real"
          value={formatCurrency(metrics.currentCash)}
          subtitle="Saldo operativo de la cuenta principal tras movimientos contabilizados."
          accent={metrics.currentCash >= 0 ? '#3e68d9' : '#c25d42'}
          icon={Landmark}
          help={
            <HelpButton title="Caja real" size={13}>
              <p>Saldo operativo real. Calculado desde el saldo de apertura (dic 2025) mas todos los movimientos bancarios registrados.</p>
            </HelpButton>
          }
        />
        <HeroCard
          title="Liquidez proyectada"
          value={formatCurrency(metrics.projectedLiquidity)}
          subtitle="Caja actual mas CXC abierta menos CXP abierta."
          accent="#4d74ff"
          icon={Wallet}
          help={
            <HelpButton title="Liquidez proyectada" size={13}>
              <p>Caja actual + CXC abiertas - CXP abiertas.</p>
              <p>Muestra cuanto tendria la empresa si se cobrara y pagara todo lo pendiente.</p>
            </HelpButton>
          }
        />
        <HeroCard
          title="Siguiente ventana"
          value={`${metrics.next14Net >= 0 ? '+' : ''}${formatCurrency(metrics.next14Net)}`}
          subtitle="Impacto neto esperado de vencimientos en los proximos 14 dias."
          accent={metrics.next14Net >= 0 ? '#4d74ff' : '#c25d42'}
          icon={CalendarRange}
          help={
            <HelpButton title="Siguiente ventana" size={13}>
              <p>Impacto neto de vencimientos en los proximos 14 dias.</p>
              <p>Positivo = mas cobros que pagos esperados.</p>
            </HelpButton>
          }
        />
        <HeroCard
          title="Exposicion vencida"
          value={formatCurrency(overdueExposure)}
          subtitle="Suma de documentos vencidos por cobrar y por pagar."
          accent="#c25d42"
          icon={ShieldAlert}
          onClick={() => setView?.('alertas')}
          help={
            <HelpButton title="Exposicion vencida" size={13}>
              <p>Suma de documentos CXC y CXP que ya pasaron su fecha de vencimiento sin liquidarse.</p>
            </HelpButton>
          }
        />
        <HeroCard
          title="Margen Neto Mes"
          value={netMarginPct+'%'}
          subtitle="Ingresos menos burn rate mensual sobre ingresos totales."
          accent={parseFloat(netMarginPct)>=0?'#16a34a':'#dc2626'}
          icon={parseFloat(netMarginPct)>=0?TrendingUp:TrendingDown}
          help={
            <HelpButton title="Margen Neto Mes" size={13}>
              <p>(Ingresos - gastos promedio mensual) / ingresos.</p>
              <p>Indica que porcentaje de los ingresos queda como ganancia operativa.</p>
            </HelpButton>
          }
        />
      </div>

      {/* VAT Summary Card — German Umsatzsteuer */}
      <div className="rounded-[28px] border border-[rgba(205,219,243,0.74)] bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(245,248,253,0.82))] p-5 shadow-[0_18px_44px_rgba(124,148,191,0.1)]">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7184a8]">IVA Alemán — Umsatzsteuer (Voranmeldung)</p>
          </div>
          <HelpButton title="IVA Alemán (Umsatzsteuer)" size={13}>
            <p><strong>USt (Umsatzsteuer)</strong> = IVA cobrado en ingresos. Lo debes al Finanzamt.</p>
            <p className="mt-1"><strong>Vorsteuer</strong> = IVA pagado en gastos. El Finanzamt te lo devuelve.</p>
            <p className="mt-1"><strong>Neto +</strong> = debes pagar al Finanzamt.</p>
            <p className="mt-1"><strong>Neto −</strong> = el Finanzamt te devuelve.</p>
          </HelpButton>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-[rgba(255,159,10,0.18)] bg-[rgba(255,159,10,0.06)] px-4 py-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#d97706]">USt (ingresos)</p>
            <p className="mt-1 text-[20px] font-semibold text-[#d97706]">{formatCurrency(vatSummary.outputVAT)}</p>
            <p className="text-[10px] text-[#6b7a96]">IVA cobrado — debe a Finanzamt</p>
          </div>
          <div className="rounded-2xl border border-[rgba(59,130,246,0.18)] bg-[rgba(59,130,246,0.06)] px-4 py-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#3b82f6]">Vorsteuer (gastos)</p>
            <p className="mt-1 text-[20px] font-semibold text-[#3b82f6]">{formatCurrency(vatSummary.inputVAT)}</p>
            <p className="text-[10px] text-[#6b7a96]">IVA pagado — reclamable</p>
          </div>
          <div className={`rounded-2xl border px-4 py-3 text-center ${vatSummary.netVAT >= 0 ? 'border-[rgba(239,68,68,0.18)] bg-[rgba(239,68,68,0.06)]' : 'border-[rgba(16,185,129,0.18)] bg-[rgba(16,185,129,0.06)]'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7184a8]">Neto VAT</p>
            <p className={`mt-1 text-[20px] font-semibold ${vatSummary.netVAT >= 0 ? 'text-[#dc2626]' : 'text-[#16a34a]'}`}>
              {vatSummary.netVAT >= 0 ? '+' : ''}{formatCurrency(vatSummary.netVAT)}
            </p>
            <p className="text-[10px] text-[#6b7a96]">{vatSummary.netVAT >= 0 ? 'Debes al Finanzamt' : 'A favor de la empresa'}</p>
          </div>
        </div>
      </div>

      <SectionCard eyebrow="Acciones" title="Registrar operacion desde inicio">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => onNewTransaction?.(action.id)}
                className="group rounded-[24px] border border-[rgba(205,219,243,0.74)] bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(244,248,253,0.84))] p-4 text-left shadow-[0_14px_34px_rgba(124,148,191,0.08)] transition-all hover:-translate-y-[1px] hover:shadow-[0_18px_42px_rgba(124,148,191,0.14)]"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `${action.accent}18`, color: action.accent }}
                  >
                    <Icon size={18} />
                  </div>
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: action.accent }}
                  />
                </div>
                <p className="text-sm font-semibold text-[#101938]">{action.title}</p>
                <p className="mt-1 text-[12px] leading-5 text-[#62718f]">{action.description}</p>
                <div className="mt-4 inline-flex items-center gap-2 text-[12px] font-medium text-[#3156d3]">
                  Abrir flujo
                  <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[1.35fr,0.95fr]">
        <SectionCard
          eyebrow="Tendencia"
          title="Caja de las ultimas 12 semanas"
          action={
            <button
              type="button"
              onClick={() => setView?.('cashflow')}
              className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(205,219,243,0.74)] bg-white/72 px-3 py-2 text-sm font-medium text-[#62718f] transition-colors hover:bg-white hover:text-[#101938]"
            >
              Abrir tesoreria
              <ChevronRight size={14} />
            </button>
          }
        >
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.cashSeries}>
                <defs>
                  <linearGradient id="dashboardCash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4d74ff" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#4d74ff" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(177,192,220,0.32)" vertical={false} />
                <XAxis dataKey="label" stroke="#7b8cab" tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#7b8cab"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `€${Math.round(value / 1000)}k`}
                />
                <Tooltip content={<TooltipCard />} />
                <Area type="monotone" dataKey="balance" name="Caja" stroke="#4d74ff" fill="url(#dashboardCash)" strokeWidth={2.4} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Proyeccion" title="Compromisos de las proximas 8 semanas">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.weeklyProjection} barCategoryGap={18}>
                <CartesianGrid stroke="rgba(177,192,220,0.32)" vertical={false} />
                <XAxis dataKey="week" stroke="#7b8cab" tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#7b8cab"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `€${Math.round(value / 1000)}k`}
                />
                <Tooltip content={<TooltipCard />} />
                <Bar dataKey="committedIn" name="Cobros" fill="#4d74ff" radius={[10, 10, 0, 0]} />
                <Bar dataKey="committedOut" name="Pagos" fill="#c28c48" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <SectionCard eyebrow="Vencimientos" title="Proximos movimientos de caja">
          <div className="space-y-3">
            {upcomingRows.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-[rgba(205,219,243,0.72)] bg-[rgba(255,255,255,0.62)] px-4 py-10 text-center text-sm text-[#6b7a96]">
                No hay vencimientos en la siguiente ventana.
              </div>
            )}
            {upcomingRows.map((entry) => {
              const isInflow = entry.direction === 'in';
              return (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[rgba(205,219,243,0.7)] bg-[rgba(255,255,255,0.74)] px-4 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-2xl"
                      style={{
                        backgroundColor: isInflow ? 'rgba(77,116,255,0.12)' : 'rgba(194,140,72,0.14)',
                        color: isInflow ? '#4d74ff' : '#bd7a2f',
                      }}
                    >
                      {isInflow ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#101938]">{entry.counterpartyName}</p>
                      <p className="text-xs text-[#6b7a96]">
                        {entry.documentNumber || 'Sin documento'} · vence {formatDate(entry.dueDate)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${isInflow ? 'text-[#3156d3]' : 'text-[#bd7a2f]'}`}>
                      {isInflow ? '+' : '-'}
                      {formatCurrency(entry.openAmount)}
                    </p>
                    <p className="text-xs text-[#7b8cab]">{entry.description || 'Sin descripcion'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Rentabilidad"
          title="Margen reciente por proyecto"
          action={
            <button
              type="button"
              onClick={() => setView?.('proyectos')}
              className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(205,219,243,0.74)] bg-white/72 px-3 py-2 text-sm font-medium text-[#62718f] transition-colors hover:bg-white hover:text-[#101938]"
            >
              Ver detalle
              <ChevronRight size={14} />
            </button>
          }
        >
          <div className="space-y-3">
            {metrics.projectMargins.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-[rgba(205,219,243,0.72)] bg-[rgba(255,255,255,0.62)] px-4 py-10 text-center text-sm text-[#6b7a96]">
                No hay movimientos con proyecto para analizar margen.
              </div>
            )}
            {metrics.projectMargins.map((project) => (
              <div
                key={project.name}
                className="rounded-[24px] border border-[rgba(205,219,243,0.7)] bg-[rgba(255,255,255,0.74)] px-4 py-4"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#101938]">{project.name}</p>
                    <p className="text-xs text-[#6b7a96]">
                      Ingreso {formatCurrency(project.inflows)} · Gasto {formatCurrency(project.outflows)}
                    </p>
                  </div>
                  <div className="rounded-full border border-[rgba(205,219,243,0.72)] bg-white/84 px-2.5 py-1 text-xs font-semibold text-[#101938]">
                    {project.margin.toFixed(1)}%
                  </div>
                </div>
                <div className="h-2 rounded-full bg-[rgba(183,195,220,0.34)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(6, Math.min(100, Math.abs(project.margin)))}%`,
                      background: project.net >= 0 ? '#4d74ff' : '#c25d42',
                    }}
                  />
                </div>
                <p className={`mt-2 text-xs font-medium ${project.net >= 0 ? 'text-[#3156d3]' : 'text-[#c25d42]'}`}>
                  Neto {project.net >= 0 ? '+' : ''}
                  {formatCurrency(project.net)}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard eyebrow="Alertas" title="Radar operativo">
          <div className="space-y-3">
            <div className="rounded-[22px] border border-[rgba(194,93,66,0.14)] bg-[rgba(255,240,236,0.86)] px-4 py-4">
              <div className="mb-2 flex items-center gap-2 text-[#c25d42]">
                <AlertTriangle size={16} />
                <span className="text-sm font-semibold">Cartera vencida</span>
              </div>
              <p className="text-sm text-[#4f5e7a]">
                {metrics.overdueReceivables.length} documentos por cobrar · {formatCurrency(metrics.overdueReceivables.reduce((sum, entry) => sum + entry.openAmount, 0))}
              </p>
            </div>
            <div className="rounded-[22px] border border-[rgba(194,140,72,0.14)] bg-[rgba(255,247,235,0.9)] px-4 py-4">
              <div className="mb-2 flex items-center gap-2 text-[#bd7a2f]">
                <Clock3 size={16} />
                <span className="text-sm font-semibold">Pagos vencidos</span>
              </div>
              <p className="text-sm text-[#4f5e7a]">
                {metrics.overduePayables.length} documentos por pagar · {formatCurrency(metrics.overduePayables.reduce((sum, entry) => sum + entry.openAmount, 0))}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Capacidad" title="Runway estimado">
          <div className="rounded-[24px] border border-[rgba(205,219,243,0.7)] bg-[rgba(255,255,255,0.74)] px-4 py-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(77,116,255,0.12)] text-[#4d74ff]">
                <Target size={18} />
              </div>
              <p className="text-[28px] font-semibold tracking-tight text-[#101938]">
                {metrics.runwayMonths == null ? 'N/A' : `${metrics.runwayMonths.toFixed(1)}m`}
              </p>
            </div>
            <p className="text-sm leading-7 text-[#5f7091]">
              Basado en caja actual y egreso mensual promedio de los ultimos 90 dias: {formatCurrency(metrics.avgMonthlyOutflows)}.
            </p>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Disciplina" title="Accion sugerida">
          <div className="rounded-[24px] border border-[rgba(205,219,243,0.7)] bg-[rgba(255,255,255,0.74)] px-4 py-5">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(77,116,255,0.12)] text-[#4d74ff]">
              <BriefcaseBusiness size={18} />
            </div>
            <p className="text-sm leading-7 text-[#5f7091]">
              Prioriza el cobro de la cartera vencida y valida conciliacion semanalmente para mantener la caja proyectada alineada con banco.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default Dashboard;
