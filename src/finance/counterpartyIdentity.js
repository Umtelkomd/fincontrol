/**
 * Counterparty identity — nómina vs subcontratista
 * ────────────────────────────────────────────────
 * "Jeisson, Juan de Dios son nómina de empresa no subcontratistas.
 *  Eso debe dejarse bien claro."
 *
 * The employee master already answers this and nothing read it: `employees[].type`
 * is `internal` (company payroll) or `external` / `contractor` (subcontractor).
 * This module turns that field into an answer about a BANK MOVEMENT, because the
 * bank only ever gives us a free-text counterparty name.
 *
 * ── Why the distinction is a correctness problem, not a label ──────────────
 * Personnel cost reaches a project by two independent routes:
 *
 *   1. Payroll route (authoritative). `allocatePayrollCost` spreads each
 *      employee's `gesamtkosten` across `employee.projectIds`. That is the real
 *      employer cost — brutto + SV-AG — and ProyectoDashboard already adds it.
 *   2. Bank route. The individual transfer to that same person lands in
 *      `bankMovements` and, if someone assigns it to a project, becomes a cost.
 *
 * Both firing for the same euro bills the obra twice for one day of work. So:
 *   internal  → the transfer is PAYROLL SETTLEMENT: classify it (Salarios,
 *               estructura) but never charge it to the obra.
 *   external  → the payment IS the project cost: charge it, demand a project.
 *
 * ── Why confidence exists ──────────────────────────────────────────────────
 * Master names and bank names disagree in production:
 *   master `Beatriz Penaranda`     vs bank `Beatriz Mercedes Sandoval Penaranda`
 *   master `Pedro Pizarro Caufal`  vs bank `Pedro Luis Pizarro Zapata`
 *   master `Simon Pizarro Caufal`  vs bank `Simon Andres Pizarro Calfual`  (typo)
 *   master `Felipe Santamaria`     vs bank `Juan Felipe Santamaria Losada`
 *
 * The shared matcher is recall-first, so "Pedro Bau GmbH" also matches an
 * employee called Pedro. Acting on that would delete real supplier cost from a
 * project. A match therefore carries a confidence, and only a certain one is
 * ever acted on automatically. `aliases` is the permanent fix and is empty on
 * 14 of 15 employees — filling one turns any of the above into an EXACT match
 * forever, which is why the UI pushes it.
 *
 * Pure: no React, no Firebase, no Date.now().
 */

import { signedAmountOf } from '../lib/finance/movementAmount.js';
import { nameMatches, nameTokens, normalizeName } from '../utils/nameMatching.js';
import { COST_SCOPE } from './costScope.js';

/** What a bank counterparty turned out to be. */
export const COUNTERPARTY_KIND = {
  PAYROLL: 'payroll',
  SUBCONTRACTOR: 'subcontractor',
  UNKNOWN: 'unknown',
};

/** How sure we are that the bank name is that person. */
export const MATCH_CONFIDENCE = {
  EXACT: 'exact',
  HIGH: 'high',
  LOW: 'low',
  NONE: 'none',
};

/** Categories the suggestions point at. Both exist in EXPENSE_CATEGORIES. */
export const PAYROLL_CATEGORY = 'Salarios';
export const SUBCONTRACTOR_CATEGORY = 'Subcontratos';

const CONFIDENCE_RANK = {
  [MATCH_CONFIDENCE.EXACT]: 3,
  [MATCH_CONFIDENCE.HIGH]: 2,
  [MATCH_CONFIDENCE.LOW]: 1,
  [MATCH_CONFIDENCE.NONE]: 0,
};

const NO_MATCH = Object.freeze({
  kind: COUNTERPARTY_KIND.UNKNOWN,
  employee: null,
  confidence: MATCH_CONFIDENCE.NONE,
  ambiguous: false,
});

