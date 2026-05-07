import { useState, useMemo } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Wand2,
  Search,
  ToggleLeft,
  ToggleRight,
  PlayCircle,
  CheckCircle2,
} from 'lucide-react';
import { useClassificationRules } from '../../hooks/useClassificationRules';
import { useClassifier } from '../../hooks/useClassifier';
import { useCategories } from '../../hooks/useCategories';
import { useCostCenters } from '../../hooks/useCostCenters';
import { useProjects } from '../../hooks/useProjects';
import { useToast } from '../../contexts/ToastContext';
import { matchRule } from '../../finance/ruleEngine';
import { rowButtonProps } from '../../utils/a11y';
import RuleFormModal from '../../components/ui/RuleFormModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';

const FIELD_LABELS = {
  counterpartyName: 'Contraparte',
  description: 'Descripción',
};
const MATCH_LABELS = {
  contains: 'contiene',
  exact: 'exacto',
  startsWith: 'empieza con',
  regex: 'regex',
};
const DIRECTION_LABELS = {
  both: 'Ambas',
  in: 'Ingreso',
  out: 'Gasto',
};

const Rules = ({ user }) => {
  const {
    rules,
    loading,
    createRule,
    updateRule,
    deleteRule,
    toggleActive,
    applyRulesToMovements,
  } = useClassificationRules(user);

  const { inboxMovements } = useClassifier(user);
  const { expenseCategories, incomeCategories } = useCategories(user);
  const { costCenters } = useCostCenters(user);
  const { projects } = useProjects(user);
  const { showToast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmApplyAll, setConfirmApplyAll] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const allCategories = useMemo(
    () => [
      ...(incomeCategories || []).map((name) => ({ name, type: 'income' })),
      ...(expenseCategories || []).map((name) => ({ name, type: 'expense' })),
    ],
    [incomeCategories, expenseCategories],
  );

  const rulesWithStats = useMemo(() => {
    return rules.map((r) => {
      const matchingPending = (inboxMovements || []).filter((m) => matchRule(m, r)).length;
      return { ...r, matchingPending };
    });
  }, [rules, inboxMovements]);

  const filtered = useMemo(() => {
    let list = rulesWithStats;
    if (!showInactive) list = list.filter((r) => r.active);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.name?.toLowerCase().includes(q) ||
          r.pattern?.toLowerCase().includes(q) ||
          r.applyTo?.categoryName?.toLowerCase().includes(q) ||
          r.notes?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rulesWithStats, showInactive, searchQuery]);

  const stats = useMemo(() => {
    const active = rules.filter((r) => r.active);
    const totalHits = rules.reduce((sum, r) => sum + (r.hits || 0), 0);
    const matchingTotal = rulesWithStats.reduce((sum, r) => sum + (r.matchingPending || 0), 0);
    return {
      total: rules.length,
      active: active.length,
      totalHits,
      matchingTotal,
    };
  }, [rules, rulesWithStats]);

  const handleCreate = async (data) => createRule(data);
  const handleUpdate = async (data) => updateRule(editingRule.id, data);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    await deleteRule(confirmDelete.id);
    setConfirmDelete(null);
    showToast('Regla eliminada', 'success');
  };

  const handleApplyAll = async () => {
    setIsApplying(true);
    const result = await applyRulesToMovements(inboxMovements);
    setIsApplying(false);
    setConfirmApplyAll(false);
    if (result.errors.length > 0) {
      showToast(`Aplicadas ${result.applied}, ${result.errors.length} con error`, 'warning');
    } else if (result.applied === 0) {
      showToast('Ninguna regla coincidió con la bandeja actual', 'info');
    } else {
      showToast(`${result.applied} movimiento(s) clasificados automáticamente`, 'success');
    }
  };

  const openEdit = (r) => {
    setEditingRule(r);
    setIsModalOpen(true);
  };

  const openCreate = () => {
    setEditingRule(null);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6 pb-12">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="label-mono text-[var(--color-fg-3)]">Automatización · Reglas</p>
          <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
            Reglas de clasificación automática
          </h2>
          <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
            Cuando importás DATEV, las reglas asignan categoría / centro de costo / proyecto
            automáticamente según contraparte o descripción. Tu bandeja queda más chica cada semana.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={PlayCircle}
            onClick={() => setConfirmApplyAll(true)}
            disabled={stats.matchingTotal === 0}
          >
            Aplicar a bandeja ({stats.matchingTotal})
          </Button>
          <Button variant="primary" icon={Plus} onClick={openCreate}>
            Nueva regla
          </Button>
        </div>
      </header>

      <KPIGrid cols={4}>
        <KPI
          label="Reglas activas"
          value={stats.active}
          meta={`${stats.total} totales`}
          tone="info"
          icon={Wand2}
        />
        <KPI
          label="Aplicaciones totales"
          value={stats.totalHits}
          meta="Veces que clasificaron"
          tone="ok"
          icon={CheckCircle2}
        />
        <KPI
          label="Coinciden con bandeja"
          value={stats.matchingTotal}
          meta="Movimientos pendientes que matchean"
          tone={stats.matchingTotal > 0 ? 'warn' : 'ok'}
          icon={PlayCircle}
        />
        <KPI
          label="Bandeja sin clasificar"
          value={(inboxMovements || []).length}
          meta="Total pendiente"
        />
      </KPIGrid>

      <Panel
        title="Lista de reglas"
        meta={`${filtered.length} ${filtered.length === 1 ? 'regla' : 'reglas'}`}
        padding={false}
        actions={
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 cursor-pointer text-[12px] text-[var(--color-fg-3)]">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Mostrar inactivas
            </label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-4)]"
                size={14}
              />
              <input
                type="text"
                placeholder="Buscar..."
                className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] py-1.5 pl-8 pr-3 text-[12px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        }
      >
        {loading ? (
          <div className="px-4 py-12 text-center">
            <p className="label-mono">Cargando...</p>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Wand2}
            title="Sin reglas todavía"
            description='Creá una regla y todos los movimientos futuros con esa contraparte se clasificarán solos. También podés crear reglas desde un movimiento en la Bandeja con el botón "Crear regla".'
            action={
              <Button variant="primary" icon={Plus} onClick={openCreate}>
                Nueva regla
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="nx-table w-full">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Match</th>
                  <th>Patrón</th>
                  <th>Aplica</th>
                  <th>Dirección</th>
                  <th className="text-right">Prioridad</th>
                  <th className="text-right">Hits</th>
                  <th className="text-right">Match bandeja</th>
                  <th className="text-center">Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} {...rowButtonProps(() => openEdit(r))}>
                    <td className="font-medium text-[var(--color-fg-1)]">{r.name || '—'}</td>
                    <td className="text-[var(--color-fg-3)]">
                      {FIELD_LABELS[r.field]} {MATCH_LABELS[r.matchType]}
                    </td>
                    <td className="font-mono text-[12px] text-[var(--color-fg-1)] max-w-[280px] truncate">
                      {r.pattern || '—'}
                    </td>
                    <td className="text-[var(--color-fg-3)]">
                      <div className="flex flex-wrap gap-1">
                        {r.applyTo?.categoryName && (
                          <Badge variant="info">{r.applyTo.categoryName}</Badge>
                        )}
                        {r.applyTo?.costCenterId && (
                          <Badge variant="neutral">CC: {r.applyTo.costCenterId}</Badge>
                        )}
                        {r.applyTo?.projectName && (
                          <Badge variant="neutral">{r.applyTo.projectName}</Badge>
                        )}
                      </div>
                    </td>
                    <td>
                      <Badge variant={r.direction === 'in' ? 'ok' : r.direction === 'out' ? 'warn' : 'neutral'}>
                        {DIRECTION_LABELS[r.direction]}
                      </Badge>
                    </td>
                    <td className="text-right font-mono tabular-nums">{r.priority}</td>
                    <td className="text-right font-mono tabular-nums text-[var(--color-ok)]">
                      {r.hits}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {r.matchingPending > 0 ? (
                        <Badge variant="warn">{r.matchingPending}</Badge>
                      ) : (
                        <span className="text-[var(--color-fg-4)]">0</span>
                      )}
                    </td>
                    <td className="text-center">
                      <Badge variant={r.active ? 'ok' : 'neutral'} dot>
                        {r.active ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={r.active ? ToggleRight : ToggleLeft}
                          onClick={() => toggleActive(r)}
                        >
                          {r.active ? 'Desactivar' : 'Activar'}
                        </Button>
                        <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(r)}>
                          Editar
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={Trash2}
                          onClick={() => setConfirmDelete(r)}
                        >
                          Borrar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <RuleFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={editingRule ? handleUpdate : handleCreate}
        editingRule={editingRule}
        categories={allCategories}
        costCenters={costCenters}
        projects={projects}
        pendingMovements={inboxMovements}
      />

      <ConfirmModal
        isOpen={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Eliminar regla"
        message={`¿Seguro que querés eliminar "${confirmDelete?.name || confirmDelete?.pattern}"? Los movimientos ya clasificados por esta regla NO se modifican.`}
        confirmText="Eliminar"
        variant="danger"
      />

      <ConfirmModal
        isOpen={confirmApplyAll}
        onClose={() => setConfirmApplyAll(false)}
        onConfirm={handleApplyAll}
        title="Aplicar reglas a la bandeja actual"
        message={`Esto va a recorrer ${(inboxMovements || []).length} movimientos pendientes y aplicar la regla activa de mayor prioridad a cada uno cuando coincida. Los movimientos ya con categoría no se tocan.`}
        confirmText={isApplying ? 'Aplicando...' : 'Aplicar reglas'}
        variant="primary"
      />
    </div>
  );
};

export default Rules;
