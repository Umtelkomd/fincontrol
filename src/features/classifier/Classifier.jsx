import { useMemo, useState } from 'react';
import {
 Inbox,
 Link2,
 Tag,
 HardHat,
 ArrowDownRight,
 ArrowUpRight,
 CheckCircle2,
 Search,
 Wand2,
 PlayCircle,
} from 'lucide-react';
import { useClassifier } from '../../hooks/useClassifier';
import { useCategories } from '../../hooks/useCategories';
import { useCostCenters } from '../../hooks/useCostCenters';
import { useEmployees } from '../../hooks/useEmployees';
import { useProjects } from '../../hooks/useProjects';
import { useClassificationRules } from '../../hooks/useClassificationRules';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency } from '../../utils/formatters';
import { findBestRule } from '../../finance/ruleEngine';
import { COST_SCOPE } from '../../finance/costScope';
import { OPERATIONAL_DATA_START } from '../../finance/constants';
import { COUNTERPARTY_KIND, suggestClassification } from '../../finance/counterpartyIdentity';
import CategorizeModal from '../../components/ui/CategorizeModal';
import RuleFormModal from '../../components/ui/RuleFormModal';
import PageHeader from '../../components/layout/PageHeader';
import ClassificationCoverage from './ClassificationCoverage';
import { groupByCounterparty } from './lib/groupByCounterparty';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const OPERATIONAL_YEAR = OPERATIONAL_DATA_START.slice(0, 4);

const TABS = [
 { key: 'sinCategoria', label: 'Sin categoría', icon: Tag },
 { key: 'sinObra', label: 'Sin obra', icon: HardHat },
 { key: 'sinConciliar', label: 'Sin conciliar', icon: Link2 },
];

const EMPTY_COPY = {
 sinCategoria: {
 title: 'Sin pendientes de categoría',
 description: 'Todos los movimientos del periodo tienen categoría.',
 },
 sinObra: {
 title: 'Sin pendientes de obra',
 description: 'Todos los gastos de obra del periodo tienen su proyecto asignado.',
 },
 sinConciliar: {
 title: 'Sin pendientes de conciliación',
 description: 'Todos los cobros de obra del periodo están vinculados a una CXC.',
 },
};

const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** 'YYYY-MM' → 'Sep 2026'. */
const monthLabel = (key) => {
 const [year, month] = String(key || '').split('-');
 const name = SHORT_MONTHS[Number(month) - 1];
 return name ? `${name} ${year}` : key;
};

const matchesSearch = (movement, query) =>
 (movement.description || '').toLowerCase().includes(query) ||
 (movement.counterpartyName || '').toLowerCase().includes(query) ||
 String(movement.amount || '').includes(query);