/** Only a certain match may drive an automatic decision. */
export const isHighConfidence = (confidence) =>
  confidence === MATCH_CONFIDENCE.EXACT || confidence === MATCH_CONFIDENCE.HIGH;

const kindOfEmployee = (employee) => {
  const type = normalizeName(employee?.type);
  if (type === 'internal') return COUNTERPARTY_KIND.PAYROLL;
  if (type === 'external' || type === 'contractor') return COUNTERPARTY_KIND.SUBCONTRACTOR;
  // A type nobody defined must not silently become payroll: an unknown kind is
  // never excluded from project cost and never auto-classified.
  return COUNTERPARTY_KIND.UNKNOWN;
};

const uniq = (values) => Array.from(new Set(values));

/**
 * How convincing is this match?
 *
 *   exact — the bank string IS the master name or a curated alias
 *   high  — an alias hit, or every part of the person's name is in the bank
 *           string (or the whole master name is), with at least two words in play
 *   low   — anything else the recall-first matcher accepted: one shared token,
 *           a differing second surname, a misspelling
 */
const confidenceFor = (employee, counterpartyName) => {
  const target = normalizeName(counterpartyName);
  if (!target) return MATCH_CONFIDENCE.NONE;

  const fullName = normalizeName(employee.fullName);
  const aliases = (Array.isArray(employee.aliases) ? employee.aliases : [])
    .map(normalizeName)
    .filter(Boolean);

  if (target === fullName || aliases.includes(target)) return MATCH_CONFIDENCE.EXACT;

  // An alias is a human statement about this exact person, so any alias hit is
  // trusted — that is what makes "add an alias" a permanent fix.
  if (aliases.some((alias) => target.includes(alias) || alias.includes(target))) {
    return MATCH_CONFIDENCE.HIGH;
  }

  const targetTokens = nameTokens(counterpartyName);
  if (fullName && (target.includes(fullName) || fullName.includes(target))) {
    // Two words minimum: "Beatriz" inside "Beatriz Penaranda" is not an identity.
    const shorter = Math.min(nameTokens(fullName).length, targetTokens.length);
    if (shorter >= 2) return MATCH_CONFIDENCE.HIGH;
  }

  const required = uniq([...nameTokens(employee.firstName), ...nameTokens(employee.lastName)]);
  const present = new Set(targetTokens);
  if (required.length >= 2 && required.every((token) => present.has(token))) {
    return MATCH_CONFIDENCE.HIGH;
  }

  return MATCH_CONFIDENCE.LOW;
};

const isActive = (employee) => normalizeName(employee?.status) !== 'inactive';

/**
 * Resolve a bank counterparty name to a person and say what kind they are.
 *
 * @param {string} counterpartyName raw bank string
 * @param {Array<object>} employees the employees collection
 * @returns {{kind:string, employee:object|null, confidence:string, ambiguous:boolean}}
 */
export const classifyCounterparty = (counterpartyName, employees) => {
  const target = normalizeName(counterpartyName);
  if (!target || !Array.isArray(employees) || employees.length === 0) return NO_MATCH;

  const candidates = employees
    .map((employee, index) => ({ employee, index }))
    .filter(({ employee }) => nameMatches(employee, counterpartyName))
    .map((entry) => ({ ...entry, confidence: confidenceFor(entry.employee, counterpartyName) }))
    .sort((left, right) => {
      const byConfidence = CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence];
      if (byConfidence !== 0) return byConfidence;
      const byStatus = Number(isActive(right.employee)) - Number(isActive(left.employee));
      if (byStatus !== 0) return byStatus;
      return left.index - right.index;
    });

  if (candidates.length === 0) return NO_MATCH;

  const [best, runnerUp] = candidates;
  // Two people equally entitled to the name: pick the first deterministically but
  // refuse to be certain — the wrong person here means the wrong project pays.
  const ambiguous = Boolean(runnerUp) && runnerUp.confidence === best.confidence;
  const confidence = ambiguous ? MATCH_CONFIDENCE.LOW : best.confidence;

  return {
    kind: kindOfEmployee(best.employee),
    employee: best.employee,
    confidence,
    ambiguous,
  };
};

