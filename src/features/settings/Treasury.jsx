import React, { useState } from 'react';
import { Anchor, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useReconciliation } from '../../hooks/useReconciliation';
import { useTreasurySettings } from '../../hooks/useTreasurySettings';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { Button } from '@/components/ui/nexus';

const todayIso = () => new Date().toISOString().slice(0, 10);
const currentMonthKey = () => todayIso().slice(0, 7);

/**
 * Configuración → Tesorería: reconciliation anchors (the trusted base of the
 * cash position), monthly VAT estimates (Dauerfristverlängerung) and the
 * projected-cash alert buffer.
 */
const Treasury = ({ user }) => {
  const { anchors, loading: anchorsLoading, addAnchor, removeAnchor } = useReconciliation(user);
  const {
    vatEstimates,
    alertBufferEur,
    loading: settingsLoading,
    saveVatEstimate,
    removeVatEstimate,
    saveAlertBuffer,
  } = useTreasurySettings(user);
  const metrics = useTreasuryMetrics({ user });

  const [anchorForm, setAnchorForm] = useState({
    date: todayIso(),
    balance: '',
    source: '',
    note: '',
  });
  const [vatForm, setVatForm] = useState({ month: currentMonthKey(), amount: '' });
  const [bufferDraft, setBufferDraft] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);

  const flash = (message, tone = 'ok') => {
    setFeedback({ message, tone });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleAddAnchor = async (event) => {
    event.preventDefault();
    setSaving(true);
    const result = await addAnchor(anchorForm);
    setSaving(false);
    if (result.success) {
      setAnchorForm({ date: todayIso(), balance: '', source: '', note: '' });
      flash('Ancla de conciliación guardada.');
    } else {
      flash('No se pudo guardar el ancla. Revisa fecha, saldo y fuente.', 'err');
    }
  };

  const handleAddVat = async (event) => {
    event.preventDefault();
    setSaving(true);
    const result = await saveVatEstimate(vatForm);
    setSaving(false);
    if (result.success) {
      setVatForm({ month: currentMonthKey(), amount: '' });
      flash('Estimado de IVA guardado.');
    } else {
      flash('No se pudo guardar el estimado de IVA.', 'err');
    }
  };

  const handleSaveBuffer = async () => {
    setSaving(true);
    const result = await saveAlertBuffer(bufferDraft);
    setSaving(false);
    if (result.success) {
      setBufferDraft(null);
      flash('Colchón de alertas actualizado.');
    } else {
      flash('Importe de colchón no válido.', 'err');
    }
  };

  if (anchorsLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-[var(--color-accent)] animate-spin" />
        <span className="ml-3 text-[var(--color-fg-3)]">Preparando tesorería…</span>
      </div>
    );
  }

  const inputClass =
    'w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-accent)]';
  const labelClass = 'label-mono text-[var(--color-fg-3)] mb-1 block';

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

      {/* ── Reconciliation anchors ─────────────────────────────────────────── */}
      <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
        <div className="flex items-center gap-3 mb-1">
          <Anchor size={18} className="text-[var(--color-accent)]" />
          <h2 className="font-display text-lg font-medium text-[var(--color-fg-1)]">
            Anclas de conciliación
          </h2>
        </div>
        <p className="text-[13px] text-[var(--color-fg-3)] mb-4 max-w-2xl">
          Un ancla es un saldo bancario verificado en una fecha (extracto o DATEV). La caja actual
          se calcula desde el ancla más reciente más los movimientos importados posteriores.
        </p>

        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 mb-4">
          <p className="label-mono text-[var(--color-fg-3)]">Saldo derivado hoy</p>
          <p className="font-mono text-[24px] tabular-nums text-[var(--color-fg-1)] mt-1">
            {formatCurrency(metrics.currentCash ?? 0)}
          </p>
          <p className="text-[12px] text-[var(--color-fg-4)] mt-1">
            {metrics.cashSource === 'anchors' && metrics.cashMeta?.anchor
              ? `Basado en el ancla del ${formatDate(metrics.cashMeta.anchor.date)} (${formatCurrency(metrics.cashMeta.anchor.balance)}) · último movimiento ${metrics.cashMeta.lastMovementDate ? formatDate(metrics.cashMeta.lastMovementDate) : '—'}`
              : 'Sin anclas: se usa el saldo estático heredado de Cuenta Bancaria.'}
          </p>
        </div>

        {anchors.length > 0 && (
          <ul className="divide-y divide-[var(--color-line)] mb-4">
            {anchors.map((anchor) => (
              <li key={anchor.date} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] text-[var(--color-fg-1)]">
                    <span className="font-mono tabular-nums">{formatDate(anchor.date)}</span>
                    {' · '}
                    <span className="font-mono tabular-nums">{formatCurrency(anchor.balance)}</span>
                  </p>
                  <p className="label-mono text-[var(--color-fg-4)] mt-0.5 truncate">
                    {anchor.source}
                    {anchor.confirmedBy ? ` · ${anchor.confirmedBy}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`¿Eliminar el ancla del ${formatDate(anchor.date)}?`)) {
                      removeAnchor(anchor.date);
                    }
                  }}
                  className="p-2 rounded-md text-[var(--color-fg-4)] hover:text-[var(--color-err)] hover:bg-[var(--color-bg-2)] transition-colors"
                  aria-label={`Eliminar ancla del ${formatDate(anchor.date)}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddAnchor} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className={labelClass} htmlFor="anchor-date">Fecha</label>
            <input
              id="anchor-date"
              type="date"
              className={inputClass}
              value={anchorForm.date}
              max={todayIso()}
              onChange={(e) => setAnchorForm((f) => ({ ...f, date: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="anchor-balance">Saldo verificado (€)</label>
            <input
              id="anchor-balance"
              type="number"
              step="0.01"
              className={inputClass}
              value={anchorForm.balance}
              onChange={(e) => setAnchorForm((f) => ({ ...f, balance: e.target.value }))}
              placeholder="1214.20"
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="anchor-source">Fuente</label>
            <input
              id="anchor-source"
              type="text"
              className={inputClass}
              value={anchorForm.source}
              onChange={(e) => setAnchorForm((f) => ({ ...f, source: e.target.value }))}
              placeholder="Extracto Volksbank / DATEV"
              required
            />
          </div>
          <Button type="submit" disabled={saving}>
            <Plus size={14} />
            Registrar ancla
          </Button>
        </form>
      </div>

      {/* ── VAT estimates ──────────────────────────────────────────────────── */}
      <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
        <div className="flex items-center gap-3 mb-1">
          <ShieldAlert size={18} className="text-[var(--color-accent)]" />
          <h2 className="font-display text-lg font-medium text-[var(--color-fg-1)]">
            IVA estimado por mes
          </h2>
        </div>
        <p className="text-[13px] text-[var(--color-fg-3)] mb-4 max-w-2xl">
          El IVA del mes M vence el día 10 del mes M+2 (Dauerfristverlängerung). Registra aquí el
          importe de cada Voranmeldung para que entre en el calendario y en el forecast.
        </p>

        {vatEstimates.length > 0 && (
          <ul className="divide-y divide-[var(--color-line)] mb-4">
            {vatEstimates.map((entry) => (
              <li key={entry.month} className="flex items-center justify-between gap-3 py-2.5">
                <p className="text-[13px] text-[var(--color-fg-1)]">
                  <span className="font-mono tabular-nums">{entry.month}</span>
                  {' · '}
                  <span className="font-mono tabular-nums">{formatCurrency(entry.amount)}</span>
                </p>
                <button
                  type="button"
                  onClick={() => removeVatEstimate(entry.month)}
                  className="p-2 rounded-md text-[var(--color-fg-4)] hover:text-[var(--color-err)] hover:bg-[var(--color-bg-2)] transition-colors"
                  aria-label={`Eliminar estimado de ${entry.month}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddVat} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className={labelClass} htmlFor="vat-month">Mes</label>
            <input
              id="vat-month"
              type="month"
              className={inputClass}
              value={vatForm.month}
              onChange={(e) => setVatForm((f) => ({ ...f, month: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="vat-amount">IVA a pagar (€)</label>
            <input
              id="vat-amount"
              type="number"
              step="0.01"
              min="0"
              className={inputClass}
              value={vatForm.amount}
              onChange={(e) => setVatForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="13269.06"
              required
            />
          </div>
          <Button type="submit" disabled={saving}>
            <Plus size={14} />
            Guardar estimado
          </Button>
        </form>
      </div>

      {/* ── Alert buffer ───────────────────────────────────────────────────── */}
      <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
        <h2 className="font-display text-lg font-medium text-[var(--color-fg-1)] mb-1">
          Colchón de alertas
        </h2>
        <p className="text-[13px] text-[var(--color-fg-3)] mb-4 max-w-2xl">
          Si la caja proyectada cae por debajo de este importe en las próximas semanas, Resumen
          muestra una alerta.
        </p>
        <div className="flex items-end gap-3 max-w-sm">
          <div className="flex-1">
            <label className={labelClass} htmlFor="alert-buffer">Importe (€)</label>
            <input
              id="alert-buffer"
              type="number"
              step="100"
              min="0"
              className={inputClass}
              value={bufferDraft ?? alertBufferEur}
              onChange={(e) => setBufferDraft(e.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={handleSaveBuffer}
            disabled={saving || bufferDraft == null || String(bufferDraft).trim() === ''}
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Treasury;
