import { useState, useMemo } from 'react';
import {
 Inbox,
 Link2,
 Tag,
 ArrowDownRight,
 ArrowUpRight,
 CheckCircle2,
 AlertTriangle,
 Search,
 Wand2,
 PlayCircle,
} from 'lucide-react';
import { useClassifier } from '../../hooks/useClassifier';
import { useCategories } from '../../hooks/useCategories';
import { useCostCenters } from '../../hooks/useCostCenters';
import { useProjects } from '../../hooks/useProjects';
import { useClassificationRules } from '../../hooks/useClassificationRules';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency } from '../../utils/formatters';
import { findBestRule } from '../../finance/ruleEngine';
import CategorizeModal from '../../components/ui/CategorizeModal';
import RuleFormModal from '../../components/ui/RuleFormModal';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const TABS = [
 { key: 'income', label: 'Ingresos sin conciliar', icon: ArrowUpRight },
 { key: 'expense-suggested', label: 'Gastos con CXP sugerida', icon: Link2 },
 { key: 'expense-spontaneous', label: 'Gastos espontáneos', icon: Tag },
];

const Classifier = ({ user }) => {
 const {
 inboxMovements,
 linkToReceivable,
 linkToPayable,
 categorize,
 suggestMatches,
 } = useClassifier(user);

 const { expenseCategories, incomeCategories } = useCategories(user);
 const { costCenters } = useCostCenters(user);
 const { projects } = useProjects(user);
 const { rules, createRule, applyRulesToMovements } = useClassificationRules(user);
 const { showToast } = useToast();

 const [activeTab, setActiveTab] = useState('income');
 const [searchQuery, setSearchQuery] = useState('');
 const [categorizingMovement, setCategorizingMovement] = useState(null);
 const [ruleSeedMovement, setRuleSeedMovement] = useState(null);
 const [busyId, setBusyId] = useState(null);
 const [applyingAll, setApplyingAll] = useState(false);

 const allCategories = useMemo(
 () => [
 ...(incomeCategories || []).map((name) => ({ name, type: 'income' })),
 ...(expenseCategories || []).map((name) => ({ name, type: 'expense' })),
 ],
 [incomeCategories, expenseCategories],
 );

 const ruleHitCount = useMemo(
 () => (inboxMovements || []).reduce((sum, m) => (findBestRule(m, rules) ? sum + 1 : sum), 0),
 [inboxMovements, rules],
 );

 // Bucketize inbox by tab
 const buckets = useMemo(() => {
 const income = [];
 const expenseSuggested = [];
 const expenseSpontaneous = [];

 inboxMovements.forEach((m) => {
 if (m.direction === 'in') {
 income.push(m);
 } else {
 const matches = suggestMatches(m);
 if (matches.length > 0 && matches[0].score >= 100) {
 expenseSuggested.push({ movement: m, matches });
 } else {
 expenseSpontaneous.push({ movement: m, matches });
 }
 }
 });

 // Sort by date desc
 income.sort((a, b) => (b.postedDate || '').localeCompare(a.postedDate || ''));
 expenseSuggested.sort((a, b) => (b.movement.postedDate || '').localeCompare(a.movement.postedDate || ''));
 expenseSpontaneous.sort((a, b) => (b.movement.postedDate || '').localeCompare(a.movement.postedDate || ''));

 return { income, expenseSuggested, expenseSpontaneous };
 }, [inboxMovements, suggestMatches]);

 const filterBySearch = (items, getMovement = (x) => x) => {
 if (!searchQuery.trim()) return items;
 const q = searchQuery.toLowerCase();
 return items.filter((it) => {
 const m = getMovement(it);
 return (
 (m.description || '').toLowerCase().includes(q) ||
 (m.counterpartyName || '').toLowerCase().includes(q) ||
 String(m.amount || '').includes(q)
 );
 });
 };

 const handleLinkReceivable = async (movement, receivable) => {
 setBusyId(movement.id);
 const r = await linkToReceivable(movement, receivable);
 setBusyId(null);
 if (r.success) {
 showToast(
 r.status === 'settled' ? 'Conciliado y CXC liquidada' : 'Conciliación parcial registrada',
 'success',
 );
 } else {
 showToast(r.error?.message || 'Error al conciliar', 'error');
 }
 };

 const handleLinkPayable = async (movement, payable) => {
 setBusyId(movement.id);
 const r = await linkToPayable(movement, payable);
 setBusyId(null);
 if (r.success) {
 showToast(
 r.status === 'settled' ? 'Conciliado y CXP liquidada' : 'Conciliación parcial registrada',
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
 const result = await applyRulesToMovements(inboxMovements);
 setApplyingAll(false);
 if (result.applied > 0) {
 showToast(`${result.applied} movimiento(s) clasificados automáticamente`, 'success');
 } else if (result.errors.length > 0) {
 showToast(`Errores aplicando reglas: ${result.errors.length}`, 'error');
 } else {
 showToast('Sin cambios — los matches ya estaban clasificados', 'info');
 }
 };

 const stats = {
 total: inboxMovements.length,
 income: buckets.income.length,
 expenseSuggested: buckets.expenseSuggested.length,
 expenseSpontaneous: buckets.expenseSpontaneous.length,
 };

 const incomeFiltered = filterBySearch(buckets.income);
 const expenseSuggestedFiltered = filterBySearch(buckets.expenseSuggested, (it) => it.movement);
 const expenseSpontaneousFiltered = filterBySearch(buckets.expenseSpontaneous, (it) => it.movement);

 return (
 <div className="space-y-6 pb-12">
 <header className="flex items-end justify-between gap-4 flex-wrap">
 <div>
 <p className="label-mono text-[var(--color-fg-3)]">Bandeja semanal</p>
 <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
 Clasificar movimientos
 </h2>
 <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
 Cada viernes después del DATEV semanal, conciliá ingresos con CXC, vinculá gastos con CXP cuando corresponda
 y categorizá los gastos espontáneos.
 </p>
 </div>
 {ruleHitCount > 0 && (
 <Button
 variant="secondary"
 icon={PlayCircle}
 loading={applyingAll}
 disabled={applyingAll}
 onClick={handleApplyAllRules}
 >
 Aplicar reglas ({ruleHitCount})
 </Button>
 )}
 </header>

 <KPIGrid cols={4}>
 <KPI
 label="Pendientes total"
 value={stats.total}
 meta={stats.total === 0 ? '✓ Bandeja al día' : 'Necesitan acción'}
 tone={stats.total === 0 ? 'ok' : 'warn'}
 icon={Inbox}
 />
 <KPI
 label="Ingresos sin conciliar"
 value={stats.income}
 meta="Buscar match con CXC"
 tone={stats.income > 0 ? 'warn' : 'ok'}
 icon={ArrowUpRight}
 />
 <KPI
 label="Con CXP sugerida"
 value={stats.expenseSuggested}
 meta="Match exacto detectado"
 tone="info"
 icon={Link2}
 />
 <KPI
 label="Gastos espontáneos"
 value={stats.expenseSpontaneous}
 meta="Solo categorizar"
 tone={stats.expenseSpontaneous > 0 ? 'warn' : 'ok'}
 icon={Tag}
 />
 </KPIGrid>

 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="nx-tabs">
 {TABS.map((t) => {
 const Icon = t.icon;
 const count =
 t.key === 'income' ? stats.income :
 t.key === 'expense-suggested' ? stats.expenseSuggested :
 stats.expenseSpontaneous;
 return (
 <button
 key={t.key}
 type="button"
 onClick={() => setActiveTab(t.key)}
 className={`nx-tab ${activeTab === t.key ? 'active' : ''}`}
 >
 <span className="inline-flex items-center gap-2">
 <Icon size={12} />
 {t.label}
 <Badge variant="neutral">{count}</Badge>
 </span>
 </button>
 );
 })}
 </div>
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

 {/* INCOME TAB */}
 {activeTab === 'income' && (
 <Panel title="Ingresos sin conciliar" meta={`${incomeFiltered.length} resultado(s)`} padding={false}>
 {incomeFiltered.length === 0 ? (
 <EmptyState
 icon={CheckCircle2}
 title="Sin ingresos pendientes"
 description="Todos los ingresos están conciliados con CXC."
 />
 ) : (
 <div className="divide-y divide-[var(--color-line)]">
 {incomeFiltered.map((m) => {
 const matches = suggestMatches(m);
 return (
 <MovementRow
 key={m.id}
 movement={m}
 matches={matches}
 direction="in"
 busy={busyId === m.id}
 onLink={(item) => handleLinkReceivable(m, item)}
 onCategorize={() => setCategorizingMovement(m)}
 onCreateRule={() => setRuleSeedMovement(m)}
 />
 );
 })}
 </div>
 )}
 </Panel>
 )}

 {/* EXPENSE SUGGESTED */}
 {activeTab === 'expense-suggested' && (
 <Panel title="Gastos con CXP sugerida" meta={`${expenseSuggestedFiltered.length} resultado(s)`} padding={false}>
 {expenseSuggestedFiltered.length === 0 ? (
 <EmptyState
 icon={CheckCircle2}
 title="Sin sugerencias"
 description="No hay gastos cuyo monto coincida exactamente con una CXP abierta."
 />
 ) : (
 <div className="divide-y divide-[var(--color-line)]">
 {expenseSuggestedFiltered.map(({ movement, matches }) => (
 <MovementRow
 key={movement.id}
 movement={movement}
 matches={matches}
 direction="out"
 busy={busyId === movement.id}
 onLink={(item) => handleLinkPayable(movement, item)}
 onCategorize={() => setCategorizingMovement(movement)}
 onCreateRule={() => setRuleSeedMovement(movement)}
 />
 ))}
 </div>
 )}
 </Panel>
 )}

 {/* EXPENSE SPONTANEOUS */}
 {activeTab === 'expense-spontaneous' && (
 <Panel title="Gastos espontáneos" meta={`${expenseSpontaneousFiltered.length} resultado(s)`} padding={false}>
 {expenseSpontaneousFiltered.length === 0 ? (
 <EmptyState
 icon={CheckCircle2}
 title="Sin gastos por categorizar"
 description="Todos los gastos están conciliados o categorizados."
 />
 ) : (
 <div className="divide-y divide-[var(--color-line)]">
 {expenseSpontaneousFiltered.map(({ movement, matches }) => (
 <MovementRow
 key={movement.id}
 movement={movement}
 matches={matches}
 direction="out"
 busy={busyId === movement.id}
 onLink={matches.length > 0 ? (item) => handleLinkPayable(movement, item) : null}
 onCategorize={() => setCategorizingMovement(movement)}
 onCreateRule={() => setRuleSeedMovement(movement)}
 />
 ))}
 </div>
 )}
 </Panel>
 )}

 <CategorizeModal
 isOpen={Boolean(categorizingMovement)}
 onClose={() => setCategorizingMovement(null)}
 onSubmit={handleCategorize}
 movement={categorizingMovement}
 categories={
 categorizingMovement?.direction === 'in'
 ? (incomeCategories || []).map((name) => ({ name, type: 'income' }))
 : (expenseCategories || []).map((name) => ({ name, type: 'expense' }))
 }
 costCenters={costCenters || []}
 projects={projects || []}
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

const MovementRow = ({ movement, matches, direction, busy, onLink, onCategorize, onCreateRule }) => {
 const ArrowIcon = direction === 'in' ? ArrowUpRight : ArrowDownRight;
 const colorClass = direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]';
 const top = matches?.[0];
 const tooLate = matches?.some?.((m) => m.daysDiff > 14);

 return (
 <div className="px-5 py-4 flex items-start gap-4">
 <ArrowIcon size={16} className={`flex-shrink-0 mt-1 ${colorClass}`} />
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-3">
 <p className="text-[14px] text-[var(--color-fg-1)] truncate">{movement.description || 'Sin descripción'}</p>
 <span className={`font-mono text-[14px] tabular-nums flex-shrink-0 ${colorClass}`}>
 {direction === 'in' ? '+' : '-'}{formatCurrency(movement.amount)}
 </span>
 </div>
 <p className="mt-1 font-mono text-[11px] text-[var(--color-fg-4)]">
 {movement.postedDate} · {movement.counterpartyName || 'Sin contraparte'}
 </p>

 {/* Top match suggestion */}
 {top && (
 <div className="mt-3 rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-2)] px-3 py-2">
 <div className="flex items-center justify-between gap-3 flex-wrap">
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2 flex-wrap">
 <Badge variant={top.score >= 130 ? 'ok' : top.score >= 100 ? 'info' : 'warn'} dot>
 {direction === 'in' ? 'CXC' : 'CXP'} sugerida · score {Math.round(top.score)}
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
 {!top && onLink && (
 <Button
 variant="ghost"
 size="sm"
 icon={Link2}
 disabled={busy}
 onClick={() => onLink && onLink(matches[0]?.item)}
 >
 Buscar
 </Button>
 )}
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