/** True when the movement is money leaving the account and still alive. */
const isLiveOutflow = (movement) =>
  Boolean(movement) && movement.status !== 'void' && movement.direction === 'out';

const isSalaryCategory = (movement) =>
  normalizeName(movement?.categoryName) === normalizeName(PAYROLL_CATEGORY);

/**
 * Is this movement the settlement of company payroll?
 *
 * True ⇒ the euro is ALREADY counted by `allocatePayrollCost`, so charging it to
 * a project would double count it.
 *
 * Requires a certain name match, OR a probable one the user has already
 * categorised as Salarios — a human saying "this is a salary" outranks a fuzzy
 * string. A probable match on its own is deliberately NOT enough: "Pedro Bau
 * GmbH" matches an employee called Pedro, and silently deleting that supplier
 * cost from an obra is worse than showing it and asking.
 *
 * @param {object} movement bank movement
 * @param {Array<object>} employees
 * @returns {boolean}
 */
export const isPayrollSettlement = (movement, employees) => {
  if (!isLiveOutflow(movement)) return false;
  const match = classifyCounterparty(movement.counterpartyName, employees);
  if (match.kind !== COUNTERPARTY_KIND.PAYROLL) return false;
  return isHighConfidence(match.confidence) || isSalaryCategory(movement);
};

const defaultAmountOf = (movement) => Math.abs(Number(movement?.amount) || 0);

/**
 * Split a project's movements into what may be charged to the obra and what may
 * not, plus the ones that need a human before either can be decided.
 *
 * @param {Array<object>} movements
 * @param {Array<object>} employees
 * @param {{amountOf?: (movement:object)=>number}} [options]
 *   `amountOf` lets the caller keep its own convention — ProyectoDashboard
 *   measures cost NET of VAT, so it passes the net resolver.
 * @returns {{
 *   projectCostMovements: Array<object>,
 *   payrollSettlements: Array<object>,
 *   possiblePayroll: Array<{movement:object, employeeId:string, employeeName:string, confidence:string, amount:number}>,
 *   excludedTotal: number,
 *   possibleTotal: number,
 * }}
 */
export const splitPayrollSettlements = (movements, employees, options = {}) => {
  const amountOf = typeof options.amountOf === 'function' ? options.amountOf : defaultAmountOf;

  const projectCostMovements = [];
  const payrollSettlements = [];
  const possiblePayroll = [];
  let excludedTotal = 0;
  let possibleTotal = 0;

  (Array.isArray(movements) ? movements : []).forEach((movement) => {
    if (!isLiveOutflow(movement)) {
      projectCostMovements.push(movement);
      return;
    }

    const match = classifyCounterparty(movement.counterpartyName, employees);
    if (match.kind !== COUNTERPARTY_KIND.PAYROLL) {
      projectCostMovements.push(movement);
      return;
    }

    if (isHighConfidence(match.confidence) || isSalaryCategory(movement)) {
      payrollSettlements.push(movement);
      excludedTotal += amountOf(movement);
      return;
    }

    // Probable payroll: still charged (see isPayrollSettlement) but surfaced so
    // the user can confirm with an alias instead of living with a silent double
    // count.
    const amount = amountOf(movement);
    possiblePayroll.push({
      movement,
      employeeId: match.employee?.id || '',
      employeeName: match.employee?.fullName || '',
      confidence: match.confidence,
      amount,
    });
    possibleTotal += amount;
    projectCostMovements.push(movement);
  });

  return { projectCostMovements, payrollSettlements, possiblePayroll, excludedTotal, possibleTotal };
};

