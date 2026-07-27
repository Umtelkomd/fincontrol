/**
 * Counterparty identity — nómina vs subcontratista.
 *
 * The fixtures below are the REAL production friction: master names and bank
 * counterparty names never agree, so every case here is a live example from the
 * employees collection paired with the string the bank actually wrote.
 */
import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES } from '../constants/categories.js';
import { deriveBalance } from '../lib/finance/cashPosition.js';
import {
  COUNTERPARTY_KIND,
  MATCH_CONFIDENCE,
  PAYROLL_CATEGORY,
  SUBCONTRACTOR_CATEGORY,
  classifyCounterparty,
  isHighConfidence,
  isPayrollSettlement,
  splitPayrollSettlements,
  suggestClassification,
  summarizeCounterparties,
} from './counterpartyIdentity.js';

const employee = (overrides) => ({
  id: 'e-x',
  fullName: '',
  firstName: '',
  lastName: '',
  aliases: [],
  type: 'internal',
  status: 'active',
  projectIds: [],
  ...overrides,
});

// Company payroll — never a project cost on the bank side.
const JEISSON = employee({
  id: 'e-jeisson',
  fullName: 'Jeisson Lesmes Linares',
  firstName: 'Jeisson',
  lastName: 'Lesmes Linares',
  type: 'internal',
});
const JUAN = employee({
  id: 'e-juan',
  fullName: 'Juan Dios Lesmes Linares',
  firstName: 'Juan Dios',
  lastName: 'Lesmes Linares',
  type: 'internal',
});
// Subcontractor — its payment IS a direct project cost.
const JORGE = employee({
  id: 'e-jorge',
  fullName: 'Jorge Moran',
  firstName: 'Jorge',
  lastName: 'Moran',
  type: 'external',
  projectIds: ['proj-1'],
});

const ALL = [JEISSON, JUAN, JORGE];

const movement = (overrides) => ({
  id: 'mov-x',
  direction: 'out',
  status: 'posted',
  amount: 1000,
  postedDate: '2026-07-10',
  counterpartyName: '',
  categoryName: '',
  ...overrides,
});

describe('classifyCounterparty — kind', () => {
  it('maps an internal employee to payroll', () => {
    const result = classifyCounterparty('Jeisson Lesmes Linares', ALL);
    expect(result.kind).toBe(COUNTERPARTY_KIND.PAYROLL);
    expect(result.employee.id).toBe('e-jeisson');
  });

  it('maps an external employee to subcontractor', () => {
    const result = classifyCounterparty('Jorge Moran', ALL);
    expect(result.kind).toBe(COUNTERPARTY_KIND.SUBCONTRACTOR);
    expect(result.employee.id).toBe('e-jorge');
  });

  it('treats the legacy "contractor" type as a subcontractor too', () => {
    const contractor = employee({ id: 'e-c', fullName: 'Michael Matos', type: 'contractor' });
    expect(classifyCounterparty('Michael Matos', [contractor]).kind).toBe(
      COUNTERPARTY_KIND.SUBCONTRACTOR,
    );
  });

  it('returns unknown for a supplier nobody in the master matches', () => {
    const result = classifyCounterparty('Kabel Service GmbH', ALL);
    expect(result).toEqual({
      kind: COUNTERPARTY_KIND.UNKNOWN,
      employee: null,
      confidence: MATCH_CONFIDENCE.NONE,
      ambiguous: false,
    });
  });

  it('returns unknown for blank or missing input', () => {
    expect(classifyCounterparty('', ALL).kind).toBe(COUNTERPARTY_KIND.UNKNOWN);
    expect(classifyCounterparty(null, ALL).kind).toBe(COUNTERPARTY_KIND.UNKNOWN);
    expect(classifyCounterparty('Jeisson', null).kind).toBe(COUNTERPARTY_KIND.UNKNOWN);
  });
});

