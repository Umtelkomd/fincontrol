/**
 * Work in progress (WIP) — executed work that has not become an invoice yet.
 *
 * UMTELKOMD executes, certifies, invoices, and only then collects. Between the
 * first and the third step the money exists as real, delivered work but appears
 * NOWHERE in the app, so the reported position is wrong in the pessimistic
 * direction: cash and payables alone read as a company that is bankrupt when it
 * is in fact owed a large amount for work already done.
 *
 * This module is the arithmetic of that backlog. It is PURE — no Firebase, no
 * Date.now(), no formatting; callers pass `today` and plain arrays in.
 *
 * ⚠️ WIP IS NOT CASH. Nothing here feeds the cash position, the reconciliation
 * anchors or the 13-week forecast, and it must never be written into
 * `receivables` — that would pollute aging, DSO and the collection slip. WIP is
 * its own thing until a real invoice exists; at that point the entry is CLOSED
 * (status 'invoiced', linked to the receivable), never deleted.
 */

import { clampMoney, daysUntil, toISODate } from './utils';

/**
 * The two backlogs. They are different problems with different fixes:
 * `executed` needs an Aufmaß/certification, `certified` needs an invoice raised.
 * Keeping them apart is the whole point — a screen that merges them cannot tell
 * the owner which phone call to make.
 */
export const WIP_STAGE = {
  /** Ejecutado sin certificar. */
  EXECUTED: 'executed',
  /** Certificado sin facturar. */
  CERTIFIED: 'certified',
};

export const WIP_STATUS = {
  OPEN: 'open',
  /** Closed by a real invoice; kept as history, excluded from the position. */
  INVOICED: 'invoiced',
};

/**
 * Age thresholds, in days since `asOf`.
 *
 * German fibre construction runs on a MONTHLY certification cycle: quantities
 * are measured (Aufmaß) and billed as an Abschlagsrechnung once a month. So one
 * month is the natural unit of "late".
 *
 * ≤ 30 days (ok)       — inside the current cycle. This is normal, not a problem.
 * 31–60 days (warn)    — one full cycle was missed. The cash is now roughly
 *                        three months out: a cycle to certify, ~30 days of
 *                        payment terms, plus the ~21 days Insyte's confirming
 *                        adds after the due date.
 * > 60 days (critical) — two cycles missed. At the ~38,800 €/month payroll this
 *                        company pays regardless, two uncertified months is more
 *                        than a full payroll frozen for administrative reasons.
 *                        It is also where the claim itself gets risky: the
 *                        longer between execution and Aufmaß, the harder the
 *                        quantities are to evidence if the client disputes them.
 */
export const WIP_AGE_WARN_DAYS = 30;
export const WIP_AGE_CRITICAL_DAYS = 60;

const STAGES = [WIP_STAGE.EXECUTED, WIP_STAGE.CERTIFIED];

/** Amounts arrive from `<input type="number">` as strings. Refuse anything else. */
const toAmount = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clampMoney(numeric) : 0;
};

const normalizeStage = (value) =>
  STAGES.includes(value) ? value : WIP_STAGE.EXECUTED;

/**
 * Reject an entry that cannot carry money: no project to attribute it to, no
 * amount, or no date to age it from. Dropping it beats charting a zero.
 */
const normalizeEntry = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const projectId = String(raw.projectId ?? '').trim();
  const projectName = String(raw.projectName ?? '').trim();
  if (!projectId && !projectName) return null;

  const amount = toAmount(raw.amount);
  if (amount <= 0) return null;

  const asOf = toISODate(raw.asOf);
  if (!asOf) return null;

  return {
    ...raw,
    id: raw.id ?? null,
    projectId: projectId || projectName,
    projectName: projectName || projectId,
    amount,
    asOf,
    stage: normalizeStage(raw.stage),
    status: raw.status === WIP_STATUS.INVOICED ? WIP_STATUS.INVOICED : WIP_STATUS.OPEN,
    note: String(raw.note ?? ''),
  };
};

/**
 * Newest first. `asOf` is what the owner measured; `createdAt` breaks a same-day
 * tie (two figures recorded for the same date — the later keystroke wins), and
 * `id` makes the result deterministic when even that collides.
 */
const byRecencyDesc = (left, right) =>
  String(right.asOf).localeCompare(String(left.asOf)) ||
  String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')) ||
  String(right.id ?? '').localeCompare(String(left.id ?? ''));

const bucketKey = (entry) => `${entry.projectId}::${entry.stage}`;

/**
 * The current WIP: the newest entry of each (project, stage), kept only while it
 * is still open.
 *
 * An entry is superseded, never edited — recording a new figure just adds a
 * document, and the previous one stays as history so the owner can see whether
 * the backlog is growing or shrinking.
 *
 * Note the ORDER of the two steps: latest first, THEN open. Filtering to open
 * entries before picking the latest would resurrect a superseded figure the
 * moment its successor is invoiced — money that is now sitting on a real
 * receivable, counted a second time.
 *
 * @param {object[]} entries - raw workInProgress documents
 * @returns {object[]} normalized current entries, largest backlog first
 */
