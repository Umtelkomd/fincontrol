import { useState, useEffect, useMemo } from 'react';
import { X, Calendar, CheckCircle2, AlertCircle, Repeat } from 'lucide-react';
import { useRecurringCosts } from '../../hooks/useRecurringCosts';
import { usePayables } from '../../hooks/usePayables';
import { useRecurringGenerator } from '../../hooks/useRecurringGenerator';
import {
 periodLabel,
 summarizeInstances,
} from '../../finance/recurringGenerator';
import { formatCurrency } from '../../utils/formatters';
import { Button, Badge, KPIGrid, KPI } from '@/components/ui/nexus';

const todayParts = () => {
 const d = new Date();
 return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

/**
 * GenerateMonthModal — preview + bulk-create payables for a target month.
 *
 * The modal shows a per-rule preview with status (NEW vs EXISTING). User
 * confirms to write the new ones to Firestore. Idempotent: same month can
 * be re-run safely (only missing instances get created).
 */
const GenerateMonthModal = ({ isOpen, onClose, user }) => {
 const { recurringCosts } = useRecurringCosts(user);
 const { payables } = usePayables(user);
 const { preview, generate } = useRecurringGenerator(user);

 const [year, setYear] = useState(todayParts().year);
 const [month, setMonth] = useState(todayParts().month);
 const [submitting, setSubmitting] = useState(false);
 const [result, setResult] = useState(null);

 useEffect(() => {
 if (isOpen) {
 const { year: y, month: m } = todayParts();
 setYear(y);
 setMonth(m);
 setResult(null);
 }
 }, [isOpen]);

 const instances = useMemo(() => {
 if (!isOpen) return [];
 return preview({
 rules: recurringCosts,
 existingPayables: payables,
 year,
 month,
 });
 }, [isOpen, preview, recurringCosts, payables, year, month]);

 const stats = useMemo(() => summarizeInstances(instances), [instances]);

 if (!isOpen) return null;

 const handleGenerate = async () => {
 setSubmitting(true);
 const r = await generate({
 rules: recurringCosts,
 existingPayables: payables,
 year,
 month,
 });
 setSubmitting(false);
 setResult(r);
 };

 const yearOptions = [];
 const currentYear = new Date().getFullYear();
 for (let y = currentYear - 1; y <= currentYear + 1; y++) yearOptions.push(y);

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn" onClick={onClose}>
 <div className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
 <header className="px-6 py-4 border-b border-[var(--color-line)] flex items-center justify-between">
 <div className="flex items-center gap-3">
 <Repeat size={18} className="text-[var(--color-fg-4)]" />
 <h2 className="text-lg font-medium text-[var(--color-fg-1)]">
 Generar pagos del mes
 </h2>
 </div>
 <button type="button" onClick={onClose} className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)]">
 <X size={20} />
 </button>
 </header>

 <div className="px-6 py-4 border-b border-[var(--color-line)] flex items-end gap-4 flex-wrap">
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Año</span>
 <select
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none"
 value={year}
 onChange={(e) => { setYear(Number(e.target.value)); setResult(null); }}
 >
 {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
 </select>
 </label>
 <label className="block">
 <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Mes</span>
 <select
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none"
 value={month}
 onChange={(e) => { setMonth(Number(e.target.value)); setResult(null); }}
 >
 {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
 <option key={m} value={m}>{periodLabel(year, m)}</option>
 ))}
 </select>
 </label>
 <p className="ml-auto text-[12px] text-[var(--color-fg-3)] flex items-center gap-2">
 <Calendar size={14} className="text-[var(--color-fg-4)]" />
 Período: <span className="text-[var(--color-fg-1)] font-mono">{periodLabel(year, month)}</span>
 </p>
 </div>

 <div className="px-6 py-4 border-b border-[var(--color-line)]">
 <KPIGrid cols={3}>
 <KPI
 label="Nuevas a crear"
 value={stats.newCount}
 meta={formatCurrency(stats.totalNew)}
 tone={stats.newCount > 0 ? 'warn' : 'default'}
 />
 <KPI
 label="Ya generadas"
 value={stats.existingCount}
 meta={formatCurrency(stats.totalExisting)}
 tone="ok"
 />
 <KPI
 label="Total mes"
 value={instances.length}
 meta={formatCurrency(stats.grandTotal)}
 />
 </KPIGrid>
 </div>

 <div className="overflow-y-auto flex-1">
 {instances.length === 0 ? (
 <div className="px-4 py-12 text-center">
 <p className="label-mono text-[var(--color-fg-4)]">[SIN REGLAS APLICABLES]</p>
 <p className="mt-2 text-[13px] text-[var(--color-fg-4)]">
 No hay costos recurrentes activos que apliquen a {periodLabel(year, month)}.
 </p>
 </div>
 ) : (
 <table className="nx-table w-full">
 <thead>
 <tr>
 <th>Concepto</th>
 <th>Asociado a</th>
 <th>Contraparte</th>
 <th>Vencimiento</th>
 <th className="text-right">Monto</th>
 <th className="text-center">Estado</th>
 </tr>
 </thead>
 <tbody>
 {instances.map((i, idx) => (
 <tr key={`${i.recurringCostId}-${idx}`}>
 <td className="font-medium text-[var(--color-fg-1)]">{i.concept}</td>
 <td className="text-[var(--color-fg-3)]">{i.ownerName || '—'}</td>
 <td className="text-[var(--color-fg-3)]">{i.counterpartyName || '—'}</td>
 <td className="font-mono text-[var(--color-fg-3)]">{i.dueDate}</td>
 <td className="text-right font-mono tabular-nums">{formatCurrency(i.amount)}</td>
 <td className="text-center">
 {i.existing ? (
 <Badge variant="ok" dot>Ya existe</Badge>
 ) : (
 <Badge variant="warn" dot>Crear</Badge>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 )}
 </div>

 {result && (
 <div className={`px-6 py-3 border-t border-[var(--color-line)] ${result.errors?.length > 0 ? 'bg-[rgba(255,77,46,0.05)]' : 'bg-[rgba(74,222,128,0.05)]'}`}>
 <div className="flex items-center gap-3">
 {result.errors?.length > 0 ? (
 <AlertCircle size={16} className="text-[var(--color-err)]" />
 ) : (
 <CheckCircle2 size={16} className="text-[var(--color-ok)]" />
 )}
 <p className="text-sm text-[var(--color-fg-1)]">
 <span className="text-[var(--color-ok)]">{result.created}</span> creadas ·{' '}
 <span className="text-[var(--color-fg-4)]">{result.skipped}</span> ya existían
 {result.errors?.length > 0 && <span className="text-[var(--color-err)]"> · {result.errors.length} errores</span>}
 </p>
 </div>
 </div>
 )}

 <footer className="px-6 py-4 border-t border-[var(--color-line)] flex justify-between items-center gap-3">
 <p className="text-[11px] text-[var(--color-fg-4)] max-w-md">
 Idempotente: ya las creadas se omiten. Las nuevas se agregan a CXP con vencimiento
 calculado del día configurado en cada regla.
 </p>
 <div className="flex gap-3">
 <Button variant="ghost" onClick={onClose} disabled={submitting}>
 {result ? 'Cerrar' : 'Cancelar'}
 </Button>
 {!result && stats.newCount > 0 && (
 <Button variant="primary" icon={CheckCircle2} loading={submitting} disabled={submitting} onClick={handleGenerate}>
 Generar {stats.newCount} {stats.newCount === 1 ? 'pago' : 'pagos'}
 </Button>
 )}
 </div>
 </footer>
 </div>
 </div>
 );
};

export default GenerateMonthModal;
