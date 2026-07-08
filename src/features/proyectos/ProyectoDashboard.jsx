import React, { useMemo, useState } from 'react';
import {
 Activity,
 ArrowDownCircle,
 ArrowUpCircle,
 CalendarRange,
 ChevronDown,
 FolderKanban,
 Gauge,
 Percent,
 RefreshCw,
 Target,
} from 'lucide-react';
import {
 Bar,
 ComposedChart,
 CartesianGrid,
 Legend,
 Line,
 LineChart,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from 'recharts';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { useEmployees } from '../../hooks/useEmployees';
import { usePayrollPeriods } from '../nominas/usePayrollPeriods';
import { allocatePayrollCost } from '../nominas/lib/payrollAllocation';
import { formatCurrency, formatDate } from '../../utils/formatters';

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

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

const monthLabel = (key) => {
 const [year, month] = key.split('-');
 return `${MONTHS_ES[Number(month) - 1]} ${year.slice(2)}`;
};

// Inclusive list of 'YYYY-MM' keys between two month keys.
const buildMonthRange = (startKey, endKey) => {
 if (!startKey || !endKey || startKey > endKey) return [];
 const out = [];
 let [year, month] = startKey.split('-').map(Number);
 const [endYear, endMonth] = endKey.split('-').map(Number);
 while (year < endYear || (year === endYear && month <= endMonth)) {
 out.push(`${year}-${String(month).padStart(2, '0')}`);
 month += 1;
 if (month > 12) { month = 1; year += 1; }
 }
 return out;
};

const TooltipCard = ({ active, payload, label }) => {
 if (!active || !payload?.length) return null;

 return (
 <div className="min-w-[180px] rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-3">
 <p className="mb-2 label-mono text-[var(--color-fg-4)]">{label}</p>
 {payload.filter((entry) => entry.value != null).map((entry) => (
 <p key={entry.name} className="flex items-center gap-2 text-sm font-medium text-[var(--color-fg-1)]">
 <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
 {entry.name}: {formatCurrency(entry.value)}
 </p>
 ))}
 </div>
 );
};

const KpiCard = ({ title, value, subtitle, tone = 'neutral', icon }) => {
 const IconComponent = icon;
 const valueColor =
 tone === 'positive'
 ? 'text-[var(--color-ok)]'
 : tone === 'negative'
 ? 'text-[var(--color-err)]'
 : 'text-[var(--color-fg-1)]';

 return (
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
 <div className="mb-3 flex items-center justify-between gap-3">
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">{title}</p>
 <p className={`mt-2 font-display text-[28px] font-medium tracking-tight ${valueColor}`}>{value}</p>
 </div>
 <div className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-fg-3)]">
 <IconComponent size={18} />
 </div>
 </div>
 <p className="text-[12px] leading-5 text-[var(--color-fg-3)]">{subtitle}</p>
 </div>
 );
};

const Section = ({ title, subtitle, children, action }) => (
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
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

// Performance-index thresholds (PMP convention): >=1 on track, >=0.9 watch, below critical.
const indexStatus = (value) => {
 if (value == null || !Number.isFinite(value)) {
 return { label: 'Sin datos', dot: 'bg-[var(--color-fg-4)]', text: 'text-[var(--color-fg-3)]' };
 }
 if (value >= 1) return { label: 'En control', dot: 'bg-[var(--color-ok)]', text: 'text-[var(--color-ok)]' };
 if (value >= 0.9) return { label: 'Atención', dot: 'bg-[var(--color-warn)]', text: 'text-[var(--color-warn)]' };
 return { label: 'Crítico', dot: 'bg-[var(--color-err)]', text: 'text-[var(--color-err)]' };
};

const EvmStat = ({ title, value, detail, status }) => (
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-4">
 <p className="label-mono text-[var(--color-fg-4)]">{title}</p>
 <p className="mt-2 font-display text-[24px] font-medium tracking-tight text-[var(--color-fg-1)]">{value}</p>
 {status ? (
 <p className={`mt-1 flex items-center gap-2 text-[12px] font-medium ${status.text}`}>
 <span className={`h-2 w-2 rounded-full ${status.dot}`} />
 {status.label}
 </p>
 ) : null}
 <p className="mt-1 text-[12px] leading-5 text-[var(--color-fg-3)]">{detail}</p>
 </div>
);

const ProgressBar = ({ ratio, barClass }) => (
 <div className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--color-line)]">
 <div
 className={`h-full rounded-full ${barClass}`}
 style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
 />
 </div>
);

