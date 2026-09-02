import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useEmployees } from '../../hooks/useEmployees';
import { useProjects } from '../../hooks/useProjects';
import { useClassifier } from '../../hooks/useClassifier';
import { useClassificationRules } from '../../hooks/useClassificationRules';
import { useToast } from '../../contexts/ToastContext';
import { rowButtonProps } from '../../utils/a11y';
import { formatCurrency } from '../../utils/formatters';
import { classificationCoverage, isClassified } from '../../finance/costScope';
import { isInternalTransfer, splitInternalTransfers } from '../../lib/finance/movementAmount';
import {
 COUNTERPARTY_KIND,
 classifyCounterparty,
 isHighConfidence,
} from '../../finance/counterpartyIdentity';
import CanonicalRecordModal from '../../components/finance/CanonicalRecordModal';
import { buildMovementEditRecord } from './movementRecordUtils';
import { filterMovements } from './movementFilters';
import {
 formatBulkResult,
 movementDestinationLabel,
 resolveProjectName,
} from './bulkClassification';
import {
 pageSelectionState,
 pruneSelection,
 selectableMovementIds,
 setPageSelection,
 toggleMovementSelection,
} from './movementSelection';
import BulkClassifyBar from './BulkClassifyBar';
import ClassificationCoverage from '../classifier/ClassificationCoverage';
import MovementDetailModal from '../../components/ui/MovementDetailModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import RuleFormModal from '../../components/ui/RuleFormModal';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const PAGE_SIZE = 50;

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const Movimientos = ({ user }) => {
 const { bankMovements, loading, updateBankMovement, bulkClassify } = useBankMovements(user);
 const { receivables } = useReceivables(user);
 const { payables } = usePayables(user);
 const { expenseCategories, incomeCategories, categoryOptions: allCategories } = useCategories(user);
 const { costCenters } = useCostCenters(user);
 const { employees } = useEmployees(user);
 const { projects } = useProjects(user);
 const { inboxMovements } = useClassifier(user);
 const { createRule } = useClassificationRules(user);
 const { showToast } = useToast();

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
 const [selectedIds, setSelectedIds] = useState([]);
 const [bulkSubmitting, setBulkSubmitting] = useState(false);

 const filtered = useMemo(
 () => filterMovements(bankMovements, { year, month, direction, statusFilter, searchQuery }),
 [bankMovements, year, month, direction, statusFilter, searchQuery],
 );

 const stats = useMemo(() => {
 const total = filtered.length;
 const inflows = filtered.filter((m) => m.direction === 'in');
 const outflows = filtered.filter((m) => m.direction === 'out');
 const inSum = inflows.reduce((s, m) => s + (Number(m.amount) || 0), 0);
 const outSum = outflows.reduce((s, m) => s + (Number(m.amount) || 0), 0);
 const classified = filtered.filter(isClassified).length;
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

 // Coverage is measured over the WHOLE ledger, so the number matches the
 // classifier inbox no matter which filters are active here.
 const coverage = useMemo(() => classificationCoverage(bankMovements), [bankMovements]);

 // Own-account transfers inside the current filter. The KPI totals above stay
 // BANK truth (they must reconcile with the rows on screen), so the amount that
 // every cost report leaves out is stated separately instead of silently
 // disappearing from a number the user can add up by hand.
 const internalTransfers = useMemo(
 () => splitInternalTransfers(filtered.filter((m) => m.status !== 'void')),
 [filtered],
 );

 // Nómina vs subcontratista, resolved from the counterparty name. Only the
 // visible page is classified — this runs per row and the ledger is thousands
 // of movements long.
 const personnelOf = useMemo(() => {
 const cache = new Map();
 return (counterpartyName) => {
 const key = String(counterpartyName || '');
 if (!cache.has(key)) cache.set(key, classifyCounterparty(key, employees));
 return cache.get(key);
 };
 }, [employees]);

 const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
 const safePage = Math.min(page, totalPages);
 const pageStart = (safePage - 1) * PAGE_SIZE;
 const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

 // A filter change can hide selected rows; never bulk-write what the user
 // can no longer see. Void movements are cancelled and never selectable, so
 // filtering to "Anulados" and selecting the page writes nothing.
 const selectableIds = useMemo(() => selectableMovementIds(filtered), [filtered]);
 const activeSelection = useMemo(
 () => pruneSelection(selectedIds, selectableIds),
 [selectedIds, selectableIds],
 );
 const selectionSet = useMemo(() => new Set(activeSelection), [activeSelection]);
 const selectedMovements = useMemo(
 () => filtered.filter((m) => selectionSet.has(m.id)),
 [filtered, selectionSet],
 );
 const pageIds = useMemo(() => selectableMovementIds(pageRows), [pageRows]);
 const headerSelection = pageSelectionState(activeSelection, pageIds);

 const toggleRow = (id) => setSelectedIds((current) => toggleMovementSelection(current, id));
 const togglePage = (selected) =>
 setSelectedIds((current) => setPageSelection(current, pageIds, selected));

 const handleBulkApply = async (payload) => {
 if (activeSelection.length === 0) return { success: false };
 setBulkSubmitting(true);
 const result = await bulkClassify(activeSelection, payload);
 setBulkSubmitting(false);
 const { message, tone } = formatBulkResult(result);
 showToast(message, tone);
 if (result?.success) setSelectedIds([]);
 return result;
 };

 const executeMovementEdit = async (formData) => {
 if (!editingMovement) return false;

 setSubmittingMovementEdit(true);
 try {
 const result = await updateBankMovement(editingMovement.id, {
 ...formData,
 amount: Number(formData.amount) || 0,
 projectName: resolveProjectName(projects, formData.projectId),
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
 Historial completo de movimientos bancarios (DATEV + recurrentes generadas + manuales).
 Filtros por año/mes, dirección y estado de clasificación.
 </p>
 </div>
 </header>

 <ClassificationCoverage
 coverage={coverage}
 action={
 <Button
 variant="secondary"
 size="sm"
 icon={Filter}
 onClick={() => resetFilter(() => setStatusFilter('unclassified'))}
 >
 Ver sin clasificar
 </Button>
 }
 />

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

 {internalTransfers.internalTransfers.length > 0 && (
 <section
 data-testid="internal-transfer-note"
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-5 py-4"
 >
 <p className="label-mono text-[var(--color-fg-4)]">Transferencias internas</p>
 <p className="mt-2 max-w-4xl text-[13px] leading-6 text-[var(--color-fg-3)]">
 {internalTransfers.internalTransfers.length} movimiento(s) por{' '}
 <span className="text-[var(--color-fg-1)]">{formatCurrency(internalTransfers.excludedTotal)}</span>{' '}
 son traspasos <span className="text-[var(--color-fg-1)]">entre cuentas propias</span> de UMTELKOMD
 GmbH. No necesitan categoría ni proyecto: mover tu propio dinero no es ingreso ni gasto, así que
 quedan fuera del P&amp;L, del desglose por categoría y del presupuesto. La caja sí los cuenta —
 el dinero salió y entró del banco de verdad.
 </p>
 <p className="mt-2 max-w-4xl text-[12px] leading-6 text-[var(--color-fg-4)]">
 <span className="text-[var(--color-fg-3)]">UMTELKOMD ESPAÑA S.L.</span> es un subcontratista
 distinto con nombre casi idéntico: sus pagos son coste real de obra y siguen exigiendo categoría y
 proyecto.
 </p>
 </section>
 )}

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

 {activeSelection.length > 0 && (
 <BulkClassifyBar
 selectedMovements={selectedMovements}
 categories={allCategories}
 costCenters={costCenters || []}
 projects={projects || []}
 onApply={handleBulkApply}
 onClear={() => setSelectedIds([])}
 submitting={bulkSubmitting}
 />
 )}

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
 <th className="w-8 text-center">
 <SelectAllCheckbox
 state={headerSelection}
 onChange={togglePage}
 disabled={bulkSubmitting}
 />
 </th>
 <th>Fecha</th>
 <th>Concepto</th>
 <th>Contraparte</th>
 <th>Categoría</th>
 <th>CC</th>
 <th>Proyecto</th>
 <th>Destino</th>
 <th className="text-right">Monto</th>
 <th className="text-center">Estado</th>
 <th className="text-right">Acciones</th>
 </tr>
 </thead>
 <tbody>
 {pageRows.map((m) => {
 const isIn = m.direction === 'in';
 const isReconciled = !!(m.receivableId || m.payableId);
 const classified = isClassified(m);
 const isVoid = m.status === 'void';
 const isTransfer = !isVoid && isInternalTransfer(m);
 const isRecurring = !!m.recurringCostId;
 const destination = movementDestinationLabel(m);
 return (
  <tr key={m.id} {...rowButtonProps(() => setDetailMovement(m))}>
 <td className="text-center" onClick={(e) => e.stopPropagation()}>
 <input
 type="checkbox"
 className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
 checked={selectionSet.has(m.id)}
 disabled={bulkSubmitting || isVoid}
 onChange={() => toggleRow(m.id)}
 aria-label={
 isVoid
 ? `Movimiento anulado, no seleccionable: ${m.description || m.id}`
 : `Seleccionar movimiento ${m.description || m.id}`
 }
 />
 </td>
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
 <td className="text-[var(--color-fg-3)] max-w-[180px]">
 <span className="block truncate">{m.counterpartyName || '—'}</span>
 <PersonnelBadge personnel={personnelOf(m.counterpartyName)} />
 </td>
 <td className="text-[var(--color-fg-3)]">{m.categoryName || <span className="text-[var(--color-fg-4)]">—</span>}</td>
 <td className="text-[var(--color-fg-3)] font-mono text-[12px]">{m.costCenterId || <span className="text-[var(--color-fg-4)]">—</span>}</td>
 <td className="text-[var(--color-fg-3)] truncate max-w-[140px]">{m.projectName || m.projectId || <span className="text-[var(--color-fg-4)]">—</span>}</td>
 <td className={destination === '—' ? 'text-[var(--color-fg-4)]' : 'text-[var(--color-fg-3)]'}>{destination}</td>
 <td className={`text-right font-mono tabular-nums ${isIn ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'}`}>
 {isIn ? '+' : '-'}{formatCurrency(m.amount)}
 </td>
 <td className="text-center">
 {isVoid ? (
 <Badge variant="err" dot>Anulado</Badge>
 ) : isTransfer ? (
 <Badge
 variant="neutral"
 dot
 title="Traspaso entre cuentas propias de UMTELKOMD — no es ingreso ni gasto y no necesita categoría ni proyecto"
 >
 Transferencia interna
 </Badge>
 ) : isReconciled ? (
 <Badge variant="ok" dot>Conciliado</Badge>
 ) : classified ? (
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

/**
 * Is this counterparty company payroll or a subcontractor?
 *
 * The difference is not cosmetic: payroll is already charged to the obras by the
 * payroll allocation, so its bank transfer must not be charged again, while a
 * subcontractor payment IS the obra cost. A trailing "?" means the bank name only
 * probably belongs to that person — an alias on the employee settles it.
 */
const PersonnelBadge = ({ personnel }) => {
 if (!personnel || personnel.kind === COUNTERPARTY_KIND.UNKNOWN) return null;

 const isPayroll = personnel.kind === COUNTERPARTY_KIND.PAYROLL;
 const certain = isHighConfidence(personnel.confidence);
 const label = `${isPayroll ? 'Nómina' : 'Subcontratista'}${certain ? '' : '?'}`;

 return (
 <Badge
 variant={certain ? (isPayroll ? 'info' : 'warn') : 'neutral'}
 className="mt-1"
 title={
 certain
 ? `${personnel.employee?.fullName} · ${isPayroll ? 'nómina de empresa' : 'subcontratista'}`
 : `Posible ${personnel.employee?.fullName} — añadí el nombre exacto del banco como alias en su ficha`
 }
 >
 {label}
 </Badge>
 );
};

/**
 * Header checkbox for the current page. `indeterminate` is a DOM property,
 * not an attribute, so it has to be set imperatively.
 */
const SelectAllCheckbox = ({ state, onChange, disabled }) => {
 const ref = useRef(null);

 useEffect(() => {
 if (ref.current) ref.current.indeterminate = state === 'partial';
 }, [state]);

 return (
 <input
 ref={ref}
 type="checkbox"
 className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent)]"
 checked={state === 'all'}
 disabled={disabled}
 onChange={(e) => onChange(e.target.checked)}
 aria-label="Seleccionar todos los movimientos de la página"
 />
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
