/**
 * ObraSinFacturar — the weekly control of executed work that is not invoiced yet.
 *
 * WipPanel shows one obra at a time, buried in its project dashboard, and so it
 * was never filled in. This screen puts every active obra in one table: type
 * the current figure, press Enter, next obra. A minute a week keeps the whole
 * backlog honest, and the age colours make stale certification impossible to
 * miss (> 30 days = one monthly Aufmaß cycle missed, > 60 = two).
 *
 * Typing 0 closes the current figure (everything was certified / invoiced).
 * Figures are snapshots: a new one supersedes the previous, which stays as
 * history — that is what the trend column compares against.
 *
 * ⚠️ Nothing here touches cash or receivables (see finance/workInProgress.js).
 */
import { useMemo, useState } from 'react';
import { Construction, Snowflake, TrendingDown, TrendingUp } from 'lucide-react';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { useWorkInProgress } from '../../hooks/useWorkInProgress';
import { useToast } from '../../contexts/ToastContext';
import { WIP_STAGE } from '../../finance/workInProgress';
import { wipControlRows } from '../../finance/wipControl';
import { formatCurrency } from '../../utils/formatters';
import { Badge, EmptyState, KPI, KPIGrid, Panel } from '@/components/ui/nexus';
import PageHeader from '../../components/layout/PageHeader';

const TONE_BADGE = { ok: 'neutral', warn: 'warn', critical: 'err' };

const todayIso = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const ERRORS = {
  'invalid-amount': 'Escribe un importe válido (0 para cerrar).',
  'no-user': 'Necesitas sesión iniciada.',
};

/** One editable figure: shows the current amount, Enter records a new one. */
const FigureInput = ({ row, stage, onSave, saving }) => {
  const state = row[stage];
  const [value, setValue] = useState('');
  const label = `${stage === WIP_STAGE.EXECUTED ? 'Ejecutado sin certificar' : 'Certificado sin facturar'} · ${row.projectName}`;

  const commit = async () => {
    if (value.trim() === '') return;
    const ok = await onSave(row, stage, value.trim());
    if (ok) setValue('');
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        aria-label={label}
        disabled={saving}
        value={value}
        placeholder={state.amount > 0 ? formatCurrency(state.amount) : '—'}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
        onBlur={commit}
        className="w-32 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-2 py-1.5 text-right font-mono text-[13px] tabular-nums text-[var(--color-fg-1)] placeholder:text-[var(--color-fg-2)] focus:border-[var(--color-line-s)] focus:outline-none"
      />
    </div>
  );
};

