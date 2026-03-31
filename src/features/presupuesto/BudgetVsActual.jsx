import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Plus,
  Target,
  TrendingDown,
  TrendingUp,
  Copy,
  Trash2,
  Edit3,
  Check,
  X,
  BarChart3,
  List,
  Sparkles,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useToast } from '../../contexts/ToastContext';
import { useBudgets } from '../../hooks/useBudgets';
import { useCategories } from '../../hooks/useCategories';
import { useFinanceLedger } from '../../hooks/useFinanceLedger';
import { useAllTransactions } from '../../hooks/useAllTransactions';
import { useProjects } from '../../hooks/useProjects';
import { formatCurrency } from '../../utils/formatters';
import { txToBudgetMap, incToBudgetMap } from './categoryMapping';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTHS_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CURRENT_MONTH = new Date().getMonth(); // 0-indexed
const CURRENT_YEAR = new Date().getFullYear();

const generateLineId = () => `line-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;

// ── Confirm Modal ───────────────────────────────────────────────
const ConfirmModal = ({ isOpen, onConfirm, onCancel, title, message }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-[rgba(20,27,42,0.34)] p-4 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-[24px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(244,248,255,0.95))] p-6 shadow-[0_36px_110px_rgba(93,117,161,0.22)]">
        <h3 className="mb-2 text-[18px] font-semibold tracking-tight text-[#101938]">{title}</h3>
        <p className="mb-6 text-sm text-[#5f7091]">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/84 px-5 py-2.5 text-sm font-medium text-[#6b7a96] hover:bg-white hover:text-[#101938]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-2xl bg-[#d46a13] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#b85a0f]"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Number Input Modal (replaces browser prompt) ─────────────────
const NumberInputModal = ({ isOpen, onSubmit, onCancel, title, label, defaultValue }) => {
  const [val, setVal] = useState(String(defaultValue || 0));

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-[rgba(20,27,42,0.34)] p-4 backdrop-blur-md">
      <div className="w-full max-w-xs rounded-[24px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(244,248,255,0.95))] p-6 shadow-[0_36px_110px_rgba(93,117,161,0.22)]">
        <h3 className="mb-4 text-[18px] font-semibold tracking-tight text-[#101938]">{title}</h3>
        <label className="block">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">{label}</span>
          <input
            type="number"
            min="0"
            step="100"
            className="w-full rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none focus:border-[rgba(90,141,221,0.56)]"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            autoFocus
          />
        </label>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/84 px-5 py-2.5 text-sm font-medium text-[#6b7a96] hover:bg-white hover:text-[#101938]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => { onSubmit(parseFloat(val) || 0); }}
            className="rounded-2xl bg-[#3156d3] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2748b6]"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Tooltip component ──────────────────────────────────────────
const TooltipCard = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/96 px-3 py-3 shadow-[0_20px_50px_rgba(118,136,173,0.18)]">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#6980ac]">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
};

// ── Inline edit cell for monthly amounts ────────────────────────
const EditableCell = ({ value, onSave, formatter = (v) => v }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const num = parseFloat(draft);
    if (!isNaN(num) && num >= 0) {
      onSave(num);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="number"
        min="0"
        step="100"
        className="w-full rounded-lg border border-[rgba(90,141,221,0.56)] bg-white px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(90,141,221,0.2)]"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        autoFocus
      />
    );
  }

  return (
    <span
      className="cursor-pointer rounded px-2 py-1 text-right hover:bg-[rgba(90,141,221,0.08)]"
      onClick={() => { setDraft(value); setEditing(true); }}
      title="Clic para editar"
    >
      {formatter(value)}
    </span>
  );
};

// ── Budget Line Editor Modal ────────────────────────────────────
const BudgetLineModal = ({ isOpen, onClose, onSave, line, categories, allCategories }) => {
  const { showToast } = useToast();
  const [form, setForm] = useState(
    line || {
      id: null,
      categoryId: '',
      categoryName: '',
      type: 'expense',
      monthlyBudget: Array(12).fill(0),
      notes: '',
    }
  );
  const [showDistribute, setShowDistribute] = useState(false);

  if (!isOpen) return null;

  const fillEvenly = (total) => {
    if (total > 0) {
      setForm((f) => ({ ...f, monthlyBudget: Array(12).fill(total / 12) }));
    }
  };

  const fillFromPrev = (monthIndex) => {
    const prev = form.monthlyBudget[monthIndex - 1] || 0;
    const updated = [...form.monthlyBudget];
    updated[monthIndex] = prev;
    setForm((f) => ({ ...f, monthlyBudget: updated }));
  };

  const setMonth = (i, val) => {
    const updated = [...form.monthlyBudget];
    updated[i] = parseFloat(val) || 0;
    setForm((f) => ({ ...f, monthlyBudget: updated }));
  };

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-[rgba(20,27,42,0.34)] p-4 backdrop-blur-md">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-[28px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,248,255,0.94))] p-6 shadow-[0_36px_110px_rgba(93,117,161,0.22)]">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[22px] font-semibold tracking-tight text-[#101938]">
            {line?.id ? 'Editar línea' : 'Nueva línea de presupuesto'}
          </h3>
          <button onClick={onClose} className="rounded-xl p-2 text-[#6b7a96] hover:bg-white hover:text-[#101938]">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Tipo</span>
            <select
              className="w-full rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none focus:border-[rgba(90,141,221,0.56)]"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, categoryId: '' }))}
            >
              <option value="expense">Gasto</option>
              <option value="income">Ingreso</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Categoría</span>
            <select
              className="w-full rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none focus:border-[rgba(90,141,221,0.56)]"
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value, categoryName: e.target.value }))}
            >
              <option value="">Seleccionar categoría</option>
              {(form.type === 'expense' ? categories.expenseCategories : categories.incomeCategories).map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">
              Monto mensual (EUR) — clic para editar
            </span>
            <button
              type="button"
              onClick={() => setShowDistribute(true)}
              className="flex items-center gap-1 rounded-lg border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-1.5 text-xs font-medium text-[#6b7a96] hover:bg-white hover:text-[#101938]"
            >
              <Copy size={12} /> Distribuir evenly
            </button>
          </div>

          <div className="grid grid-cols-6 gap-2 md:grid-cols-12">
            {MONTHS.map((m, i) => (
              <div key={m} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold text-[#6b7a96]">{m}</span>
                <input
                  type="number"
                  min="0"
                  step="100"
                  className="w-full rounded-xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-2 py-2 text-center text-sm text-[#16223f] outline-none focus:border-[rgba(90,141,221,0.56)]"
                  value={form.monthlyBudget[i].toFixed(2)}
                  onChange={(e) => setMonth(i, e.target.value)}
                />
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => fillFromPrev(i)}
                    className="text-[9px] text-[#6b7a96] hover:text-[#3156d3]"
                    title="Copiar del mes anterior"
                  >
                    ↩
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Notas</span>
            <input
              type="text"
              className="w-full rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none focus:border-[rgba(90,141,221,0.56)]"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Ej: Presupuesto basado en contrato X"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/84 px-5 py-3 text-sm font-medium text-[#6b7a96] hover:bg-white hover:text-[#101938]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (!form.categoryId) {
                showToast('Selecciona una categoría', 'error');
                return;
              }
              onSave({ ...form, id: form.id || generateLineId() });
              onClose();
            }}
            className="rounded-2xl bg-[#3156d3] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2748b6]"
          >
            Guardar línea
          </button>
        </div>

        <NumberInputModal
          isOpen={showDistribute}
          title="Distribuir uniformemente"
          label="Total anual (EUR)"
          defaultValue={0}
          onSubmit={(total) => { fillEvenly(total); setShowDistribute(false); }}
          onCancel={() => setShowDistribute(false)}
        />
      </div>
    </div>
  );
};

// ── Create/Edit Budget Modal ─────────────────────────────────────
const CreateBudgetModal = ({ isOpen, onClose, onSubmit, projects, year }) => {
  const [projectId, setProjectId] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[rgba(20,27,42,0.34)] p-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-[28px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,248,255,0.94))] p-6 shadow-[0_36px_110px_rgba(93,117,161,0.22)]">
        <h3 className="text-[22px] font-semibold tracking-tight text-[#101938]">Nuevo presupuesto {year}</h3>
        <p className="mt-2 text-sm text-[#6b7a96]">Define el alcance del presupuesto. Las líneas se añaden después.</p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const project = projects.find((p) => p.id === projectId);
            onSubmit({
              projectId: projectId || null,
              projectName: projectId ? (project?.name || project?.displayName || project?.code || 'Proyecto') : 'Empresa',
              year,
            });
            onClose();
          }}
        >
          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">Proyecto / Empresa</span>
            <select
              className="w-full rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none focus:border-[rgba(90,141,221,0.56)]"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Empresa (general)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.displayName || p.code}</option>
              ))}
            </select>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/84 px-4 py-3 text-sm font-medium text-[#6b7a96] hover:bg-white hover:text-[#101938]">
              Cancelar
            </button>
            <button type="submit" className="rounded-2xl bg-[#3156d3] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2748b6]">
              Crear presupuesto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main Component ──────────────────────────────────────────────
const BudgetVsActual = ({ user, userRole }) => {
  const { showToast } = useToast();
  const { budgets, loading: budgetsLoading, createBudget, upsertBudgetLine, deleteBudgetLine, importBudgetLines, getBudgetsForYear } = useBudgets(user);
  const { projects } = useProjects(user);
  const categories = useCategories(user);
  const ledger = useFinanceLedger(user);
  const { allTransactions } = useAllTransactions(user);

  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [selectedProject, setSelectedProject] = useState(null); // null = empresa
  const [activeTab, setActiveTab] = useState('summary'); // 'summary' | 'detail'
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingLine, setEditingLine] = useState(null); // null = no modal

  // Confirm modal state
  const [confirmState, setConfirmState] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const openConfirm = (title, message, onConfirm) => setConfirmState({ isOpen: true, title, message, onConfirm });
  const closeConfirm = () => setConfirmState((s) => ({ ...s, isOpen: false }));

  const yearOptions = useMemo(() => {
    // Always include current year + prev year + any years with budgets
    const ys = new Set([CURRENT_YEAR, CURRENT_YEAR - 1]);
    budgets.forEach((b) => ys.add(b.year));
    return Array.from(ys).sort((a, b) => b - a);
  }, [budgets]);

  // Current budget for selected year + project
  const currentBudget = useMemo(() => {
    return budgets.find(
      (b) => Number(b.year) === Number(selectedYear) && (b.projectId || null) === (selectedProject || null)
    );
  }, [budgets, selectedYear, selectedProject]);

  // Build actuals: aggregate real amounts per budget category + month
  const actuals = useMemo(() => {
    const map = new Map(); // key: "budgetCat|income|monthIndex"

    if (!currentBudget?.lines?.length) return map;

    // Build a quick lookup: budgetCategoryName → type (income|expense)
    const budLineLookup = new Map(
      currentBudget.lines.map((l) => [l.categoryName, l.type])
    );

    // Resolve a tx category + direction → budget category name (or null)
    const resolve = (rawCat, isIncome) => {
      if (!rawCat) return null;
      const lookupMap = isIncome ? incToBudgetMap : txToBudgetMap;
      const budCat = lookupMap.get(rawCat);
      if (!budCat) return null;
      const expectedType = isIncome ? 'income' : 'expense';
      return budLineLookup.get(budCat) === expectedType ? budCat : null;
    };

    const addAmount = (budCat, isIncome, monthIdx, amount) => {
      const dir = isIncome ? 'income' : 'expense';
      const key = `${budCat}|${dir}|${monthIdx}`;
      const existing = map.get(key) || { income: 0, expense: 0 };
      if (isIncome) existing.income += amount;
      else existing.expense += amount;
      map.set(key, existing);
    };

    // ── Source A: allTransactions (Firebase transactions — always categorized) ──
    // These are the manually entered income/expense records with category field
    allTransactions.forEach((t) => {
      if (Number(t.date?.slice(0, 4)) !== Number(selectedYear)) return;

      const status = String(t.status || '').toLowerCase();
      const settled = ['paid','completed','settled'].includes(status);
      if (!settled) return;

      const isIncome = t.type === 'income';
      const rawCat = t.category || t.categoryName || '';
      const budCat = resolve(rawCat, isIncome);
      if (!budCat) return;

      const monthIdx = Number(t.date?.slice(5, 7)) - 1;
      if (monthIdx < 0 || monthIdx > 11) return;

      addAmount(budCat, isIncome, monthIdx, Math.abs(t.amount || 0));
    });

    // ── Source B: bankMovements that have categoryName set ──
    // Only adds movements NOT already represented by allTransactions
    const txIds = new Set(allTransactions.map(t => t.id).filter(Boolean));

    ledger.postedMovements.forEach((m) => {
      if (Number(m.postedDate?.slice(0, 4)) !== Number(selectedYear)) return;
      if (!m.categoryName) return; // skip uncategorized bank imports
      // Skip if this movement is linked to a transaction already counted above
      if (m.legacyTransactionId && txIds.has(m.legacyTransactionId)) return;

      const isIncome = m.direction === 'in';
      const budCat = resolve(m.categoryName, isIncome);
      if (!budCat) return;

      const monthIdx = Number(m.postedDate?.slice(5, 7)) - 1;
      if (monthIdx < 0 || monthIdx > 11) return;

      addAmount(budCat, isIncome, monthIdx, Math.abs(m.netAmount ?? m.amount));
    });

    return map;
  }, [allTransactions, ledger.postedMovements, selectedYear, currentBudget]);

  // Summary rows: budget line vs actual
  const summaryRows = useMemo(() => {
    if (!currentBudget?.lines?.length) return [];

    return currentBudget.lines
      .filter((line) => {
        if (activeTab === 'summary') {
          const totalBudget = line.monthlyBudget.reduce((s, v) => s + v, 0);
          return totalBudget > 0;
        }
        return true;
      })
      .map((line) => {
        const totalBudget = line.monthlyBudget.reduce((s, v) => s + v, 0);
        const totalActual = line.monthlyBudget.map((_, mi) => {
          const key = `${line.categoryName}|${line.type}|${mi}`;
          const a = actuals.get(key) || { income: 0, expense: 0 };
          return line.type === 'income' ? a.income : a.expense;
        }).reduce((s, v) => s + v, 0);

        const variance = totalBudget - totalActual;
        const pct = totalBudget > 0 ? (variance / totalBudget) * 100 : 0;

        return {
          ...line,
          totalBudget,
          totalActual,
          variance,
          pct,
          monthlyActual: line.monthlyBudget.map((_, mi) => {
            const key = `${line.categoryName}|${line.type}|${mi}`;
            const a = actuals.get(key) || { income: 0, expense: 0 };
            return line.type === 'income' ? a.income : a.expense;
          }),
        };
      })
      .sort((a, b) => (a.type === 'expense' ? b.variance - a.variance : a.variance - b.variance));
  }, [currentBudget, actuals, activeTab]);

  // Chart data: monthly budget vs actual for the selected budget
  const chartData = useMemo(() => {
    return MONTHS.map((m, i) => {
      const row = {
        name: m,
        budget: 0,
        actual: 0,
        budgetIncome: 0,
        actualIncome: 0,
        budgetExpense: 0,
        actualExpense: 0,
      };

      if (currentBudget?.lines?.length) {
        currentBudget.lines.forEach((line) => {
          row.budget += line.monthlyBudget[i] || 0;
          if (line.type === 'income') {
            row.budgetIncome += line.monthlyBudget[i] || 0;
            const key = `${line.categoryName}|income|${i}`;
            row.actualIncome += (actuals.get(key)?.income || 0);
          } else {
            row.budgetExpense += line.monthlyBudget[i] || 0;
            const key = `${line.categoryName}|expense|${i}`;
            row.actualExpense += (actuals.get(key)?.expense || 0);
          }
        });

        // actual = income - expense (net)
        row.actual = row.actualIncome - row.actualExpense;
      }

      return row;
    });
  }, [currentBudget, actuals]);

  // Totals
  const totals = useMemo(() => {
    const inc = summaryRows.filter((r) => r.type === 'income');
    const exp = summaryRows.filter((r) => r.type === 'expense');
    return {
      budgetIncome: inc.reduce((s, r) => s + r.totalBudget, 0),
      actualIncome: inc.reduce((s, r) => s + r.totalActual, 0),
      budgetExpense: exp.reduce((s, r) => s + r.totalBudget, 0),
      actualExpense: exp.reduce((s, r) => s + r.totalActual, 0),
      budgetNet: inc.reduce((s, r) => s + r.totalBudget, 0) - exp.reduce((s, r) => s + r.totalBudget, 0),
      actualNet: inc.reduce((s, r) => s + r.totalActual, 0) - exp.reduce((s, r) => s + r.totalActual, 0),
    };
  }, [summaryRows]);

  // DEBUG: visible debug panel for diagnosis
  const [showDebug, setShowDebug] = useState(false);
  const canAct = userRole === 'admin';

  if (budgetsLoading || ledger.loading) {
    return (
      <div className="flex items-center justify-center py-28">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3156d3] border-t-transparent" />
          <p className="text-sm text-[#6b7a96]">Cargando presupuesto...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <section className="rounded-[34px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,248,255,0.94))] px-6 py-7 shadow-[0_32px_90px_rgba(126,147,190,0.14)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#5a8ddd]">Presupuesto {selectedYear}</p>
            <h2 className="text-[32px] font-semibold tracking-tight text-[#101938]">Planificado vs. Real.</h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#5f7091]">
              Compara el presupuesto por categoría y mes contra la ejecución real (neto sin IVA).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Year */}
            <select
              className="rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none focus:border-[rgba(90,141,221,0.56)]"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {/* Project filter */}
            <select
              className="rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/88 px-4 py-3 text-sm text-[#16223f] outline-none focus:border-[rgba(90,141,221,0.56)]"
              value={selectedProject || ''}
              onChange={(e) => setSelectedProject(e.target.value || null)}
            >
              <option value="">Empresa</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.displayName || p.code}</option>
              ))}
            </select>
            {canAct && (
              <>
                {!currentBudget && (
                  <button
                    type="button"
                    onClick={() => setIsCreateOpen(true)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#3156d3] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2748b6]"
                  >
                    <Plus size={16} />
                    Crear presupuesto
                  </button>
                )}
                {currentBudget && (
                  <button
                    type="button"
                    onClick={() => {
                      const prevYear = selectedYear - 1;
                      if (true) {
                        openConfirm(
                          `Importar de ${prevYear}`,
                          `Copiar las líneas del presupuesto ${prevYear} como plantilla para ${selectedYear}?`,
                          () => {
                            importBudgetLines(prevYear, selectedYear, selectedProject, { replaceExisting: false }).then((r) => {
                              if (r.success) showToast(`${r.importedLines} líneas importadas`);
                              else showToast('No hay presupuesto de ' + prevYear, 'error');
                            });
                          }
                        );
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/84 px-4 py-3 text-sm font-medium text-[#6b7a96] hover:bg-white hover:text-[#101938]"
                  >
                    <Copy size={14} />
                    Copiar de {selectedYear - 1}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowDebug((v) => !v)}
                  className="rounded-2xl border border-[rgba(201,214,238,0.82)] bg-white/84 px-3 py-2.5 text-xs font-medium text-[#6b7a96] hover:bg-white hover:text-[#101938]"
                >
                  Debug
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Debug panel */}
      {showDebug && (() => {
        // Compute matching preview
        const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').trim();
        const STOPWORDS = new Set(['de','del','la','el','los','las','y','a','en','por','para','con','sin','al','lo','una','unos','otras','otros','pasajes','pasaje']);
        const getWords = (s) => normalize(s).split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
        const scoreMatch = (txCat, budCat) => {
          const nt = normalize(txCat); const nb = normalize(budCat);
          if (nt === nb) return 100;
          if (nt.includes(nb) || nb.includes(nt)) return 80;
          const wt = new Set(getWords(txCat)); const wb = new Set(getWords(budCat));
          const shared = [...wt].filter((w) => wb.has(w));
          return shared.length > 0 ? 60 + shared.length * 10 : 0;
        };
        const bCats = currentBudget?.lines ? [...new Set(currentBudget.lines.map((l) => l.categoryName))] : [];

        // Show sample movements from 2026 with categories
        const mov2026 = ledger.postedMovements.filter(m => m.postedDate?.startsWith(String(selectedYear)));
        const sampleMov = mov2026.slice(0, 8);

        // What categories exist in ledger vs transactions
        const txCats2026 = [...new Set(mov2026.map((m) => m.categoryName || '(vacío)'))];

        return (
        <section className="rounded-[28px] border border-red-300 bg-red-50 p-5">
          <h3 className="mb-3 text-[16px] font-semibold text-red-700">Diagnóstico</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs font-semibold text-red-600">Presupuesto</p>
              <p className="text-xs text-red-800">Año: {selectedYear} | Project: {selectedProject || 'Empresa'}</p>
              <p className="text-xs text-red-800">Líneas: {currentBudget?.lines?.length || 0}</p>
              {currentBudget?.lines?.map(l => (
                <p key={l.id} className="text-xs text-red-700">  &quot;{l.categoryName}&quot; [{l.type}] budget={l.monthlyBudget.reduce((s,v)=>s+v,0).toFixed(0)}</p>
              ))}
            </div>
            <div>
              <p className="text-xs font-semibold text-red-600">Movimientos ledger 2026</p>
              <p className="text-xs text-red-800">Total ledger: {ledger.postedMovements.length} | En 2026: {mov2026.length}</p>
              <p className="text-xs text-red-800 mt-1">Muestra de movimientos 2026:</p>
              {sampleMov.map(m => (
                <p key={m.id} className="text-xs text-red-700">  src={m.source || '?'} cat=&quot;{m.categoryName}&quot; {m.direction} €{m.amount?.toFixed(0)} {m.postedDate?.slice(0,7)}</p>
              ))}
              <p className="text-xs text-red-800 mt-1">Cats únicas en ledger 2026:</p>
              {txCats2026.slice(0, 8).map(c => (
                <p key={c} className="text-xs text-red-700">  &quot;{c}&quot;</p>
              ))}
            </div>
            <div>
              <p className="text-xs font-semibold text-red-600">Matching</p>
              <p className="text-xs text-red-800">Presupuesto cats: {bCats.join(', ')}</p>
              <p className="text-xs text-red-800 mt-1">Matches con score ≥ 40:</p>
              {txCats2026.map(lc => {
                const rows = bCats.map(bc => ({ bc, score: scoreMatch(lc, bc) })).filter(r => r.score >= 40).sort((a,b) => b.score - a.score);
                return rows.length > 0 ? (
                  <p key={lc} className="text-xs text-red-700">  &quot;{lc}&quot; → &quot;{rows[0].bc}&quot; ({rows[0].score})</p>
                ) : null;
              })}
              {txCats2026.every(c => bCats.every(bc => scoreMatch(c, bc) < 40)) && (
                <p className="text-xs text-red-500 italic">Ningún match — las cats del presupuesto no coinciden con las del ledger</p>
              )}
              <p className="text-xs text-red-800 mt-2">Actuals:</p>
              {[...actuals.entries()].slice(0, 8).map(([k, v]) => (
                <p key={k} className="text-xs text-red-700">  {k}: inc={v.income.toFixed(0)} exp={v.expense.toFixed(0)}</p>
              ))}
            </div>
          </div>
        </section>
        );
      })()}

      {/* No budget state */}
      {!currentBudget && (
        <div className="flex flex-col items-center justify-center rounded-[28px] border border-dashed border-[rgba(201,214,238,0.82)] py-20">
          <Target size={48} className="mb-4 text-[#6b7a96]" />
          <h3 className="text-xl font-semibold text-[#101938]">Sin presupuesto para {selectedYear}</h3>
          <p className="mt-2 text-sm text-[#6b7a96]">Crea un presupuesto para empezar a comparar.</p>
          {canAct && (
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#3156d3] px-6 py-3 text-sm font-semibold text-white hover:bg-[#2748b6]"
              >
                <Plus size={16} />
                Crear presupuesto {selectedYear}
              </button>
              {selectedYear === 2026 && (
                <button
                  type="button"
                  onClick={async () => {
                    // Build budget lines from 2025 legacy transactions
                    const byKey = new Map();
                    ledger.postedMovements
                      .filter((m) => Number(m.postedDate?.slice(0, 4)) === 2025)
                      .forEach((m) => {
                        const cat = m.categoryName || '';
                        const dir = m.direction === 'in' ? 'income' : 'expense';
                        const key = `${cat}|${dir}`;
                        const existing = byKey.get(key) || { cat, dir, total: 0 };
                        existing.total += Math.abs(m.netAmount ?? m.amount);
                        byKey.set(key, existing);
                      });

                    const txToBudgetMap_local = new Map([
                      ['EGR-ADM','Administrativo'],['EGR-CXP','Administrativo'],['EGR-GES','Administrativo'],
                      ['EGR-SUB','Subcontratos'],
                      ['EGR-MO','Salarios'],['Nomina','Salarios'],
                      ['EGR-ARR','Vivienda'],
                      ['EGR-SEG','Seguros'],
                      ['EGR-TRN','Cuotas vehiculos'],
                      ['EGR-GAS','Combustible'],['Gasolina','Combustible'],
                      ['EGR-MAT','Materiales'],
                      ['EGR-FIN','Impuestos'],['EGR-IMP','Impuestos'],
                      ['EGR-EQP','Equipos'],['EGR-HERR','Equipos'],
                      ['EGR-SRV','Servicios'],
                      ['EGR-OTR','Otros'],
                      ['ING-FAC','Servicios'],['ING-SRV','Servicios'],
                      ['ING-OTR','SP'],['SP','SP'],
                    ]);

                    const seen = new Set();
                    const lines = [];
                    byKey.forEach(({ cat, dir, total }) => {
                      const budCat = txToBudgetMap_local.get(cat);
                      if (!budCat) return;
                      const key2 = `${budCat}|${dir}`;
                      if (seen.has(key2)) return;
                      seen.add(key2);
                      const monthly = Array(12).fill(Math.round(total / 12));
                      lines.push({ categoryName: budCat, type: dir, monthlyBudget: monthly });
                    });

                    if (lines.length === 0) {
                      showToast('No se encontraron transacciones de 2025 para basar el presupuesto', 'error');
                      return;
                    }

                    const result = await createBudget({ year: 2026, projectId: null, projectName: 'Empresa', lines });
                    if (result.success) {
                      showToast('Presupuesto 2026 generado desde datos de 2025', 'success');
                    } else {
                      showToast('Error al crear presupuesto', 'error');
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-[#3156d3] bg-white/84 px-6 py-3 text-sm font-semibold text-[#3156d3] hover:bg-blue-50"
                >
                  <Sparkles size={16} />
                  Generar desde 2025
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {currentBudget && (
        <>
          {/* KPI Cards */}
          <div className="grid gap-4 lg:grid-cols-4">
            <div className="rounded-[26px] border border-[rgba(205,219,243,0.78)] bg-white/82 p-5 shadow-[0_18px_44px_rgba(126,147,190,0.1)]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6980ac]">Ingresos presupuestados</p>
                <TrendingUp size={16} className="text-[#3156d3]" />
              </div>
              <p className="text-[26px] font-semibold tracking-tight text-[#101938]">{formatCurrency(totals.budgetIncome)}</p>
            </div>
            <div className="rounded-[26px] border border-[rgba(205,219,243,0.78)] bg-white/82 p-5 shadow-[0_18px_44px_rgba(126,147,190,0.1)]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6980ac]">Ingresos reales (neto)</p>
                <TrendingUp size={16} className="text-[#0f8f4b]" />
              </div>
              <p className="text-[26px] font-semibold tracking-tight text-[#0f8f4b]">{formatCurrency(totals.actualIncome)}</p>
              <p className={`mt-1 text-xs font-medium ${totals.actualIncome >= totals.budgetIncome ? 'text-[#0f8f4b]' : 'text-[#d46a13]'}`}>
                {totals.budgetIncome > 0 ? (((totals.actualIncome / totals.budgetIncome) - 1) * 100).toFixed(1) : '0'}% del objetivo
              </p>
            </div>
            <div className="rounded-[26px] border border-[rgba(205,219,243,0.78)] bg-white/82 p-5 shadow-[0_18px_44px_rgba(126,147,190,0.1)]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6980ac]">Gastos presupuestados</p>
                <TrendingDown size={16} className="text-[#d47a22]" />
              </div>
              <p className="text-[26px] font-semibold tracking-tight text-[#101938]">{formatCurrency(totals.budgetExpense)}</p>
            </div>
            <div className="rounded-[26px] border border-[rgba(205,219,243,0.78)] bg-white/82 p-5 shadow-[0_18px_44px_rgba(126,147,190,0.1)]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6980ac]">Gastos reales (neto)</p>
                <TrendingDown size={16} className="text-[#c46a19]" />
              </div>
              <p className="text-[26px] font-semibold tracking-tight text-[#c46a19]">{formatCurrency(totals.actualExpense)}</p>
              <p className={`mt-1 text-xs font-medium ${totals.actualExpense <= totals.budgetExpense ? 'text-[#0f8f4b]' : 'text-[#d46a13]'}`}>
                {totals.budgetExpense > 0 ? (((totals.actualExpense / totals.budgetExpense) - 1) * 100).toFixed(1) : '0'}% vs límite
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            {[
              { id: 'summary', label: 'Resumen', icon: List },
              { id: 'detail', label: 'Detalle mensual', icon: BarChart3 },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold transition-all ${
                  activeTab === id
                    ? 'bg-[#3156d3] text-white shadow-lg'
                    : 'border border-[rgba(201,214,238,0.82)] text-[#6b7a96] hover:bg-white hover:text-[#101938]'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          {/* Monthly Chart (always visible) */}
          <section className="rounded-[28px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,249,255,0.9))] p-5 shadow-[0_24px_72px_rgba(126,147,190,0.12)]">
            <div className="mb-4">
              <h3 className="text-[18px] font-semibold tracking-tight text-[#101938]">
                {activeTab === 'summary' ? 'Ingresos y Gastos por mes' : 'Detalle mensual por categoría'}
              </h3>
              <p className="mt-1 text-sm text-[#6b7a96]">Barras: presupuesto. Línea: ejecución real.</p>
            </div>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid stroke="rgba(176,194,226,0.42)" vertical={false} />
                  <XAxis dataKey="name" stroke="#7b8dae" tickLine={false} axisLine={false} />
                  <YAxis stroke="#7b8dae" tickLine={false} axisLine={false} tickFormatter={(v) => `€${Math.round(v / 1000)}k`} />
                  <Tooltip content={<TooltipCard />} />
                  <Bar dataKey="budgetIncome" name="Ingreso presupuestado" fill="#3156d3" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="actualIncome" name="Ingreso real" fill="#0f8f4b" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="budgetExpense" name="Gasto presupuestado" fill="#d47a22" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="actualExpense" name="Gasto real" fill="#c46a19" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Summary Table */}
          {activeTab === 'summary' && (
            <section className="rounded-[28px] border border-[rgba(205,219,243,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,249,255,0.9))] p-5 shadow-[0_24px_72px_rgba(126,147,190,0.12)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-[18px] font-semibold tracking-tight text-[#101938]">Resumen por categoría</h3>
                  <p className="mt-1 text-sm text-[#6b7a96]">Presupuesto vs. real (neto sin IVA). Clic en monto para editar.</p>
                </div>
                {canAct && (
                  <button
                    type="button"
                    onClick={() => setEditingLine({})}
                    className="flex items-center gap-2 rounded-2xl bg-[#3156d3] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2748b6]"
                  >
                    <Plus size={14} />
                    Añadir línea
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left">
                  <thead>
                    <tr className="border-b border-[rgba(201,214,238,0.78)] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6980ac]">
                      <th className="px-4 py-3">Categoría</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3 text-right">Presupuesto</th>
                      <th className="px-4 py-3 text-right">Real (neto)</th>
                      <th className="px-4 py-3 text-right">Desviación</th>
                      <th className="px-4 py-3 text-right">%</th>
                      <th className="px-4 py-3 text-center">Estado</th>
                      {canAct && <th className="px-4 py-3 text-center">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(201,214,238,0.58)]">
                    {summaryRows.map((row) => {
                      const isOver = row.type === 'expense' ? row.variance < 0 : row.variance < 0;
                      return (
                        <tr key={row.id} className="hover:bg-[rgba(90,141,221,0.04)]">
                          <td className="px-4 py-4">
                            <p className="text-sm font-semibold text-[#101938]">{row.categoryName}</p>
                            {row.notes && <p className="text-xs text-[#6b7a96]">{row.notes}</p>}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              row.type === 'income'
                                ? 'border border-[rgba(15,143,75,0.2)] bg-[rgba(15,143,75,0.08)] text-[#0f8f4b]'
                                : 'border border-[rgba(196,106,25,0.2)] bg-[rgba(196,106,25,0.08)] text-[#c46a19]'
                            }`}>
                              {row.type === 'income' ? 'Ingreso' : 'Gasto'}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right text-sm font-semibold text-[#101938]">
                            <EditableCell
                              value={row.totalBudget}
                              formatter={(v) => formatCurrency(v)}
                              onSave={(v) => {
                                const newMonthly = Array(12).fill(v / 12);
                                upsertBudgetLine(currentBudget.id, { ...row, monthlyBudget: newMonthly }).then((r) => {
                                  if (r.success) showToast('Presupuesto actualizado');
                                  else showToast('Error', 'error');
                                });
                              }}
                            />
                          </td>
                          <td className="px-4 py-4 text-right text-sm font-semibold text-[#101938]">
                            {formatCurrency(row.totalActual)}
                          </td>
                          <td className={`px-4 py-4 text-right text-sm font-semibold ${row.variance >= 0 ? 'text-[#0f8f4b]' : 'text-[#d46a13]'}`}>
                            {row.variance >= 0 ? '+' : ''}{formatCurrency(row.variance)}
                          </td>
                          <td className={`px-4 py-4 text-right text-sm font-semibold ${row.pct >= 0 ? 'text-[#0f8f4b]' : 'text-[#d46a13]'}`}>
                            {row.pct >= 0 ? '+' : ''}{row.pct.toFixed(1)}%
                          </td>
                          <td className="px-4 py-4 text-center">
                            {row.variance >= 0
                              ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0f8f4b]"><Check size={12} /> Bajo presupuesto</span>
                              : <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#d46a13]"><AlertTriangle size={12} /> Sobre presupuesto</span>
                            }
                          </td>
                          {canAct && (
                            <td className="px-4 py-4 text-center">
                              <div className="flex justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditingLine(row)}
                                  className="rounded-lg p-1.5 text-[#6b7a96] hover:bg-white hover:text-[#3156d3]"
                                  title="Editar"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    openConfirm(
                                      'Eliminar línea',
                                      'Esta acción no se puede deshacer. Continuar?',
                                      () => {
                                        deleteBudgetLine(currentBudget.id, row.id).then((r) => {
                                          if (r.success) showToast('Línea eliminada');
                                          else showToast('Error', 'error');
                                        });
                                      }
                                    );
                                  }}
                                  className="rounded-lg p-1.5 text-[#6b7a96] hover:bg-white hover:text-[#d46a13]"
                                  title="Eliminar"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {summaryRows.length === 0 && (
                      <tr>
                        <td colSpan={canAct ? 8 : 7} className="px-4 py-10 text-center text-sm text-[#6b7a96]">
                          Sin líneas de presupuesto. Clica "Añadir línea" para empezar.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {summaryRows.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-[rgba(201,214,238,0.82)] font-semibold">
                        <td className="px-4 py-3 text-sm text-[#101938]" colSpan={2}>TOTALES</td>
                        <td className="px-4 py-3 text-right text-sm text-[#101938]">{formatCurrency(totals.budgetIncome - totals.budgetExpense)}</td>
                        <td className="px-4 py-3 text-right text-sm text-[#101938]">{formatCurrency(totals.actualIncome - totals.actualExpense)}</td>
                        <td className={`px-4 py-3 text-right text-sm ${(totals.budgetNet - totals.actualNet) >= 0 ? 'text-[#0f8f4b]' : 'text-[#d46a13]'}`}>
                          {(totals.budgetNet - totals.actualNet) >= 0 ? '+' : ''}{formatCurrency(totals.budgetNet - totals.actualNet)}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          )}

          {/* Detail: per-month breakdown */}
          {activeTab === 'detail' && currentBudget.lines?.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-semibold tracking-tight text-[#101938]">Desglose mensual</h3>
                {canAct && (
                  <button
                    type="button"
                    onClick={() => setEditingLine({})}
                    className="flex items-center gap-2 rounded-2xl bg-[#3156d3] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2748b6]"
                  >
                    <Plus size={14} />
                    Añadir línea
                  </button>
                )}
              </div>
              {currentBudget.lines
                .filter((line) => line.monthlyBudget.some((v) => v > 0))
                .map((line) => (
                  <div key={line.id} className="rounded-[22px] border border-[rgba(205,219,243,0.82)] bg-white/90 p-5 shadow-[0_12px_40px_rgba(126,147,190,0.08)]">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h4 className="text-[15px] font-semibold text-[#101938]">{line.categoryName}</h4>
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${
                          line.type === 'income' ? 'bg-[rgba(15,143,75,0.1)] text-[#0f8f4b]' : 'bg-[rgba(196,106,25,0.1)] text-[#c46a19]'
                        }`}>
                          {line.type === 'income' ? 'Ingreso' : 'Gasto'}
                        </span>
                      </div>
                      {canAct && (
                        <div className="flex gap-1">
                          <button onClick={() => setEditingLine(line)} className="rounded-lg p-1.5 text-[#6b7a96] hover:bg-[rgba(90,141,221,0.08)] hover:text-[#3156d3]">
                            <Edit3 size={14} />
                          </button>
                          <button onClick={() => {
                            openConfirm(
                              'Eliminar línea',
                              'Esta acción no se puede deshacer. Continuar?',
                              () => deleteBudgetLine(currentBudget.id, line.id)
                            );
                          }} className="rounded-lg p-1.5 text-[#6b7a96] hover:bg-[rgba(214,106,19,0.08)] hover:text-[#d46a13]">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-6 gap-2 md:grid-cols-12">
                      {MONTHS.map((m, i) => {
                        const budget = line.monthlyBudget[i] || 0;
                        const key = `${line.categoryName}|${line.type}|${i}`;
                        const actual = line.type === 'income'
                          ? (actuals.get(key)?.income || 0)
                          : (actuals.get(key)?.expense || 0);
                        const isPast = i < CURRENT_MONTH || selectedYear < CURRENT_YEAR;
                        return (
                          <div key={m} className="flex flex-col items-center gap-1 rounded-xl border border-[rgba(201,214,238,0.58)] bg-white/70 p-2">
                            <span className="text-[9px] font-semibold text-[#6b7a96]">{m}</span>
                            <div className="text-center">
                              <p className="text-[10px] font-semibold text-[#3156d3]">{formatCurrency(budget)}</p>
                              {isPast && (
                                <p className={`text-[10px] font-medium ${actual <= budget ? 'text-[#0f8f4b]' : 'text-[#d46a13]'}`}>
                                  {formatCurrency(actual)}
                                </p>
                              )}
                              {!isPast && (
                                <p className="text-[10px] italic text-[#6b7a96]">—</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </section>
          )}
        </>
      )}

      {/* Modals */}
      <CreateBudgetModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        projects={projects}
        year={selectedYear}
        onSubmit={async (data) => {
          const result = await createBudget(data);
          if (result.success) {
            showToast('Presupuesto creado');
          } else {
            showToast('Error al crear presupuesto', 'error');
          }
        }}
      />

      <BudgetLineModal
        isOpen={Boolean(editingLine)}
        onClose={() => setEditingLine(null)}
        line={editingLine}
        categories={categories}
        allCategories={[
          ...categories.expenseCategories.map((n) => ({ name: n, type: 'expense' })),
          ...categories.incomeCategories.map((n) => ({ name: n, type: 'income' })),
        ]}
        onSave={(lineData) => {
          if (!currentBudget) return;
          upsertBudgetLine(currentBudget.id, lineData).then((r) => {
            if (r.success) showToast('Línea guardada');
            else showToast('Error al guardar', 'error');
          });
        }}
      />

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={() => { confirmState.onConfirm?.(); closeConfirm(); }}
        onCancel={closeConfirm}
      />
    </div>
  );
};

export default BudgetVsActual;
