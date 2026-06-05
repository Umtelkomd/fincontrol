import { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useEmployees } from '../../hooks/useEmployees';
import { usePayables } from '../../hooks/usePayables';
import { useCostCenters } from '../../hooks/useCostCenters';
import { useNominas } from './useNominas';
import CargarNominaModal from './CargarNominaModal';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { Badge, KPI, KPIGrid, EmptyState } from '@/components/ui/nexus';

// ─── Obligation status helpers (mirrors CXP status mapping) ─────────────────

const STATUS_LABELS = {
  issued: 'Pendiente',
  partial: 'Parcial',
  overdue: 'Vencida',
  paid: 'Pagada',
  cancelled: 'Cancelada',
};

const statusTone = (status) => {
  if (status === 'paid') return 'ok';
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
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);

  const { costCenters } = useCostCenters(user);
  const { payables, loading: payablesLoading, createPayable } = usePayables(user);
  const { periods, loading: periodsLoading, loadPayrollPeriod } = useNominas({
    user,
    costCenters,
    createPayable,
  });

  const { getActiveEmployees } = useEmployees(user);
  const activeEmployees = useMemo(() => getActiveEmployees(), [getActiveEmployees]);

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

  // Build obligation rows enriched with live payable status
  const obligationRows = useMemo(() => {
    if (!activePeriod) return [];
    return activePeriod.obligations.map((ob) => {
      // Match by payableId or fall back to payrollKind + amount
      const matched = periodPayables.find(
        (p) =>
          (ob.payableId && p.id === ob.payableId) ||
          (p.payrollKind === ob.kind && Math.abs(p.amount - ob.amount) < 0.01),
      );
      return {
        ...ob,
        payable: matched || null,
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

  const canAct = userRole === 'admin' || userRole === 'manager';

  const handleLoadPeriod = async (formData) => {
    const result = await loadPayrollPeriod(formData);
    if (!result?.success) {
      showToast(result?.error?.message || 'Error al cargar la nómina', 'error');
    }
    return result;
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

          {activePeriod && (
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
                  meta={`${obligationRows.filter((r) => r.liveStatus !== 'paid').length} obligaciones abiertas`}
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
                <div className="mb-4">
                  <p className="label-mono text-[var(--color-fg-4)]">Obligaciones del período</p>
                  <h3 className="font-display mt-1 text-[18px] font-medium tracking-tight text-[var(--color-fg-1)]">
                    {activePeriod.label}
                  </h3>
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
                            {ob.liveStatus === 'paid' ? '—' : formatCurrency(ob.openAmount)}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-[var(--color-fg-3)]">
                            {ob.dueDate ? formatDate(ob.dueDate) : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant={statusTone(ob.liveStatus)}>
                              {STATUS_LABELS[ob.liveStatus] || ob.liveStatus}
                            </Badge>
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
                        {activePeriod.lines.map((line) => (
                          <tr key={line.employeeId} className="hover:bg-[var(--color-bg-2)]">
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
            </>
          )}
        </>
      )}

      <CargarNominaModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleLoadPeriod}
        activeEmployees={activeEmployees}
        loading={periodsLoading}
      />
    </div>
  );
};

export default Nominas;
