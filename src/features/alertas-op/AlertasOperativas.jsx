import { useMemo, useState } from 'react';
import {
  Bell,
  AlertTriangle,
  Clock,
  Inbox,
  Wand2,
  TrendingDown,
  CalendarClock,
  ArrowRight,
  Repeat,
  CheckCircle2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useReceivables } from '../../hooks/useReceivables';
import { usePayables } from '../../hooks/usePayables';
import { useAuth } from '../../hooks/useAuth';
import { useClassifier } from '../../hooks/useClassifier';
import { useClassificationRules } from '../../hooks/useClassificationRules';
import { useForwardProjection } from '../../hooks/useForwardProjection';
import { useRecurringCosts } from '../../hooks/useRecurringCosts';
import { useNominas } from '../nominas/useNominas';
import { derivePeriodStatus, statusLabel, statusBadgeTone } from '../nominas/lib/payrollStatus';
import { missingPayrollMonths } from '../nominas/lib/missingMonths';
import { groupUnclassifiedByCounterparty, findBestRule } from '../../finance/ruleEngine';
import { ruleAppliesToPeriod, periodKey } from '../../finance/recurringGenerator';
import { formatCurrency } from '../../utils/formatters';
import { Button, Badge, KPIGrid, KPI, Panel, EmptyState } from '@/components/ui/nexus';
import RuleFormModal from '../../components/ui/RuleFormModal';
import { useCategories } from '../../hooks/useCategories';
import { useCostCenters } from '../../hooks/useCostCenters';
import { useProjects } from '../../hooks/useProjects';
import { useToast } from '../../contexts/ToastContext';

const todayIso = () => new Date().toISOString().slice(0, 10);

const daysBetween = (fromIso, toIso) => {
  const f = new Date(fromIso);
  const t = new Date(toIso);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return Infinity;
  return Math.round((t - f) / (1000 * 60 * 60 * 24));
};

const isOpen = (doc) => {
  const s = doc.status;
  if (s === 'settled' || s === 'cancelled' || s === 'void' || s === 'paid') return false;
  return Number(doc.openAmount || doc.grossAmount || doc.amount || 0) > 0.01;
};