export const currentWipByProject = (entries) => {
  if (!Array.isArray(entries)) return [];

  const latest = new Map();
  entries.forEach((raw) => {
    const entry = normalizeEntry(raw);
    if (!entry) return;
    const key = bucketKey(entry);
    const held = latest.get(key);
    if (!held || byRecencyDesc(entry, held) < 0) latest.set(key, entry);
  });

  return Array.from(latest.values())
    .filter((entry) => entry.status === WIP_STATUS.OPEN)
    .sort(
      (left, right) =>
        right.amount - left.amount ||
        left.projectId.localeCompare(right.projectId) ||
        left.stage.localeCompare(right.stage),
    );
};

/**
 * The figure that enters the position: every current open entry, both stages.
 *
 * @param {object[]} entries
 * @returns {number}
 */
export const totalWip = (entries) =>
  clampMoney(
    currentWipByProject(entries).reduce((sum, entry) => sum + entry.amount, 0),
  );

const toneForDays = (days) => {
  if (days == null || days <= WIP_AGE_WARN_DAYS) return 'ok';
  return days <= WIP_AGE_CRITICAL_DAYS ? 'warn' : 'critical';
};

/**
 * How long this work has been sitting, and how uncomfortable that should look.
 *
 * A future `asOf` yields negative days and reads as `ok`: it is a typo, not an
 * emergency, and colouring it red would train the owner to ignore the colour.
 *
 * @param {object} entry
 * @param {string|Date} today
 * @returns {{ days: number|null, tone: 'ok'|'warn'|'critical' }}
 */
export const wipAge = (entry, today = new Date()) => {
  const asOf = toISODate(entry?.asOf);
  if (!asOf) return { days: null, tone: 'ok' };
  const days = -daysUntil(asOf, today);
  return { days, tone: toneForDays(days) };
};

/**
 * The real circulating position, with every component returned separately so a
 * screen can show the arithmetic instead of one opaque number. The owner needs
 * to SEE why the figure differs from his bank balance, or he will not trust it.
 *
 * `net = cash + wip + receivablesOpen − payablesOpen`
 *
 * @param {{ cash?: number, wip?: number, payablesOpen?: number, receivablesOpen?: number }} [parts]
 * @returns {{ cash: number, wip: number, receivablesOpen: number, payablesOpen: number, net: number }}
 */
export const netPosition = (parts = {}) => {
  const cash = toAmount(parts?.cash);
  const wip = toAmount(parts?.wip);
  const receivablesOpen = toAmount(parts?.receivablesOpen);
  const payablesOpen = toAmount(parts?.payablesOpen);

  return {
    cash,
    wip,
    receivablesOpen,
    payablesOpen,
    net: clampMoney(cash + wip + receivablesOpen - payablesOpen),
  };
};

const emptySummary = () => ({
  total: 0,
  byStage: { [WIP_STAGE.EXECUTED]: 0, [WIP_STAGE.CERTIFIED]: 0 },
  entries: [],
  byProject: [],
  oldestDays: null,
  tone: 'ok',
  stale: false,
});

/**
 * Everything both screens need from the backlog, computed once.
 *
 * Resumen and ProyectoDashboard read the SAME shape on purpose: this codebase
 * has already been bitten by three private aging implementations that disagreed
 * about the same invoice, and the fix was to leave exactly one place where the
 * maths happens.
 *
 * `stale` is the plain-language flag: work older than one certification cycle is
 * money frozen by paperwork, not by the client.
 *
 * @param {object[]} entries
 * @param {string|Date} today
 */
export const summarizeWip = (entries, today = new Date()) => {
  const current = currentWipByProject(entries);
  if (current.length === 0) return emptySummary();

  const aged = current.map((entry) => {
    const age = wipAge(entry, today);
    return { ...entry, ageDays: age.days, ageTone: age.tone };
  });

  const byStage = { [WIP_STAGE.EXECUTED]: 0, [WIP_STAGE.CERTIFIED]: 0 };
  const projects = new Map();

  aged.forEach((entry) => {
    byStage[entry.stage] = clampMoney(byStage[entry.stage] + entry.amount);
    const held = projects.get(entry.projectId) || {
      projectId: entry.projectId,
      projectName: entry.projectName,
      total: 0,
      oldestDays: null,
      entries: [],
    };
    held.total = clampMoney(held.total + entry.amount);
    held.entries.push(entry);
    if (entry.ageDays != null && (held.oldestDays == null || entry.ageDays > held.oldestDays)) {
      held.oldestDays = entry.ageDays;
    }
    projects.set(entry.projectId, held);
  });

  const oldestDays = aged.reduce(
    (max, entry) =>
      entry.ageDays != null && (max == null || entry.ageDays > max) ? entry.ageDays : max,
    null,
  );

  return {
    total: clampMoney(aged.reduce((sum, entry) => sum + entry.amount, 0)),
    byStage,
    entries: aged,
    byProject: Array.from(projects.values())
      .map((project) => ({ ...project, tone: toneForDays(project.oldestDays) }))
      .sort((left, right) => right.total - left.total),
    oldestDays,
    tone: toneForDays(oldestDays),
    stale: oldestDays != null && oldestDays > WIP_AGE_WARN_DAYS,
  };
};

export default summarizeWip;
