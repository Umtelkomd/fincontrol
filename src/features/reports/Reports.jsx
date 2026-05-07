import { useEffect, useMemo, useRef, useState } from 'react';
import {
 ArrowDownRight,
 ArrowUpRight,
 Calendar,
 ChevronDown,
 ChevronLeft,
 ChevronRight,
 Download,
 TrendingDown,
 TrendingUp,
 Wallet,
} from 'lucide-react';
import {
 Bar,
 BarChart,
 CartesianGrid,
 ComposedChart,
 Legend,
 Line,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from 'recharts';
import HelpButton from '../../components/ui/HelpButton';
import { useFinanceLedger } from '../../hooks/useFinanceLedger';
import { exportReportToPDF } from '../../utils/pdfExport';
import { formatCurrency } from '../../utils/formatters';
import {
 MONTH_NAMES,
 SHORT_MONTH_NAMES,
 filterRowsByRange,
 getMovementCategory,
 resolvePeriodRange,
 summarizeMovements,
 summarizeVAT,
 toPdfTransaction,
} from '../../finance/reporting';

const variation = (current, previous) => {
 if (previous === 0) return current === 0 ? 0 : 100;
 return ((current - previous) / Math.abs(previous)) * 100;
};

const StatCard = ({ title, value, subtitle, accent, icon, delta }) => {
 const IconComponent = icon;

 return (
 <div
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 "
 >
 <div className="mb-4 flex items-start justify-between">
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">{title}</p>
 <p className="mt-2 font-display text-[28px] font-medium tracking-tight text-[var(--color-fg-1)]">{value}</p>
 </div>
 <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ color: accent }}>
 <IconComponent size={18} />
 </div>
 </div>
 <p className="text-sm text-[var(--color-fg-3)]">{subtitle}</p>
 {delta != null && (
 <div className={`mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${delta >= 0 ? 'bg-transparent text-[var(--color-ok)]' : 'bg-transparent text-[var(--color-accent)]'}`}>
 {delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
 {Math.abs(delta).toFixed(1)}% vs período anterior
 </div>
 )}
 </div>
 );
};

const YEAR_OPTIONS = [
 { value: '2026', label: '2026 — Operación actual' },
 { value: '2025', label: '2025 — Histórico' },
 { value: 'all', label: 'Todos los años' },
];

