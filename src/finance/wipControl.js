/**
 * WIP control — one row per active obra for the "Obra sin facturar" screen.
 *
 * The per-obra WipPanel answers "how much is this obra owed?"; this answers the
 * owner's weekly question across ALL obras at once: where is executed work
 * piling up without a certificate, how stale is each figure, and is it growing.
 *
 * Built on the same snapshot model as `workInProgress.js`: for each (obra,
 * stage) the newest entry is the current figure and the one before it is the
 * previous measurement. An invoiced newest entry means the backlog is zero.
 *
 * PURE: no Firebase, no Date.now(); callers pass `today`.
 */

import { WIP_STAGE, WIP_STATUS, wipAge } from './workInProgress';
import { buildProjectTokens, matchesProject } from './projectMatching';
import { clampMoney, toISODate } from './utils';

const STAGES = [WIP_STAGE.EXECUTED, WIP_STAGE.CERTIFIED];
const TONE_RANK = { ok: 0, warn: 1, critical: 2 };

const newestFirst = (left, right) =>
  String(right.asOf || '').localeCompare(String(left.asOf || '')) ||
  String(right.createdAt || '').localeCompare(String(left.createdAt || '')) ||
  String(right.id || '').localeCompare(String(left.id || ''));

const validEntry = (entry) =>
  entry && Number(entry.amount) > 0 && toISODate(entry.asOf) && STAGES.includes(entry.stage || WIP_STAGE.EXECUTED);

/**
 * The state of one stage of one obra.
 *
 * @returns {{ amount: number, previous: number|null, delta: number|null, asOf: string|null,
 *             ageDays: number|null, tone: 'ok'|'warn'|'critical', entryId: string|null }}
 */
const stageState = (entries, today) => {
  const [newest, before] = [...entries].sort(newestFirst);
  if (!newest) return { amount: 0, previous: null, delta: null, asOf: null, ageDays: null, tone: 'ok', entryId: null };

  const open = newest.status !== WIP_STATUS.INVOICED;
  const amount = open ? clampMoney(Number(newest.amount)) : 0;
  const previous = before ? clampMoney(Number(before.amount)) : null;
  const { days, tone } = wipAge(newest, today);
  return {
    amount,
    previous,
    delta: previous === null ? null : clampMoney(amount - previous),
    asOf: toISODate(newest.asOf),
    ageDays: days,
    // A closed (invoiced) figure is not a backlog: its age is not a warning.
    tone: open && amount > 0 ? tone : 'ok',
    entryId: open ? newest.id ?? null : null,
  };
};

/**
 * wipControlRows — every active obra with its executed/certified backlog.
 *
 * @param {{ entries: object[], projects: object[], today?: Date|string }} input
 * @returns {{ rows: object[], total: number, executed: number, certified: number,
 *             oldestDays: number|null, neverMeasured: number }}
 */
export const wipControlRows = ({ entries = [], projects = [], today = new Date() } = {}) => {
  const valid = (Array.isArray(entries) ? entries : []).filter(validEntry)
    .map((entry) => ({ ...entry, stage: entry.stage || WIP_STAGE.EXECUTED }));
  const live = (Array.isArray(projects) ? projects : []).filter((project) => project && project.status !== 'inactive');

  const rows = live.map((project) => {
    const tokens = buildProjectTokens(project, { liveProjects: live });
    const own = valid.filter((entry) => matchesProject(entry, tokens, project.id));
    const byStage = Object.fromEntries(STAGES.map((stage) =>
      [stage, stageState(own.filter((entry) => entry.stage === stage), today)]));
    const executed = byStage[WIP_STAGE.EXECUTED];
    const certified = byStage[WIP_STAGE.CERTIFIED];
    const measured = [executed.asOf, certified.asOf].filter(Boolean).sort();
    const worst = [executed.tone, certified.tone].sort((a, b) => TONE_RANK[b] - TONE_RANK[a])[0];
    // Age shown: the oldest figure still pending; with nothing pending, how
    // long ago the obra was last measured.
    const openAges = [executed, certified].filter((st) => st.amount > 0 && st.ageDays !== null).map((st) => st.ageDays);
    const measuredAges = [executed, certified].filter((st) => st.ageDays !== null).map((st) => st.ageDays);
    const ageDays = openAges.length ? Math.max(...openAges) : measuredAges.length ? Math.min(...measuredAges) : null;
    return {
      projectId: project.id,
      projectName: project.displayName || project.name || project.code || project.id,
      code: project.code || '',
      executed,
      certified,
      total: clampMoney(executed.amount + certified.amount),
      lastMeasured: measured.length ? measured[measured.length - 1] : null,
      ageDays,
      tone: worst,
    };
  });

  // Biggest backlog first; obras never measured sink to the bottom by name.
  rows.sort((left, right) =>
    right.total - left.total ||
    Number(!!right.lastMeasured) - Number(!!left.lastMeasured) ||
    left.projectName.localeCompare(right.projectName));

  const open = rows.flatMap((row) => [row.executed, row.certified]).filter((stage) => stage.amount > 0);
  const ages = open.map((stage) => stage.ageDays).filter((days) => days !== null);
  return {
    rows,
    total: clampMoney(rows.reduce((sum, row) => sum + row.total, 0)),
    executed: clampMoney(rows.reduce((sum, row) => sum + row.executed.amount, 0)),
    certified: clampMoney(rows.reduce((sum, row) => sum + row.certified.amount, 0)),
    oldestDays: ages.length ? Math.max(...ages) : null,
    neverMeasured: rows.filter((row) => !row.lastMeasured).length,
  };
};
