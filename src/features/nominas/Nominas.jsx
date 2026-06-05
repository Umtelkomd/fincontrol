import { useEffect, useMemo, useRef, useState } from 'react';
import { FileCheck, FileText, Link2, Pencil, Trash2, Wallet } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useEmployees } from '../../hooks/useEmployees';
import { usePayables } from '../../hooks/usePayables';
import { useCostCenters } from '../../hooks/useCostCenters';
import { useNotifications } from '../../hooks/useNotifications';
import { useFinanceLedger } from '../../hooks/useFinanceLedger';
import { useNominas } from './useNominas';
import CargarNominaModal from './CargarNominaModal';
import NominasAnalytics from './NominasAnalytics';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { Badge, KPI, KPIGrid, EmptyState, Tabs } from '@/components/ui/nexus';
import {
  derivePeriodStatus,
  statusLabel,
  statusBadgeTone,
  periodStatusTransition,
} from './lib/payrollStatus';
import { obligationVariance, periodVarianceSummary } from './lib/payrollVariance';
import { validatePayrollRoster } from './lib/payrollCalendarValidation';
import { exportPersonnelCostPDF, exportPayrollDossierPDF } from '../../utils/pdfExport';
import { exportPayrollWorkbook } from '../../utils/payrollExcelExport';

// ─── Obligation status helpers (mirrors CXP status mapping) ─────────────────
// Live payable terminal status is 'settled' (see finance/constants DOCUMENT_STATUS),
// NOT 'paid'. Using 'paid' here never matched and broke the paid/pending render.

const STATUS_LABELS = {
  issued: 'Pendiente',
  partial: 'Parcial',
  overdue: 'Vencida',
  settled: 'Pagada',
  cancelled: 'Cancelada',
};

const statusTone = (status) => {
  if (status === 'settled') return 'ok';
  if (status === 'overdue') return 'err';
  if (status === 'partial') return 'warn';
  return 'neutral';
};

const KIND_LABELS = {
  krankenkasse: 'Krankenkasse',
  tax: 'Lohnsteuer',
  wages: 'Sueldos netos',
};

/**
 * Nominas — main payroll periods view.
 * Props: user, userRole
 */
