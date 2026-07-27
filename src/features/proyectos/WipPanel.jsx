/**
 * WipPanel — executed work of ONE obra that has not become an invoice yet.
 *
 * This is the early-warning surface: a site accumulating uncertified execution
 * is money frozen for an administrative reason, not a commercial one, and with
 * overdue payables on the other side certifying it is the highest-value action
 * available. So the panel does two jobs — it shows the figure, and it makes its
 * AGE uncomfortable.
 *
 * Capture is deliberately four fields (amount, stage, date, optional note) with
 * the obra already fixed and the date pre-filled with today: anything slower
 * than a few seconds and nobody keeps it up to date, and the feature rots.
 *
 * ⚠️ Nothing here touches cash. WIP is not a bank balance and not a receivable.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Snowflake } from 'lucide-react';
import { Badge, Button, Panel } from '@/components/ui/nexus';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useWorkInProgress } from '../../hooks/useWorkInProgress';
import { WIP_STAGE, summarizeWip } from '../../finance/workInProgress';

const STAGE_LABEL = {
  [WIP_STAGE.EXECUTED]: 'Ejecutado sin certificar',
  [WIP_STAGE.CERTIFIED]: 'Certificado sin facturar',
};

/** Age → NEXUS.OS semantic colour. Thresholds live in the pure module. */
const TONE_COLOR = {
  ok: 'var(--color-fg-3)',
  warn: 'var(--color-warn)',
  critical: 'var(--color-err)',
};

const TONE_BADGE = { ok: 'neutral', warn: 'warn', critical: 'err' };

const normalize = (value) => String(value ?? '').trim().toLowerCase();

/**
 * An entry belongs to this obra when it matches by id OR by any of the names the
 * project is known under — entries captured before a project had an id, or typed
 * against its display name, must not silently vanish from their own site.
 */
const belongsToProject = (entry, project) => {
  const tokens = [project?.id, project?.code, project?.name, project?.displayName]
    .map(normalize)
    .filter(Boolean);
  return tokens.includes(normalize(entry?.projectId)) || tokens.includes(normalize(entry?.projectName));
};