const Trend = ({ delta }) => {
  if (delta === null || delta === undefined) return <span className="text-[var(--color-fg-4)]">—</span>;
  if (Math.abs(delta) < 0.005) return <span className="font-mono text-[12px] text-[var(--color-fg-4)]">=</span>;
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[12px] tabular-nums ${up ? 'text-[var(--color-warn)]' : 'text-[var(--color-ok)]'}`}>
      <Icon size={12} aria-hidden="true" />
      {up ? '+' : '−'}{formatCurrency(Math.abs(delta))}
    </span>
  );
};

const ObraSinFacturar = ({ user }) => {
  const ledger = useFinanceLedgerContext();
  const { entries, loading, error, recordWip, markInvoiced } = useWorkInProgress(user);
  const { showToast } = useToast();
  const [savingKey, setSavingKey] = useState('');
  const today = useMemo(() => new Date(), []);

  const control = useMemo(
    () => wipControlRows({ entries, projects: ledger.projects || [], today }),
    [entries, ledger.projects, today],
  );

  const save = async (row, stage, raw) => {
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) { showToast(ERRORS['invalid-amount'], 'error'); return false; }
    const key = `${row.projectId}:${stage}`;
    setSavingKey(key);
    try {
      if (amount === 0) {
        const current = row[stage];
        if (!current.entryId) return true; // nothing open to close
        const result = await markInvoiced(current.entryId);
        if (result && result.success === false) { showToast('No se pudo cerrar. Inténtalo de nuevo.', 'error'); return false; }
        showToast(`${row.projectName}: cerrado`, 'success');
        return true;
      }
      const result = await recordWip({ projectId: row.projectId, projectName: row.projectName, amount, asOf: todayIso(), stage });
      if (!result?.success) { showToast(ERRORS[result?.error] || 'No se pudo guardar. Inténtalo de nuevo.', 'error'); return false; }
      showToast(`${row.projectName}: ${formatCurrency(amount)} registrado`, 'success');
      return true;
    } finally {
      setSavingKey('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        section="Obra"
        title="Obra sin"
        accent="facturar"
        subtitle="Ejecutado sin certificar y certificado sin facturar, por obra"
      />

      <KPIGrid cols={4}>
        <KPI label="Total sin facturar" value={formatCurrency(control.total)} icon={Construction} />
        <KPI label="Ejecutado sin certificar" value={formatCurrency(control.executed)} />
        <KPI label="Certificado sin facturar" value={formatCurrency(control.certified)} />
        <KPI
          label="Más antiguo"
          value={control.oldestDays === null ? '—' : `${control.oldestDays} días`}
          tone={control.oldestDays > 60 ? 'err' : control.oldestDays > 30 ? 'warn' : 'default'}
          meta={control.neverMeasured ? `${control.neverMeasured} obra${control.neverMeasured === 1 ? '' : 's'} sin medir` : undefined}
        />
      </KPIGrid>

      <Panel title="Por obra" meta="Escribe el importe actual y pulsa Enter · 0 = ya certificado / facturado">
        {error && (
          <p className="mb-3 font-mono text-[12px] text-[var(--color-err)]">No se pudo cargar la obra ejecutada. Recarga la página.</p>
        )}
        {!loading && control.rows.length === 0 ? (
          <EmptyState icon={Construction} title="Sin obras activas" description="Da de alta una obra en Configuración → Proyectos." />
        ) : (
          <div className="overflow-x-auto">
            <table className="nx-table w-full" data-testid="wip-control">
              <thead>
                <tr>
                  <th>Obra</th>
                  <th className="text-right">Ejecutado sin certificar</th>
                  <th className="text-right">Certificado sin facturar</th>
                  <th className="text-right">Total</th>
                  <th>Medido</th>
                  <th>Tendencia</th>
                </tr>
              </thead>
              <tbody>
                {control.rows.map((row) => (
                  <tr key={row.projectId} data-testid={`wip-row-${row.projectId}`}>
                    <td>
                      <p className="text-[13px] text-[var(--color-fg-1)]">{row.projectName}</p>
                      {row.code && <p className="font-mono text-[10px] text-[var(--color-fg-4)]">{row.code}</p>}
                    </td>
                    <td>
                      <FigureInput row={row} stage={WIP_STAGE.EXECUTED} onSave={save} saving={savingKey === `${row.projectId}:${WIP_STAGE.EXECUTED}`} />
                    </td>
                    <td>
                      <FigureInput row={row} stage={WIP_STAGE.CERTIFIED} onSave={save} saving={savingKey === `${row.projectId}:${WIP_STAGE.CERTIFIED}`} />
                    </td>
                    <td className="text-right font-mono tabular-nums text-[var(--color-fg-1)]">
                      {row.total > 0 ? formatCurrency(row.total) : <span className="text-[var(--color-fg-4)]">—</span>}
                    </td>
                    <td>
                      {row.lastMeasured ? (
                        <Badge variant={TONE_BADGE[row.tone]} title={`Última medición ${row.lastMeasured}`}>
                          {row.tone !== 'ok' && <Snowflake size={10} aria-hidden="true" className="mr-1 inline" />}
                          hace {row.ageDays} d
                        </Badge>
                      ) : (
                        <span className="font-mono text-[12px] text-[var(--color-fg-4)]">nunca</span>
                      )}
                    </td>
                    <td><Trend delta={row.executed.delta ?? row.certified.delta} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[12px] text-[var(--color-fg-4)]">
          Amarillo: más de 30 días sin certificar (un ciclo mensual de Aufmaß perdido). Rojo: más de 60 días.
          Nada de esto es caja ni CXC: es trabajo hecho que todavía no se ha pedido cobrar.
        </p>
      </Panel>
    </div>
  );
};

export default ObraSinFacturar;