const Nominas = ({ user, userRole }) => {
  const { showToast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);
  const [activeTab, setActiveTab] = useState('obligaciones'); // 'obligaciones' | 'analitica'
  // Pending duplicate replacement and pending deletion (drive ConfirmModals).
  const [duplicatePrompt, setDuplicatePrompt] = useState(null); // { formData, existing }
  const [deletePrompt, setDeletePrompt] = useState(null); // period
  // One-click linking of an unmatched line to an employee.
  const [linkingLine, setLinkingLine] = useState(null); // { lineIndex }

  const { costCenters } = useCostCenters(user);
  const { payables, loading: payablesLoading, createPayable, cancelPayable } = usePayables(user);
  const { employees } = useEmployees(user);
  const { notifications, createNotification } = useNotifications(user);
  const ledger = useFinanceLedger(user);
  const {
    periods,
    loading: periodsLoading,
    loadPayrollPeriod,
    updatePayrollPeriod,
    deletePayrollPeriod,
  } = useNominas({
    user,
    costCenters,
    createPayable,
    cancelPayable,
    payables,
    employees,
    createNotification,
    notifications,
  });

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'active'),
    [employees],
  );

  // Item 5 — revenue for the nómina-%-of-revenue KPI, reusing posted bank
  // inflows from the finance ledger (no new Firestore fetch, no CFO snapshot
  // cache bump). Null until the ledger is ready so the KPI hides gracefully.
  const revenue = useMemo(() => {
    const movements = ledger.postedMovements || [];
    if (movements.length === 0) return null;
    return movements.reduce((sum, m) => {
      const isIncome = m.direction === 'in';
      return isIncome ? sum + Math.abs(m.netAmount ?? m.amount ?? 0) : sum;
    }, 0);
  }, [ledger.postedMovements]);

  const loading = periodsLoading || payablesLoading;

  // Selected period — default to most recent (first in desc-ordered list)
  const activePeriod = useMemo(() => {
    if (!periods.length) return null;
    const id = selectedPeriodId || periods[0].id;
    return periods.find((p) => p.id === id) || periods[0];
  }, [periods, selectedPeriodId]);

  // Match payables for this period by the payrollPeriodId marker
  const periodPayables = useMemo(() => {
    if (!activePeriod) return [];
    return payables.filter((p) => p.payrollPeriodId === activePeriod.id);
  }, [payables, activePeriod]);

  // Build obligation rows enriched with live payable status.
  // Strict payableId-only join — every obligation now carries a real payableId.
  const obligationRows = useMemo(() => {
    if (!activePeriod) return [];
    return activePeriod.obligations.map((ob) => {
      const matched = ob.payableId
        ? periodPayables.find((p) => p.id === ob.payableId) || null
        : null;
      return {
        ...ob,
        payable: matched,
        liveStatus: matched?.status || 'issued',
        openAmount: matched?.openAmount ?? ob.amount,
      };
    });
  }, [activePeriod, periodPayables]);

  // "Pendiente de pago" = sum of open amounts of this period's payables
  const pendingTotal = useMemo(
    () => periodPayables.reduce((sum, p) => sum + (p.openAmount || 0), 0),
    [periodPayables],
  );

  // Item 3 — derive the period status (borrador/cargada/parcial/pagada) from the
  // live obligation statuses. Read-only: settlement only flows through bank
  // conciliation; this never settles anything.
  const periodStatus = useMemo(
    () => derivePeriodStatus(obligationRows),
    [obligationRows],
  );

  // Item 7 — per-obligation variance vs the reconciled bank movement amount.
  const varianceRows = useMemo(
    () => obligationRows.map((ob) => obligationVariance({ obligation: ob, payable: ob.payable })),
    [obligationRows],
  );
  const varianceSummary = useMemo(
    () => periodVarianceSummary(varianceRows),
    [varianceRows],
  );

  // Item 6 — joiner/leaver validation summary for the active period, surfaced
  // as a Badge. Validates lines against the full roster (incl. leavers).
  const rosterValidation = useMemo(() => {
    if (!activePeriod) return { ok: true, ghosts: [], missingActives: [] };
    return validatePayrollRoster({
      period: activePeriod.period,
      lines: activePeriod.lines,
      employees,
    });
  }, [activePeriod, employees]);

  // Persist a status transition into the period doc + auditTrail when the
  // derived status diverges from what is stored. Guarded so it fires once per
  // real transition (not on every snapshot).
  const canAct = userRole === 'admin' || userRole === 'manager';

  const lastPersistedStatusRef = useRef(null);
  useEffect(() => {
    // Only actors persist transitions — a read-only editor viewing a legacy
    // period must never trigger a Firestore write.
    if (!activePeriod || !canAct) return;
    const stored = activePeriod.status || '';
    if (periodStatus === stored) {
      lastPersistedStatusRef.current = null;
      return;
    }
    const fingerprint = `${activePeriod.id}:${stored}->${periodStatus}`;
    if (lastPersistedStatusRef.current === fingerprint) return;
    lastPersistedStatusRef.current = fingerprint;
    updatePayrollPeriod(
      activePeriod.id,
      { status: periodStatus },
      periodStatusTransition(stored, periodStatus),
    );
  }, [activePeriod, periodStatus, updatePayrollPeriod, canAct]);

  const handleLoadPeriod = async (formData) => {
    const result = await loadPayrollPeriod(formData);
    if (result?.code === 'duplicate') {
      // Defer to a ConfirmModal to replace the existing period.
      setDuplicatePrompt({ formData, existing: result.existing });
      return result;
    }
    if (!result?.success) {
      showToast(result?.error?.message || 'Error al cargar la nómina', 'error');
    }
    return result;
  };

  const handleConfirmReplace = async () => {
    if (!duplicatePrompt) return true;
    const result = await loadPayrollPeriod({ ...duplicatePrompt.formData, replace: true });
    if (!result?.success) {
      showToast(result?.error?.message || 'No se pudo reemplazar la nómina', 'error');
      return false; // keep the confirm modal open
    }
    showToast('Nómina reemplazada correctamente', 'success');
    setDuplicatePrompt(null);
    return true;
  };

  const handleConfirmDelete = async () => {
    if (!deletePrompt) return true;
    const result = await deletePayrollPeriod(deletePrompt.id);
    if (!result?.success) {
      showToast(result?.error?.message || 'No se pudo eliminar la nómina', 'error');
      return false;
    }
    showToast('Nómina eliminada', 'success');
    if (selectedPeriodId === deletePrompt.id) setSelectedPeriodId(null);
    setDeletePrompt(null);
    return true;
  };

  const handleEdit = (period) => {
    setEditingPeriod(period);
    setIsModalOpen(true);
  };

  const handleModalSubmit = async (formData) => {
    if (editingPeriod) {
      // Edit mode: recompute by replacing the existing period in place.
      const result = await loadPayrollPeriod({ ...formData, replace: true });
      if (!result?.success) {
        showToast(result?.error?.message || 'No se pudo actualizar la nómina', 'error');
      }
      return result;
    }
    return handleLoadPeriod(formData);
  };

  // Link an unmatched line to a concrete employee, then persist.
  const handleLinkEmployee = async (employeeId) => {
    if (!linkingLine || !activePeriod) return;
    const emp = employees.find((e) => e.id === employeeId);
    const nextLines = activePeriod.lines.map((l, idx) =>
      idx === linkingLine.lineIndex
        ? { ...l, employeeId, persNr: l.persNr || emp?.persNr || '' }
        : l,
    );
    const linkedPersNr = activePeriod.lines[linkingLine.lineIndex]?.persNr || '';
    const linkedName = activePeriod.lines[linkingLine.lineIndex]?.name || '';
    // Remove only the FIRST matching unmatched entry — several lines can share
    // an empty persNr + identical name, so a blanket filter over-removes.
    const removeIdx = (activePeriod.unmatched || []).findIndex(
      (u) => u.persNr === linkedPersNr && u.name === linkedName,
    );
    const nextUnmatched = (activePeriod.unmatched || []).filter((_, i) => i !== removeIdx);
    const result = await updatePayrollPeriod(
      activePeriod.id,
      { lines: nextLines, unmatched: nextUnmatched },
      `Línea vinculada a ${emp?.fullName || employeeId}`,
    );
    if (!result?.success) {
      showToast(result?.error?.message || 'No se pudo vincular el empleado', 'error');
      return;
    }
    showToast('Empleado vinculado', 'success');
    setLinkingLine(null);
  };

  // ─── Item 8 — exports ──────────────────────────────────────────────────────
  const handleExportPersonnelPDF = async () => {
    try {
      await exportPersonnelCostPDF(periods);
    } catch (err) {
      showToast(err.message || 'No se pudo generar el PDF de coste de personal', 'error');
    }
  };

  const handleExportPersonnelExcel = () => {
    try {
      exportPayrollWorkbook(periods);
    } catch (err) {
      showToast(err.message || 'No se pudo generar el Excel', 'error');
    }
  };

  const handleExportDossier = async () => {
    if (!activePeriod) return;
    try {
      await exportPayrollDossierPDF(activePeriod);
    } catch (err) {
      showToast(err.message || 'No se pudo generar el dossier', 'error');
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPeriod(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-28">
        <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Page header */}
      <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="label-mono text-[var(--color-fg-3)] mb-3">§ Nóminas</p>
            <h2 className="font-display text-[32px] font-light tracking-tight text-[var(--color-fg-1)]">
              Control de nómina mensual y obligaciones sociales.
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[var(--color-fg-4)]">
              Cargá la nómina del mes, seguí el estado de los 6 pagos obligatorios y controlá el costo empresa por período.
            </p>
          </div>
          {canAct && (
            <button
              type="button"
              className="nx-btn nx-btn-primary self-start xl:self-auto"
              onClick={() => setIsModalOpen(true)}
            >
              Cargar nómina del mes
            </button>
          )}
        </div>
      </section>

      {periods.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Sin períodos de nómina"
          description="Cargá el primer mes para empezar a registrar las obligaciones salariales."
          action={
            canAct ? (
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={() => setIsModalOpen(true)}
              >
                Cargar nómina del mes
              </button>
            ) : null
          }
        />
      ) : (
        <>
          {/* Period selector */}
          {periods.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {periods.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPeriodId(p.id)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
                    activePeriod?.id === p.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-bg-2)] text-[var(--color-accent)]'
                      : 'border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-fg-3)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-fg-1)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Phase 3 — Obligaciones | Analítica sub-tabs */}
          <Tabs
            value={activeTab}
            onChange={setActiveTab}
            items={[
              { value: 'obligaciones', label: 'Obligaciones' },
              { value: 'analitica', label: 'Analítica' },
            ]}
          />

          {activeTab === 'analitica' && (
            <NominasAnalytics
              periods={periods}
              revenue={revenue}
              onExportPersonnelPDF={handleExportPersonnelPDF}
              onExportPersonnelExcel={handleExportPersonnelExcel}
            />
          )}

          {activeTab === 'obligaciones' && activePeriod && (
            <>
              {/* KPI row */}
              <KPIGrid cols={4}>
                <KPI
                  label="Gasto en caja"
                  value={formatCurrency(activePeriod.cashTotal)}
                  meta={`${activePeriod.label} — KK + LSt + sueldos netos`}
                  tone="warn"
                  icon={Wallet}
                />
                <KPI
                  label="Costo empresa"
                  value={formatCurrency(activePeriod.employerCostTotal)}
                  meta="Personalkosten (gesamtkosten)"
                />
                <KPI
                  label="Pendiente de pago"
                  value={formatCurrency(pendingTotal)}
                  meta={`${obligationRows.filter((r) => r.liveStatus !== 'settled' && r.liveStatus !== 'cancelled').length} obligaciones abiertas`}
                  tone={pendingTotal > 0 ? 'err' : 'ok'}
                />
                <KPI
                  label="Empleados"
                  value={`${activePeriod.payCount} / ${activePeriod.employeeCount}`}
                  meta="con neto > 0 / total en período"
                />
              </KPIGrid>

              {/* Obligations table */}
              <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="label-mono text-[var(--color-fg-4)]">Obligaciones del período</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <h3 className="font-display text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">
                        {activePeriod.label}
                      </h3>
                      {/* Item 3 — period-level status badge */}
                      <Badge variant={statusBadgeTone(periodStatus)} dot>
                        {statusLabel(periodStatus)}
                      </Badge>
                      {/* Item 7 — reconciliation variance summary */}
                      {varianceRows.some((v) => v.status !== 'pending') && (
                        <Badge variant={varianceSummary.label === 'descuadre' ? 'err' : 'ok'}>
                          {varianceSummary.label === 'descuadre'
                            ? `Descuadre ${formatCurrency(varianceSummary.totalDiff)}`
                            : 'Todo cuadra'}
                        </Badge>
                      )}
                      {/* Item 6 — joiner/leaver roster validation summary */}
                      {!rosterValidation.ok && (
                        <Badge variant="warn">
                          {rosterValidation.ghosts.length > 0
                            ? `${rosterValidation.ghosts.length} línea(s) fantasma`
                            : `${rosterValidation.missingActives.length} activo(s) sin línea`}
                        </Badge>
                      )}
                    </div>
                    {/* Origen — document fingerprint chips */}
                    {activePeriod.documents.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="label-mono text-[var(--color-fg-4)]">Origen:</span>
                        {activePeriod.documents.map((d, i) => (
                          <span
                            key={`${d.kind}-${d.fileName}-${i}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-2.5 py-1 text-[12px] text-[var(--color-fg-2)]"
                            title={d.hash ? `SHA-256: ${d.hash}` : undefined}
                          >
                            <FileText size={12} className="text-[var(--color-fg-4)]" />
                            {d.fileName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Item 8 — immutable closed-period dossier */}
                    <button
                      type="button"
                      className="nx-btn nx-btn-ghost"
                      onClick={handleExportDossier}
                      title="Dossier inmutable del período (huellas + auditoría)"
                    >
                      <FileCheck size={14} /> Dossier
                    </button>
                    {canAct && (
                      <>
                        <button
                          type="button"
                          className="nx-btn nx-btn-ghost"
                          onClick={() => handleEdit(activePeriod)}
                        >
                          <Pencil size={14} /> Editar
                        </button>
                        <button
                          type="button"
                          className="nx-btn nx-btn-danger"
                          onClick={() => setDeletePrompt(activePeriod)}
                        >
                          <Trash2 size={14} /> Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left">
                    <thead>
                      <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-4)]">
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Acreedor</th>
                        <th className="px-4 py-3 text-right">Importe</th>
                        <th className="px-4 py-3 text-right">Pendiente</th>
                        <th className="px-4 py-3 text-center">Vence</th>
                        <th className="px-4 py-3 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-line)]">
                      {obligationRows.map((ob, i) => (
                        <tr key={`${ob.kind}-${i}`} className="hover:bg-[var(--color-bg-2)]">
                          <td className="px-4 py-3">
                            <span className="label-mono text-[var(--color-fg-3)]">
                              {KIND_LABELS[ob.kind] || ob.kind}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--color-fg-1)]">{ob.payee}</td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-fg-1)]">
                            {formatCurrency(ob.amount)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-warn)]">
                            {ob.liveStatus === 'settled' ? '—' : formatCurrency(ob.openAmount)}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-[var(--color-fg-3)]">
                            {ob.dueDate ? formatDate(ob.dueDate) : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <Badge variant={statusTone(ob.liveStatus)}>
                                {STATUS_LABELS[ob.liveStatus] || ob.liveStatus}
                              </Badge>
                              {varianceRows[i]?.status === 'descuadre' && (
                                <span className="font-mono text-[11px] text-[var(--color-err)]">
                                  Δ {formatCurrency(varianceRows[i].diff)}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {obligationRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center">
                            <p className="label-mono text-[var(--color-fg-4)]">Sin obligaciones registradas</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Unmatched lines — one-click linking */}
              {activePeriod.unmatched.length > 0 && (
                <section className="rounded-md border border-[var(--color-warn)] bg-[var(--color-bg-1)] p-5">
                  <p className="label-mono text-[var(--color-warn)]">
                    Líneas sin empleado vinculado ({activePeriod.unmatched.length})
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--color-fg-4)]">
                    No pude resolver la Pers.-Nr ni el nombre. Cargá la Pers.-Nr en la ficha del
                    empleado o vinculá cada línea manualmente.
                  </p>
                  <div className="mt-3 space-y-2">
                    {activePeriod.lines.map((line, idx) =>
                      line.employeeId ? null : (
                        <div
                          key={`unmatched-${idx}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2"
                        >
                          <span className="text-sm text-[var(--color-fg-2)]">
                            {line.persNr ? `[${line.persNr}] ` : ''}
                            {line.name}
                          </span>
                          {canAct && (
                            <button
                              type="button"
                              className="nx-btn nx-btn-ghost"
                              onClick={() => setLinkingLine({ lineIndex: idx })}
                            >
                              <Link2 size={14} /> Vincular
                            </button>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </section>
              )}

              {/* Per-employee breakdown */}
              {activePeriod.lines.length > 0 && (
                <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
                  <div className="mb-4">
                    <p className="label-mono text-[var(--color-fg-4)]">Desglose por empleado</p>
                    <h3 className="font-display mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">
                      {activePeriod.label}
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left">
                      <thead>
                        <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-4)]">
                          <th className="px-4 py-3">Empleado</th>
                          <th className="px-4 py-3 text-right">Neto</th>
                          <th className="px-4 py-3 text-right">Bruto</th>
                          <th className="px-4 py-3 text-right">Costo empresa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {activePeriod.lines.map((line, idx) => (
                          <tr key={line.employeeId || line.persNr || `line-${idx}`} className="hover:bg-[var(--color-bg-2)]">
                            <td className="px-4 py-3 text-sm text-[var(--color-fg-1)]">{line.name}</td>
                            <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-fg-2)]">
                              {formatCurrency(line.netto)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-fg-2)]">
                              {formatCurrency(line.brutto)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-fg-1)]">
                              {formatCurrency(line.gesamtkosten)}
                            </td>
                          </tr>
                        ))}
                        {/* Totals row */}
                        <tr className="border-t border-[var(--color-line-s)] bg-[var(--color-bg-2)]">
                          <td className="px-4 py-3 label-mono text-[var(--color-fg-3)]">
                            Total ({activePeriod.employeeCount} empleados)
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-medium tabular-nums text-[var(--color-fg-1)]">
                            {formatCurrency(activePeriod.netWagesTotal)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[var(--color-fg-3)]">
                            —
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-medium tabular-nums text-[var(--color-fg-1)]">
                            {formatCurrency(activePeriod.employerCostTotal)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Audit trail */}
              {activePeriod.auditTrail.length > 0 && (
                <section className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
                  <div className="mb-4">
                    <p className="label-mono text-[var(--color-fg-4)]">Historial de auditoría</p>
                    <h3 className="font-display mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">
                      {activePeriod.label}
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left">
                      <thead>
                        <tr className="border-b border-[var(--color-line)] label-mono text-[var(--color-fg-4)]">
                          <th className="px-4 py-3">Acción</th>
                          <th className="px-4 py-3">Usuario</th>
                          <th className="px-4 py-3">Fecha</th>
                          <th className="px-4 py-3">Detalle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {activePeriod.auditTrail.map((entry, idx) => (
                          <tr key={`audit-${idx}`} className="hover:bg-[var(--color-bg-2)]">
                            <td className="px-4 py-3">
                              <span className="label-mono text-[var(--color-fg-3)]">{entry.action}</span>
                            </td>
                            <td className="px-4 py-3 text-sm text-[var(--color-fg-2)]">{entry.user || '—'}</td>
                            <td className="px-4 py-3 text-sm text-[var(--color-fg-3)]">
                              {entry.timestamp ? formatDate(entry.timestamp) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-[var(--color-fg-1)]">{entry.detail || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      <CargarNominaModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onSubmit={handleModalSubmit}
        activeEmployees={activeEmployees}
        allEmployees={employees}
        editingPeriod={editingPeriod}
        loading={periodsLoading}
      />

      {/* Duplicate-period replacement confirmation */}
      <ConfirmModal
        isOpen={Boolean(duplicatePrompt)}
        onClose={() => setDuplicatePrompt(null)}
        onConfirm={handleConfirmReplace}
        title="Nómina duplicada"
        message={`Ya existe la nómina de ${duplicatePrompt?.existing?.label || ''}. ¿Querés reemplazarla? Se cancelarán las obligaciones anteriores no pagadas y se cargará la nueva.`}
        confirmText="Reemplazar"
        variant="warning"
      />

      {/* Delete-period confirmation */}
      <ConfirmModal
        isOpen={Boolean(deletePrompt)}
        onClose={() => setDeletePrompt(null)}
        onConfirm={handleConfirmDelete}
        title="Eliminar nómina"
        message={`Vas a eliminar la nómina de ${deletePrompt?.label || ''} y cancelar sus 6 obligaciones (si ninguna tiene pagos registrados). Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        variant="danger"
      />

      {/* Link an unmatched line to an employee */}
      {linkingLine && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,8,10,0.72)] p-4 animate-fadeIn"
          onClick={() => setLinkingLine(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[var(--color-line-s)] bg-[var(--color-bg-1)] p-5 animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="label-mono text-[var(--color-fg-4)] mb-2">Vincular empleado</p>
            <p className="mb-4 text-sm text-[var(--color-fg-2)]">
              {activePeriod?.lines?.[linkingLine.lineIndex]?.name}
            </p>
            <select
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-0)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-line-s)]"
              defaultValue=""
              onChange={(e) => e.target.value && handleLinkEmployee(e.target.value)}
            >
              <option value="" disabled>
                — Elegí un empleado —
              </option>
              {activeEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.persNr ? `[${e.persNr}] ` : ''}
                  {e.fullName}
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end">
              <button type="button" className="nx-btn nx-btn-secondary" onClick={() => setLinkingLine(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Nominas;
