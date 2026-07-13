import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  ReceiptText,
  Upload,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useFinanceLedgerContext } from '../../contexts/FinanceLedgerContext';
import { usePayables } from '../../hooks/usePayables';
import { useReceivables } from '../../hooks/useReceivables';
import { useProjects } from '../../hooks/useProjects';
import { useTreasuryMetrics } from '../../hooks/useTreasuryMetrics';
import {
  buildCxcDraftsFromRows,
  matchClearRowsToPayables,
  OPS_WEEK_CSV_TEMPLATE,
  parseOpsWeekCsv,
} from '../../finance/opsWeekImport';
import { formatCurrency } from '../../utils/formatters';
import { Badge, Button, EmptyState, KPI, KPIGrid, Panel } from '@/components/ui/nexus';

/**
 * F1 bridge: import weekly production CSV →
 *  - clear ops on matching CXP
 *  - draft CXC for client billing
 */
const OpsWeekBridge = ({ user }) => {
  const { showToast } = useToast();
  const ledger = useFinanceLedgerContext();
  const metrics = useTreasuryMetrics({ user, ledger });
  const { projects } = useProjects(user);
  const { setOpsCleared } = usePayables(user);
  const { createReceivable } = useReceivables(user);

  const [parseResult, setParseResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  const payables = useMemo(
    () => (metrics.payables || []).filter((p) => p.source === 'payable'),
    [metrics.payables],
  );

  const clearRows = useMemo(
    () => (parseResult?.rows || []).filter((r) => r.kind === 'clear'),
    [parseResult],
  );
  const cxcRows = useMemo(
    () => (parseResult?.rows || []).filter((r) => r.kind === 'cxc'),
    [parseResult],
  );

  const clearMatches = useMemo(
    () => matchClearRowsToPayables(clearRows, payables, projects),
    [clearRows, payables, projects],
  );

  const cxcDrafts = useMemo(
    () => buildCxcDraftsFromRows(cxcRows, projects),
    [cxcRows, projects],
  );

  const downloadTemplate = () => {
    const blob = new Blob([OPS_WEEK_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'umtelkomd-ops-semana-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const result = parseOpsWeekCsv(text);
    setParseResult(result);
    setLog([]);
    if (!result.ok) {
      showToast(result.error || 'CSV inválido', 'error');
    } else {
      showToast(`${result.rows.length} fila(s) leídas`, 'success');
    }
  };

  const applyClears = async () => {
    const toApply = clearMatches.filter((m) => m.match?.payable && !m.alreadyCleared);
    if (!toApply.length) {
      showToast('No hay CXP nuevas para validar', 'info');
      return;
    }
    setBusy(true);
    const lines = [];
    let ok = 0;
    for (const m of toApply) {
      const r = await setOpsCleared(m.match.payable, {
        cleared: true,
        productionWeekRef: m.row.week,
        note: m.row.description || `import CSV L${m.row.line}`,
      });
      if (r.success) {
        ok += 1;
        lines.push(`✓ ${m.match.payable.counterpartyName} · ${m.row.week}`);
      } else {
        lines.push(`✗ ${m.row.counterparty}: ${r.error?.message || 'error'}`);
      }
    }
    setLog((prev) => [...lines, ...prev]);
    setBusy(false);
    showToast(`${ok}/${toApply.length} CXP validadas`, ok ? 'success' : 'error');
  };

  const createCxcDrafts = async () => {
    if (!cxcDrafts.length) {
      showToast('No hay filas cxc en el CSV', 'info');
      return;
    }
    setBusy(true);
    const lines = [];
    let ok = 0;
    for (const d of cxcDrafts) {
      const r = await createReceivable(d.payload);
      if (r.success) {
        ok += 1;
        lines.push(`✓ CXC ${d.payload.client} ${formatCurrency(d.payload.amount)}`);
      } else {
        lines.push(`✗ CXC ${d.payload.client}: ${r.error?.message || 'error'}`);
      }
    }
    setLog((prev) => [...lines, ...prev]);
    setBusy(false);
    showToast(`${ok}/${cxcDrafts.length} borradores CXC creados`, ok ? 'success' : 'error');
  };

  const matchedCount = clearMatches.filter((m) => m.match).length;
  const pendingClear = clearMatches.filter((m) => m.match && !m.alreadyCleared).length;

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-mono text-[var(--color-fg-3)]">Ops · F1</p>
          <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
            Semana de producción
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-fg-3)]">
            Importá el CSV semanal: validá CXP de cuadrillas (sin parte validado no se paga) y
            generá borradores CXC de cobro a cliente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Download} onClick={downloadTemplate}>
            Plantilla CSV
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <span className="nx-btn nx-btn-primary inline-flex cursor-pointer items-center gap-2 px-4 py-2 text-sm">
              <Upload size={14} />
              Subir CSV
            </span>
          </label>
        </div>
      </header>

      <KPIGrid cols={4}>
        <KPI label="Filas clear" value={clearRows.length} icon={CheckCircle2} />
        <KPI label="Match CXP" value={matchedCount} meta={`${pendingClear} nuevas`} tone="warn" />
        <KPI label="Filas CXC" value={cxcRows.length} icon={ReceiptText} />
        <KPI
          label="Estado parse"
          value={parseResult ? (parseResult.ok ? 'OK' : 'Error') : '—'}
          tone={parseResult?.ok ? 'ok' : parseResult ? 'err' : 'neutral'}
          icon={FileSpreadsheet}
        />
      </KPIGrid>

      {!parseResult && (
        <EmptyState
          icon={FileSpreadsheet}
          title="Sin archivo cargado"
          description="Descargá la plantilla, completá kind=clear (pagar cuadrilla) y kind=cxc (cobrar cliente), y subila."
          action={
            <Button variant="primary" icon={Download} onClick={downloadTemplate}>
              Descargar plantilla
            </Button>
          }
        />
      )}

      {parseResult && !parseResult.ok && (
        <Panel title="Error de CSV">
          <p className="text-sm text-[var(--color-err)]">{parseResult.error}</p>
          {(parseResult.errors || []).slice(0, 8).map((e) => (
            <p key={e} className="text-[12px] text-[var(--color-fg-3)]">
              {e}
            </p>
          ))}
        </Panel>
      )}

      {parseResult?.ok && (
        <>
          <Panel
            title="Validar producción → CXP"
            meta={`${pendingClear} por aplicar`}
            actions={
              <Button
                variant="primary"
                icon={busy ? Loader2 : CheckCircle2}
                disabled={busy || !pendingClear}
                onClick={applyClears}
              >
                Aplicar validaciones
              </Button>
            }
            padding={false}
          >
            {clearMatches.length === 0 ? (
              <p className="px-5 py-4 text-sm text-[var(--color-fg-3)]">Sin filas clear.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="nx-table w-full">
                  <thead>
                    <tr>
                      <th>Línea</th>
                      <th>Semana</th>
                      <th>Proveedor</th>
                      <th className="text-right">Importe</th>
                      <th>Match CXP</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clearMatches.map((m) => (
                      <tr key={`c-${m.row.line}`}>
                        <td className="font-mono text-[12px]">{m.row.line}</td>
                        <td>{m.row.week}</td>
                        <td>{m.row.counterparty}</td>
                        <td className="text-right font-mono">{formatCurrency(m.row.amount)}</td>
                        <td className="text-sm">
                          {m.match
                            ? `${m.match.payable.counterpartyName} · ${formatCurrency(m.match.payable.openAmount)}`
                            : '— sin match —'}
                        </td>
                        <td>
                          {!m.match ? (
                            <Badge variant="err">Sin match</Badge>
                          ) : m.alreadyCleared ? (
                            <Badge variant="ok">Ya OK</Badge>
                          ) : (
                            <Badge variant="warn">Pendiente</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Borradores CXC (cobro)"
            meta={`${cxcDrafts.length} filas`}
            actions={
              <Button
                variant="primary"
                icon={busy ? Loader2 : ReceiptText}
                disabled={busy || !cxcDrafts.length}
                onClick={createCxcDrafts}
              >
                Crear borradores CXC
              </Button>
            }
            padding={false}
          >
            {cxcDrafts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-[var(--color-fg-3)]">Sin filas cxc.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="nx-table w-full">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Semana</th>
                      <th>Proyecto</th>
                      <th>Documento</th>
                      <th className="text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cxcDrafts.map((d) => (
                      <tr key={`x-${d.row.line}`}>
                        <td>{d.payload.client}</td>
                        <td>{d.row.week}</td>
                        <td className="text-sm text-[var(--color-fg-3)]">
                          {d.payload.projectName || d.payload.projectId || '—'}
                        </td>
                        <td className="font-mono text-[12px]">{d.payload.documentNumber}</td>
                        <td className="text-right font-mono">{formatCurrency(d.payload.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {log.length > 0 && (
        <Panel title="Resultado">
          <ul className="space-y-1 font-mono text-[12px] text-[var(--color-fg-2)]">
            {log.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
};

export default OpsWeekBridge;