describe('classifyCounterparty — confidence', () => {
  it('is exact when the bank string equals the master name', () => {
    expect(classifyCounterparty('JEISSON LESMES LINARES', ALL).confidence).toBe(
      MATCH_CONFIDENCE.EXACT,
    );
  });

  it('is exact when the bank string equals an alias — the permanent fix', () => {
    const beatriz = employee({
      id: 'e-bea',
      fullName: 'Beatriz Penaranda',
      firstName: 'Beatriz',
      lastName: 'Penaranda',
      aliases: ['Beatriz Mercedes Sandoval Penaranda'],
    });
    expect(classifyCounterparty('Beatriz Mercedes Sandoval Penaranda', [beatriz]).confidence).toBe(
      MATCH_CONFIDENCE.EXACT,
    );
  });

  // Production: master "Beatriz Penaranda" vs bank "Beatriz Mercedes Sandoval Penaranda".
  it('is high when first AND last name both appear inside a longer bank name', () => {
    const beatriz = employee({
      id: 'e-bea',
      fullName: 'Beatriz Penaranda',
      firstName: 'Beatriz',
      lastName: 'Penaranda',
    });
    const result = classifyCounterparty('Beatriz Mercedes Sandoval Penaranda', [beatriz]);
    expect(result.employee.id).toBe('e-bea');
    expect(result.confidence).toBe(MATCH_CONFIDENCE.HIGH);
  });

  // Production: master "Felipe Santamaria" vs bank "Juan Felipe Santamaria Losada".
  it('is high when the whole master name sits inside the bank name', () => {
    const felipe = employee({
      id: 'e-fel',
      fullName: 'Felipe Santamaria',
      firstName: 'Felipe',
      lastName: 'Santamaria',
    });
    expect(classifyCounterparty('Juan Felipe Santamaria Losada', [felipe]).confidence).toBe(
      MATCH_CONFIDENCE.HIGH,
    );
  });

  // Production: master "Pedro Pizarro Caufal" vs bank "Pedro Luis Pizarro Zapata".
  // Second surname differs — plausible, not certain. Must NOT be acted on silently.
  it('is low when only part of the surname matches', () => {
    const pedro = employee({
      id: 'e-ped',
      fullName: 'Pedro Pizarro Caufal',
      firstName: 'Pedro',
      lastName: 'Pizarro Caufal',
    });
    const result = classifyCounterparty('Pedro Luis Pizarro Zapata', [pedro]);
    expect(result.employee.id).toBe('e-ped');
    expect(result.confidence).toBe(MATCH_CONFIDENCE.LOW);
  });

  // Production: master "Simon Pizarro Caufal" vs bank "Simon Andres Pizarro Calfual" (typo).
  it('is low when the bank misspells the surname', () => {
    const simon = employee({
      id: 'e-sim',
      fullName: 'Simon Pizarro Caufal',
      firstName: 'Simon',
      lastName: 'Pizarro Caufal',
    });
    expect(classifyCounterparty('Simon Andres Pizarro Calfual', [simon]).confidence).toBe(
      MATCH_CONFIDENCE.LOW,
    );
  });

  it('is low when a single first name is all that matched — a company can carry it', () => {
    const pedro = employee({ id: 'e-ped', fullName: 'Pedro Pizarro', firstName: 'Pedro', lastName: 'Pizarro' });
    expect(classifyCounterparty('Pedro Bau GmbH', [pedro]).confidence).toBe(MATCH_CONFIDENCE.LOW);
  });

  it('prefers the better match when two employees answer to the same text', () => {
    const typo = employee({ id: 'e-typo', fullName: 'Sebatian Agudelo Grajales', status: 'inactive' });
    const real = employee({ id: 'e-real', fullName: 'Sebastian Agudelo Grajales' });
    const result = classifyCounterparty('Sebastian Agudelo Grajales', [typo, real]);
    expect(result.employee.id).toBe('e-real');
    expect(result.confidence).toBe(MATCH_CONFIDENCE.EXACT);
  });

  it('downgrades to low and flags ambiguity when two people tie', () => {
    const result = classifyCounterparty('Lesmes Linares', ALL); // both Lesmes Linares brothers
    expect(result.ambiguous).toBe(true);
    expect(result.confidence).toBe(MATCH_CONFIDENCE.LOW);
  });

  it('prefers an active employee over an inactive one at the same confidence', () => {
    const gone = employee({ id: 'e-old', fullName: 'Klaus Wagner', status: 'inactive' });
    const here = employee({ id: 'e-new', fullName: 'Klaus Wagner' });
    expect(classifyCounterparty('Klaus Wagner', [gone, here]).employee.id).toBe('e-new');
  });
});

describe('isHighConfidence', () => {
  it('accepts exact and high, refuses low and none', () => {
    expect(isHighConfidence(MATCH_CONFIDENCE.EXACT)).toBe(true);
    expect(isHighConfidence(MATCH_CONFIDENCE.HIGH)).toBe(true);
    expect(isHighConfidence(MATCH_CONFIDENCE.LOW)).toBe(false);
    expect(isHighConfidence(MATCH_CONFIDENCE.NONE)).toBe(false);
  });
});

