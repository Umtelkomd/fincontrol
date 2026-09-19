import { useFinanceLedgerContext } from "../contexts/FinanceLedgerContext.jsx";
import { nextRitualStep } from "../finance/ritualStep.js";
import { ritualCopy } from "../features/resumen/lib/ritualCopy.js";
import {
  pendingInboxCount,
  pendingRemesasCount,
} from "../features/resumen/lib/ritualCounts.js";

const badgeCount = (value) => {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.floor(count);
};

export const ritualBadgeFor = (path, step) => {
  if (!step || typeof step !== "object") return 0;

  if (path === "/banco" && (step.id === "import" || step.id === "anchor")) {
    return 1;
  }
  if (path === "/clasificar" && step.id === "classify") {
    return badgeCount(step.count);
  }
  if (path === "/cxc" && step.id === "remesas") {
    return badgeCount(step.count);
  }
  return 0;
};

export const useRitualStep = () => {
  const ledger = useFinanceLedgerContext();
  const loading = Boolean(ledger.independentLoading);
  const inboxCount = pendingInboxCount(ledger.bankMovements);
  const remesasCount = pendingRemesasCount(ledger.bankMovements);
  const step = loading
    ? null
    : nextRitualStep({
        cashSource: ledger.cashSource,
        cashMeta: ledger.cashMeta,
        pendingInboxCount: inboxCount,
        pendingRemesasCount: remesasCount,
        today: new Date().toISOString().slice(0, 10),
      });

  return {
    step,
    copy: loading ? null : ritualCopy(step),
    inboxCount,
    remesasCount,
    loading,
    onRetry: ledger.actions.reconciliation.retry,
  };
};

export default useRitualStep;