/**
 * The classification this movement almost certainly wants.
 *
 * payroll      → Salarios, estructura. It is not obra cost; the payroll
 *                allocation already put it on the projects.
 * subcontractor→ Subcontratos, obra. It IS obra cost and needs a project.
 *
 * `autoApply` is true only for a certain match. Everything else is a suggestion
 * the user confirms — a wrong auto-write here moves money between obras.
 *
 * @param {object} movement
 * @param {Array<object>} employees
 */
export const suggestClassification = (movement, employees) => {
  const match = classifyCounterparty(movement?.counterpartyName, employees);
  const base = {
    kind: match.kind,
    employee: match.employee,
    confidence: match.confidence,
    ambiguous: match.ambiguous,
    categoryName: '',
    costScope: '',
    requiresProject: false,
    autoApply: false,
  };

  // Only outbound money gets a cost destination; an inflow from a person is a
  // refund and needs a human.
  if (movement?.direction !== 'out' || movement?.status === 'void') return base;

  if (match.kind === COUNTERPARTY_KIND.PAYROLL) {
    return {
      ...base,
      categoryName: PAYROLL_CATEGORY,
      costScope: COST_SCOPE.OVERHEAD,
      requiresProject: false,
      autoApply: isHighConfidence(match.confidence),
    };
  }

  if (match.kind === COUNTERPARTY_KIND.SUBCONTRACTOR) {
    return {
      ...base,
      categoryName: SUBCONTRACTOR_CATEGORY,
      costScope: COST_SCOPE.PROJECT,
      requiresProject: true,
      autoApply: isHighConfidence(match.confidence),
    };
  }

  return base;
};

const emptyBucket = () => ({ count: 0, total: 0 });

/**
 * Per-counterparty roll-up split by kind — what the UI lists so the owner can
 * see nómina and subcontratistas apart at a glance.
 *
 * `total` is the NET money that left the account for that counterparty (a refund
 * subtracts), derived with `signedAmountOf` because movements imported before
 * May 2026 carry no usable `signedAmount`. Void movements are ignored.
 *
 * @param {Array<object>} movements
 * @param {Array<object>} employees
 */
export const summarizeCounterparties = (movements, employees) => {
  const rows = new Map();
  const byKind = {
    [COUNTERPARTY_KIND.PAYROLL]: emptyBucket(),
    [COUNTERPARTY_KIND.SUBCONTRACTOR]: emptyBucket(),
    [COUNTERPARTY_KIND.UNKNOWN]: emptyBucket(),
  };

  (Array.isArray(movements) ? movements : []).forEach((movement) => {
    if (!movement || movement.status === 'void') return;
    const counterpartyName = String(movement.counterpartyName || '').trim();
    if (!counterpartyName) return;

    const key = normalizeName(counterpartyName);
    if (!rows.has(key)) {
      const match = classifyCounterparty(counterpartyName, employees);
      rows.set(key, {
        counterpartyName,
        kind: match.kind,
        confidence: match.confidence,
        ambiguous: match.ambiguous,
        employeeId: match.employee?.id || '',
        employeeName: match.employee?.fullName || '',
        count: 0,
        total: 0,
      });
    }

    const row = rows.get(key);
    // Outflow adds, inflow (a refund) subtracts.
    const paid = -signedAmountOf(movement);
    row.count += 1;
    row.total += paid;

    const bucket = byKind[row.kind] || byKind[COUNTERPARTY_KIND.UNKNOWN];
    bucket.count += 1;
    bucket.total += paid;
  });

  const round = (value) => Math.round(value * 100) / 100;
  const list = Array.from(rows.values())
    .map((row) => ({ ...row, total: round(row.total) }))
    .sort((left, right) => right.total - left.total || left.counterpartyName.localeCompare(right.counterpartyName));

  Object.values(byKind).forEach((bucket) => {
    bucket.total = round(bucket.total);
  });

  return {
    rows: list,
    byKind,
    // Matched a person but not convincingly — one alias each and they are solved
    // permanently.
    needsAlias: list.filter((row) => row.employeeId && !isHighConfidence(row.confidence)),
  };
};