/**
 * THE double-count rule. Payroll cost reaches a project through
 * `allocatePayrollCost` (employee.gesamtkosten split over employee.projectIds).
 * The same euro also shows up as a bank transfer to that person. Charging both
 * bills the obra twice for one day of work.
 */
describe('isPayrollSettlement', () => {
  it('is true for a confident transfer to an internal employee', () => {
    expect(isPayrollSettlement(movement({ counterpartyName: 'Jeisson Lesmes Linares' }), ALL)).toBe(true);
  });

  it('is FALSE for a subcontractor — that payment IS a project cost', () => {
    expect(isPayrollSettlement(movement({ counterpartyName: 'Jorge Moran' }), ALL)).toBe(false);
  });

  it('is false for an unknown supplier', () => {
    expect(isPayrollSettlement(movement({ counterpartyName: 'Kabel Service GmbH' }), ALL)).toBe(false);
  });

  it('is false for money coming IN — an inflow is never a salary payment', () => {
    expect(
      isPayrollSettlement(
        movement({ direction: 'in', counterpartyName: 'Jeisson Lesmes Linares' }),
        ALL,
      ),
    ).toBe(false);
  });

  it('is false for a voided movement', () => {
    expect(
      isPayrollSettlement(
        movement({ status: 'void', counterpartyName: 'Jeisson Lesmes Linares' }),
        ALL,
      ),
    ).toBe(false);
  });

  /**
   * A LOW match must not silently remove real cost from a project: "Pedro Bau
   * GmbH" is a supplier that happens to carry an employee's first name.
   */
  it('does not exclude on a low-confidence name match alone', () => {
    const pedro = employee({ id: 'e-ped', fullName: 'Pedro Pizarro', firstName: 'Pedro', lastName: 'Pizarro' });
    expect(isPayrollSettlement(movement({ counterpartyName: 'Pedro Bau GmbH' }), [pedro])).toBe(false);
  });

  /**
   * …but once the user has categorised it as Salarios, the human already said
   * what it is, so a low-confidence match is enough to stop the double count.
   */
  it('does exclude a low-confidence match the user categorised as Salarios', () => {
    const pedro = employee({
      id: 'e-ped',
      fullName: 'Pedro Pizarro Caufal',
      firstName: 'Pedro',
      lastName: 'Pizarro Caufal',
    });
    expect(
      isPayrollSettlement(
        movement({ counterpartyName: 'Pedro Luis Pizarro Zapata', categoryName: 'Salarios' }),
        [pedro],
      ),
    ).toBe(true);
  });

  it('never excludes a Salarios movement whose counterparty is not an employee', () => {
    expect(
      isPayrollSettlement(
        movement({ counterpartyName: 'Finanzamt Lohnsteuer', categoryName: 'Salarios' }),
        ALL,
      ),
    ).toBe(false);
  });
});

describe('splitPayrollSettlements', () => {
  const MOVEMENTS = [
    movement({ id: 'm-payroll', counterpartyName: 'Jeisson Lesmes Linares', amount: 3000 }),
    movement({ id: 'm-sub', counterpartyName: 'Jorge Moran', amount: 5000 }),
    movement({ id: 'm-supplier', counterpartyName: 'Kabel Service GmbH', amount: 1200 }),
    movement({ id: 'm-income', direction: 'in', counterpartyName: 'Insyte', amount: 20000 }),
  ];

  it('keeps payroll settlements out of the chargeable set and totals them', () => {
    const split = splitPayrollSettlements(MOVEMENTS, ALL);

    expect(split.projectCostMovements.map((m) => m.id)).toEqual([
      'm-sub',
      'm-supplier',
      'm-income',
    ]);
    expect(split.payrollSettlements.map((m) => m.id)).toEqual(['m-payroll']);
    expect(split.excludedTotal).toBe(3000);
  });

  it('uses a caller-supplied amount resolver so net-of-VAT figures stay net', () => {
    const split = splitPayrollSettlements(MOVEMENTS, ALL, {
      amountOf: (m) => Number(m.amount || 0) / 2,
    });
    expect(split.excludedTotal).toBe(1500);
  });

  /**
   * A probable-but-unproven payroll match stays CHARGED (removing real cost on a
   * guess is worse), and is reported separately so the UI can ask for an alias
   * instead of leaving a silent double count.
   */
  it('reports low-confidence payroll matches as pending confirmation, still charged', () => {
    const pedro = employee({
      id: 'e-ped',
      fullName: 'Pedro Pizarro Caufal',
      firstName: 'Pedro',
      lastName: 'Pizarro Caufal',
    });
    const maybe = movement({ id: 'm-maybe', counterpartyName: 'Pedro Luis Pizarro Zapata', amount: 2200 });

    const split = splitPayrollSettlements([maybe], [pedro]);

    expect(split.projectCostMovements.map((m) => m.id)).toEqual(['m-maybe']);
    expect(split.payrollSettlements).toEqual([]);
    expect(split.possiblePayroll).toHaveLength(1);
    expect(split.possiblePayroll[0].employeeName).toBe('Pedro Pizarro Caufal');
    expect(split.possibleTotal).toBe(2200);
  });

  it('handles an empty ledger', () => {
    const split = splitPayrollSettlements([], ALL);
    expect(split).toEqual({
      projectCostMovements: [],
      payrollSettlements: [],
      possiblePayroll: [],
      excludedTotal: 0,
      possibleTotal: 0,
    });
  });
});