const todayIso = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const WipPanel = ({ project, user }) => {
  const { entries, loading, error, recordWip, markInvoiced } = useWorkInProgress(user);

  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState(WIP_STAGE.EXECUTED);
  const [asOf, setAsOf] = useState(todayIso);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const today = useMemo(() => new Date(), []);

  const summary = useMemo(() => {
    if (!project) return summarizeWip([], today);
    return summarizeWip(
      (entries || []).filter((entry) => belongsToProject(entry, project)),
      today,
    );
  }, [entries, project, today]);

  if (!project) return null;

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');

    setSaving(true);
    let result;
    try {
      result = await recordWip({
        projectId: project.id,
        projectName: project.name || project.displayName || project.code || '',
        amount,
        asOf,
        stage,
        note,
      });
    } finally {
      setSaving(false);
    }

    if (!result?.success) {
      setFormError(
        {
          'invalid-amount': 'Escribe un importe mayor que 0.',
          'invalid-date': 'Escribe una fecha válida.',
          'invalid-stage': 'Elige un estado válido.',
          'invalid-project': 'Falta la obra.',
          'no-user': 'Necesitas sesión iniciada para registrar.',
        }[result?.error] || 'No se pudo guardar. Inténtalo de nuevo.',
      );
      return;
    }

    // Keep stage and date: capturing several obras in a row is the real usage.
    setAmount('');
    setNote('');
  };

  const meta =
    summary.entries.length > 0
      ? `${summary.entries.length} registro${summary.entries.length === 1 ? '' : 's'}`
      : 'Sin registrar';

  return (
    <Panel title="Obra ejecutada sin facturar" meta={meta}>
      <div data-testid="wip-panel">
        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-md border border-[var(--color-err)] bg-[var(--color-bg-2)] px-4 py-3">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-[var(--color-err)]" />
            <p className="font-mono text-[12px] text-[var(--color-err)]">
              No se pudo cargar la obra ejecutada. Recarga la página.
            </p>
          </div>
        )}

        {summary.total > 0 ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="label-mono text-[var(--color-fg-3)]">Pendiente de facturar</p>
                <p
                  data-testid="wip-total"
                  className="mt-1 font-mono text-[32px] leading-[1] tabular-nums tracking-tight"
                  style={{ color: TONE_COLOR[summary.tone] }}
                >
                  {formatCurrency(summary.total)}
                </p>
              </div>
              <p className="label-mono text-[var(--color-fg-4)]">
                Ejecutado {formatCurrency(summary.byStage.executed)} · Certificado{' '}
                {formatCurrency(summary.byStage.certified)}
              </p>
            </div>

            {summary.stale && (
              <div className="mt-4 flex items-start gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
                <Snowflake
                  size={16}
                  className="mt-0.5 flex-shrink-0"
                  style={{ color: TONE_COLOR[summary.tone] }}
                />
                <div>
                  <p className="font-mono text-[12px]" style={{ color: TONE_COLOR[summary.tone] }}>
                    Dinero congelado por papeleo — lo más antiguo lleva {summary.oldestDays} días
                    sin facturar.
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--color-fg-4)]">
                    No es que el cliente no pague: todavía no se le ha pedido. Certificar y facturar
                    esta obra es la acción de más valor disponible ahora mismo.
                  </p>
                </div>
              </div>
            )}

            <ul data-testid="wip-entries" className="mt-4 divide-y divide-[var(--color-line)]">
              {summary.entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] text-[var(--color-fg-1)]">
                        {STAGE_LABEL[entry.stage]}
                      </span>
                      <Badge variant={TONE_BADGE[entry.ageTone]}>hace {entry.ageDays} días</Badge>
                    </div>
                    <p className="label-mono mt-1 text-[var(--color-fg-4)]">
                      Medido el {formatDate(entry.asOf)}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <span
                      className="font-mono text-[15px] tabular-nums tracking-tight"
                      style={{ color: TONE_COLOR[entry.ageTone] }}
                    >
                      {formatCurrency(entry.amount)}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => markInvoiced(entry.id)}>
                      Facturado
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          !loading && (
            <p className="text-[13px] text-[var(--color-fg-4)]">
              Sin obra ejecutada registrada. Anota abajo lo que ya está hecho y todavía no se ha
              facturado — mientras no esté aquí, la empresa parece más pobre de lo que es.
            </p>
          )
        )}

        <form onSubmit={submit} className="mt-5 border-t border-[var(--color-line)] pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]" id="wip-amount-label">
                Importe (€)
              </span>
              <input
                id="wip-amount"
                aria-labelledby="wip-amount-label"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="55000"
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 font-mono text-[14px] tabular-nums text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]" id="wip-stage-label">
                Estado
              </span>
              <select
                id="wip-stage"
                aria-labelledby="wip-stage-label"
                value={stage}
                onChange={(event) => setStage(event.target.value)}
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-[14px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
              >
                <option value={WIP_STAGE.EXECUTED}>{STAGE_LABEL[WIP_STAGE.EXECUTED]}</option>
                <option value={WIP_STAGE.CERTIFIED}>{STAGE_LABEL[WIP_STAGE.CERTIFIED]}</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]" id="wip-asof-label">
                Medido el
              </span>
              <input
                id="wip-asof"
                aria-labelledby="wip-asof-label"
                type="date"
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 font-mono text-[13px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block label-mono text-[var(--color-fg-4)]" id="wip-note-label">
                Nota (opcional)
              </span>
              <input
                id="wip-note"
                aria-labelledby="wip-note-label"
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="KW29 pendiente de Aufmaß"
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2 text-[14px] text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="sm" icon={Plus} loading={saving}>
              Registrar
            </Button>
            <p className="label-mono text-[var(--color-fg-4)]">
              Cada registro sustituye al anterior de ese estado; el previo queda como histórico.
            </p>
          </div>

          {formError && (
            <p role="alert" className="mt-2 font-mono text-[12px] text-[var(--color-err)]">
              {formError}
            </p>
          )}
        </form>
      </div>
    </Panel>
  );
};

export default WipPanel;