const ProyectoDashboard = ({ user }) => {
 const ledger = useFinanceLedgerContext();
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

 // Budgets migrated to the lines[] schema (useBudgets.migrateBudgetLines); the
 // legacy incomeTarget/expenseLimit fields no longer exist on new documents.
 // Totals and the planned monthly cost curve are derived from the lines.
 const projectBudgetPlan = useMemo(() => {
 if (!selectedProject) return null;

 const matching = (ledger.budgets || []).filter((entry) => {
 const budgetTokens = [entry.projectId, entry.projectName].map(normalizeToken).filter(Boolean);
 return (
 normalizeToken(entry.projectId) === normalizeToken(selectedProject.id) ||
 budgetTokens.some((token) => projectTokens.includes(token))
 );
 });

 if (matching.length === 0) return null;

 let incomeTarget = 0;
 let expenseLimit = 0;
 const plannedExpenseByMonth = {};

 matching.forEach((budget) => {
 (budget.lines || []).forEach((line) => {
 const monthly = Array.isArray(line.monthlyBudget) ? line.monthlyBudget : [];
 const total = monthly.reduce((sum, value) => sum + Number(value || 0), 0);
 if (line.type === 'income') {
 incomeTarget += total;
 } else {
 expenseLimit += total;
 monthly.forEach((value, monthIndex) => {
 const amount = Number(value || 0);
 if (amount <= 0 || !budget.year) return;
 const key = `${budget.year}-${String(monthIndex + 1).padStart(2, '0')}`;
 plannedExpenseByMonth[key] = (plannedExpenseByMonth[key] || 0) + amount;
 });
 }
 });
 });

 return { incomeTarget, expenseLimit, plannedExpenseByMonth };
 }, [ledger.budgets, projectTokens, selectedProject]);

 // Allocated labor cost for the selected project, so its P&L includes payroll.
 // Uses employee.projectIds via the tested allocation lib; matches by id, code
 // or name token.
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

 // Per-month allocated labor for the selected project — runs the allocation
 // lib once per period so spike months stay accurate.
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
 const key = entry.postedDate.slice(0, 7);
 const current = months.get(key) || { month: key, ingresos: 0, gastos: 0, manoObra: 0 };

 if (entry.direction === 'in') current.ingresos += Number(entry.amount || 0);
 else current.gastos += Number(entry.amount || 0);

 months.set(key, current);
 });

 // Fold per-month labor into gastos so the chart includes payroll.
 Object.entries(laborByMonth).forEach(([key, labor]) => {
 const current = months.get(key) || { month: key, ingresos: 0, gastos: 0, manoObra: 0 };
 current.gastos += labor;
 current.manoObra += labor;
 months.set(key, current);
 });

 return Array.from(months.values())
 .sort((left, right) => left.month.localeCompare(right.month))
 .map((entry) => ({
 ...entry,
 margen: entry.ingresos - entry.gastos,
 label: monthLabel(entry.month),
 }));
 }, [projectMovements, laborByMonth]);

 // --- Earned-value control (PMP) ------------------------------------------
 // BAC comes from the project's expense budget (lines) or, as fallback, the
 // budget field captured on the project itself. Physical progress isn't
 // tracked, so earned value uses billing progress as proxy:
 // EV = (cumulative income / income target) × BAC.
 const evm = useMemo(() => {
 if (!selectedProject) return null;

 const bac = (projectBudgetPlan?.expenseLimit || 0) > 0
 ? projectBudgetPlan.expenseLimit
 : Number(selectedProject.budget || 0);
 const incomeTarget = projectBudgetPlan?.incomeTarget || 0;

 const movementMonths = projectMovements
 .map((entry) => (entry.postedDate || '').slice(0, 7))
 .filter(Boolean)
 .sort();
 const laborMonths = Object.keys(laborByMonth).sort();
 const firstActivity = [movementMonths[0], laborMonths[0]].filter(Boolean).sort()[0] || null;
 const lastActivity = [movementMonths[movementMonths.length - 1], laborMonths[laborMonths.length - 1]]
 .filter(Boolean)
 .sort()
 .pop() || null;

 const scheduleStart = (selectedProject.startDate || '').slice(0, 7) || firstActivity;
 const scheduleEnd = (selectedProject.endDate || '').slice(0, 7) || lastActivity;
 if (!scheduleStart || !scheduleEnd || bac <= 0) {
 return { available: false, bac, incomeTarget, hasSchedule: Boolean(scheduleStart && scheduleEnd) };
 }

 const currentMonth = new Date().toISOString().slice(0, 7);
 const rangeEnd = [scheduleEnd, lastActivity, currentMonth <= scheduleEnd ? currentMonth : scheduleEnd]
 .filter(Boolean)
 .sort()
 .pop();
 const months = buildMonthRange(scheduleStart, rangeEnd > scheduleEnd ? rangeEnd : scheduleEnd);
 if (months.length === 0) return { available: false, bac, incomeTarget, hasSchedule: true };

 const scheduleMonths = buildMonthRange(scheduleStart, scheduleEnd);
 const hasPlannedCurve = Object.keys(projectBudgetPlan?.plannedExpenseByMonth || {}).length > 0;

 const incomeByMonth = {};
 const costByMonth = {};
 projectMovements.forEach((entry) => {
 const key = (entry.postedDate || '').slice(0, 7);
 if (!key) return;
 const amount = Number(entry.amount || 0);
 if (entry.direction === 'in') incomeByMonth[key] = (incomeByMonth[key] || 0) + amount;
 else costByMonth[key] = (costByMonth[key] || 0) + amount;
 });
 Object.entries(laborByMonth).forEach(([key, labor]) => {
 costByMonth[key] = (costByMonth[key] || 0) + labor;
 });

 let cumPlan = 0;
 let cumCost = 0;
 let cumIncome = 0;
 const curve = months.map((key, index) => {
 if (hasPlannedCurve) {
 cumPlan += projectBudgetPlan.plannedExpenseByMonth[key] || 0;
 } else {
 // Linear plan across the schedule window; flat once the schedule ends.
 const position = scheduleMonths.indexOf(key);
 cumPlan = position >= 0 ? (bac * (position + 1)) / scheduleMonths.length : bac;
 }
 cumPlan = Math.min(cumPlan, bac);

 const isFuture = key > currentMonth;
 if (!isFuture) {
 cumCost += costByMonth[key] || 0;
 cumIncome += incomeByMonth[key] || 0;
 }
 const earned = incomeTarget > 0 ? Math.min(cumIncome / incomeTarget, 1) * bac : null;

 return {
 month: key,
 label: monthLabel(key),
 plan: Math.round(cumPlan),
 real: isFuture ? null : Math.round(cumCost),
 ganado: isFuture || earned == null ? null : Math.round(earned),
 index,
 };
 });

 const lastActual = [...curve].reverse().find((point) => point.real != null) || null;
 const pv = lastActual ? lastActual.plan : 0;
 const ac = lastActual ? lastActual.real : 0;
 const ev = lastActual ? lastActual.ganado : null;

 const elapsed = scheduleMonths.filter((key) => key <= currentMonth).length;
 const schedulePct = scheduleMonths.length > 0 ? Math.min(elapsed / scheduleMonths.length, 1) : 0;
 const billingPct = incomeTarget > 0 ? Math.min(kpis.income / incomeTarget, 1) : null;

 return {
 available: true,
 bac,
 incomeTarget,
 curve,
 pv,
 ac,
 ev,
 cpi: ev != null && ac > 0 ? ev / ac : null,
 spi: ev != null && pv > 0 ? ev / pv : null,
 schedulePct,
 billingPct,
 scheduleStart,
 scheduleEnd,
 scheduleMonths: scheduleMonths.length,
 };
 }, [selectedProject, projectBudgetPlan, projectMovements, laborByMonth, kpis.income]);

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

 const categoryTotal = useMemo(
 () => categoryData.reduce((sum, entry) => sum + entry.value, 0),
 [categoryData],
 );

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
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-6 py-7">
 <div className="grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
 <div>
 <p className="mb-3 label-mono text-[var(--color-fg-3)]">Proyectos</p>
 <h2 className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">Rentabilidad y seguimiento por proyecto.</h2>
 <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[var(--color-fg-4)]">
 Revisa ingresos, gastos, documentos abiertos, control de ejecución y evolución mensual de cada proyecto desde una sola vista.
 </p>
 </div>

 <div className="flex flex-col gap-3 justify-end">
 <label className="block">
 <span className="mb-2 block label-mono text-[var(--color-fg-4)]">Proyecto</span>
 <div className="relative">
 <select
 value={effectiveProjectId}
 onChange={(event) => setSelectedProjectId(event.target.value)}
 className="w-full appearance-none rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3 pr-10 text-[14px] text-[var(--color-fg-1)] outline-none transition-all focus:border-[var(--color-line-s)]"
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
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-16 text-center">
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

 <Section
 title="Control de ejecución"
 subtitle="Valor ganado (EVM): plan frente a costo real y avance por facturación."
 action={
 evm?.available ? (
 <span className="flex items-center gap-2 rounded-sm border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-1 text-[11px] text-[var(--color-fg-3)]">
 <CalendarRange size={12} />
 {monthLabel(evm.scheduleStart)} – {monthLabel(evm.scheduleEnd)} · {evm.scheduleMonths} meses
 </span>
 ) : null
 }
 >
 {!evm?.available ? (
 <div className="rounded-lg border border-dashed border-[var(--color-line)] px-4 py-10 text-center">
 <Gauge size={32} className="mx-auto text-[var(--color-fg-4)]" />
 <p className="mt-3 text-sm font-medium text-[var(--color-fg-1)]">Control de ejecución no disponible</p>
 <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-[var(--color-fg-3)]">
 {evm && evm.bac <= 0
 ? 'Define un presupuesto de gastos para el proyecto (líneas de presupuesto o campo presupuesto del proyecto) para calcular la curva S y los índices CPI/SPI.'
 : 'Registra fechas de inicio/fin del proyecto o movimientos asociados para construir el cronograma.'}
 </p>
 </div>
 ) : (
 <>
 <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <EvmStat
 title="Avance programado"
 value={`${(evm.schedulePct * 100).toFixed(0)}%`}
 detail={`Valor planificado ${formatCurrency(evm.pv)} de ${formatCurrency(evm.bac)} (BAC)`}
 />
 <EvmStat
 title="Avance por facturación"
 value={evm.billingPct == null ? '—' : `${(evm.billingPct * 100).toFixed(0)}%`}
 detail={
 evm.billingPct == null
 ? 'Sin meta de ingresos en el presupuesto — no se puede estimar el valor ganado.'
 : `Valor ganado ${formatCurrency(evm.ev ?? 0)} · facturado ${formatCurrency(kpis.income)} de ${formatCurrency(evm.incomeTarget)}`
 }
 />
 <EvmStat
 title="CPI · eficiencia de costo"
 value={evm.cpi == null ? '—' : evm.cpi.toFixed(2)}
 status={indexStatus(evm.cpi)}
 detail={`Costo real ${formatCurrency(evm.ac)} · cada € gastado produce ${evm.cpi == null ? '—' : formatCurrency(evm.cpi)} de valor`}
 />
 <EvmStat
 title="SPI · eficiencia de cronograma"
 value={evm.spi == null ? '—' : evm.spi.toFixed(2)}
 status={indexStatus(evm.spi)}
 detail="Valor ganado sobre valor planificado a la fecha"
 />
 </div>

 <div className="h-[300px]">
 <ResponsiveContainer width="100%" height="100%">
 <LineChart data={evm.curve} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
 <CartesianGrid stroke="var(--color-line)" vertical={false} />
 <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-fg-4)' }} axisLine={false} tickLine={false} />
 <YAxis tickFormatter={formatAxis} tick={{ fontSize: 11, fill: 'var(--color-fg-4)' }} axisLine={false} tickLine={false} />
 <Tooltip content={<TooltipCard />} />
 <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 12, fontSize: 11 }} />
 <Line type="monotone" dataKey="plan" name="Plan (PV)" stroke="var(--color-fg-4)" strokeWidth={2} strokeDasharray="6 4" dot={false} />
 <Line type="monotone" dataKey="real" name="Costo real (AC)" stroke="var(--color-err)" strokeWidth={2} dot={false} />
 <Line type="monotone" dataKey="ganado" name="Valor ganado (EV)" stroke="var(--color-ok)" strokeWidth={2} dot={false} />
 </LineChart>
 </ResponsiveContainer>
 </div>
 <p className="mt-3 text-[11px] leading-5 text-[var(--color-fg-4)]">
 El avance físico no se registra en el sistema; el valor ganado usa el avance por facturación
 (ingresos sobre meta) como aproximación. CPI/SPI ≥ 1.00 indica ejecución en control.
 </p>
 </>
 )}
 </Section>

 {projectBudgetPlan && (projectBudgetPlan.incomeTarget > 0 || projectBudgetPlan.expenseLimit > 0) ? (
 <Section title="Presupuesto frente a ejecución" subtitle="Comparativa entre objetivo y comportamiento real del proyecto.">
 <div className="grid gap-4 lg:grid-cols-2">
 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-4">
 <div className="mb-3 flex items-center justify-between">
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Ingresos frente a meta</p>
 <span className="text-xs text-[var(--color-fg-3)]">{formatCurrency(projectBudgetPlan.incomeTarget)}</span>
 </div>
 <ProgressBar
 ratio={projectBudgetPlan.incomeTarget > 0 ? kpis.income / projectBudgetPlan.incomeTarget : 0}
 barClass="bg-[var(--color-ok)]"
 />
 <p className="text-[12px] text-[var(--color-fg-3)]">
 {formatCurrency(kpis.income)} registrados ·{' '}
 {projectBudgetPlan.incomeTarget > 0 ? ((kpis.income / projectBudgetPlan.incomeTarget) * 100).toFixed(1) : '0.0'}% alcanzado
 </p>
 </div>

 <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-4">
 <div className="mb-3 flex items-center justify-between">
 <p className="text-sm font-medium text-[var(--color-fg-1)]">Gastos frente a límite</p>
 <span className="text-xs text-[var(--color-fg-3)]">{formatCurrency(projectBudgetPlan.expenseLimit)}</span>
 </div>
 <ProgressBar
 ratio={projectBudgetPlan.expenseLimit > 0 ? kpis.expenses / projectBudgetPlan.expenseLimit : 0}
 barClass={kpis.expenses > projectBudgetPlan.expenseLimit ? 'bg-[var(--color-err)]' : 'bg-[var(--color-fg-2)]'}
 />
 <p className="text-[12px] text-[var(--color-fg-3)]">
 {formatCurrency(kpis.expenses)} registrados ·{' '}
 {projectBudgetPlan.expenseLimit > 0 ? ((kpis.expenses / projectBudgetPlan.expenseLimit) * 100).toFixed(1) : '0.0'}% utilizado
 </p>
 </div>
 </div>
 </Section>
 ) : null}

 <div className="grid gap-6 xl:grid-cols-[1.9fr,1.1fr]">
 <Section
 title="Evolución mensual"
 subtitle="Ingresos y gastos por mes con la línea de balance neto."
 action={<span className="text-xs text-[var(--color-fg-4)]">{monthlyData.length} meses</span>}
 >
 {monthlyData.length > 0 ? (
 <div className="h-[320px]">
 <ResponsiveContainer width="100%" height="100%">
 <ComposedChart data={monthlyData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
 <CartesianGrid stroke="var(--color-line)" vertical={false} />
 <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-fg-4)' }} axisLine={false} tickLine={false} />
 <YAxis tickFormatter={formatAxis} tick={{ fontSize: 11, fill: 'var(--color-fg-4)' }} axisLine={false} tickLine={false} />
 <Tooltip content={<TooltipCard />} />
 <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 12, fontSize: 11 }} />
 <Bar dataKey="ingresos" name="Ingresos" fill="var(--color-ok)" maxBarSize={24} radius={[4, 4, 0, 0]} />
 <Bar dataKey="gastos" name="Gastos" fill="var(--color-err)" maxBarSize={24} radius={[4, 4, 0, 0]} />
 <Line type="monotone" dataKey="margen" name="Balance" stroke="var(--color-fg-1)" strokeWidth={2} dot={false} />
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
 <div className="space-y-3">
 {categoryData.slice(0, 8).map((entry) => {
 const share = categoryTotal > 0 ? entry.value / categoryTotal : 0;
 return (
 <div key={entry.name}>
 <div className="mb-1.5 flex items-baseline justify-between gap-3">
 <span className="truncate text-[13px] font-medium text-[var(--color-fg-1)]">{entry.name}</span>
 <span className="shrink-0 text-[12px] text-[var(--color-fg-3)]">
 {formatCurrency(entry.value)} · {(share * 100).toFixed(0)}%
 </span>
 </div>
 <div className="h-2 overflow-hidden rounded-full bg-[var(--color-line)]">
 <div
 className="h-full rounded-full bg-[var(--color-info)]"
 style={{ width: `${Math.max(2, share * 100)}%` }}
 />
 </div>
 </div>
 );
 })}
 {categoryData.length > 8 ? (
 <p className="pt-1 text-[11px] text-[var(--color-fg-4)]">
 +{categoryData.length - 8} categorías más ·{' '}
 {formatCurrency(categoryData.slice(8).reduce((sum, entry) => sum + entry.value, 0))}
 </p>
 ) : null}
 </div>
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
 action={
 <span className="flex items-center gap-1.5 rounded-sm border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-1 text-[11px] text-[var(--color-fg-3)]">
 <Activity size={12} />
 {recentRows.length} registros
 </span>
 }
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
 <tr key={entry.id} className="hover:bg-[var(--color-bg-2)]">
 <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">{formatDate(entry.postedDate)}</td>
 <td className="px-4 py-3 text-sm font-medium text-[var(--color-fg-1)]">{entry.description || 'Movimiento sin descripción'}</td>
 <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">{entry.kind || 'Movimiento'}</td>
 <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">{entry.counterpartyName || 'Sin contraparte'}</td>
 <td className={`px-4 py-3 text-right text-sm font-medium ${entry.direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
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