const Classifier = ({ user }) => {
 const [month, setMonth] = useState('all');
 const {
 inboxMovements,
 pendingMovements,
 availableMonths,
 coverage,
 loading,
 linkToReceivable,
 linkToPayable,
 categorize,
 suggestMatches,
 bulkClassify,
 } = useClassifier(user, { month });

 const { categoryOptions: allCategories } = useCategories(user);
 const { costCenters } = useCostCenters(user);
 const { employees } = useEmployees(user);
 const { projects } = useProjects(user);
 const { rules, createRule, applyRulesToMovements } = useClassificationRules(user);
 const { showToast } = useToast();

 const [activeTab, setActiveTab] = useState('sinCategoria');
 const [searchQuery, setSearchQuery] = useState('');
 const [categorizingMovement, setCategorizingMovement] = useState(null);
 const [ruleSeedMovement, setRuleSeedMovement] = useState(null);
 const [busyId, setBusyId] = useState(null);
 const [applyingAll, setApplyingAll] = useState(false);
 // Project chosen per counterparty group in the "Sin obra" tab.
 const [groupProject, setGroupProject] = useState({});

 const ruleHitCount = useMemo(
 () => pendingMovements.reduce((sum, m) => (findBestRule(m, rules) ? sum + 1 : sum), 0),
 [pendingMovements, rules],
 );

 const activeProjects = useMemo(
 () => (projects || []).filter((p) => p.status !== 'inactive' && p.active !== false),
 [projects],
 );

 // "Jeisson, Juan de Dios son nómina de empresa no subcontratistas." The bank
 // only writes a free-text name; the employee master knows which is which. The
 // row resolves the two and says it out loud, because telling them apart at a
 // glance is the whole point.
 const personnelOf = useMemo(() => {
 const cache = new Map();
 return (movement) => {
 if (!cache.has(movement.id)) cache.set(movement.id, suggestClassification(movement, employees));
 return cache.get(movement.id);
 };
 }, [employees]);

 const query = searchQuery.trim().toLowerCase();
 const filterBySearch = (items) => (query ? items.filter((m) => matchesSearch(m, query)) : items);

 const sinCategoria = filterBySearch(inboxMovements.sinCategoria);
 const sinConciliar = filterBySearch(inboxMovements.sinConciliar);
 const sinObraGroups = useMemo(
 () => groupByCounterparty(query ? inboxMovements.sinObra.filter((m) => matchesSearch(m, query)) : inboxMovements.sinObra),
 [inboxMovements.sinObra, query],
 );

 const stats = {
 total: pendingMovements.length,
 sinCategoria: inboxMovements.sinCategoria.length,
 sinObra: inboxMovements.sinObra.length,
 sinConciliar: inboxMovements.sinConciliar.length,
 };

 const handleLink = async (movement, item) => {
 setBusyId(movement.id);
 const r = movement.direction === 'in'
 ? await linkToReceivable(movement, item)
 : await linkToPayable(movement, item);
 setBusyId(null);
 if (r.success) {
 const label = movement.direction === 'in' ? 'CXC' : 'CXP';
 showToast(
 r.status === 'settled' ? `Conciliado y ${label} liquidada` : 'Conciliación parcial registrada',
 'success',
 );
 } else {
 showToast(r.error?.message || 'Error al conciliar', 'error');
 }
 };

 const handleCategorize = async (classification) => {
 if (!categorizingMovement) return { success: false };
 setBusyId(categorizingMovement.id);
 const r = await categorize(categorizingMovement, classification);
 setBusyId(null);
 if (r.success) showToast('Movimiento categorizado', 'success');
 else showToast(r.error?.message || 'Error al guardar', 'error');
 return r;
 };

 const handleCreateRule = async (data) => {
 const r = await createRule(data);
 if (r.success) showToast('Regla creada — los próximos imports se autoclasifican', 'success');
 return r;
 };

 const handleApplyAllRules = async () => {
 if (ruleHitCount === 0) {
 showToast('Ninguna regla coincide con la bandeja actual', 'info');
 return;
 }
 setApplyingAll(true);
 const result = await applyRulesToMovements(pendingMovements);
 setApplyingAll(false);
 if (result.applied > 0) {
 showToast(`${result.applied} movimiento(s) clasificados automáticamente`, 'success');
 } else if (result.errors.length > 0) {
 showToast(`Errores aplicando reglas: ${result.errors.length}`, 'error');
 } else {
 showToast('Sin cambios — los matches ya estaban clasificados', 'info');
 }
 };

 // The 30-minute job: one project for a whole counterparty group (or one row),
 // written through the ledger's chunked bulkClassify — never one write per row.
 const handleAssignProject = async (ids, projectId, busyKey) => {
 const project = activeProjects.find((p) => p.id === projectId);
 if (!project || !bulkClassify) return;
 setBusyId(busyKey);
 const r = await bulkClassify(ids, {
 projectId: project.id,
 projectName: project.name,
 costScope: COST_SCOPE.PROJECT,
 });
 setBusyId(null);
 if (r.success) showToast(`${r.updated} movimiento(s) asignados a ${project.name}`, 'success');
 else showToast(r.error?.message || 'No se pudo asignar la obra', 'error');
 };

 const periodLabel = month === 'all' ? OPERATIONAL_YEAR : monthLabel(month);

 return (
 <div className="space-y-6 pb-12">
 <PageHeader
 section="Bandeja"
 title="Clasificar"
 accent="movimientos"
 subtitle={loading ? periodLabel : `${periodLabel} · ${stats.total} pendientes`}
 actions={
 !loading && ruleHitCount > 0 ? (
 <Button
 variant="primary"
 icon={PlayCircle}
 loading={applyingAll}
 disabled={applyingAll}
 onClick={handleApplyAllRules}
 >
 Aplicar reglas ({ruleHitCount})
 </Button>
 ) : null
 }
 />

 {loading ? (
 <div className="flex items-center justify-center py-28">
 <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
 </div>
 ) : (
 <>
 <ClassificationCoverage coverage={coverage} title={`Cobertura de clasificación · ${periodLabel}`} />

 <KPIGrid cols={4}>
 <KPI
 label={`Pendientes ${OPERATIONAL_YEAR}`}
 value={stats.total}
 meta={stats.total === 0 ? '✓ Bandeja al día' : 'Necesitan acción'}
 tone={stats.total === 0 ? 'ok' : 'warn'}
 icon={Inbox}
 />
 <KPI
 label="Sin categoría"
 value={stats.sinCategoria}
 meta="Categorizar o vincular"
 tone={stats.sinCategoria > 0 ? 'warn' : 'ok'}
 icon={Tag}
 />
 <KPI
 label="Sin obra"
 value={stats.sinObra}
 meta="Gasto de obra sin proyecto"
 tone={stats.sinObra > 0 ? 'warn' : 'ok'}
 icon={HardHat}
 />
 <KPI
 label="Sin conciliar"
 value={stats.sinConciliar}
 meta="Cobro de obra sin CXC"
 tone={stats.sinConciliar > 0 ? 'warn' : 'ok'}
 icon={Link2}
 />
 </KPIGrid>

 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="nx-tabs mb-0 overflow-x-auto" role="tablist">
 {TABS.map((t) => {
 const Icon = t.icon;
 return (
 <button
 key={t.key}
 type="button"
 role="tab"
 aria-selected={activeTab === t.key}
 onClick={() => setActiveTab(t.key)}
 className={`nx-tab ${activeTab === t.key ? 'active' : ''}`}
 >
 <Icon size={12} />
 {t.label}
 <Badge variant="neutral">{stats[t.key]}</Badge>
 </button>
 );
 })}
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <label className="flex items-center gap-2">
 <span className="label-mono text-[var(--color-fg-3)]">Mes</span>
 <select
 aria-label="Mes"
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-1.5 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={month}
 onChange={(e) => setMonth(e.target.value)}
 >
 <option value="all">Todos {OPERATIONAL_YEAR}</option>
 {availableMonths.map((key) => (
 <option key={key} value={key}>{monthLabel(key)}</option>
 ))}
 </select>
 </label>
 <div className="relative">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]" size={14} />
 <input
 type="text"
 placeholder="Buscar..."
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-1.5 pl-8 pr-3 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 />
 </div>
 </div>
 </div>

 {/* SIN CATEGORÍA */}
 {activeTab === 'sinCategoria' && (
 <Panel title="Sin categoría" meta={`${sinCategoria.length} resultado(s)`} padding={false}>
 {sinCategoria.length === 0 ? (
 <EmptyState icon={CheckCircle2} {...EMPTY_COPY.sinCategoria} />
 ) : (
 <div className="divide-y divide-[var(--color-line)]">
 {sinCategoria.map((m) => (
 <MovementRow
 key={m.id}
 movement={m}
 matches={suggestMatches(m)}
 personnel={personnelOf(m)}
 busy={busyId === m.id}
 onLink={(item) => handleLink(m, item)}
 onCategorize={() => setCategorizingMovement(m)}
 onCreateRule={() => setRuleSeedMovement(m)}
 />
 ))}
 </div>
 )}
 </Panel>
 )}

 {/* SIN OBRA — grouped by counterparty, one project per group */}
 {activeTab === 'sinObra' && (
 <Panel
 title="Sin obra"
 meta={`${sinObraGroups.length} contraparte(s) · ${sinObraGroups.reduce((n, g) => n + g.count, 0)} movimiento(s)`}
 padding={false}
 >
 {sinObraGroups.length === 0 ? (
 <EmptyState icon={CheckCircle2} {...EMPTY_COPY.sinObra} />
 ) : (
 <div className="divide-y divide-[var(--color-line)]">
 {sinObraGroups.map((group) => {
 const selected = groupProject[group.key] || '';
 const groupBusy = busyId === `group:${group.key}`;
 return (
 <section key={group.key} className="px-5 py-4" aria-label={group.counterparty}>
 <div className="flex flex-wrap items-center justify-between gap-3">
 <p className="min-w-0 text-[14px] text-[var(--color-fg-1)]">
 <span className="font-medium">{group.counterparty}</span>
 <span className="ml-2 font-mono text-[11px] text-[var(--color-fg-3)]">
 · {group.count} {group.count === 1 ? 'movimiento' : 'movimientos'} · {formatCurrency(group.total)}
 </span>
 </p>
 <div className="flex flex-wrap items-center gap-2">
 <ProjectSelect
 label={`Obra para ${group.counterparty}`}
 value={selected}
 projects={activeProjects}
 onChange={(value) => setGroupProject((current) => ({ ...current, [group.key]: value }))}
 />
 <Button
 variant="primary"
 size="sm"
 icon={HardHat}
 loading={groupBusy}
 disabled={!selected || busyId != null}
 onClick={() => handleAssignProject(group.ids, selected, `group:${group.key}`)}
 >
 Asignar obra a los {group.count}
 </Button>
 </div>
 </div>
 <div className="mt-3 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
 {group.movements.map((m) => (
 <SinObraRow
 key={m.id}
 movement={m}
 projects={activeProjects}
 busy={busyId === m.id}
 disabled={busyId != null}
 onAssign={(projectId) => handleAssignProject([m.id], projectId, m.id)}
 onCategorize={() => setCategorizingMovement(m)}
 />
 ))}
 </div>
 </section>
 );
 })}
 </div>
 )}
 </Panel>
 )}

 {/* SIN CONCILIAR — obra revenue without a CXC */}
 {activeTab === 'sinConciliar' && (
 <Panel title="Sin conciliar" meta={`${sinConciliar.length} resultado(s)`} padding={false}>
 {sinConciliar.length === 0 ? (
 <EmptyState icon={CheckCircle2} {...EMPTY_COPY.sinConciliar} />
 ) : (
 <div className="divide-y divide-[var(--color-line)]">
 {sinConciliar.map((m) => (
 <MovementRow
 key={m.id}
 movement={m}
 matches={suggestMatches(m)}
 personnel={personnelOf(m)}
 busy={busyId === m.id}
 onLink={(item) => handleLink(m, item)}
 onCategorize={() => setCategorizingMovement(m)}
 onCreateRule={null}
 />
 ))}
 </div>
 )}
 </Panel>
 )}
 </>
 )}

 <CategorizeModal
 isOpen={Boolean(categorizingMovement)}
 onClose={() => setCategorizingMovement(null)}
 onSubmit={handleCategorize}
 movement={categorizingMovement}
 categories={allCategories}
 costCenters={costCenters || []}
 projects={projects || []}
 suggestion={categorizingMovement ? personnelOf(categorizingMovement) : null}
 />

 <RuleFormModal
 isOpen={Boolean(ruleSeedMovement)}
 onClose={() => setRuleSeedMovement(null)}
 onSubmit={handleCreateRule}
 seedMovement={ruleSeedMovement}
 categories={allCategories}
 costCenters={costCenters || []}
 projects={projects || []}
 pendingMovements={pendingMovements}
 />
 </div>
 );
};