describe('suggestClassification', () => {
  it('suggests Salarios / estructura for payroll and applies it on a certain match', () => {
    const suggestion = suggestClassification(
      movement({ counterpartyName: 'Jeisson Lesmes Linares' }),
      ALL,
    );
    expect(suggestion).toMatchObject({
      kind: COUNTERPARTY_KIND.PAYROLL,
      categoryName: PAYROLL_CATEGORY,
      costScope: 'overhead',
      requiresProject: false,
      autoApply: true,
    });
  });

  it('suggests Subcontratos / obra for a subcontractor and demands a project', () => {
    const suggestion = suggestClassification(movement({ counterpartyName: 'Jorge Moran' }), ALL);
    expect(suggestion).toMatchObject({
      kind: COUNTERPARTY_KIND.SUBCONTRACTOR,
      categoryName: SUBCONTRACTOR_CATEGORY,
      costScope: 'project',
      requiresProject: true,
      autoApply: true,
    });
  });

  it('never auto-applies a low-confidence match', () => {
    const pedro = employee({
      id: 'e-ped',
      fullName: 'Pedro Pizarro Caufal',
      firstName: 'Pedro',
      lastName: 'Pizarro Caufal',
    });
    const suggestion = suggestClassification(
      movement({ counterpartyName: 'Pedro Luis Pizarro Zapata' }),
      [pedro],
    );
    expect(suggestion.categoryName).toBe(PAYROLL_CATEGORY);
    expect(suggestion.autoApply).toBe(false);
  });

  it('suggests nothing for an unknown counterparty', () => {
    const suggestion = suggestClassification(movement({ counterpartyName: 'Kabel Service GmbH' }), ALL);
    expect(suggestion).toMatchObject({
      kind: COUNTERPARTY_KIND.UNKNOWN,
      categoryName: '',
      costScope: '',
      autoApply: false,
    });
  });

  it('suggests nothing for an inflow', () => {
    const suggestion = suggestClassification(
      movement({ direction: 'in', counterpartyName: 'Jorge Moran' }),
      ALL,
    );
    expect(suggestion.categoryName).toBe('');
    expect(suggestion.autoApply).toBe(false);
  });

  it('only ever suggests categories the app actually offers', () => {
    expect(EXPENSE_CATEGORIES).toContain(PAYROLL_CATEGORY);
    expect(EXPENSE_CATEGORIES).toContain(SUBCONTRACTOR_CATEGORY);
  });
});

