/**
 * Pure cash-ritual sequencer. The caller supplies `today` (YYYY-MM-DD);
 * this module never reads the wall clock, React, or Firebase.
 */

export const RITUAL_ANCHOR_STALE_DAYS = 45;

export const RITUAL_STEP = {
 unavailable: "unavailable",
 import: "import",
 anchor: "anchor",
 drift: "drift",
 classify: "classify",
 remesas: "remesas",
 done: "done",
};

const HREF = {
 unavailable: null,
 import: "/banco",
 anchor: "/banco",
 drift: "/configuracion",
 classify: "/clasificar",
 remesas: "/cxc/remesas",
 done: null,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const step = (id, { count = null, reason = null } = {}) => ({
 id,
 href: HREF[id],
 count,
 reason,
});

const isIsoDate = (value) => typeof value === "string" && ISO_DATE.test(value);

const calendarDaysUtc = (fromIso, toIso) => {
 const from = Date.UTC(
  Number(fromIso.slice(0, 4)),
  Number(fromIso.slice(5, 7)) - 1,
  Number(fromIso.slice(8, 10)),
 );
 const to = Date.UTC(
  Number(toIso.slice(0, 4)),
  Number(toIso.slice(5, 7)) - 1,
  Number(toIso.slice(8, 10)),
 );
 return Math.round((to - from) / 86400000);
};

const usableAnchor = (anchor) =>
 Boolean(anchor && typeof anchor === "object" && isIsoDate(anchor.date));

/**
 * @param {{
 *   cashSource?: 'anchors'|'legacy'|'unavailable',
 *   cashMeta?: {
 *     status?: 'loading'|'error'|'ready',
 *     anchor?: { date: string, balance?: number }|null,
 *     importGap?: { hasGap: boolean, lastMovementDate?: string|null, quietBusinessDays?: number|null },
 *     anchorDrift?: Array<{ fromDate: string, toDate: string, expected: number, derived: number, drift: number }>,
 *   }|null,
 *   pendingInboxCount?: number,
 *   pendingRemesasCount?: number,
 *   today: string,
 * }} input
 * @returns {{
 *   id: 'unavailable'|'import'|'anchor'|'drift'|'classify'|'remesas'|'done',
 *   href: string|null,
 *   count: number|null,
 *   reason: string|null,
 * }}
 */
export const nextRitualStep = (input = {}) => {
 const cashSource = input.cashSource;
 const cashMeta = input.cashMeta;
 const today = input.today;
 const pendingInboxCount = Number(input.pendingInboxCount) || 0;
 const pendingRemesasCount = Number(input.pendingRemesasCount) || 0;

 if (
  cashSource === "unavailable" ||
  cashMeta?.status === "loading" ||
  cashMeta?.status === "error"
 ) {
  return step(RITUAL_STEP.unavailable);
 }

 if (cashMeta?.importGap?.hasGap === true) {
  return step(RITUAL_STEP.import);
 }

 const anchor = cashMeta?.anchor;
 const hasUsableAnchor = usableAnchor(anchor);
 if (cashSource !== "anchors" || !hasUsableAnchor) {
  return step(RITUAL_STEP.anchor, { reason: "missing" });
 }

 if (isIsoDate(today)) {
  const age = calendarDaysUtc(anchor.date, today);
  if (age > RITUAL_ANCHOR_STALE_DAYS) {
   return step(RITUAL_STEP.anchor, { reason: "stale" });
  }
 }

 if (Array.isArray(cashMeta?.anchorDrift) && cashMeta.anchorDrift.length > 0) {
  return step(RITUAL_STEP.drift);
 }

 if (pendingInboxCount > 0) {
  return step(RITUAL_STEP.classify, { count: pendingInboxCount });
 }

 if (pendingRemesasCount > 0) {
  return step(RITUAL_STEP.remesas, { count: pendingRemesasCount });
 }

 return step(RITUAL_STEP.done);
};