const ProjectSelect = ({ label, value, projects, onChange, disabled }) => (
 <select
 aria-label={label}
 className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-1.5 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)] disabled:opacity-50"
 value={value}
 disabled={disabled}
 onChange={(e) => onChange(e.target.value)}
 >
 <option value="">Elegir obra…</option>
 {projects.map((p) => (
 <option key={p.id} value={p.id}>{p.displayName || p.name}</option>
 ))}
 </select>
);

/** One "Sin obra" row: the exception to its group's project. */
const SinObraRow = ({ movement, projects, busy, disabled, onAssign, onCategorize }) => {
 const [projectId, setProjectId] = useState('');
 return (
 <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
 <div className="min-w-0 flex-1">
 <p className="truncate text-[13px] text-[var(--color-fg-1)]">{movement.description || 'Sin descripción'}</p>
 <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-4)]">
 {movement.postedDate} · {movement.categoryName || 'Sin categoría'} · -{formatCurrency(movement.amount)}
 </p>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <ProjectSelect
 label={`Obra para ${movement.description || movement.id}`}
 value={projectId}
 projects={projects}
 onChange={setProjectId}
 disabled={disabled}
 />
 <Button
 variant="secondary"
 size="sm"
 loading={busy}
 disabled={!projectId || disabled}
 onClick={() => onAssign(projectId)}
 >
 Asignar
 </Button>
 <Button variant="ghost" size="sm" icon={Tag} onClick={onCategorize} disabled={disabled}>
 Categorizar
 </Button>
 </div>
 </div>
 );
};

