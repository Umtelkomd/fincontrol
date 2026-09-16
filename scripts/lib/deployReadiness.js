/**
 * Pure deploy-readiness evaluation — no I/O, no `child_process`.
 *
 * Production deploys are manual (`firebase deploy`) from whatever local tree
 * a developer happens to have checked out; CI does not deploy. This module
 * decides whether that tree is safe to ship: it must be `main`, clean, and
 * exactly equal to `origin/main`. The caller (`scripts/assert-deploy-ready.js`)
 * gathers the git facts and hands them in; this function only judges them,
 * which keeps the decision unit-testable without a real git checkout.
 *
 * @typedef {Object} DeployReadinessInput
 * @property {string} [branch] - current branch name, or 'HEAD'/empty when detached
 * @property {string} [statusPorcelain] - raw `git status --porcelain` output
 * @property {string} [head] - `git rev-parse HEAD`
 * @property {string} [originMain] - `git rev-parse origin/main`, or undefined if unresolved
 * @property {Error|string} [fetchError] - set when `git fetch origin main` failed
 * @property {boolean} [override] - emergency override; turns failures into warnings
 *
 * @typedef {Object} DeployReadinessResult
 * @property {boolean} ok
 * @property {boolean} overridden - true only when override suppressed real problems
 * @property {string[]} problems - human-readable English problem descriptions
 */

const DIRTY_LISTING_LIMIT = 10;

/**
 * @param {DeployReadinessInput} input
 * @returns {DeployReadinessResult}
 */
export function evaluateDeployReadiness({
  branch,
  statusPorcelain,
  head,
  originMain,
  fetchError,
  override,
} = {}) {
  const problems = [];

  if (fetchError) {
    const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
    problems.push(`Could not fetch origin/main: ${message}. Deploys fail closed when the remote can't be checked.`);
  }

  if (!branch || branch === 'HEAD') {
    problems.push('Refusing to deploy from a detached HEAD — check out main first.');
  } else if (branch !== 'main') {
    problems.push(`Current branch is "${branch}" — deploys must run from main.`);
  }

  // trimEnd only: porcelain lines start with a meaningful status column (' M file').
  const dirty = typeof statusPorcelain === 'string' ? statusPorcelain.trimEnd() : '';
  if (dirty.trim()) {
    const lines = dirty.split('\n');
    const shown = lines.slice(0, DIRTY_LISTING_LIMIT);
    const remaining = lines.length - shown.length;
    const entryWord = lines.length === 1 ? 'entry' : 'entries';
    let message = `Working tree is not clean (${lines.length} ${entryWord}):\n${shown.map((line) => `  ${line}`).join('\n')}`;
    if (remaining > 0) {
      message += `\n  ...and ${remaining} more`;
    }
    problems.push(message);
  }

  if (!originMain) {
    problems.push('origin/main could not be resolved — fetch origin and try again.');
  } else if (head !== originMain) {
    problems.push(
      `Local HEAD (${shortSha(head)}) does not match origin/main (${shortSha(originMain)}) — `
      + 'pull the latest main or push your changes via a reviewed PR before deploying.',
    );
  }

  const overridden = Boolean(override) && problems.length > 0;
  const ok = overridden ? true : problems.length === 0;

  return { ok, overridden, problems };
}

/**
 * Plain-text rendering of the problems, one bulleted line each.
 *
 * @param {string[]} problems
 * @returns {string}
 */
export function formatDeployReadinessReport(problems) {
  return problems.map((problem) => `- ${problem}`).join('\n');
}

function shortSha(sha) {
  return typeof sha === 'string' && sha.length > 0 ? sha.slice(0, 7) : 'unknown';
}
