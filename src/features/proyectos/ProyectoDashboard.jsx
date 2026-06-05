import React, { useMemo, useState } from 'react';
import {
 ArrowDownCircle,
 ArrowUpCircle,
 BarChart3,
 ChevronDown,
 FolderKanban,
 Percent,
 PieChart as PieChartIcon,
 RefreshCw,
 Target,
} from 'lucide-react';
import {
 Bar,
 Cell,
 ComposedChart,
 CartesianGrid,
 Legend,
 Line,
 Pie,
 PieChart,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from 'recharts';
import { useFinanceLedger } from '../../hooks/useFinanceLedger';
import { useEmployees } from '../../hooks/useEmployees';
import { usePayrollPeriods } from '../nominas/usePayrollPeriods';
import { allocatePayrollCost } from '../nominas/lib/payrollAllocation';
import { formatCurrency, formatDate } from '../../utils/formatters';

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const CHART_COLORS = ['var(--color-fg-1)', 'var(--color-ok)', 'var(--color-warn)', 'var(--color-warn)', 'var(--color-fg-4)', 'var(--color-line-s)', 'var(--color-fg-4)', 'var(--color-fg-3)'];

const OPEN_DOCUMENT_STATUSES = new Set(['issued', 'partial', 'overdue']);

const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const buildProjectTokens = (project) => {
 const rawTokens = [
 project?.id,
 project?.code,
 project?.name,
 project?.displayName,
 `${project?.code || ''} (${project?.name || ''})`,
 ];

 return Array.from(new Set(rawTokens.map(normalizeToken).filter(Boolean)));
};

const matchesProject = (record, tokens, projectId) => {
 const directId = normalizeToken(record?.projectId);
 if (projectId && directId && directId === normalizeToken(projectId)) return true;

 const candidates = [
 record?.projectName,
 record?.project,
 record?.raw?.projectName,
 record?.raw?.project,
 record?.rawRecord?.projectName,
 record?.rawRecord?.project,
 ]
 .map(normalizeToken)
 .filter(Boolean);

 return candidates.some((candidate) => tokens.includes(candidate));
};

const formatAxis = (value) => {
 if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
 return `${Math.round(value)}`;
};

const TooltipCard = ({ active, payload, label }) => {
 if (!active || !payload?.length) return null;

 return (
 <div className="min-w-[180px] rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-3 ">
 <p className="mb-2 label-mono text-[var(--color-fg-4)]">{label}</p>
 {payload.map((entry) => (
 <p key={entry.name} className="text-sm font-medium" style={{ color: entry.color }}>
 {entry.name}: {formatCurrency(entry.value)}
 </p>
 ))}
 </div>
 );
};

const KpiCard = ({ title, value, subtitle, tone = 'neutral', icon }) => {
 const IconComponent = icon;
 const palette =
 tone === 'positive'
 ? {
 card: 'bg-[var(--color-bg-1)]',
 icon: 'bg-transparent text-[var(--color-ok)]',
 value: 'text-[var(--color-ok)]',
 }
 : tone === 'negative'
 ? {
 card: 'bg-[var(--color-bg-1)]',
 icon: 'bg-transparent text-[var(--color-warn)]',
 value: 'text-[var(--color-warn)]',
 }
 : {
 card: 'bg-[var(--color-bg-1)]',
 icon: 'bg-[var(--color-bg-1)] text-[var(--color-fg-1)]',
 value: 'text-[var(--color-fg-1)]',
 };

 return (
 <div className={`rounded-md border border-[var(--color-line)] p-5 ${palette.card}`}>
 <div className="mb-3 flex items-center justify-between gap-3">
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">{title}</p>
 <p className={`mt-2 font-display text-[28px] font-medium tracking-tight ${palette.value}`}>{value}</p>
 </div>
 <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${palette.icon}`}>
 <IconComponent size={18} />
 </div>
 </div>
 <p className="text-[12px] leading-5 text-[var(--color-fg-3)]">{subtitle}</p>
 </div>
 );
};

const Section = ({ title, subtitle, children, action }) => (
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-5 flex items-start justify-between gap-4">
 <div>
 <h3 className="text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">{title}</h3>
 {subtitle ? <p className="mt-1 text-sm text-[var(--color-fg-3)]">{subtitle}</p> : null}
 </div>
 {action}
 </div>
 {children}
 </section>
);

const ProyectoDashboard = ({ user }) => {
 const ledger = useFinanceLedger(user);
 const { employees } = useEmployees(user);
 const { periods: payrollPeriods } = usePayrollPeriods(user);
 const [selectedProjectId, setSelectedProjectId] = useState('');

 const availableProjects = useMemo(
 () =>
 (ledger.projects || [])
 .filter((project) => project.status !== 'inactive')
 .sort((left, right) => (left.name || left.code || '').localeCompare(right.name || right.code || '')),
 [ledger.projects],
 );

 const effectiveProjectId = selectedProjectId || availableProjects[0]?.id || '';

 const selectedProject = useMemo(
 () => availableProjects.find((project) => project.id === effectiveProjectId) || null,
 [availableProjects, effectiveProjectId],
 );

 const projectTokens = useMemo(() => buildProjectTokens(selectedProject), [selectedProject]);

 const projectMovements = useMemo(() => {
 if (!selectedProject) return [];

 return (ledger.postedMovements || [])
 .filter((entry) => matchesProject(entry, projectTokens, selectedProject.id))
 .sort((left, right) => (right.postedDate || '').localeCompare(left.postedDate || ''));
 }, [ledger.postedMovements, projectTokens, selectedProject]);

 const openReceivables = useMemo(() => {
 if (!selectedProject) return [];
 return (ledger.receivables || []).filter(
 (entry) => OPEN_DOCUMENT_STATUSES.has(entry.status) && matchesProject(entry, projectTokens, selectedProject.id),
 );
 }, [ledger.receivables, projectTokens, selectedProject]);

 const openPayables = useMemo(() => {
 if (!selectedProject) return [];
 return (ledger.payables || []).filter(
 (entry) => OPEN_DOCUMENT_STATUSES.has(entry.status) && matchesProject(entry, projectTokens, selectedProject.id),
 );
 }, [ledger.payables, projectTokens, selectedProject]);

 const projectBudget = useMemo(() => {
 if (!selectedProject) return null;

 return (ledger.budgets || []).find((entry) => {
 const budgetTokens = [
 entry.projectId,
 entry.projectName,
 selectedProject.code,
 selectedProject.name,
 selectedProject.displayName,
 ]
 .map(normalizeToken)
 .filter(Boolean);

 return (
 normalizeToken(entry.projectId) === normalizeToken(selectedProject.id) ||
 budgetTokens.some((token) => projectTokens.includes(token))
 );
 }) || null;
 }, [ledger.budgets, projectTokens, selectedProject]);

 // Phase 3, item 3 — allocated labor cost (gesamtkosten) for the selected
 // project, so its P&L stops ignoring payroll. Uses employee.projectIds via the
 // tested allocation lib; matches the selected project by id, code or name token.
 const employeesById = useMemo(() => {
 const map = {};
 (employees || []).forEach((e) => { map[e.id] = e; });
 return map;
 }, [employees]);

 const allocatedLabor = useMemo(() => {
 if (!selectedProject) return 0;
 const { byProject } = allocatePayrollCost({ periods: payrollPeriods, employeesById });
 const wanted = [selectedProject.id, selectedProject.code, selectedProject.name]
 .map(normalizeToken)
 .filter(Boolean);
 return Object.entries(byProject).reduce((sum, [key, value]) => {
 return wanted.includes(normalizeToken(key)) ? sum + Number(value || 0) : sum;
 }, 0);
 }, [selectedProject, payrollPeriods, employeesById]);

 const kpis = useMemo(() => {
 const income = projectMovements
 .filter((entry) => entry.direction === 'in')
 .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
 const bankExpenses = projectMovements
 .filter((entry) => entry.direction === 'out')
 .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
 // Labor cost is folded into expenses so net/margin reflect payroll.
 const expenses = bankExpenses + allocatedLabor;
 const net = income - expenses;
 const margin = income > 0 ? (net / income) * 100 : 0;

 return {
 income,
 expenses,
 laborCost: allocatedLabor,
 net,
 margin,
 openReceivableAmount: openReceivables.reduce((sum, entry) => sum + Number(entry.openAmount || 0), 0),
 openPayableAmount: openPayables.reduce((sum, entry) => sum + Number(entry.openAmount || 0), 0),
 };
 }, [openPayables, openReceivables, projectMovements, allocatedLabor]);

 // Per-month allocated labor for the selected project (item 3) — runs the
 // allocation lib once per period so spike months stay accurate.
 const laborByMonth = useMemo(() => {
 if (!selectedProject) return {};
 const wanted = [selectedProject.id, selectedProject.code, selectedProject.name]
 .map(normalizeToken)
 .filter(Boolean);
 const out = {};
 (payrollPeriods || []).forEach((period) => {
 if (!period.period) return;
 const { byProject } = allocatePayrollCost({ periods: [period], employeesById });
 const monthLabor = Object.entries(byProject).reduce((sum, [key, value]) => {
 return wanted.includes(normalizeToken(key)) ? sum + Number(value || 0) : sum;
 }, 0);
 if (monthLabor > 0) out[period.period] = (out[period.period] || 0) + monthLabor;
 });
 return out;
 }, [selectedProject, payrollPeriods, employeesById]);

 const monthlyData = useMemo(() => {
 const months = new Map();

 projectMovements.forEach((entry) => {
 if (!entry.postedDate) return;
 const [year, month] = entry.postedDate.split('-');
 const key = `${year}-${month}`;
 const current = months.get(key) || { month: key, ingresos: 0, gastos: 0, manoObra: 0 };

 if (entry.direction === 'in') current.ingresos += Number(entry.amount || 0);
 else current.gastos += Number(entry.amount || 0);

 months.set(key, current);
 });

 // Fold per-month labor into gastos so the ComposedChart includes payroll.
 Object.entries(laborByMonth).forEach(([key, labor]) => {
 const current = months.get(key) || { month: key, ingresos: 0, gastos: 0, manoObra: 0 };
 current.gastos += labor;
 current.manoObra += labor;
 months.set(key, current);
 });

 return Array.from(months.values())
 .sort((left, right) => left.month.localeCompare(right.month))
 .map((entry) => {
 const [, month] = entry.month.split('-');
 return {
 ...entry,
 margen: entry.ingresos - entry.gastos,
 label: `${MONTHS_ES[Number(month) - 1]} ${entry.month.slice(2, 4)}`,
 };
 });
 }, [projectMovements, laborByMonth]);

 const categoryData = useMemo(() => {
 const categories = new Map();

 projectMovements
 .filter((entry) => entry.direction === 'out')
 .forEach((entry) => {
 const key = entry.kind || entry.costCenterId || 'Sin categoría';
 categories.set(key, (categories.get(key) || 0) + Number(entry.amount || 0));
 });

 return Array.from(categories.entries())
 .map(([name, value]) => ({ name, value }))
 .sort((left, right) => right.value - left.value);
 }, [projectMovements]);

 const recentRows = useMemo(() => projectMovements.slice(0, 50), [projectMovements]);

 if (ledger.loading) {
 return (
 <div className="flex items-center justify-center py-24">
 <div className="flex flex-col items-center gap-3">
 <RefreshCw className="h-7 w-7 animate-spin text-[var(--color-fg-1)]" />
 <p className="text-sm text-[var(--color-fg-3)]">Cargando proyectos...</p>
 </div>
 </div>
 );
 }

 return (
 <div className="space-y-6 pb-12 animate-fadeIn">
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-6 py-7 ">
 <div className="grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
 <div>
 <p className="mb-3 label-mono text-[var(--color-fg-3)]">Proyectos</p>
 <h2 className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">Rentabilidad y seguimiento por proyecto.</h2>
 <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[var(--color-fg-4)]">
 Revisa ingresos, gastos, documentos abiertos y evolución mensual de cada proyecto desde una sola vista.
 </p>
 </div>

 <div className="flex flex-col gap-3 justify-end">
 <label className="block">
 <span className="mb-2 block label-mono text-[var(--color-fg-4)]">Proyecto</span>
 <div className="relative">
 <select
 value={effectiveProjectId}
 onChange={(event) => setSelectedProjectId(event.target.value)}
 className="w-full appearance-none rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3 pr-10 text-[14px] text-[var(--color-fg-1)] outline-none transition-all focus:border-[var(--color-line-s)] focus:bg-[var(--color-bg-1)] focus:"
 >
 {availableProjects.length === 0 && <option value="">Sin proyectos activos</option>}
 {availableProjects.map((project) => (
 <option key={project.id} value={project.id}>
 {project.code ? `${project.code} · ${project.name}` : project.name}
 </option>
 ))}
 </select>
 <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" />
 </div>
 </label>

 {selectedProject ? (
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3">
 <p className="label-mono text-[var(--color-fg-4)]">Proyecto activo</p>
 <p className="mt-2 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">{selectedProject.name}</p>
 <p className="mt-1 text-[12px] text-[var(--color-fg-3)]">
 {selectedProject.code || 'Sin código'}{selectedProject.client ? ` · ${selectedProject.client}` : ''}
 </p>
 </div>
 ) : null}
 </div>
 </div>
 </section>

 {!selectedProject ? (
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-16 text-center ">
 <FolderKanban size={40} className="mx-auto text-[var(--color-fg-4)]" />
 <p className="mt-4 text-[16px] font-medium text-[var(--color-fg-1)]">No hay proyecto seleccionado</p>
 <p className="mt-2 text-[13px] text-[var(--color-fg-3)]">Selecciona un proyecto para revisar su comportamiento financiero.</p>
 </section>
 ) : (
 <>
 <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
 <KpiCard
 title="Ingresos realizados"
 value={formatCurrency(kpis.income)}
 subtitle={`${projectMovements.filter((entry) => entry.direction === 'in').length} cobros y entradas registradas`}
 tone="positive"
 icon={ArrowUpCircle}
 />
 <KpiCard
 title="Gastos realizados"
 value={formatCurrency(kpis.expenses)}
 subtitle={
 kpis.laborCost > 0
 ? `Incluye ${formatCurrency(kpis.laborCost)} de mano de obra (nómina)`
 : `${projectMovements.filter((entry) => entry.direction === 'out').length} pagos y salidas registradas`
 }
 tone="negative"
 icon={ArrowDownCircle}
 />
 <KpiCard
 title="Balance neto"
 value={`${kpis.net >= 0 ? '+' : ''}${formatCurrency(kpis.net)}`}
 subtitle={`CXC abierta ${formatCurrency(kpis.openReceivableAmount)} · CXP abierta ${formatCurrency(kpis.openPayableAmount)}`}
 tone={kpis.net >= 0 ? 'positive' : 'negative'}
 icon={Target}
 />
 <KpiCard
 title="Margen"
 value={`${kpis.margin.toFixed(1)}%`}
 subtitle="Balance neto sobre ingresos realizados"
 tone={kpis.margin >= 0 ? 'neutral' : 'negative'}
 icon={Percent}
 />
 </div>

 {projectBudget ? (
 <Section title="Presupuesto frente a ejecución" subtitle="Comparativa entre objetivo y comportamiento real del proyecto.">
 <div className="grid gap-4 lg:grid-cols-2">
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-4">
 <div className="mb-3 flex items-center justify-between">
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Ingresos frente a meta</p>
 <span className="text-xs text-[var(--color-fg-3)]">{formatCurrency(projectBudget.incomeTarget || 0)}</span>
 </div>
 <div className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--color-line)]">
 <div
 className="h-full rounded-full bg-[var(--color-ok)]"
 style={{
 width: `${Math.min(100, (projectBudget.incomeTarget || 0) > 0 ? (kpis.income / projectBudget.incomeTarget) * 100 : 0)}%`,
 }}
 />
 </div>
 <p className="text-[12px] text-[var(--color-fg-3)]">
 {formatCurrency(kpis.income)} registrados ·{' '}
 {(projectBudget.incomeTarget || 0) > 0 ? ((kpis.income / projectBudget.incomeTarget) * 100).toFixed(1) : '0.0'}% alcanzado
 </p>
 </div>

 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-4">
 <div className="mb-3 flex items-center justify-between">
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Gastos frente a límite</p>
 <span className="text-xs text-[var(--color-fg-3)]">{formatCurrency(projectBudget.expenseLimit || 0)}</span>
 </div>
 <div className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--color-line)]">
 <div
 className={`h-full rounded-full ${kpis.expenses > (projectBudget.expenseLimit || 0) ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-warn)]'}`}
 style={{
 width: `${Math.min(100, (projectBudget.expenseLimit || 0) > 0 ? (kpis.expenses / projectBudget.expenseLimit) * 100 : 0)}%`,
 }}
 />
 </div>
 <p className="text-[12px] text-[var(--color-fg-3)]">
 {formatCurrency(kpis.expenses)} registrados ·{' '}
 {(projectBudget.expenseLimit || 0) > 0 ? ((kpis.expenses / projectBudget.expenseLimit) * 100).toFixed(1) : '0.0'}% utilizado
 </p>
 </div>
 </div>
 </Section>
 ) : null}

 <div className="grid gap-6 xl:grid-cols-[1.9fr,1.1fr]">
 <Section
 title="Evolución mensual"
 subtitle="Barras de ingresos y gastos con la línea de balance neto por mes."
 action={<span className="text-xs text-[var(--color-fg-4)]">{monthlyData.length} meses</span>}
 >
 {monthlyData.length > 0 ? (
 <div className="h-[320px]">
 <ResponsiveContainer width="100%" height="100%">
 <ComposedChart data={monthlyData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
 <CartesianGrid stroke="var(--color-line)" vertical={false} />
 <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-fg-4)' }} axisLine={false} tickLine={false} />
 <YAxis yAxisId="left" tickFormatter={formatAxis} tick={{ fontSize: 11, fill: 'var(--color-fg-4)' }} axisLine={false} tickLine={false} />
 <YAxis yAxisId="right" orientation="right" tickFormatter={formatAxis} tick={{ fontSize: 11, fill: 'var(--color-fg-4)' }} axisLine={false} tickLine={false} />
 <Tooltip content={<TooltipCard />} />
 <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 12, fontSize: 11 }} />
 <Bar yAxisId="left" dataKey="ingresos" name="Ingresos" fill="var(--color-ok)" maxBarSize={28} radius={0} />
 <Bar yAxisId="left" dataKey="gastos" name="Gastos" fill="var(--color-warn)" maxBarSize={28} radius={0} />
 <Line yAxisId="right" type="monotone" dataKey="margen" name="Balance" stroke="var(--color-fg-1)" strokeWidth={2.8} dot={false} />
 </ComposedChart>
 </ResponsiveContainer>
 </div>
 ) : (
 <div className="flex h-[320px] items-center justify-center text-sm text-[var(--color-fg-3)]">
 No hay movimientos suficientes para mostrar una evolución mensual.
 </div>
 )}
 </Section>

 <Section title="Gastos por categoría" subtitle="Distribución de las salidas realizadas del proyecto.">
 {categoryData.length > 0 ? (
 <>
 <div className="h-[220px]">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={categoryData}
 cx="50%"
 cy="50%"
 innerRadius={48}
 outerRadius={82}
 paddingAngle={2}
 dataKey="value"
 >
 {categoryData.map((entry, index) => (
 <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={0} />
 ))}
 </Pie>
 <Tooltip
 formatter={(value) => formatCurrency(value)}
 contentStyle={{ backgroundColor: 'var(--color-bg-2)', color: 'var(--color-fg-1)', border: '1px solid var(--color-line)', borderRadius: 18 }}
 />
 </PieChart>
 </ResponsiveContainer>
 </div>
 <div className="space-y-2">
 {categoryData.slice(0, 6).map((entry, index) => (
 <div key={entry.name} className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5">
 <div className="flex items-center gap-2">
 <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
 <span className="text-[13px] font-medium text-[var(--color-fg-1)]">{entry.name}</span>
 </div>
 <span className="text-[12px] font-medium text-[var(--color-fg-3)]">{formatCurrency(entry.value)}</span>
 </div>
 ))}
 </div>
 </>
 ) : (
 <div className="flex h-[320px] items-center justify-center text-sm text-[var(--color-fg-3)]">
 No hay gastos registrados en este proyecto.
 </div>
 )}
 </Section>
 </div>

 <Section
 title="Movimientos del proyecto"
 subtitle="Últimos registros confirmados asociados al proyecto seleccionado."
 action={<span className="rounded-full border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-1 text-[11px] text-[var(--color-fg-3)]">{recentRows.length} registros</span>}
 >
 {recentRows.length > 0 ? (
 <div className="overflow-x-auto">
 <table className="w-full min-w-[880px] text-left">
 <thead>
 <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-4)]">
 <th className="px-4 py-3">Fecha</th>
 <th className="px-4 py-3">Descripción</th>
 <th className="px-4 py-3">Tipo</th>
 <th className="px-4 py-3">Contraparte</th>
 <th className="px-4 py-3 text-right">Importe</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-line)]">
 {recentRows.map((entry) => (
 <tr key={entry.id} className="hover:bg-[var(--color-bg-1)]">
 <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">{formatDate(entry.postedDate)}</td>
 <td className="px-4 py-3 text-sm font-medium text-[var(--color-fg-1)]">{entry.description || 'Movimiento sin descripción'}</td>
 <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">{entry.kind || 'Movimiento'}</td>
 <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">{entry.counterpartyName || 'Sin contraparte'}</td>
 <td className={`px-4 py-3 text-right text-sm font-medium ${entry.direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}`}>
 {entry.direction === 'in' ? '+' : '-'}
 {formatCurrency(entry.amount)}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 ) : (
 <div className="rounded-lg border border-dashed border-[var(--color-line)] px-4 py-12 text-center text-sm text-[var(--color-fg-3)]">
 No hay movimientos registrados para este proyecto en la base actual.
 </div>
 )}
 </Section>
 </>
 )}
 </div>
 );
};

export default ProyectoDashboard;