/**
 * Nómina vs subcontratista, said in one line.
 *
 * Payroll: the transfer settles a salary the payroll allocation has ALREADY
 * charged to the obras, so it must not be charged again — hence estructura.
 * Subcontractor: the payment IS the obra cost, so it needs a project.
 * A probable-but-unproven match never asserts; it asks for an alias, which fixes
 * that person's bank name permanently.
 */
const PersonnelHint = ({ personnel }) => {
 if (!personnel || personnel.kind === COUNTERPARTY_KIND.UNKNOWN) return null;

 const isPayroll = personnel.kind === COUNTERPARTY_KIND.PAYROLL;
 const scopeLabel = personnel.costScope === COST_SCOPE.OVERHEAD ? 'Estructura' : 'Obra';

 return (
 <div className="mt-2">
 <div className="flex flex-wrap items-center gap-2">
 <Badge variant={isPayroll ? 'info' : 'warn'} dot>
 {isPayroll ? 'Nómina' : 'Subcontratista'}
 </Badge>
 <span className="text-[12px] text-[var(--color-fg-3)]">{personnel.employee?.fullName}</span>
 {!personnel.autoApply && <Badge variant="warn">Sin confirmar</Badge>}
 </div>
 {personnel.categoryName ? (
 <p className="mt-1 text-[11px] leading-5 text-[var(--color-fg-4)]">
 Sugerencia: {personnel.categoryName} · {scopeLabel}
 {isPayroll
 ? ' — no se carga a la obra: ya está contabilizada en la asignación de nómina.'
 : ' — requiere proyecto.'}
 </p>
 ) : null}
 {!personnel.autoApply ? (
 <p className="mt-1 text-[11px] leading-5 text-[var(--color-warn)]">
 El nombre del banco no coincide del todo con la ficha. Confirmá antes de guardar y añadí
 “{personnel.employee?.fullName}” un alias con el nombre exacto del banco (Personal → Editar) para
 resolverlo de forma permanente.
 </p>
 ) : null}
 </div>
 );
};