const AlertasOperativas = ({ user }) => {
  const navigate = useNavigate();
  const today = todayIso();
  // Payroll holds salary data — only managers/admins (cxp permission) may see it.
  const { hasPermission } = useAuth();
  const canSeePayroll = hasPermission('cxp');

  const { receivables } = useReceivables(user);
  const { payables, createPayable, cancelPayable } = usePayables(user);
  const { recurringCosts } = useRecurringCosts(user);
  const { inboxMovements } = useClassifier(user);
  const { rules, createRule } = useClassificationRules(user);
  const projection = useForwardProjection(user, 90);

  const { incomeCategories, expenseCategories } = useCategories(user);
  const { costCenters } = useCostCenters(user);
  const { projects } = useProjects(user);
  const { showToast } = useToast();

  const [seedCounterparty, setSeedCounterparty] = useState(null);

  // ─── Payroll (Nóminas) tile data ───
  // Read-only consumer: pass createPayable/cancelPayable so the hook is happy,
  // but NOT createNotification — Nominas.jsx owns reminder emission to avoid
  // duplicate notifications.
  const { periods: payrollPeriods, payrollPayables } = useNominas({
    // Skip the payrollPeriods subscription entirely for non-cxp users — firestore
    // rules deny them the read anyway, so don't open a doomed listener.
    user: canSeePayroll ? user : null,
    costCenters,
    createPayable,
    cancelPayable,
    payables,
  });

  const payrollTile = useMemo(() => {
    const latest = payrollPeriods?.[0] || null;
    const open = (payrollPayables || []).filter(isOpen);
    const openTotal = open.reduce(
      (s, p) => s + Number(p.openAmount || p.grossAmount || p.amount || 0),
      0,
    );
    // Next SV/LSt due date among open payroll obligations (exclude net wages).
    const svLst = open
      .filter((p) => p.payrollKind === 'krankenkasse' || p.payrollKind === 'tax')
      .filter((p) => p.dueDate)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    const nextDue = svLst[0]?.dueDate || null;
    const currentMonth = today.slice(0, 7);
    const missing = missingPayrollMonths(payrollPeriods || [], currentMonth);
    // Derive the latest period status from its obligation statuses joined live.
    const status = latest
      ? derivePeriodStatus(
          (latest.obligations || []).map((ob) => {
            const live = (payables || []).find((p) => p.id === ob.payableId);
            return { liveStatus: live?.status || 'issued' };
          }),
        )
      : null;
    return {
      latest,
      status,
      openCount: open.length,
      openTotal,
      nextDue,
      missing,
      hasData: Boolean(latest) || (payrollPeriods || []).length > 0,
    };
  }, [payrollPeriods, payrollPayables, payables, today]);

  // ─── CXP buckets ───
  const cxpBuckets = useMemo(() => {
    const overdue = [];
    const due7 = [];
    const due14 = [];
    const due30 = [];
    (payables || []).filter(isOpen).forEach((p) => {
      if (!p.dueDate) return;
      const days = daysBetween(today, p.dueDate);
      if (days < 0) overdue.push({ ...p, daysOverdue: -days });
      else if (days <= 7) due7.push({ ...p, daysToDue: days });
      else if (days <= 14) due14.push({ ...p, daysToDue: days });
      else if (days <= 30) due30.push({ ...p, daysToDue: days });
    });
    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
    due7.sort((a, b) => a.daysToDue - b.daysToDue);
    due14.sort((a, b) => a.daysToDue - b.daysToDue);
    due30.sort((a, b) => a.daysToDue - b.daysToDue);
    const sum = (arr) => arr.reduce((s, x) => s + Number(x.openAmount || x.grossAmount || x.amount || 0), 0);
    return {
      overdue,
      due7,
      due14,
      due30,
      overdueTotal: sum(overdue),
      due7Total: sum(due7),
      due14Total: sum(due14),
      due30Total: sum(due30),
    };
  }, [payables, today]);

  // ─── CXC buckets ───
  const cxcBuckets = useMemo(() => {
    const overdue = [];
    const due14 = [];
    (receivables || []).filter(isOpen).forEach((r) => {
      if (!r.dueDate) return;
      const days = daysBetween(today, r.dueDate);
      if (days < 0) overdue.push({ ...r, daysOverdue: -days });
      else if (days <= 14) due14.push({ ...r, daysToDue: days });
    });
    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
    due14.sort((a, b) => a.daysToDue - b.daysToDue);
    const sum = (arr) => arr.reduce((s, x) => s + Number(x.openAmount || x.grossAmount || x.amount || 0), 0);
    return {
      overdue,
      due14,
      overdueTotal: sum(overdue),
      due14Total: sum(due14),
    };
  }, [receivables, today]);

  // ─── Inbox classifications + rule suggestions ───
  const ruleHits = useMemo(
    () => (inboxMovements || []).filter((m) => findBestRule(m, rules || [])).length,
    [inboxMovements, rules],
  );

  const counterpartySuggestions = useMemo(
    () => groupUnclassifiedByCounterparty(inboxMovements || [], 8),
    [inboxMovements],
  );

  // ─── Recurring costs not yet generated for current period ───
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentPeriod = periodKey(currentYear, currentMonth);
  const recurringPending = useMemo(() => {
    const pending = (recurringCosts || []).filter(
      (rule) => rule.active && ruleAppliesToPeriod(rule, currentYear, currentMonth),
    );
    const alreadyGenerated = new Set(
      (payables || [])
        .filter((p) => p.recurringPeriod === currentPeriod && p.recurringCostId)
        .map((p) => p.recurringCostId),
    );
    return pending.filter((r) => !alreadyGenerated.has(r.id));
  }, [recurringCosts, payables, currentPeriod, currentYear, currentMonth]);

  const recurringPendingTotal = recurringPending.reduce(
    (s, r) => s + (Number(r.amount) || 0),
    0,
  );

  // ─── Cash projection alert ───
  const negativeAlert = useMemo(() => {
    const firstNegativeDay = projection.firstNegativeDay;
    if (!firstNegativeDay) return null;
    const negativeDate =
      typeof firstNegativeDay === 'string' ? firstNegativeDay : firstNegativeDay.date;
    const days = daysBetween(today, negativeDate);
    return {
      date: negativeDate,
      daysFromNow: days,
      projectedBalance:
        typeof firstNegativeDay === 'object'
          ? firstNegativeDay.balance
          : projection.next30Balance,
      endBalance: projection.projectedEndBalance,
    };
  }, [projection, today]);

  const allCategories = useMemo(
    () => [
      ...(incomeCategories || []).map((name) => ({ name, type: 'income' })),
      ...(expenseCategories || []).map((name) => ({ name, type: 'expense' })),
    ],
    [incomeCategories, expenseCategories],
  );

  const handleCreateRule = async (data) => {
    const r = await createRule(data);
    if (r.success) showToast('Regla creada', 'success');
    return r;
  };

  // Build a synthetic "seed movement" from the counterparty bucket
  const seedMovement = useMemo(() => {
    if (!seedCounterparty) return null;
    const sample = seedCounterparty.samples?.[0];
    if (!sample) return null;
    return {
      ...sample,
      counterpartyName: seedCounterparty.counterparty,
    };
  }, [seedCounterparty]);

  const totalUrgent =
    cxpBuckets.overdue.length +
    cxpBuckets.due7.length +
    cxcBuckets.overdue.length +
    (negativeAlert ? 1 : 0) +
    recurringPending.length +
    payrollTile.missing.length;

  return (
    <div className="space-y-6 pb-12">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="label-mono text-[var(--color-fg-3)]">Operación · Alertas</p>
          <h2 className="mt-2 font-display text-[28px] font-light tracking-tight text-[var(--color-fg-1)]">
            Alertas operativas
          </h2>
          <p className="mt-1 text-sm text-[var(--color-fg-3)] max-w-2xl">
            Lo urgente para hoy: vencimientos, bandeja sin clasificar, proyección negativa,
            y costos recurrentes que aún no se generaron este mes.
          </p>
        </div>
      </header>

      <KPIGrid cols={4}>
        <KPI
          label="Acciones urgentes"
          value={totalUrgent}
          meta={totalUrgent === 0 ? '✓ Todo al día' : 'Necesitan atención hoy'}
          tone={totalUrgent === 0 ? 'ok' : 'warn'}
          icon={Bell}
        />
        <KPI
          label="CXP vencidas"
          value={cxpBuckets.overdue.length}
          meta={formatCurrency(cxpBuckets.overdueTotal)}
          tone={cxpBuckets.overdue.length > 0 ? 'err' : 'ok'}
          icon={AlertTriangle}
        />
        <KPI
          label="CXP venciendo 7d"
          value={cxpBuckets.due7.length}
          meta={formatCurrency(cxpBuckets.due7Total)}
          tone={cxpBuckets.due7.length > 0 ? 'warn' : 'ok'}
          icon={Clock}
        />
        <KPI
          label="Bandeja sin clasificar"
          value={(inboxMovements || []).length}
          meta={ruleHits > 0 ? `${ruleHits} matchean reglas` : 'Sin reglas que apliquen'}
          tone={(inboxMovements || []).length > 0 ? 'warn' : 'ok'}
          icon={Inbox}
        />
      </KPIGrid>

      {/* CXP Vencidas */}
      {cxpBuckets.overdue.length > 0 && (
        <Panel
          title="CXP vencidas"
          meta={`${cxpBuckets.overdue.length} doc(s) · ${formatCurrency(cxpBuckets.overdueTotal)}`}
          padding={false}
          actions={
            <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={() => navigate('/cxp')}>
              Ir a CXP
            </Button>
          }
        >
          <DocList
            docs={cxpBuckets.overdue.slice(0, 10)}
            tone="err"
            renderMeta={(d) => `Venció hace ${d.daysOverdue}d · ${d.dueDate}`}
          />
        </Panel>
      )}

      {/* CXP próximos vencimientos */}
      {(cxpBuckets.due7.length > 0 || cxpBuckets.due14.length > 0) && (
        <Panel
          title="CXP por vencer"
          meta={`${cxpBuckets.due7.length} en 7d · ${cxpBuckets.due14.length} en 14d`}
          padding={false}
        >
          <div className="px-5 py-2 label-mono text-[var(--color-fg-3)]">Próximos 7 días</div>
          {cxpBuckets.due7.length === 0 ? (
            <p className="px-5 pb-3 text-[12px] text-[var(--color-fg-4)]">Sin vencimientos en 7 días.</p>
          ) : (
            <DocList
              docs={cxpBuckets.due7}
              tone="warn"
              renderMeta={(d) =>
                d.daysToDue === 0 ? 'Vence hoy' : `Vence en ${d.daysToDue}d · ${d.dueDate}`
              }
            />
          )}
          {cxpBuckets.due14.length > 0 && (
            <>
              <div className="px-5 py-2 label-mono text-[var(--color-fg-3)] border-t border-[var(--color-line)]">
                8–14 días
              </div>
              <DocList
                docs={cxpBuckets.due14}
                tone="info"
                renderMeta={(d) => `Vence en ${d.daysToDue}d · ${d.dueDate}`}
              />
            </>
          )}
        </Panel>
      )}

      {/* CXC vencidas */}
      {cxcBuckets.overdue.length > 0 && (
        <Panel
          title="CXC vencidas (cobranza)"
          meta={`${cxcBuckets.overdue.length} factura(s) · ${formatCurrency(cxcBuckets.overdueTotal)}`}
          padding={false}
          actions={
            <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={() => navigate('/cxc')}>
              Ir a CXC
            </Button>
          }
        >
          <DocList
            docs={cxcBuckets.overdue.slice(0, 10)}
            tone="err"
            renderMeta={(d) => `Cliente vencido hace ${d.daysOverdue}d · ${d.dueDate}`}
          />
        </Panel>
      )}

      {/* Saldo negativo proyectado */}
      {negativeAlert && (
        <Panel
          title="Saldo proyectado a negativo"
          meta={`En ${negativeAlert.daysFromNow}d (${negativeAlert.date})`}
        >
          <div className="flex items-start gap-4 p-4 rounded-md border border-[var(--color-err)] bg-[var(--color-bg-1)]">
            <TrendingDown className="text-[var(--color-err)] flex-shrink-0 mt-1" size={20} />
            <div className="flex-1">
              <p className="text-[14px] text-[var(--color-fg-1)]">
                Si los CXP/recurrentes salen como están programados, la caja queda en negativo
                a partir del <strong>{negativeAlert.date}</strong>.
              </p>
              <p className="mt-2 font-mono text-[12px] text-[var(--color-fg-4)]">
                Saldo proyectado fin de horizonte (90d): {formatCurrency(negativeAlert.endBalance)}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/cashflow')}>
              Ver tesorería
            </Button>
          </div>
        </Panel>
      )}

      {/* Nóminas — estado del período + próximos vencimientos SV/LSt */}
      {canSeePayroll && payrollTile.hasData && (
        <Panel
          title="Nóminas"
          meta={payrollTile.latest ? payrollTile.latest.label : 'Sin períodos cargados'}
          actions={
            <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={() => navigate('/nominas')}>
              Ir a Nóminas
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {payrollTile.status && (
                <Badge variant={statusBadgeTone(payrollTile.status)} dot>
                  {statusLabel(payrollTile.status)}
                </Badge>
              )}
              {payrollTile.missing.length > 0 && (
                <Badge variant="warn">
                  {payrollTile.missing.length} mes(es) sin cargar
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
                <p className="label-mono text-[var(--color-fg-4)]">Obligaciones abiertas</p>
                <p className="mt-1 font-mono text-[18px] tabular-nums text-[var(--color-fg-1)]">
                  {payrollTile.openCount}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-4)]">
                  {formatCurrency(payrollTile.openTotal)}
                </p>
              </div>
              <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
                <p className="label-mono text-[var(--color-fg-4)]">Próximo SV / LSt</p>
                <p className="mt-1 font-mono text-[18px] tabular-nums text-[var(--color-fg-1)]">
                  {payrollTile.nextDue ? payrollTile.nextDue : '—'}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-4)]">
                  {payrollTile.nextDue
                    ? `en ${daysBetween(today, payrollTile.nextDue)}d`
                    : 'sin vencimientos abiertos'}
                </p>
              </div>
              <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
                <p className="label-mono text-[var(--color-fg-4)]">Meses faltantes</p>
                <p className="mt-1 font-mono text-[18px] tabular-nums text-[var(--color-fg-1)]">
                  {payrollTile.missing.length}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-4)] truncate">
                  {payrollTile.missing.length > 0 ? payrollTile.missing.join(', ') : 'al día'}
                </p>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* Recurrentes pendientes */}
      {recurringPending.length > 0 && (
        <Panel
          title={`Recurrentes pendientes — ${currentPeriod}`}
          meta={`${recurringPending.length} regla(s) · ${formatCurrency(recurringPendingTotal)}`}
          padding={false}
          actions={
            <Button
              variant="primary"
              size="sm"
              icon={Repeat}
              onClick={() => navigate('/costos-recurrentes')}
            >
              Generar mes
            </Button>
          }
        >
          <div className="divide-y divide-[var(--color-line)]">
            {recurringPending.slice(0, 12).map((r) => (
              <div key={r.id} className="px-5 py-3 flex items-center gap-3">
                <Repeat size={14} className="text-[var(--color-fg-4)] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[var(--color-fg-1)] truncate">
                    {r.concept || 'Sin concepto'}
                  </p>
                  <p className="font-mono text-[11px] text-[var(--color-fg-4)] truncate">
                    {r.ownerName || '—'} · {r.counterpartyName || '—'} · día {r.dayOfMonth}
                  </p>
                </div>
                <span className="font-mono tabular-nums text-[13px] text-[var(--color-accent)] flex-shrink-0">
                  -{formatCurrency(r.amount)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Sugerencias de reglas */}
      {counterpartySuggestions.length > 0 && (
        <Panel
          title="Top contrapartes sin clasificar"
          meta="Sugerencias para crear reglas"
          padding={false}
          actions={
            <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={() => navigate('/clasificar')}>
              Ir a Bandeja
            </Button>
          }
        >
          <div className="divide-y divide-[var(--color-line)]">
            {counterpartySuggestions.map((cp) => (
              <div key={cp.counterparty} className="px-5 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[var(--color-fg-1)] truncate">
                    {cp.counterparty}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-4)]">
                    {cp.count} movimiento(s) sin clasificar
                    {cp.totalIn > 0 && ` · +${formatCurrency(cp.totalIn)}`}
                    {cp.totalOut > 0 && ` · -${formatCurrency(cp.totalOut)}`}
                  </p>
                </div>
                <Badge variant="warn">{cp.count}</Badge>
                <Button
                  variant="primary"
                  size="sm"
                  icon={Wand2}
                  onClick={() => setSeedCounterparty(cp)}
                >
                  Crear regla
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {totalUrgent === 0 && (
        <Panel padding>
          <EmptyState
            icon={CheckCircle2}
            title="Todo bajo control"
            description="No hay CXP vencidas, ni vencimientos en 7 días, ni proyección negativa, ni recurrentes pendientes. Vení mañana — o el viernes después del DATEV."
          />
        </Panel>
      )}

      <RuleFormModal
        isOpen={Boolean(seedMovement)}
        onClose={() => setSeedCounterparty(null)}
        onSubmit={handleCreateRule}
        seedMovement={seedMovement}
        categories={allCategories}
        costCenters={costCenters || []}
        projects={projects || []}
        pendingMovements={inboxMovements}
      />
    </div>
  );
};

const DocList = ({ docs, tone = 'warn', renderMeta }) => {
  return (
    <div className="divide-y divide-[var(--color-line)]">
      {docs.map((d) => {
        const open = Number(d.openAmount || d.grossAmount || d.amount || 0);
        return (
          <div key={d.id} className="px-5 py-3 flex items-center gap-4">
            <CalendarClock
              size={14}
              className={`flex-shrink-0 ${
                tone === 'err'
                  ? 'text-[var(--color-err)]'
                  : tone === 'warn'
                  ? 'text-[var(--color-warn)]'
                  : 'text-[var(--color-fg-4)]'
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-[var(--color-fg-1)] truncate">
                {d.description ||
                  d.counterpartyName ||
                  d.documentNumber ||
                  d.id}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-4)] truncate">
                {renderMeta ? renderMeta(d) : d.dueDate}
                {d.documentNumber && ` · ${d.documentNumber}`}
              </p>
            </div>
            <span className="font-mono tabular-nums text-[13px] text-[var(--color-fg-1)] flex-shrink-0">
              {formatCurrency(open)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default AlertasOperativas;