describe('summarizeCounterparties', () => {
  const MOVEMENTS = [
    movement({ id: 'm1', counterpartyName: 'Jeisson Lesmes Linares', amount: 3000 }),
    movement({ id: 'm2', counterpartyName: 'Jeisson Lesmes Linares', amount: 3100 }),
    movement({ id: 'm3', counterpartyName: 'Jorge Moran', amount: 5000 }),
    movement({ id: 'm4', counterpartyName: 'Kabel Service GmbH', amount: 1200 }),
    movement({ id: 'm5', status: 'void', counterpartyName: 'Jorge Moran', amount: 9999 }),
  ];

  it('groups by counterparty with counts and totals, biggest first', () => {
    const { rows } = summarizeCounterparties(MOVEMENTS, ALL);

    expect(rows.map((r) => r.counterpartyName)).toEqual([
      'Jeisson Lesmes Linares',
      'Jorge Moran',
      'Kabel Service GmbH',
    ]);
    expect(rows[0]).toMatchObject({
      kind: COUNTERPARTY_KIND.PAYROLL,
      employeeId: 'e-jeisson',
      employeeName: 'Jeisson Lesmes Linares',
      count: 2,
      total: 6100,
    });
  });

  it('splits the totals by kind', () => {
    const { byKind } = summarizeCounterparties(MOVEMENTS, ALL);
    expect(byKind.payroll).toEqual({ count: 2, total: 6100 });
    expect(byKind.subcontractor).toEqual({ count: 1, total: 5000 });
    expect(byKind.unknown).toEqual({ count: 1, total: 1200 });
  });

  it('nets a refund back out of the counterparty total', () => {
    const { rows } = summarizeCounterparties(
      [
        movement({ counterpartyName: 'Jorge Moran', amount: 5000 }),
        movement({ counterpartyName: 'Jorge Moran', direction: 'in', amount: 500 }),
      ],
      ALL,
    );
    expect(rows[0].total).toBe(4500);
  });

  it('lists the people whose bank name still needs an alias', () => {
    const pedro = employee({
      id: 'e-ped',
      fullName: 'Pedro Pizarro Caufal',
      firstName: 'Pedro',
      lastName: 'Pizarro Caufal',
    });
    const { needsAlias } = summarizeCounterparties(
      [movement({ counterpartyName: 'Pedro Luis Pizarro Zapata', amount: 2200 })],
      [pedro],
    );
    expect(needsAlias).toHaveLength(1);
    expect(needsAlias[0]).toMatchObject({
      counterpartyName: 'Pedro Luis Pizarro Zapata',
      employeeName: 'Pedro Pizarro Caufal',
      confidence: MATCH_CONFIDENCE.LOW,
    });
  });

  it('ignores blank counterparties and empty input', () => {
    expect(summarizeCounterparties([movement({ counterpartyName: '' })], ALL).rows).toEqual([]);
    expect(summarizeCounterparties(null, ALL).rows).toEqual([]);
  });
});

/**
 * Cash must not move.
 *
 * "Payroll settlement" is a statement about PROJECT COST, never about cash. The
 * salary really did leave the bank, so the cash position, the reconciliation
 * anchors and everything derived from them have to be byte-identical whether or
 * not the counterparty happens to be an employee. This test pins that boundary
 * from the outside: the same ledger, run through the real cash engine, with and
 * without an employee master to match against.
 */
describe('payroll classification never touches cash', () => {
  const ANCHOR = [{ date: '2026-06-30', balance: 10000, source: 'DATEV SuSa 1200' }];
  const LEDGER = [
    movement({ id: 'c1', direction: 'out', amount: 3000, counterpartyName: 'Jeisson Lesmes Linares', postedDate: '2026-07-05' }),
    movement({ id: 'c2', direction: 'out', amount: 5000, counterpartyName: 'Jorge Moran', postedDate: '2026-07-06' }),
    movement({ id: 'c3', direction: 'in', amount: 20000, counterpartyName: 'Insyte', postedDate: '2026-07-07' }),
  ];

  it('keeps the payroll settlement inside the cash position', () => {
    const cash = deriveBalance({ anchors: ANCHOR, movements: LEDGER, today: '2026-07-10' });

    // 10.000 − 3.000 (salary) − 5.000 (subcontractor) + 20.000 = 22.000
    expect(cash.balance).toBe(22000);
    expect(cash.movementsApplied).toBe(3);
  });

  it('gives the same cash whether or not the employee master resolves anyone', () => {
    const withMaster = deriveBalance({ anchors: ANCHOR, movements: LEDGER, today: '2026-07-10' });
    const split = splitPayrollSettlements(LEDGER, ALL);

    // The split removed the salary from PROJECT COST…
    expect(split.payrollSettlements.map((m) => m.id)).toEqual(['c1']);
    // …and left the cash ledger untouched: same objects, none dropped or mutated.
    const seen = [...split.projectCostMovements, ...split.payrollSettlements];
    expect(seen).toHaveLength(LEDGER.length);
    expect(LEDGER.every((original, index) => seen.includes(LEDGER[index]))).toBe(true);
    expect(deriveBalance({ anchors: ANCHOR, movements: LEDGER, today: '2026-07-10' })).toEqual(withMaster);
  });

  it('does not mutate the movements it classifies', () => {
    const snapshot = JSON.stringify(LEDGER);
    splitPayrollSettlements(LEDGER, ALL);
    summarizeCounterparties(LEDGER, ALL);
    LEDGER.forEach((m) => classifyCounterparty(m.counterpartyName, ALL));
    expect(JSON.stringify(LEDGER)).toBe(snapshot);
  });
});