const MovementRow = ({ movement, matches, personnel, busy, onLink, onCategorize, onCreateRule }) => {
 const isInflow = movement.direction === 'in';
 const ArrowIcon = isInflow ? ArrowUpRight : ArrowDownRight;
 const colorClass = isInflow ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]';
 const top = matches?.[0];
 const tooLate = matches?.some?.((m) => m.daysDiff > 14);

 return (
 <div className="px-5 py-4 flex items-start gap-4">
 <ArrowIcon size={16} className={`flex-shrink-0 mt-1 ${colorClass}`} />
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-3">
 <p className="text-[14px] text-[var(--color-fg-1)] truncate">{movement.description || 'Sin descripción'}</p>
 <span className={`font-mono text-[14px] tabular-nums flex-shrink-0 ${colorClass}`}>
 {isInflow ? '+' : '-'}{formatCurrency(movement.amount)}
 </span>
 </div>
 <p className="mt-1 font-mono text-[11px] text-[var(--color-fg-4)]">
 {movement.postedDate} · {movement.counterpartyName || 'Sin contraparte'}
 {movement.categoryName ? ` · ${movement.categoryName}` : ''}
 </p>

 <PersonnelHint personnel={personnel} />

 {/* Top match suggestion */}
 {top && (
 <div className="mt-3 rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-2)] px-3 py-2">
 <div className="flex items-center justify-between gap-3 flex-wrap">
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2 flex-wrap">
 <Badge variant={top.score >= 130 ? 'ok' : top.score >= 100 ? 'info' : 'warn'} dot>
 {isInflow ? 'CXC' : 'CXP'} sugerida · score {Math.round(top.score)}
 </Badge>
 {top.item.payrollKind && <Badge variant="info">Nómina</Badge>}
 {tooLate && <Badge variant="warn">+14 días de diferencia</Badge>}
 </div>
 <p className="mt-1.5 text-[13px] text-[var(--color-fg-1)] truncate">
 {top.item.description || top.item.counterpartyName || top.item.documentNumber || top.item.id}
 </p>
 <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-4)]">
 Vence {top.item.dueDate || top.item.issueDate || '—'} ·
 abierto {formatCurrency(top.item.openAmount || top.item.grossAmount || top.item.amount)}
 {top.daysDiff !== Infinity && ` · ${Math.round(top.daysDiff)}d de diferencia`}
 </p>
 </div>
 {top.score >= 100 && (
 <Button
 variant="primary"
 size="sm"
 icon={Link2}
 loading={busy}
 disabled={busy}
 onClick={() => onLink && onLink(top.item)}
 >
 Vincular
 </Button>
 )}
 </div>
 {matches.length > 1 && (
 <details className="mt-2">
 <summary className="text-[11px] text-[var(--color-fg-3)] cursor-pointer hover:text-[var(--color-fg-1)]">
 Ver {matches.length - 1} alternativa(s)
 </summary>
 <div className="mt-2 space-y-1.5">
 {matches.slice(1).map((alt) => (
 <div key={alt.item.id} className="flex items-center justify-between gap-2 text-[12px]">
 <span className="truncate text-[var(--color-fg-3)]">
 {alt.item.description || alt.item.counterpartyName || alt.item.id} ·{' '}
 {formatCurrency(alt.item.openAmount || alt.item.grossAmount || alt.item.amount)}
 </span>
 <button
 type="button"
 className="text-[var(--color-accent)] hover:underline flex-shrink-0"
 onClick={() => onLink && onLink(alt.item)}
 >
 vincular
 </button>
 </div>
 ))}
 </div>
 </details>
 )}
 </div>
 )}
 </div>
 <div className="flex flex-col gap-2 flex-shrink-0">
 <Button variant="ghost" size="sm" icon={Tag} onClick={onCategorize} disabled={busy}>
 Categorizar
 </Button>
 {onCreateRule && (
 <Button variant="ghost" size="sm" icon={Wand2} onClick={onCreateRule} disabled={busy} title="Crear regla desde este movimiento">
 Regla
 </Button>
 )}
 </div>
 </div>
 );
};

export default Classifier;
