import { useState, useEffect, useMemo } from 'react';
import { X, Save, Wand2, Sparkles } from 'lucide-react';
import {
  classificationRuleDefaults,
  RULE_DIRECTIONS,
  RULE_FIELDS,
  RULE_MATCH_TYPES,
} from '../../finance/assetSchemas';
import { matchRule } from '../../finance/ruleEngine';
import { Button, Badge } from '@/components/ui/nexus';
import { formatCurrency } from '../../utils/formatters';

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
  in: 'Solo ingresos',
  out: 'Solo gastos',
};

/**
 * RuleFormModal — create/edit a classificationRule.
 *
 * Optionally seeded from a movement (when invoked from "Crear regla
 * desde este movimiento" in the Bandeja or Movimientos page).
 *
 * Live-previews how many of the currently-pending movements would
 * be auto-classified by this rule.
 */
const RuleFormModal = ({
  isOpen,
  onClose,
  onSubmit,
  editingRule,
  seedMovement,
  categories = [],
  costCenters = [],
  projects = [],
  pendingMovements = [],
}) => {
  const [form, setForm] = useState(classificationRuleDefaults());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (editingRule) {
      setForm({ ...classificationRuleDefaults(), ...editingRule });
    } else if (seedMovement) {
      const cp = (seedMovement.counterpartyName || '').trim();
      setForm({
        ...classificationRuleDefaults(),
        name: cp ? `Auto: ${cp}` : '',
        field: 'counterpartyName',
        matchType: cp ? 'contains' : 'contains',
        pattern: cp,
        direction: seedMovement.direction === 'in' ? 'in' : 'out',
        applyTo: {
          categoryName: seedMovement.categoryName || '',
          costCenterId: seedMovement.costCenterId || '',
          projectId: seedMovement.projectId || '',
          projectName: seedMovement.projectName || '',
        },
      });
    } else {
      setForm(classificationRuleDefaults());
    }
    setError('');
  }, [isOpen, editingRule, seedMovement]);

  const previewMovements = useMemo(() => {
    if (!form.pattern) return [];
    return (pendingMovements || []).filter((m) => matchRule(m, form));
  }, [form, pendingMovements]);

  if (!isOpen) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setApply = (k, v) =>
    setForm((f) => ({ ...f, applyTo: { ...f.applyTo, [k]: v } }));

  const setProject = (id) => {
    const p = projects.find((x) => x.id === id);
    const name = p ? String(p.nombre || p.name || p.codigo || p.code || id) : '';
    setForm((f) => ({ ...f, applyTo: { ...f.applyTo, projectId: id, projectName: name } }));
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!form.pattern.trim()) {
      setError('Ingresá un patrón a buscar');
      return;
    }
    if (!form.applyTo.categoryName && !form.applyTo.costCenterId && !form.applyTo.projectId) {
      setError('Definí al menos un campo a aplicar (categoría / centro / proyecto)');
      return;
    }
    if (form.matchType === 'regex') {
      try {
        new RegExp(form.pattern);
      } catch {
        setError('La expresión regular no es válida');
        return;
      }
    }
    setSubmitting(true);
    const result = await onSubmit(form);
    setSubmitting(false);
    if (result?.success) onClose();
    else setError(result?.error?.message || 'Error al guardar');
  };

  const incomeCats = categories.filter((c) => c.type === 'income' || !c.type);
  const expenseCats = categories.filter((c) => c.type === 'expense' || !c.type);
  const visibleCats =
    form.direction === 'in' ? incomeCats : form.direction === 'out' ? expenseCats : categories;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-1)] rounded-lg w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-[var(--color-line)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wand2 size={18} className="text-[var(--color-accent)]" />
            <div>
              <h2 className="text-lg font-medium text-[var(--color-fg-1)]">
                {editingRule ? 'Editar regla' : 'Nueva regla de clasificación'}
              </h2>
              <p className="text-[12px] text-[var(--color-fg-3)]">
                Asigná categoría/CC/proyecto automáticamente cuando un movimiento coincida.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-fg-4)] hover:text-[var(--color-fg-1)]"
          >
            <X size={20} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 flex-1 space-y-5">
          <section className="space-y-3">
            <p className="label-mono text-[var(--color-fg-3)]">1. Identificación</p>
            <label className="block">
              <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Nombre</span>
              <input
                type="text"
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder='Ej: "AOK Rheinland — Salud"'
              />
            </label>
          </section>

          <section className="space-y-3">
            <p className="label-mono text-[var(--color-fg-3)]">2. Cuándo aplicar</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Buscar en</span>
                <select
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
                  value={form.field}
                  onChange={(e) => set('field', e.target.value)}
                >
                  {RULE_FIELDS.map((f) => (
                    <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Tipo de match</span>
                <select
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
                  value={form.matchType}
                  onChange={(e) => set('matchType', e.target.value)}
                >
                  {RULE_MATCH_TYPES.map((t) => (
                    <option key={t} value={t}>{MATCH_LABELS[t]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Dirección</span>
                <select
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
                  value={form.direction}
                  onChange={(e) => set('direction', e.target.value)}
                >
                  {RULE_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">
                Patrón a buscar *
              </span>
              <input
                type="text"
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)] font-mono"
                value={form.pattern}
                onChange={(e) => set('pattern', e.target.value)}
                placeholder={form.matchType === 'regex' ? '^AOK.*$' : 'AOK Rheinland'}
              />
              <span className="mt-1 block text-[11px] text-[var(--color-fg-4)]">
                Case-insensitive. {form.matchType === 'regex' ? 'Sintaxis: JS RegExp.' : ''}
              </span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">
                  Monto mínimo (€) — opcional
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
                  value={form.amountMin ?? ''}
                  onChange={(e) => set('amountMin', e.target.value === '' ? null : e.target.value)}
                  placeholder="—"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">
                  Monto máximo (€) — opcional
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
                  value={form.amountMax ?? ''}
                  onChange={(e) => set('amountMax', e.target.value === '' ? null : e.target.value)}
                  placeholder="—"
                />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <p className="label-mono text-[var(--color-fg-3)]">3. Qué clasificar</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Categoría</span>
                <select
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
                  value={form.applyTo.categoryName}
                  onChange={(e) => setApply('categoryName', e.target.value)}
                >
                  <option value="">— Ninguna —</option>
                  {visibleCats.map((c) => (
                    <option key={c.name || c} value={c.name || c}>
                      {c.name || c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Centro de costo</span>
                <select
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
                  value={form.applyTo.costCenterId}
                  onChange={(e) => setApply('costCenterId', e.target.value)}
                >
                  <option value="">— Ninguno —</option>
                  {costCenters.map((c) => {
                    const id = String(c.id || c.codigo || c.code || '');
                    const label = String(c.nombre || c.name || c.codigo || c.code || id);
                    return (
                      <option key={id} value={id}>{label}</option>
                    );
                  })}
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Proyecto</span>
                <select
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
                  value={form.applyTo.projectId}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="">— Ninguno —</option>
                  {projects.map((p) => {
                    const id = String(p.id || '');
                    const label = String(p.nombre || p.name || p.codigo || p.code || id);
                    return (
                      <option key={id} value={id}>{label}</option>
                    );
                  })}
                </select>
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <p className="label-mono text-[var(--color-fg-3)]">4. Configuración</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Prioridad</span>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none font-mono tabular-nums"
                  value={form.priority}
                  onChange={(e) => set('priority', e.target.value)}
                />
                <span className="mt-1 block text-[11px] text-[var(--color-fg-4)]">
                  Mayor prioridad gana cuando dos reglas coinciden. Default: 100.
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer mt-7">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.active}
                  onChange={(e) => set('active', e.target.checked)}
                />
                <span className="text-sm text-[var(--color-fg-1)]">
                  Activa (clasifica al importar)
                </span>
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]">Notas</span>
              <textarea
                rows={2}
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5 text-sm text-[var(--color-fg-1)] outline-none"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </label>
          </section>

          {/* Live preview */}
          {form.pattern && (
            <section className="rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-2)] px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} className="text-[var(--color-accent)]" />
                <p className="label-mono text-[var(--color-fg-3)]">Preview</p>
                <Badge variant={previewMovements.length > 0 ? 'ok' : 'neutral'}>
                  {previewMovements.length} movimiento(s) coinciden
                </Badge>
              </div>
              {previewMovements.length === 0 ? (
                <p className="text-[12px] text-[var(--color-fg-4)]">
                  Ningún movimiento pendiente coincide con este patrón hoy. La regla seguirá
                  activa para futuros imports.
                </p>
              ) : (
                <div className="space-y-1">
                  {previewMovements.slice(0, 6).map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-[12px] gap-3">
                      <span className="truncate text-[var(--color-fg-1)]">
                        {m.postedDate} · {m.counterpartyName || m.description || '—'}
                      </span>
                      <span
                        className={`font-mono tabular-nums flex-shrink-0 ${
                          m.direction === 'in' ? 'text-[var(--color-ok)]' : 'text-[var(--color-accent)]'
                        }`}
                      >
                        {m.direction === 'in' ? '+' : '-'}
                        {formatCurrency(m.amount)}
                      </span>
                    </div>
                  ))}
                  {previewMovements.length > 6 && (
                    <p className="text-[11px] text-[var(--color-fg-4)] mt-1">
                      …+{previewMovements.length - 6} más
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {error && <p className="text-sm text-[var(--color-err)]">{error}</p>}
        </form>

        <footer className="px-6 py-4 border-t border-[var(--color-line)] flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            icon={Save}
            loading={submitting}
            disabled={submitting}
            onClick={handleSubmit}
          >
            {editingRule ? 'Guardar cambios' : 'Crear regla'}
          </Button>
        </footer>
      </div>
    </div>
  );
};

export default RuleFormModal;
