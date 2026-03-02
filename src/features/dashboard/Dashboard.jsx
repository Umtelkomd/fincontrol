import React, { useState } from 'react';
import {
  Wallet, ArrowUpCircle, ArrowDownCircle, TrendingUp, TrendingDown,
  AlertTriangle, Users, Clock, ArrowRight, Plus, Eye
} from 'lucide-react';
import ProjectDetail from './ProjectDetail';
import {
  LineChart, Line, PieChart, Pie, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import PeriodSelector, { usePeriodSelector } from '../../components/ui/PeriodSelector';
import { useMetrics } from '../../hooks/useMetrics';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { COLORS, ALERT_THRESHOLDS } from '../../constants/config';

const CHART_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff'];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#2c2c2e] p-3 rounded-xl border border-[rgba(255,255,255,0.1)] text-sm" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <p className="font-medium text-[#c7c7cc] mb-1.5">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-xs" style={{ color: entry.color }}>
            {entry.name}: €{formatCurrency(entry.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// ─── Primary KPI Card ────────────────────────────────────────────
const PrimaryKPI = ({ title, amount, icon: Icon, color, subtitle, trend }) => {
  const isNeg = amount < 0;
  const palette = {
    green:  { grad: 'rgba(48,209,88,0.08)',   border: 'rgba(48,209,88,0.18)',   iconBg: 'rgba(48,209,88,0.15)',   iconColor: '#30d158' },
    red:    { grad: 'rgba(255,69,58,0.08)',    border: 'rgba(255,69,58,0.18)',   iconBg: 'rgba(255,69,58,0.15)',   iconColor: '#ff453a' },
    blue:   { grad: 'rgba(10,132,255,0.08)',   border: 'rgba(10,132,255,0.18)',  iconBg: 'rgba(10,132,255,0.15)', iconColor: '#0a84ff' },
    orange: { grad: 'rgba(255,159,10,0.08)',   border: 'rgba(255,159,10,0.18)',  iconBg: 'rgba(255,159,10,0.15)', iconColor: '#ff9f0a' },
  };
  const c = palette[color] || palette.blue;

  return (
    <div
      className="rounded-xl p-5 border transition-all duration-200 hover:translate-y-[-1px] hover:shadow-lg"
      style={{ background: `linear-gradient(135deg, ${c.grad} 0%, #1c1c1e 55%)`, borderColor: c.border }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2.5 rounded-xl flex-shrink-0" style={{ background: c.iconBg }}>
          <Icon size={18} style={{ color: c.iconColor }} />
        </div>
        <p className="text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider">{title}</p>
      </div>
      <h3 className={`text-[30px] font-bold tracking-tight leading-none ${isNeg ? 'text-[#ff453a]' : 'text-[#e5e5ea]'}`}>
        €{formatCurrency(amount)}
      </h3>
      <div className="flex items-center gap-1.5 mt-2">
        {trend && (
          <span className={`flex items-center gap-1 text-[11px] font-medium ${trend === 'up' ? 'text-[#30d158]' : 'text-[#ff453a]'}`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          </span>
        )}
        {subtitle && <p className="text-[11px] text-[#636366]">{subtitle}</p>}
      </div>
    </div>
  );
};

// ─── Alert Card ──────────────────────────────────────────────────
const AlertItem = ({ icon: Icon, text, color = '#ff453a', action, onAction }) => (
  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors">
    <Icon size={15} style={{ color }} className="flex-shrink-0" />
    <span className="text-[13px] text-[#c7c7cc] flex-1">{text}</span>
    {action && (
      <button onClick={onAction} className="text-[11px] font-medium text-[#0a84ff] hover:text-[#64d2ff] transition-colors whitespace-nowrap">
        {action} →
      </button>
    )}
  </div>
);

const Dashboard = ({ transactions, allTransactions, user, setView }) => {
  const [selectedProject, setSelectedProject] = useState(null);
  const period = usePeriodSelector(2026);

  const sourceData = allTransactions && allTransactions.length > 0 ? allTransactions : transactions;
  const filteredByPeriod = period.filterTransactions(sourceData);
  const metrics = useMetrics(filteredByPeriod);

  if (selectedProject) {
    return (
      <ProjectDetail
        projectName={selectedProject}
        transactions={transactions}
        user={user}
        onClose={() => setSelectedProject(null)}
      />
    );
  }

  const hasAlerts = Object.values(metrics.alerts).some(a => a);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Dashboard</h2>
          <p className="text-[13px] text-[#636366] mt-0.5">Control financiero operativo — {period.periodLabel}</p>
        </div>
        <PeriodSelector {...period} compact />
      </div>

      {/* ─── TOP 3: Saldo, Ingresos, Gastos ────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1">
          <div className="bg-gradient-to-br from-[rgba(48,209,88,0.06)] to-[rgba(10,132,255,0.04)] rounded-xl p-6 border border-[rgba(48,209,88,0.12)] hover:border-[rgba(48,209,88,0.2)] transition-all">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wider">Saldo Actual</p>
              <Wallet size={18} className="text-[#30d158]" />
            </div>
            <h3 className={`text-[32px] font-bold tracking-tight leading-none ${metrics.cashBalance < 0 ? 'text-[#ff453a]' : 'text-white'}`}>
              €{formatCurrency(metrics.cashBalance)}
            </h3>
            <p className="text-[12px] text-[#636366] mt-2">Efectivo disponible hoy</p>
            {metrics.alerts.negativeBalance && (
              <div className="flex items-center gap-1.5 mt-2 text-[#ff453a]">
                <AlertTriangle size={12} />
                <span className="text-[11px] font-medium">Balance negativo</span>
              </div>
            )}
          </div>
        </div>
        <PrimaryKPI
          title="Ingresos Cobrados"
          amount={metrics.collectedIncome}
          icon={ArrowUpCircle}
          color="green"
          subtitle="Ya recibidos en cuenta"
          trend="up"
        />
        <PrimaryKPI
          title="Egresos Pagados"
          amount={metrics.paidExpenses}
          icon={ArrowDownCircle}
          color="red"
          subtitle="Ya pagados"
          trend="down"
        />
      </div>

      {/* ─── Secondary KPIs ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <PrimaryKPI
          title="Cuentas por Cobrar"
          amount={metrics.pendingReceivables}
          icon={Users}
          color="orange"
          subtitle="Pendiente de cobro"
        />
        <PrimaryKPI
          title="Cuentas por Pagar"
          amount={metrics.pendingPayables}
          icon={Clock}
          color="red"
          subtitle="Pendiente de pago"
        />
        <PrimaryKPI
          title="Liquidez Proyectada"
          amount={metrics.projectedLiquidity}
          icon={TrendingUp}
          color="blue"
          subtitle="Saldo + CxC − CxP"
          trend={metrics.projectedLiquidity >= 0 ? 'up' : 'down'}
        />
      </div>

      {/* ─── Alerts ─────────────────────────────────────────────── */}
      {hasAlerts && (
        <div className="bg-[#1c1c1e] rounded-xl border border-[rgba(255,69,58,0.15)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-2">
            <AlertTriangle size={15} className="text-[#ff453a]" />
            <h3 className="text-[13px] font-semibold text-[#c7c7cc]">Alertas Activas</h3>
            <span className="ml-auto text-[10px] text-[#636366] bg-[rgba(255,69,58,0.1)] px-2 py-0.5 rounded-full">
              {Object.values(metrics.alerts).filter(Boolean).length}
            </span>
          </div>
          <div className="p-2 space-y-0.5">
            {metrics.alerts.negativeBalance && (
              <AlertItem icon={AlertTriangle} text="Balance negativo — los egresos superan los ingresos" />
            )}
            {metrics.alerts.highCXP && (
              <AlertItem icon={Clock} text={`CXP supera €${formatCurrency(ALERT_THRESHOLDS.cxpLimit)} — ${metrics.pendingPayables > 0 ? `€${formatCurrency(metrics.pendingPayables)} pendiente` : ''}`} color="#ff9f0a" action="Ver gastos" onAction={() => setView?.('gastos')} />
            )}
            {metrics.alerts.highCXC && (
              <AlertItem icon={Users} text={`CXC supera €${formatCurrency(ALERT_THRESHOLDS.cxcLimit)} — cobrar facturas pendientes`} color="#ff9f0a" action="Ver ingresos" onAction={() => setView?.('ingresos')} />
            )}
            {metrics.alerts.hasOverdue && (
              <AlertItem icon={Clock} text={`${metrics.overdueTransactions.length} factura(s) vencida(s)`} color="#ff453a" action="Revisar" onAction={() => setView?.('transactions')} />
            )}
            {metrics.alerts.hasNegativeProjects && (
              <AlertItem icon={AlertTriangle} text={`${metrics.negativeProjects.length} proyecto(s) con pérdida`} color="#ff453a" />
            )}
          </div>
        </div>
      )}

      {/* ─── Quick Actions ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Nuevo Ingreso', icon: ArrowUpCircle, color: '#30d158', view: 'ingresos' },
          { label: 'Nuevo Gasto', icon: ArrowDownCircle, color: '#ff453a', view: 'gastos' },
          { label: 'Ver Flujo', icon: TrendingUp, color: '#0a84ff', view: 'cashflow' },
          { label: 'Reportes', icon: Eye, color: '#bf5af2', view: 'reportes' },
        ].map(action => (
          <button
            key={action.label}
            onClick={() => setView?.(action.view)}
            className="flex items-center gap-2.5 px-4 py-3 bg-[#1c1c1e] rounded-xl border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] hover:bg-[#2c2c2e] transition-all group"
          >
            <action.icon size={17} style={{ color: action.color }} />
            <span className="text-[13px] font-medium text-[#c7c7cc] group-hover:text-white transition-colors">{action.label}</span>
          </button>
        ))}
      </div>

      {/* ─── Charts Row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly Trend */}
        <div className="bg-[#1c1c1e] p-5 rounded-xl border border-[rgba(255,255,255,0.06)]">
          <h4 className="text-[13px] font-semibold text-[#c7c7cc] mb-4">Tendencia Mensual</h4>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
              <ComposedChart data={(() => {
                let acc = 0;
                return metrics.monthlyTrend.map(m => {
                  acc += (m.ingresos - m.gastos);
                  return { ...m, acumulado: acc };
                });
              })()} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#636366', fontSize: 11 }} />
                <YAxis yAxisId="bars" axisLine={false} tickLine={false} tick={{ fill: '#636366', fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                <YAxis yAxisId="line" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#5e5ce6', fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar yAxisId="bars" dataKey="ingresos" fill="#30d158" name="Ingresos" radius={[3,3,0,0]} maxBarSize={24} fillOpacity={0.85} />
                <Bar yAxisId="bars" dataKey="gastos" fill="#ff453a" name="Gastos" radius={[3,3,0,0]} maxBarSize={24} fillOpacity={0.85} />
                <Line yAxisId="line" type="monotone" dataKey="acumulado" stroke="#5e5ce6" strokeWidth={2} dot={{ r: 2.5, fill: '#5e5ce6' }} name="Acumulado" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Expense Distribution */}
        <div className="bg-[#1c1c1e] p-5 rounded-xl border border-[rgba(255,255,255,0.06)]">
          <h4 className="text-[13px] font-semibold text-[#c7c7cc] mb-4">Distribución de Gastos</h4>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
              <PieChart>
                <Pie data={metrics.categoryDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                  {metrics.categoryDistribution.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip formatter={v => `€${formatCurrency(v)}`} contentStyle={{ borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#2c2c2e', color: '#fff' }} />
                <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── Projects Table ─────────────────────────────────────── */}
      <div className="bg-[#1c1c1e] rounded-xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-[#c7c7cc]">Métricas por Proyecto</h4>
          <span className="text-[11px] text-[#636366]">{metrics.projectMargins.length} proyectos</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[rgba(255,255,255,0.06)] bg-[#111111]">
                <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-[#636366] uppercase tracking-wider">Proyecto</th>
                <th className="px-5 py-3.5 text-right text-[11px] font-semibold text-[#636366] uppercase tracking-wider">Ingresos</th>
                <th className="px-5 py-3.5 text-right text-[11px] font-semibold text-[#636366] uppercase tracking-wider">Gastos</th>
                <th className="px-5 py-3.5 text-right text-[11px] font-semibold text-[#636366] uppercase tracking-wider">Margen</th>
                <th className="px-5 py-3.5 text-right text-[11px] font-semibold text-[#636366] uppercase tracking-wider">ROI</th>
                <th className="px-5 py-3.5 text-center text-[11px] font-semibold text-[#636366] uppercase tracking-wider">Estado</th>
              </tr>
            </thead>
            <tbody>
              {metrics.projectMargins.map((project, idx) => {
                const margin = project.ingresos - project.gastos;
                const roi = project.ingresos > 0 ? ((margin / project.ingresos) * 100) : 0;
                const isPositive = margin >= 0;
                const isHighRoi = roi >= 30;
                const rowBg = idx % 2 === 0 ? 'bg-transparent' : 'bg-[rgba(255,255,255,0.015)]';

                return (
                  <tr
                    key={idx}
                    className={`border-b border-[rgba(255,255,255,0.04)] last:border-0 ${rowBg} hover:bg-[rgba(255,255,255,0.035)] transition-colors cursor-pointer`}
                    onClick={() => setSelectedProject(project.name)}
                  >
                    <td className="px-5 py-3.5">
                      <span className="text-[13px] font-medium text-[#c7c7cc] hover:text-[#0a84ff] transition-colors">{project.name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-[13px] text-[#98989d]">€{formatCurrency(project.ingresos)}</td>
                    <td className="px-5 py-3.5 text-right text-[13px] text-[#98989d]">€{formatCurrency(project.gastos)}</td>
                    <td className={`px-5 py-3.5 text-right text-[13px] font-semibold ${isPositive ? 'text-[#30d158]' : 'text-[#ff453a]'}`}>
                      {isPositive ? '+' : ''}€{formatCurrency(margin)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className={`text-[12px] font-semibold ${isPositive ? 'text-[#30d158]' : 'text-[#ff453a]'}`}>
                        {roi.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                        isHighRoi ? 'bg-[rgba(48,209,88,0.1)] text-[#30d158] border border-[rgba(48,209,88,0.2)]' :
                        isPositive ? 'bg-[rgba(255,255,255,0.05)] text-[#8e8e93] border border-[rgba(255,255,255,0.08)]' :
                        'bg-[rgba(255,69,58,0.1)] text-[#ff453a] border border-[rgba(255,69,58,0.2)]'
                      }`}>
                        {isHighRoi ? 'Excelente' : isPositive ? 'Normal' : 'Crítico'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Recent Activity ────────────────────────────────────── */}
      <div className="bg-[#1c1c1e] rounded-xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-[#c7c7cc]">Actividad Reciente</h4>
          <button onClick={() => setView?.('transactions')} className="text-[11px] font-medium text-[#0a84ff] hover:text-[#64d2ff] transition-colors flex items-center gap-1">
            Ver todas <ArrowRight size={12} />
          </button>
        </div>
        <div className="divide-y divide-[rgba(255,255,255,0.04)]">
          {filteredByPeriod.slice(0, 8).map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                t.type === 'income' ? 'bg-[rgba(48,209,88,0.1)]' : 'bg-[rgba(255,69,58,0.1)]'
              }`}>
                {t.type === 'income'
                  ? <ArrowUpCircle size={16} className="text-[#30d158]" />
                  : <ArrowDownCircle size={16} className="text-[#ff453a]" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[#e5e5ea] truncate">{String(t.description || '')}</p>
                <p className="text-[11px] text-[#636366]">{formatDate(t.date)} · {(t.project || '').split(' ')[0]}</p>
              </div>
              <span className={`text-[13px] font-semibold tabular-nums ${
                t.type === 'income' ? 'text-[#30d158]' : 'text-[#ff453a]'
              }`}>
                {t.type === 'income' ? '+' : '-'}€{formatCurrency(t.amount)}
              </span>
            </div>
          ))}
          {filteredByPeriod.length === 0 && (
            <div className="text-center py-10 text-[#636366] text-sm">
              No hay transacciones registradas
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