const Reports = ({ user }) => {
 const ledger = useFinanceLedger(user);
 const dropdownRef = useRef(null);
 const [initialDate] = useState(() => {
 const d = new Date();
 return { year: d.getFullYear(), month: d.getMonth() };
 });
 const defaultMonth = `${initialDate.year}-${String(initialDate.month + 1).padStart(2, '0')}`;

 const [selectedPeriod, setSelectedPeriod] = useState(`month:${defaultMonth}`);
 const [selectedYear, setSelectedYear] = useState('2026');
 const [compareMode, setCompareMode] = useState(true);
 const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);

 useEffect(() => {
 const handler = (event) => {
 if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
 setMonthDropdownOpen(false);
 }
 };
 document.addEventListener('mousedown', handler);
 return () => document.removeEventListener('mousedown', handler);
 }, []);

 const yearFilteredMovements = useMemo(() => {
 if (selectedYear === 'all') return ledger.postedMovements;
 return ledger.postedMovements.filter((entry) => {
 const date = entry.postedDate;
 if (!date) return false;
 return date.startsWith(selectedYear);
 });
 }, [ledger.postedMovements, selectedYear]);

 const availableMonths = useMemo(() => {
 const keys = new Set(
 yearFilteredMovements
 .map((entry) => entry.postedDate)
 .filter(Boolean)
 .map((date) => date.slice(0, 7)),
 );
 const yearDefaultMonth = `${selectedYear}-${String(initialDate.month + 1).padStart(2, '0')}`;
 keys.add(yearDefaultMonth);
 return Array.from(keys).sort().reverse();
 }, [yearFilteredMovements, selectedYear, initialDate.month]);

 const monthsByYear = useMemo(() => {
 const groups = {};
 availableMonths.forEach((key) => {
 const [year] = key.split('-');
 if (!groups[year]) groups[year] = [];
 groups[year].push(key);
 });
 return Object.entries(groups).sort((left, right) => Number(right[0]) - Number(left[0]));
 }, [availableMonths]);

 const periodType = selectedPeriod.startsWith('month:') ? 'month' : selectedPeriod;
 const selectedMonthKey = periodType === 'month' ? selectedPeriod.slice(6) : null;
 const currentRange = resolvePeriodRange(selectedPeriod, new Date(), 0);
 const previousRange = resolvePeriodRange(selectedPeriod, new Date(), 1);
 const currentRangeFrom = currentRange.from;
 const currentRangeTo = currentRange.to;
 const previousRangeFrom = previousRange.from;
 const previousRangeTo = previousRange.to;

 const currentMovements = filterRowsByRange(
 yearFilteredMovements,
 (entry) => entry.postedDate,
 { from: currentRangeFrom, to: currentRangeTo },
 );
 const previousMovements = filterRowsByRange(
 yearFilteredMovements,
 (entry) => entry.postedDate,
 { from: previousRangeFrom, to: previousRangeTo },
 );

 const currentTotals = summarizeMovements(currentMovements);
 const previousTotals = summarizeMovements(previousMovements);
 // Net-of-VAT totals for P&L (excludes VAT from revenue and expenses)
 const currentTotalsNet = summarizeMovements(currentMovements, { useNet: true });
 const previousTotalsNet = summarizeMovements(previousMovements, { useNet: true });

 // VAT summary for the period
 const currentVAT = summarizeVAT(currentMovements);
 const previousVAT = summarizeVAT(previousMovements);

 const yearFilteredReceivables = useMemo(() => {
 if (selectedYear === 'all') return ledger.receivables;
 return ledger.receivables.filter((entry) => entry.issueDate?.startsWith(selectedYear));
 }, [ledger.receivables, selectedYear]);

 const yearFilteredPayables = useMemo(() => {
 if (selectedYear === 'all') return ledger.payables;
 return ledger.payables.filter((entry) => entry.issueDate?.startsWith(selectedYear));
 }, [ledger.payables, selectedYear]);

 const receivablesIssued = filterRowsByRange(
 yearFilteredReceivables,
 (entry) => entry.issueDate,
 { from: currentRangeFrom, to: currentRangeTo },
 );
 const payablesIssued = filterRowsByRange(
 yearFilteredPayables,
 (entry) => entry.issueDate,
 { from: currentRangeFrom, to: currentRangeTo },
 );

 const outstandingFromPeriod = {
 cxc: receivablesIssued.reduce((sum, entry) => sum + entry.openAmount, 0),
 cxp: payablesIssued.reduce((sum, entry) => sum + entry.openAmount, 0),
 };
 outstandingFromPeriod.net = outstandingFromPeriod.cxc - outstandingFromPeriod.cxp;

 const groupedInflows = (() => {
 const bucket = new Map();
 currentMovements
 .filter((entry) => entry.direction === 'in')
 .forEach((entry) => {
 const key = getMovementCategory(entry);
 bucket.set(key, (bucket.get(key) || 0) + entry.amount);
 });
 return Array.from(bucket.entries())
 .map(([name, amount]) => ({ name, amount }))
 .sort((left, right) => right.amount - left.amount);
 })();

 const groupedOutflows = (() => {
 const bucket = new Map();
 currentMovements
 .filter((entry) => entry.direction === 'out')
 .forEach((entry) => {
 const key = getMovementCategory(entry);
 bucket.set(key, (bucket.get(key) || 0) + entry.amount);
 });
 return Array.from(bucket.entries())
 .map(([name, amount]) => ({ name, amount }))
 .sort((left, right) => right.amount - left.amount);
 })();

 const projectMargins = (() => {
 const bucket = new Map();
 currentMovements.forEach((entry) => {
 const key = entry.projectName || 'Sin proyecto';
 const current = bucket.get(key) || { name: key, inflows: 0, outflows: 0, net: 0 };
 if (entry.direction === 'in') current.inflows += entry.amount;
 else current.outflows += entry.amount;
 current.net = current.inflows - current.outflows;
 bucket.set(key, current);
 });
 return Array.from(bucket.values()).sort((left, right) => right.net - left.net).slice(0, 6);
 })();

 const trendYear = selectedYear === 'all' ? initialDate.year : Number(selectedYear);
 const trendEndMonth = trendYear === initialDate.year ? initialDate.month : 11;
 const trendStartMonth = Math.max(0, trendEndMonth - 5);
 const trendData = Array.from({ length: trendEndMonth - trendStartMonth + 1 }, (_, index) => {
 const monthIndex = trendStartMonth + index;
 const from = `${trendYear}-${String(monthIndex + 1).padStart(2, '0')}-01`;
 const to = new Date(trendYear, monthIndex + 1, 0).toISOString().slice(0, 10);
 const movements = yearFilteredMovements.filter(
 (entry) => entry.postedDate >= from && entry.postedDate <= to,
 );
 const totals = summarizeMovements(movements);
 return {
 label: `${SHORT_MONTH_NAMES[monthIndex]} ${String(trendYear).slice(2)}`,
 ingresos: totals.inflows,
 gastos: totals.outflows,
 neto: totals.net,
 };
 });

 const canNavigatePrev =
 periodType === 'month' && availableMonths.indexOf(selectedMonthKey) < availableMonths.length - 1;
 const canNavigateNext = periodType === 'month' && availableMonths.indexOf(selectedMonthKey) > 0;

 const navigateMonth = (direction) => {
 if (periodType !== 'month' || !selectedMonthKey) return;
 const currentIndex = availableMonths.indexOf(selectedMonthKey);
 const nextIndex = currentIndex - direction;
 if (nextIndex >= 0 && nextIndex < availableMonths.length) {
 setSelectedPeriod(`month:${availableMonths[nextIndex]}`);
 }
 };

 const exportRows = currentMovements.map((entry) =>
 toPdfTransaction({
 ...entry,
 date: entry.postedDate,
 category: getMovementCategory(entry),
 type: entry.direction === 'in' ? 'income' : 'expense',
 status: 'paid',
 }),
 );

 if (ledger.loading) {
 return (
 <div className="flex items-center justify-center py-28">
 <p className="font-mono text-xs text-[var(--color-fg-3)] tracking-[0.08em] uppercase">Cargando…</p>
 </div>
 );
 }

 return (
 <div className="space-y-6 pb-12">
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-6 py-7 ">
 <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
 <div>
 <p className="mb-3 label-mono text-[var(--color-fg-3)]">Estado de resultados</p>
 <h2 className="font-display text-[32px] font-medium tracking-tight text-[var(--color-fg-1)]">
 Resultado realizado y compromisos abiertos del periodo.{' '}
 <HelpButton title="Estado de resultados">
 <p><strong>Ingresos realizados</strong> — Cobros reales registrados como movimientos bancarios en el periodo seleccionado. No incluye CXC pendientes.</p>
 <p><strong>Gastos realizados</strong> — Pagos reales salidos de caja en el periodo. No incluye CXP pendientes.</p>
 <p><strong>Resultado de caja</strong> — Ingresos menos gastos del periodo. Muestra si la operacion genero o consumio efectivo.</p>
 <p><strong>Compromisos del periodo</strong> — CXC y CXP emitidas en este periodo que aun estan abiertas.</p>
 </HelpButton>
 </h2>
 <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[var(--color-fg-4)]">
 Consulta los ingresos y gastos ya registrados, y mantén aparte los documentos que siguen pendientes de cobro o pago.
 </p>
 </div>
 </div>
 </section>

 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="flex flex-wrap items-center justify-between gap-4">
 <div className="flex items-center gap-2 flex-wrap">
 <div className="relative" ref={dropdownRef}>
 <div className="flex items-center">
 <button
 type="button"
 onClick={() => navigateMonth(-1)}
 disabled={!canNavigatePrev}
 className="rounded-l-2xl border border-r-0 border-[var(--color-line)] bg-[var(--color-bg-1)] p-3 text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-bg-1)] hover:text-[var(--color-fg-1)] disabled:opacity-30"
 >
 <ChevronLeft size={16} />
 </button>
 <button
 type="button"
 onClick={() => setMonthDropdownOpen((value) => !value)}
 className={`flex items-center gap-2 border px-4 py-3 text-sm font-medium transition-all ${
 periodType === 'month'
 ? 'border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-1)]'
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)]'
 }`}
 >
 <Calendar size={16} />
 {selectedMonthKey
 ? `${MONTH_NAMES[Number(selectedMonthKey.slice(5, 7)) - 1]} ${selectedMonthKey.slice(0, 4)}`
 : 'Mes'}
 <ChevronDown size={14} className={`transition-transform ${monthDropdownOpen ? 'rotate-180' : ''}`} />
 </button>
 <button
 type="button"
 onClick={() => navigateMonth(1)}
 disabled={!canNavigateNext}
 className="rounded-r-2xl border border-l-0 border-[var(--color-line)] bg-[var(--color-bg-1)] p-3 text-[var(--color-fg-3)] transition-colors hover:bg-[var(--color-bg-1)] hover:text-[var(--color-fg-1)] disabled:opacity-30"
 >
 <ChevronRight size={16} />
 </button>
 </div>

 {monthDropdownOpen && (
 <div className="absolute left-0 top-full z-20 mt-2 max-h-[320px] min-w-[220px] overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] py-2 ">
 {monthsByYear.map(([year, months]) => (
 <div key={year}>
 <div className="px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-fg-4)]">
 {year}
 </div>
 {months.map((key) => (
 <button
 key={key}
 type="button"
 onClick={() => {
 setSelectedPeriod(`month:${key}`);
 setMonthDropdownOpen(false);
 }}
 className={`block w-full px-4 py-2 text-left text-sm transition-colors ${
 selectedMonthKey === key
 ? 'bg-[var(--color-bg-1)] text-[var(--color-fg-1)]'
 : 'text-[var(--color-fg-3)] hover:bg-[var(--color-bg-1)] hover:text-[var(--color-fg-1)]'
 }`}
 >
 {MONTH_NAMES[Number(key.slice(5, 7)) - 1]} {key.slice(0, 4)}
 </button>
 ))}
 </div>
 ))}
 </div>
 )}
 </div>

 {['quarter', 'year'].map((value) => (
 <button
 key={value}
 type="button"
 onClick={() => setSelectedPeriod(value)}
 className={`rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
 periodType === value
 ? 'border-[var(--color-line-s)] bg-[var(--color-bg-1)] text-[var(--color-fg-1)]'
 : 'border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:bg-[var(--color-bg-1)] hover:text-[var(--color-fg-1)]'
 }`}
 >
 {value === 'quarter' ? 'Trimestre' : 'Año'}
 </button>
 ))}

 <select
 value={selectedYear}
 onChange={(e) => {
 const yr = e.target.value;
 setSelectedYear(yr);
 if (yr !== 'all') {
 const newDefault = `${yr}-${String(initialDate.month + 1).padStart(2, '0')}`;
 setSelectedPeriod(`month:${newDefault}`);
 }
 }}
 className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3 text-sm font-medium text-[var(--color-fg-3)] outline-none transition-all focus:border-[var(--color-line-s)] focus:bg-[var(--color-bg-1)]"
 >
 {YEAR_OPTIONS.map((opt) => (
 <option key={opt.value} value={opt.value}>{opt.label}</option>
 ))}
 </select>
 </div>

 <div className="flex flex-wrap items-center gap-3">
 <label className="inline-flex items-center gap-2 text-sm text-[var(--color-fg-3)]">
 <input
 type="checkbox"
 checked={compareMode}
 onChange={(event) => setCompareMode(event.target.checked)}
 className="h-4 w-4 rounded border-[var(--color-line)]bg-[var(--color-bg-1)]"
 />
 Comparar con período anterior
 </label>
 <button
 type="button"
 onClick={() => exportReportToPDF(exportRows, 'general')}
 className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3 text-sm font-medium text-[var(--color-fg-1)] transition-colors hover:bg-[var(--color-bg-1)]"
 >
 <Download size={16} />
 Exportar PDF
 </button>
 </div>
 </div>

 <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--color-fg-3)]">
 <span>Actual: <span className="font-medium text-[var(--color-fg-1)]">{currentRange.label}</span></span>
 {compareMode && periodType !== 'all' && <span>Anterior: <span className="font-medium text-[var(--color-fg-1)]">{previousRange.label}</span></span>}
 </div>
 </section>

 <div className="grid gap-4 lg:grid-cols-4">
 <StatCard
 title="Ingresos realizados"
 value={formatCurrency(currentTotals.inflows)}
 subtitle={`${currentMovements.filter((entry) => entry.direction === 'in').length} cobros o entradas reales`}
 accent="var(--color-ok)"
 icon={TrendingUp}
 delta={compareMode ? variation(currentTotals.inflows, previousTotals.inflows) : null}
 />
 <StatCard
 title="Gastos realizados"
 value={formatCurrency(currentTotals.outflows)}
 subtitle={`${currentMovements.filter((entry) => entry.direction === 'out').length} pagos o salidas reales`}
 accent="var(--color-accent)"
 icon={TrendingDown}
 delta={compareMode ? variation(currentTotals.outflows, previousTotals.outflows) : null}
 />
 <StatCard
 title="Resultado de caja"
 value={formatCurrency(currentTotals.net)}
 subtitle="Ingresos realizados menos gastos realizados"
 accent={currentTotals.net >= 0 ? 'var(--color-fg-3)' : 'var(--color-accent)'}
 icon={Wallet}
 delta={compareMode ? variation(currentTotals.net, previousTotals.net) : null}
 />
 <StatCard
 title="Compromisos del período"
 value={formatCurrency(outstandingFromPeriod.net)}
 subtitle={`${formatCurrency(outstandingFromPeriod.cxc)} CXC y ${formatCurrency(outstandingFromPeriod.cxp)} CXP emitidas en este período`}
 accent={outstandingFromPeriod.net >= 0 ? 'var(--color-warn)' : 'var(--color-fg-3)'}
 icon={Calendar}
 />
 </div>

 <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4">
 <p className="label-mono text-[var(--color-fg-4)]">Tendencia</p>
 <h3 className="mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Caja realizada {trendYear}</h3>
 </div>
 <ResponsiveContainer width="100%" height={320}>
 <ComposedChart data={trendData}>
 <CartesianGrid stroke="var(--color-line)" vertical={false} />
 <XAxis dataKey="label" tick={{ fill: 'var(--color-fg-4)', fontSize: 11 }} tickLine={false} axisLine={false} />
 <YAxis tick={{ fill: 'var(--color-fg-4)', fontSize: 11 }} tickFormatter={(value) => `${Math.round(value / 1000)}k`} tickLine={false} axisLine={false} />
 <Tooltip
 formatter={(value) => formatCurrency(value)}
 contentStyle={{ backgroundColor: 'var(--color-bg-2)', color: 'var(--color-fg-1)', border: '1px solid var(--color-line)', borderRadius: 18 }}
 />
 <Legend />
 <Bar dataKey="ingresos" fill="var(--color-ok)" radius={0} name="Ingresos" />
 <Bar dataKey="gastos" fill="var(--color-accent)" radius={0} name="Gastos" />
 <Line type="monotone" dataKey="neto" stroke="var(--color-fg-3)" strokeWidth={2.5} dot={{ r: 3 }} name="Neto" />
 </ComposedChart>
 </ResponsiveContainer>
 </section>

 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4">
 <p className="label-mono text-[var(--color-fg-4)]">Top proyectos</p>
 <h3 className="mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Margen realizado por proyecto</h3>
 </div>
 <div className="space-y-3">
 {projectMargins.map((project) => (
 <div key={project.name} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-4">
 <div className="flex items-center justify-between gap-4">
 <div>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">{project.name}</p>
 <p className="mt-1 text-xs text-[var(--color-fg-3)]">
 Ingresos {formatCurrency(project.inflows)} · Gastos {formatCurrency(project.outflows)}
 </p>
 </div>
 <span className={`text-sm font-medium ${project.net >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
 {project.net >= 0 ? '+' : ''}{formatCurrency(project.net)}
 </span>
 </div>
 </div>
 ))}
 {projectMargins.length === 0 && (
 <div className="rounded-lg border border-dashed border-[var(--color-line)] px-4 py-8 text-center text-sm text-[var(--color-fg-3)]">
 No hay movimientos realizados con proyecto en este período.
 </div>
 )}
 </div>
 </section>
 </div>

 <div className="grid gap-6 xl:grid-cols-2">
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4 flex items-center justify-between">
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">Ingresos</p>
 <h3 className="mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Desglose de entradas realizadas</h3>
 </div>
 <span className="rounded-full border border-[var(--color-line-s)] px-3 py-1 text-xs font-medium text-[var(--color-ok)]">
 {formatCurrency(currentTotals.inflows)}
 </span>
 </div>
 <div className="space-y-3">
 {groupedInflows.map((row) => (
 <div key={row.name} className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3">
 <span className="text-sm text-[var(--color-fg-1)]">{row.name}</span>
 <span className="text-sm font-medium text-[var(--color-ok)]">{formatCurrency(row.amount)}</span>
 </div>
 ))}
 {groupedInflows.length === 0 && <p className="text-sm text-[var(--color-fg-3)]">No hay ingresos realizados en este período.</p>}
 </div>
 </section>

 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4 flex items-center justify-between">
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">Gastos</p>
 <h3 className="mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Desglose de salidas realizadas</h3>
 </div>
 <span className="rounded-full border border-[var(--color-line-s)] px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
 {formatCurrency(currentTotals.outflows)}
 </span>
 </div>
 <div className="space-y-3">
 {groupedOutflows.map((row) => (
 <div key={row.name} className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3">
 <span className="text-sm text-[var(--color-fg-1)]">{row.name}</span>
 <span className="text-sm font-medium text-[var(--color-accent)]">{formatCurrency(row.amount)}</span>
 </div>
 ))}
 {groupedOutflows.length === 0 && <p className="text-sm text-[var(--color-fg-3)]">No hay gastos realizados en este período.</p>}
 </div>
 </section>
 </div>

 {/* VAT Summary Section */}
 <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5 ">
 <div className="mb-4 flex items-center justify-between">
 <div>
 <p className="label-mono text-[var(--color-fg-4)]">IVA Alemán (Umsatzsteuer)</p>
 <h3 className="mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">Resumen VAT del período</h3>
 </div>
 <div className="flex gap-3">
 <div className="rounded-lg border border-[var(--color-line-s)] bg-transparent px-3 py-2 text-center">
 <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-warn)]">USt (输出)</p>
 <p className="text-sm font-medium text-[var(--color-warn)]">{formatCurrency(currentVAT.outputVAT)}</p>
 </div>
 <div className="rounded-lg border border-[var(--color-line-s)] bg-transparent px-3 py-2 text-center">
 <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-fg-1)]">Vorsteuer (输入)</p>
 <p className="text-sm font-medium text-[var(--color-fg-1)]">{formatCurrency(currentVAT.inputVAT)}</p>
 </div>
 <div className={`rounded-lg border px-3 py-2 text-center ${currentVAT.netVAT >= 0 ? 'border-[var(--color-line-s)] bg-transparent' : 'border-[var(--color-line-s)] bg-transparent'}`}>
 <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-fg-4)]">Neto VAT</p>
 <p className={`text-sm font-medium ${currentVAT.netVAT >= 0 ? 'text-[var(--color-accent)]' : 'text-[var(--color-ok)]'}`}>
 {currentVAT.netVAT >= 0 ? '+' : ''}{formatCurrency(currentVAT.netVAT)}
 </p>
 </div>
 </div>
 </div>
 <p className="text-xs text-[var(--color-fg-3)]">
 <span className="font-medium text-[var(--color-warn)]">USt (Umsatzsteuer)</span> = IVA cobrado en ingresos (acreedor).{' '}
 <span className="font-medium text-[var(--color-fg-1)]">Vorsteuer</span> = IVA pagado en gastos (reclamable).{' '}
 <span className="font-medium">Neto +</span> = debe pagar a Finanzamt. <span className="font-medium">Neto −</span> = saldo a favor.
 </p>
 {compareMode && (previousVAT.outputVAT > 0 || previousVAT.inputVAT > 0) && (
 <div className="mt-3 flex gap-4 text-xs text-[var(--color-fg-3)]">
 <span>vs. período anterior: USt {formatCurrency(previousVAT.outputVAT)}, Vorsteuer {formatCurrency(previousVAT.inputVAT)}, Neto {formatCurrency(previousVAT.netVAT)}</span>
 </div>
 )}
 <div className="mt-4">
 <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--color-fg-4)]">Resultado neto (excluye IVA)</p>
 <div className="grid grid-cols-3 gap-4">
 <div className="rounded-lg border border-[var(--color-line-s)] bg-transparent px-4 py-3">
 <p className="text-[10px] text-[var(--color-fg-3)]">Ingresos netos</p>
 <p className="text-base font-medium text-[var(--color-ok)]">{formatCurrency(currentTotalsNet.inflows)}</p>
 </div>
 <div className="rounded-lg border border-[var(--color-line-s)] bg-transparent px-4 py-3">
 <p className="text-[10px] text-[var(--color-fg-3)]">Gastos netos</p>
 <p className="text-base font-medium text-[var(--color-accent)]">{formatCurrency(currentTotalsNet.outflows)}</p>
 </div>
 <div className={`rounded-lg border px-4 py-3 ${currentTotalsNet.net >= 0 ? 'border-[var(--color-line-s)] bg-transparent' : 'border-[var(--color-line-s)] bg-transparent'}`}>
 <p className="text-[10px] text-[var(--color-fg-3)]">Resultado neto</p>
 <p className={`text-base font-medium ${currentTotalsNet.net >= 0 ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
 {currentTotalsNet.net >= 0 ? '+' : ''}{formatCurrency(currentTotalsNet.net)}
 </p>
 </div>
 </div>
 </div>
 </section>
 </div>
 );
};

export default Reports;
