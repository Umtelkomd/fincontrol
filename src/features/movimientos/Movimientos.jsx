import { useState, useMemo } from 'react';
import {
 Search,
 ArrowUpRight,
 ArrowDownRight,
 Database,
 Repeat,
 Pencil,
 Eye,
 ChevronLeft,
 ChevronRight,
 Filter,
 Wand2,
} from 'lucide-react';
import { useBankMovements } from '../../hooks/useBankMovements';
import { useReceivables } from '../../hooks/useReceivables';
import { usePayables } from '../../hooks/usePayables';
import { useCategories } from '../../hooks/useCategories';
import { useCostCenters } from '../../hooks/useCostCenters';
import { useProjects } from '../../hooks/useProjects';
import { useClassifier } from '../../hooks/useClassifier';
import { useClassificationRules } from '../../hooks/useClassificationRules';
import { useToast } from '../../contexts/ToastContext';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency } from '../../utils/formatters';
import CanonicalRecordModal from '../../components/finance/CanonicalRecordModal';
import MovementDetailModal from '../../components/ui/MovementDetailModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import RuleFormModal from '../../components/ui/RuleFormModal';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const PAGE_SIZE = 50;

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const buildMovementEditRecord = (movement) => {
 if (!movement) return null;
 return {
 ...movement,
 id: `movement:${movement.id}`,
 entityId: movement.id,
 rawRecord: movement,
 recordFamily: 'movement',
 recordFamilyLabel: 'Banco',
 date: movement.postedDate || movement.valueDate,
 amount: Number(movement.amount) || 0,
 categoryLabel: movement.categoryName || movement.kind || 'Movimiento bancario',
 canEdit: movement.status !== 'void',
 };
};

