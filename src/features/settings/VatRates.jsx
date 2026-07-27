import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Percent } from 'lucide-react';
import { useVatRates } from '../../hooks/useVatRates';
import { useCategories } from '../../hooks/useCategories';
import { categoriesMissingVatRate, isValidVatRate } from '../../finance/vatRates';

/**
 * Only the rates German VAT law actually has. A free-text field invites the one
 * typo that matters — 19 instead of 0.19 — which would multiply every project
 * cost by ~16%, so the choice is closed.
 */
const RATE_OPTIONS = [
  { value: '', label: 'Sin configurar' },
  { value: '0', label: '0 %' },
  { value: '0.07', label: '7 %' },
  { value: '0.19', label: '19 %' },
];

const optionValueFor = (rate) => (isValidVatRate(rate) ? String(rate) : '');

const CategoryRow = ({ name, rate, onChange, disabled }) => {
  const configured = isValidVatRate(rate);

  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] text-[var(--color-fg-1)]">{name}</p>
        {!configured && (
          <p className="label-mono mt-0.5 text-[var(--color-warn)]">Sin configurar</p>
        )}
      </div>
      <select
        aria-label={`IVA de ${name}`}
        value={optionValueFor(rate)}
        disabled={disabled}
        onChange={(event) => onChange(name, event.target.value)}
        className={`w-40 shrink-0 rounded-md border bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-accent)] ${
          configured ? 'border-[var(--color-line)]' : 'border-[var(--color-warn)]'
        }`}
      >
        {RATE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </li>
  );
};

/**
 * Configuración → IVA: the VAT rate behind each category.
 *
 * These rates only change what a project or a budget line COST (net, VAT
 * reclaimed as Vorsteuer). Cash, the reconciliation anchors and the forecast
 * stay gross — the bank moves gross — so nothing set here can move the balance.
 */
const VatRates = ({ user }) => {
  const { categoryRates, loading, saveRate, clearRate } = useVatRates(user);
  const { expenseCategories, incomeCategories, loading: categoriesLoading } = useCategories(user);

  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);

  const missing = useMemo(
    () => categoriesMissingVatRate([...expenseCategories, ...incomeCategories], categoryRates),
    [expenseCategories, incomeCategories, categoryRates],
  );

  // A rate belongs to a category NAME, and a few names ("Otros") live in both
  // lists. Rendering both would put two controls on one stored value, where
  // editing either silently moves the other. The income list therefore only
  // shows the names the expense list has not already claimed.
  const incomeOnlyCategories = useMemo(
    () => incomeCategories.filter((name) => !expenseCategories.includes(name)),
    [expenseCategories, incomeCategories],
  );
  const sharedCategories = useMemo(
    () => incomeCategories.filter((name) => expenseCategories.includes(name)),
    [expenseCategories, incomeCategories],
  );

  const flash = (message, tone = 'ok') => {
    setFeedback({ message, tone });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleChange = async (name, value) => {
    setSaving(true);
    const result = value === '' ? await clearRate(name) : await saveRate(name, value);
    setSaving(false);

    if (result.success) {
      flash(value === '' ? `${name} vuelve a estar sin configurar.` : `IVA de ${name} guardado.`);
    } else {
      flash(`No se pudo guardar el IVA de ${name}.`, 'err');
    }
  };

  if (loading || categoriesLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-[var(--color-accent)] animate-spin" />
        <span className="ml-3 text-[var(--color-fg-3)]">Preparando tipos de IVA…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className="rounded-md border px-4 py-3 text-sm"
          style={{
            borderColor: feedback.tone === 'err' ? 'var(--color-err)' : 'var(--color-line-s)',
            color: feedback.tone === 'err' ? 'var(--color-err)' : 'var(--color-fg-1)',
            background: 'var(--color-bg-1)',
          }}
        >
          {feedback.message}
        </div>
      )}

      {/* ── Why this screen exists ─────────────────────────────────────────── */}
      <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
        <div className="flex items-center gap-3 mb-1">
          <Percent size={18} className="text-[var(--color-accent)]" />
          <h2 className="font-display text-lg font-medium text-[var(--color-fg-1)]">
            IVA por categoría
          </h2>
        </div>
        <p className="text-[13px] text-[var(--color-fg-3)] mb-4 max-w-2xl">
          El extracto bancario llega bruto y sin columna de IVA. Estos tipos son los que convierten
          ese bruto en el coste neto de proyectos y presupuestos, porque el IVA soportado se
          recupera vía Vorsteuer y no es coste de obra. No altera la caja, ni las anclas de
          conciliación, ni el forecast: el banco sigue moviendo importes brutos.
        </p>

        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
          <p className="label-mono text-[var(--color-fg-3)]">Estado de configuración</p>
          <p className="font-mono text-[24px] tabular-nums text-[var(--color-fg-1)] mt-1">
            {missing.length > 0
              ? `${missing.length} categorías sin configurar`
              : 'Todas las categorías tienen IVA configurado'}
          </p>
          <p className="text-[12px] text-[var(--color-fg-4)] mt-1">
            Una categoría sin configurar se calcula como 0 % — es decir, neto igual a bruto. No es
            una decisión, es una decisión pendiente.
          </p>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-md border border-[var(--color-warn)] bg-[var(--color-bg-2)] px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
          <p className="text-[13px] leading-6 text-[var(--color-fg-3)]">
            <span className="text-[var(--color-fg-1)]">Subcontratos</span> depende del §13b UStG
            (Steuerschuldnerschaft des Leistungsempfängers). Si el subcontratista factura con
            inversión del sujeto pasivo, la factura llega sin IVA y el coste del proyecto es el
            importe íntegro; si factura con IVA, el coste es un 19 % menor. Confirma cómo facturan
            tus subcontratistas antes de fijar este tipo.
          </p>
        </div>
      </div>

      {/* ── Expense categories ─────────────────────────────────────────────── */}
      <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
        <h2 className="font-display text-lg font-medium text-[var(--color-fg-1)] mb-1">
          Categorías de gasto
        </h2>
        <p className="text-[13px] text-[var(--color-fg-3)] mb-4 max-w-2xl">
          Impuestos, intereses, salarios y seguros no llevan IVA alemán, por eso vienen fijados a
          0 %.
        </p>
        <ul className="divide-y divide-[var(--color-line)]">
          {expenseCategories.map((name) => (
            <CategoryRow
              key={name}
              name={name}
              rate={categoryRates[name]}
              onChange={handleChange}
              disabled={saving}
            />
          ))}
        </ul>
      </div>

      {/* ── Income categories ──────────────────────────────────────────────── */}
      <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
        <h2 className="font-display text-lg font-medium text-[var(--color-fg-1)] mb-1">
          Categorías de ingreso
        </h2>
        <p className="text-[13px] text-[var(--color-fg-3)] mb-4 max-w-2xl">
          El IVA repercutido no es ingreso: se recauda para Hacienda. Los servicios financieros
          están exentos (§4 Nr. 8/10 UStG).
          {sharedCategories.length > 0 && (
            <>
              {' '}
              El tipo se guarda por nombre de categoría, así que{' '}
              {sharedCategories.join(', ')} se configura arriba, en gastos.
            </>
          )}
        </p>
        <ul className="divide-y divide-[var(--color-line)]">
          {incomeOnlyCategories.map((name) => (
            <CategoryRow
              key={name}
              name={name}
              rate={categoryRates[name]}
              onChange={handleChange}
              disabled={saving}
            />
          ))}
        </ul>
      </div>
    </div>
  );
};

export default VatRates;