const Movimientos = ({ user }) => {
 const { bankMovements, loading, updateBankMovement } = useBankMovements(user);
 const { receivables } = useReceivables(user);
 const { payables } = usePayables(user);
 const { expenseCategories, incomeCategories } = useCategories(user);
 const { costCenters } = useCostCenters(user);
 const { projects } = useProjects(user);
 const { inboxMovements } = useClassifier(user);
 const { createRule } = useClassificationRules(user);
 const { showToast } = useToast();

 const allCategories = useMemo(
 () => [
 ...(incomeCategories || []).map((name) => ({ name, type: 'income' })),
 ...(expenseCategories || []).map((name) => ({ name, type: 'expense' })),
 ],
 [incomeCategories, expenseCategories],
 );

 // ─── Filters ───
 const allYears = useMemo(() => {
 const set = new Set();
 (bankMovements || []).forEach((m) => {
 const y = (m.postedDate || '').slice(0, 4);
 if (y) set.add(y);
 });
 return [...set].sort().reverse();
 }, [bankMovements]);

 const [year, setYear] = useState('all');
 const [month, setMonth] = useState('all'); // 'all' | '1'..'12'
 const [direction, setDirection] = useState('all'); // all | in | out
 const [statusFilter, setStatusFilter] = useState('all'); // all | classified | unclassified | reconciled | void
 const [searchQuery, setSearchQuery] = useState('');
 const [page, setPage] = useState(1);
 const [detailMovement, setDetailMovement] = useState(null);
 const [editingMovement, setEditingMovement] = useState(null);
 const [pendingEditConfirmation, setPendingEditConfirmation] = useState(null);
 const [submittingMovementEdit, setSubmittingMovementEdit] = useState(false);
 const [ruleSeedMovement, setRuleSeedMovement] = useState(null);

 const filtered = useMemo(() => {
 const q = searchQuery.trim().toLowerCase();
 return (bankMovements || []).filter((m) => {
 if (year !== 'all') {
 if (!(m.postedDate || '').startsWith(year)) return false;
 }
 if (month !== 'all') {
 const mm = (m.postedDate || '').slice(5, 7);
 if (mm !== String(month).padStart(2, '0')) return false;
 }
 if (direction !== 'all' && m.direction !== direction) return false;

 const isClassified = !!(m.categoryName || m.costCenterId || m.projectId);
 const isReconciled = !!(m.receivableId || m.payableId);
 const isVoid = m.status === 'void';

 if (statusFilter === 'classified' && !isClassified) return false;
 if (statusFilter === 'unclassified' && isClassified) return false;
 if (statusFilter === 'reconciled' && !isReconciled) return false;
 if (statusFilter === 'void' && !isVoid) return false;
 if (statusFilter !== 'void' && isVoid) return false;

 if (q) {
 const haystack = [
 m.description,
 m.counterpartyName,
 m.categoryName,
 m.projectName,
 String(m.amount || ''),
 ].join(' ').toLowerCase();
 if (!haystack.includes(q)) return false;
 }
 return true;
 }).sort((a, b) => (b.postedDate || '').localeCompare(a.postedDate || ''));
 }, [bankMovements, year, month, direction, statusFilter, searchQuery]);

 const stats = useMemo(() => {
 const total = filtered.length;
 const inflows = filtered.filter((m) => m.direction === 'in');
 const outflows = filtered.filter((m) => m.direction === 'out');
 const inSum = inflows.reduce((s, m) => s + (Number(m.amount) || 0), 0);
 const outSum = outflows.reduce((s, m) => s + (Number(m.amount) || 0), 0);
 const classified = filtered.filter((m) => !!(m.categoryName || m.costCenterId || m.projectId)).length;
 const reconciled = filtered.filter((m) => !!(m.receivableId || m.payableId)).length;
 return {
 total,
 inflows: inflows.length,
 outflows: outflows.length,
 inSum,
 outSum,
 net: inSum - outSum,
 classified,
 reconciled,
 };
 }, [filtered]);

 const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
 const safePage = Math.min(page, totalPages);
 const pageStart = (safePage - 1) * PAGE_SIZE;
 const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

 const resolveProjectName = (projectId) => {
 const project = projects.find((entry) => entry.id === projectId);
 return project?.name || project?.displayName || project?.code || projectId || '';
 };

 const executeMovementEdit = async (formData) => {
 if (!editingMovement) return false;

 setSubmittingMovementEdit(true);
 try {
 const result = await updateBankMovement(editingMovement.id, {
 ...formData,
 amount: Number(formData.amount) || 0,
 projectName: resolveProjectName(formData.projectId),
 });
 if (!result?.success) {
 throw result?.error || new Error('No se pudo actualizar el movimiento');
 }
 showToast('Movimiento actualizado', 'success');
 setEditingMovement(null);
 return true;
 } catch (error) {
 showToast(error.message || 'No se pudo actualizar el movimiento', 'error');
 return false;
 } finally {
 setSubmittingMovementEdit(false);
 }
 };

 const handleEditMovementSubmit = async (formData) => {
 if (!editingMovement) return false;

 const currentAmount = Number(editingMovement.amount) || 0;
 const nextAmount = Number(formData.amount) || 0;
 if (Math.abs(currentAmount - nextAmount) >= 0.01) {
 setPendingEditConfirmation({
 formData,
 currentAmount,
 nextAmount,
 delta: nextAmount - currentAmount,
 movement: editingMovement,
 });
 return false;
 }

 return executeMovementEdit(formData);
 };

 const confirmMovementAmountEdit = async () => {
 if (!pendingEditConfirmation) return false;
 const success = await executeMovementEdit(pendingEditConfirmation.formData);
 if (success) {
 setPendingEditConfirmation(null);
 }
 return success;
 };

 const handleCreateRule = async (data) => {
 const r = await createRule(data);
 if (r.success) showToast('Regla creada', 'success');
 return r;
 };

 const findReceivable = (m) =>
 m.receivableId ? receivables.find((r) => r.id === m.receivableId) : null;
 const findPayable = (m) =>
 m.payableId ? payables.find((p) => p.id === m.payableId) : null;

 // Reset page when filters change
 const resetFilter = (fn) => {
 fn();
 setPage(1);
 };

 return (
 <div className="space-y-6 pb-12">
 <header className="flex items-end justify-between gap-4 flex-wrap">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">Banco · Movimientos</p>
 <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
 Revisión de movimientos
 </h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
 Historial completo de bankMovements (DATEV + recurrentes generadas + manuales).
 Filtros por año/mes, dirección y estado de clasificación.
 </p>
 </div>
 </header>

 <KPIGrid cols={4}>
 <KPI label="Total filtrado" value={stats.total} meta={`${stats.classified} clasificados`} icon={Database} />
 <KPI
 label="Ingresos"
 value={formatCurrency(stats.inSum)}
 meta={`${stats.inflows} movimientos`}
 tone="ok"
 icon={ArrowUpRight}
 />
 <KPI
 label="Salidas"
 value={formatCurrency(stats.outSum)}
 meta={`${stats.outflows} movimientos`}
 tone="warn"
 icon={ArrowDownRight}
 />
 <KPI
 label="Neto"
 value={formatCurrency(stats.net)}
 meta={`${stats.reconciled} conciliados con CXC/CXP`}
 tone={stats.net >= 0 ? 'ok' : 'err'}
 />
 </KPIGrid>

 {/* ─── Filters Bar ─── */}
 <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-4 py-3 flex flex-wrap items-end gap-3">
 <FilterSelect
 label="Año"
 value={year}
 onChange={(v) => resetFilter(() => setYear(v))}
 options={[{ value: 'all', label: 'Todos' }, ...allYears.map((y) => ({ value: y, label: y }))]}
 />
 <FilterSelect
 label="Mes"
 value={month}
 onChange={(v) => resetFilter(() => setMonth(v))}
 options={[
 { value: 'all', label: 'Todos' },
 ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
 ]}
 />
 <FilterSelect
 label="Dirección"
 value={direction}
 onChange={(v) => resetFilter(() => setDirection(v))}
 options={[
 { value: 'all', label: 'Todas' },
 { value: 'in', label: 'Entradas' },
 { value: 'out', label: 'Salidas' },
 ]}
 />
 <FilterSelect
 label="Estado"
 value={statusFilter}
 onChange={(v) => resetFilter(() => setStatusFilter(v))}
 options={[
 { value: 'all', label: 'Todos (no anulados)' },
 { value: 'classified', label: 'Clasificados' },
 { value: 'unclassified', label: 'Sin clasificar' },
 { value: 'reconciled', label: 'Conciliados' },
 { value: 'void', label: 'Anulados' },
 ]}
 />
 <div className="relative ml-auto">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" size={14} />
 <input
 type="text"
 placeholder="Buscar..."
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-1.5 pl-8 pr-3 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)] w-48"
 value={searchQuery}
 onChange={(e) => resetFilter(() => setSearchQuery(e.target.value))}
 />
 </div>
 </div>

 {/* ─── Table ─── */}
 <Panel
 title="Movimientos"
 meta={
 totalPages > 1
 ? `${pageRows.length} de ${filtered.length} (página ${safePage}/${totalPages})`
 : `${filtered.length} resultado(s)`
 }
 padding={false}
 >
 {loading ? (
 <div className="px-4 py-12 text-center"><p className="label-mono">Cargando...</p></div>
 ) : filtered.length === 0 ? (
 <EmptyState
 icon={Filter}
 title="Sin resultados"
 description="Ajustá los filtros o el rango de búsqueda."
 />
 ) : (
 <>
 <div className="overflow-x-auto">
 <table className="nx-table w-full">
 <thead>
 <tr>
 <th>Fecha</th>
 <th>Concepto</th>
 <th>Contraparte</th>
 <th>Categoría</th>
 <th>CC</th>
 <th>Proyecto</th>
 <th className="text-right">Monto</th>
 <th className="text-center">Estado</th>
 <th className="text-right">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {pageRows.map((m) => {
 const isIn = m.direction === 'in';
 const isReconciled = !!(m.receivableId || m.payableId);
 const isClassified = !!(m.categoryName || m.costCenterId || m.projectId);
 const isVoid = m.status === 'void';
 const isRecurring = !!m.recurringCostId;
 return (
  <tr key={m.id} {...rowButtonProps(() => setDetailMovement(m))}>
 <td className="font-mono text-[var(--color-fg-3)] whitespace-nowrap">{m.postedDate}</td>
 <td>
 <div className="flex items-start gap-2">
 {isIn ? (
 <ArrowUpRight size={14} className="flex-shrink-0 mt-0.5 text-[var(--color-ok)]" />
 ) : (
 <ArrowDownRight size={14} className="flex-shrink-0 mt-0.5 text-[var(--color-accent)]" />
 )}
 <div className="min-w-0">
 <p className="text-[13px] text-[var(--color-fg-1)] truncate max-w-[280px]">{m.description || '—'}</p>
 {isRecurring && (
 <p className="font-mono text-[10px] text-[var(--color-fg-4)] flex items-center gap-1 mt-0.5">
 <Repeat size={10} /> {m.recurringPeriod || 'recurrente'}
 </p>
 )}
 </div>
 </div>
 </td>
 <td className="text-[var(--color-fg-3)] truncate max-w-[180px]">{m.counterpartyName || '—'}</td>
 <td className="text-[var(--color-fg-3)]">{m.categoryName || <span className="text-[var(--color-fg-4)]">—</span>}</td>
 <td className="text-[var(--color-fg-3)] font-mono text-[12px]">{m.costCenterId || <span className="text-[var(--color-fg-4)]">—</span>}</td>
 <td className="text-[var(--color-fg-3)] truncate max-w-[140px]">{m.projectName || m.projectId || <span className="text-[var(--color-fg-4)]">—</span>}</td>
 <td className={`text-right font-mono tabular-nums ${isIn ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 {isIn ? '+' : '-'}{formatCurrency(m.amount)}
 </td>
 <td className="text-center">
 {isVoid ? (
 <Badge variant="err" dot>Anulado</Badge>
 ) : isReconciled ? (
 <Badge variant="ok" dot>Conciliado</Badge>
 ) : isClassified ? (
 <Badge variant="info" dot>Clasificado</Badge>
 ) : (
 <Badge variant="warn" dot>Sin clasificar</Badge>
 )}
 </td>
 <td className="text-right" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-end gap-1.5">
 <Button variant="ghost" size="sm" icon={Eye} onClick={() => setDetailMovement(m)}>
 Ver
 </Button>
 <Button
 variant="ghost"
 size="sm"
 icon={Pencil}
 disabled={isVoid}
 onClick={() => setEditingMovement(m)}
 >
 Editar
 </Button>
 <Button
 variant="ghost"
 size="sm"
 icon={Wand2}
 onClick={() => setRuleSeedMovement(m)}
 title="Crear regla desde este movimiento"
 >
 Regla
 </Button>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>

 {/* Pagination */}
 {totalPages > 1 && (
 <div className="px-4 py-3 border-t border-[var(--color-line)] flex items-center justify-between gap-3">
 <p className="text-[12px] text-[var(--color-fg-4)]">
 Mostrando {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} de {filtered.length}
 </p>
 <div className="flex items-center gap-2">
 <Button
 variant="ghost"
 size="sm"
 icon={ChevronLeft}
 disabled={safePage === 1}
 onClick={() => setPage((p) => Math.max(1, p - 1))}
 >
 Anterior
 </Button>
 <span className="font-mono text-[12px] text-[var(--color-fg-3)] min-w-[72px] text-center">
 {safePage} / {totalPages}
 </span>
 <Button
 variant="ghost"
 size="sm"
 iconRight={ChevronRight}
 disabled={safePage === totalPages}
 onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
 >
 Siguiente
 </Button>
 </div>
 </div>
 )}
 </>
 )}
 </Panel>

 <MovementDetailModal
 isOpen={Boolean(detailMovement)}
 onClose={() => setDetailMovement(null)}
 movement={detailMovement}
 receivable={detailMovement ? findReceivable(detailMovement) : null}
 payable={detailMovement ? findPayable(detailMovement) : null}
 onEdit={() => {
 setEditingMovement(detailMovement);
 setDetailMovement(null);
 }}
 />

 <CanonicalRecordModal
 key={editingMovement?.id || 'movement-editor'}
 isOpen={Boolean(editingMovement)}
 onClose={() => {
 setEditingMovement(null);
 setPendingEditConfirmation(null);
 }}
 record={buildMovementEditRecord(editingMovement)}
 onSubmit={handleEditMovementSubmit}
 categories={[...(incomeCategories || []), ...(expenseCategories || [])]}
 costCenters={costCenters || []}
 projects={projects || []}
 submitting={submittingMovementEdit}
 />

 <ConfirmModal
 isOpen={Boolean(pendingEditConfirmation)}
 onClose={() => setPendingEditConfirmation(null)}
 onConfirm={confirmMovementAmountEdit}
 title="Confirmar cambio de importe"
 message={`Vas a modificar el importe de "${pendingEditConfirmation?.movement?.description || 'este movimiento'}". Revisa el cambio antes de guardarlo.`}
 confirmText="Guardar importe"
 cancelText="Revisar"
 variant="warning"
 details={[
 { label: 'Movimiento', value: pendingEditConfirmation?.movement?.description || '—', emphasis: true },
 { label: 'Importe actual', value: pendingEditConfirmation ? `€${pendingEditConfirmation.currentAmount.toFixed(2)}` : '—' },
 { label: 'Importe nuevo', value: pendingEditConfirmation ? `€${pendingEditConfirmation.nextAmount.toFixed(2)}` : '—', emphasis: true },
 {
 label: 'Variación',
 value: pendingEditConfirmation
 ? `${pendingEditConfirmation.delta >= 0 ? '+' : '-'}€${Math.abs(pendingEditConfirmation.delta).toFixed(2)}`
 : '—',
 },
 ]}
 warning="Este cambio afecta la caja y puede impactar conciliaciones o reportes."
 confirmKeyword="IMPORTE"
 confirmKeywordLabel="Confirmación de importe"
 confirmKeywordPlaceholder="IMPORTE"
 />

 <RuleFormModal
 isOpen={Boolean(ruleSeedMovement)}
 onClose={() => setRuleSeedMovement(null)}
 onSubmit={handleCreateRule}
 seedMovement={ruleSeedMovement}
 categories={allCategories}
 costCenters={costCenters || []}
 projects={projects || []}
 pendingMovements={inboxMovements}
 />
 </div>
 );
};

const FilterSelect = ({ label, value, onChange, options }) => (
 <label className="block">
 <span className="mb-1 block label-mono text-[var(--color-fg-4)]">{label}</span>
 <select
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-1.5 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={value}
 onChange={(e) => onChange(e.target.value)}
 >
 {options.map((o) => (
 <option key={String(o.value)} value={o.value}>{o.label}</option>
 ))}
 </select>
 </label>
);

export default Movimientos;
