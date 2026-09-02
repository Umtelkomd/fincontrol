import { describe, expect, it } from 'vitest';

import {
  COST_SCOPE,
  classificationCoverage,
  isClassified,
  normalizeCostScope,
  validateClassification,
} from './costScope.js';

const movement = (overrides = {}) => ({
  id: 'mov-1',
  direction: 'out',
  amount: 119,
  counterpartyName: 'Union Tank Eckstein GmbH',
  postedDate: '2026-06-01',
  status: 'posted',
  ...overrides,
});

const form = (overrides = {}) => ({
  categoryName: 'Combustible',
  costScope: COST_SCOPE.OVERHEAD,
  projectId: '',
  ...overrides,
});

describe('normalizeCostScope', () => {
  it('returns an already stored valid cost scope untouched', () => {
    expect(normalizeCostScope(movement({ costScope: COST_SCOPE.OVERHEAD }))).toBe(COST_SCOPE.OVERHEAD);
    expect(normalizeCostScope(movement({ costScope: COST_SCOPE.PROJECT }))).toBe(COST_SCOPE.PROJECT);
  });

  it('derives overhead from the legacy "Overhead" project name, ignoring case and padding', () => {
    expect(normalizeCostScope(movement({ projectName: 'Overhead' }))).toBe(COST_SCOPE.OVERHEAD);
    expect(normalizeCostScope(movement({ projectName: '  OVERHEAD  ' }))).toBe(COST_SCOPE.OVERHEAD);
    expect(normalizeCostScope(movement({ projectName: 'overhead' }))).toBe(COST_SCOPE.OVERHEAD);
  });

  it('prefers the legacy overhead name over a project id', () => {
    expect(normalizeCostScope(movement({ projectName: 'Overhead', projectId: 'proj-1' })))
      .toBe(COST_SCOPE.OVERHEAD);
  });

  it('derives project from a non-empty project id on legacy documents', () => {
    expect(normalizeCostScope(movement({ projectId: 'proj-1' }))).toBe(COST_SCOPE.PROJECT);
    expect(normalizeCostScope(movement({ projectId: 'proj-1', projectName: 'Rügen FTTH' })))
      .toBe(COST_SCOPE.PROJECT);
  });

  it('falls back to the legacy derivation when the stored cost scope is not a valid value', () => {
    expect(normalizeCostScope(movement({ costScope: 'structural', projectId: 'proj-1' })))
      .toBe(COST_SCOPE.PROJECT);
    expect(normalizeCostScope(movement({ costScope: 'structural' }))).toBe('');
  });

  it('returns an empty string when the destination cannot be resolved', () => {
    expect(normalizeCostScope(movement())).toBe('');
    expect(normalizeCostScope(movement({ projectId: '   ' }))).toBe('');
    expect(normalizeCostScope(movement({ projectId: 42 }))).toBe('');
    expect(normalizeCostScope(null)).toBe('');
    expect(normalizeCostScope(undefined)).toBe('');
  });
});

describe('validateClassification', () => {
  it('requires a category before every other rule', () => {
    expect(validateClassification(movement(), form({ categoryName: '' }))).toEqual({
      valid: false,
      error: 'La categoría es obligatoria',
    });
    expect(validateClassification(movement(), form({ categoryName: '   ' }))).toEqual({
      valid: false,
      error: 'La categoría es obligatoria',
    });
    expect(validateClassification(movement(), undefined)).toEqual({
      valid: false,
      error: 'La categoría es obligatoria',
    });
  });

  it('returns the first failing rule — missing category wins over missing cost scope', () => {
    expect(validateClassification(movement(), form({ categoryName: '', costScope: '' })).error)
      .toBe('La categoría es obligatoria');
  });

  it('accepts inbound movements with only a category', () => {
    expect(validateClassification(
      movement({ direction: 'in' }),
      form({ categoryName: 'Ingresos Servicios', costScope: '', projectId: '' }),
    )).toEqual({ valid: true, error: null });
  });

  it('treats a movement without direction as inbound, like the rest of the repo', () => {
    expect(validateClassification(
      movement({ direction: undefined }),
      form({ costScope: '', projectId: '' }),
    )).toEqual({ valid: true, error: null });
  });

  it('rejects outbound movements without a valid cost scope', () => {
    const expected = { valid: false, error: 'Indica si el gasto es de obra o de estructura' };
    expect(validateClassification(movement(), form({ costScope: '' }))).toEqual(expected);
    expect(validateClassification(movement(), form({ costScope: 'structural' }))).toEqual(expected);
    expect(validateClassification(movement(), form({ costScope: null }))).toEqual(expected);
  });

  it('requires a project when the outbound expense is scoped to a project', () => {
    const expected = { valid: false, error: 'Selecciona el proyecto de la obra' };
    expect(validateClassification(movement(), form({ costScope: COST_SCOPE.PROJECT, projectId: '' })))
      .toEqual(expected);
    expect(validateClassification(movement(), form({ costScope: COST_SCOPE.PROJECT, projectId: '  ' })))
      .toEqual(expected);
    expect(validateClassification(
      movement(),
      form({ costScope: COST_SCOPE.PROJECT, projectId: 'proj-1' }),
    )).toEqual({ valid: true, error: null });
  });

  it('validates overhead expenses with no project at all', () => {
    expect(validateClassification(movement(), form({ costScope: COST_SCOPE.OVERHEAD, projectId: '' })))
      .toEqual({ valid: true, error: null });
    expect(validateClassification(
      movement({ counterpartyName: 'Finanzkasse Stralsund' }),
      { categoryName: 'Impuestos', costScope: COST_SCOPE.OVERHEAD },
    )).toEqual({ valid: true, error: null });
  });
});

describe('isClassified', () => {
  it('counts an inbound movement as classified once it has a category', () => {
    expect(isClassified(movement({ direction: 'in', categoryName: 'Ingresos Servicios' }))).toBe(true);
    expect(isClassified(movement({ direction: 'in' }))).toBe(false);
  });

  it('counts an outbound overhead expense as classified without any project', () => {
    expect(isClassified(movement({ categoryName: 'Impuestos', costScope: COST_SCOPE.OVERHEAD })))
      .toBe(true);
    expect(isClassified(movement({ categoryName: 'Impuestos', projectName: 'Overhead' }))).toBe(true);
  });

  it('requires a project id when the outbound expense is scoped to a project', () => {
    expect(isClassified(movement({ categoryName: 'Materiales', projectId: 'proj-1' }))).toBe(true);
    expect(isClassified(movement({ categoryName: 'Materiales', costScope: COST_SCOPE.PROJECT })))
      .toBe(false);
  });

  it('does not count an outbound movement that only has a category', () => {
    expect(isClassified(movement({ categoryName: 'Materiales' }))).toBe(false);
  });

  it('does not count a cost center alone as a resolved destination', () => {
    expect(isClassified(movement({ categoryName: 'Materiales', costCenterId: 'cc-1' }))).toBe(false);
  });

  it('excludes void movements and non-objects', () => {
    expect(isClassified(movement({
      categoryName: 'Impuestos',
      costScope: COST_SCOPE.OVERHEAD,
      status: 'void',
    }))).toBe(false);
    expect(isClassified(null)).toBe(false);
    expect(isClassified(undefined)).toBe(false);
  });
});

describe('classificationCoverage', () => {
  it('returns zeroed metrics for an empty or invalid list without producing NaN', () => {
    expect(classificationCoverage([])).toEqual({
      total: 0,
      classified: 0,
      pct: 0,
      byScope: { project: 0, overhead: 0, transfer: 0, unresolved: 0 },
      unclassifiedOutflow: 0,
    });
    expect(classificationCoverage(null).pct).toBe(0);
    expect(Number.isFinite(classificationCoverage([]).pct)).toBe(true);
  });

  it('splits movements by resolved destination so the buckets add up to the total', () => {
    const coverage = classificationCoverage([
      movement({ id: 'a', categoryName: 'Materiales', projectId: 'proj-1' }),
      movement({ id: 'b', categoryName: 'Impuestos', costScope: COST_SCOPE.OVERHEAD }),
      movement({ id: 'c', categoryName: 'Impuestos', projectName: 'Overhead' }),
      movement({ id: 'd' }),
    ]);

    expect(coverage.total).toBe(4);
    expect(coverage.byScope).toEqual({ project: 1, overhead: 2, transfer: 0, unresolved: 1 });
    expect(
      coverage.byScope.project +
        coverage.byScope.overhead +
        coverage.byScope.transfer +
        coverage.byScope.unresolved,
    ).toBe(coverage.total);
    expect(coverage.classified).toBe(3);
  });

  it('rounds the coverage percentage to one decimal', () => {
    const classifiedMovement = (id) =>
      movement({ id, categoryName: 'Impuestos', costScope: COST_SCOPE.OVERHEAD });

    expect(classificationCoverage([classifiedMovement('a'), movement({ id: 'b' }), movement({ id: 'c' })]).pct)
      .toBe(33.3);
    expect(classificationCoverage([
      classifiedMovement('a'),
      classifiedMovement('b'),
      movement({ id: 'c' }),
    ]).pct).toBe(66.7);
    expect(classificationCoverage([classifiedMovement('a'), movement({ id: 'b' })]).pct).toBe(50);
  });

  it('excludes void movements from every count', () => {
    const coverage = classificationCoverage([
      movement({ id: 'a', categoryName: 'Impuestos', costScope: COST_SCOPE.OVERHEAD }),
      movement({ id: 'void-classified', categoryName: 'Impuestos', costScope: COST_SCOPE.OVERHEAD, status: 'void' }),
      movement({ id: 'void-pending', status: 'void', amount: 5000, signedAmount: -5000 }),
    ]);

    expect(coverage).toEqual({
      total: 1,
      classified: 1,
      pct: 100,
      byScope: { project: 0, overhead: 1, transfer: 0, unresolved: 0 },
      unclassifiedOutflow: 0,
    });
  });

  it('sums the unclassified outflow from the signed amount when the import provides one', () => {
    const coverage = classificationCoverage([
      movement({ id: 'a', amount: 200, signedAmount: -200 }),
      movement({ id: 'b', amount: 50.5, signedAmount: -50.5 }),
      movement({ id: 'c', amount: 999, signedAmount: -999, categoryName: 'Impuestos', costScope: COST_SCOPE.OVERHEAD }),
    ]);

    expect(coverage.unclassifiedOutflow).toBeCloseTo(250.5, 2);
  });

  it('falls back to direction × amount for pre-May-2026 movements without a usable signed amount', () => {
    const coverage = classificationCoverage([
      movement({ id: 'legacy-missing', postedDate: '2026-02-10', amount: 300, signedAmount: undefined }),
      movement({ id: 'legacy-zero', postedDate: '2026-03-10', amount: 120, signedAmount: 0 }),
      movement({ id: 'legacy-negative-amount', postedDate: '2026-01-10', amount: -80, signedAmount: 0 }),
    ]);

    expect(coverage.unclassifiedOutflow).toBeCloseTo(500, 2);
  });

  it('ignores inbound movements when summing the unclassified outflow', () => {
    const coverage = classificationCoverage([
      movement({ id: 'in-1', direction: 'in', amount: 10000, signedAmount: 10000 }),
      movement({ id: 'in-legacy', direction: 'in', amount: 2000 }),
      movement({ id: 'out-1', amount: 400 }),
    ]);

    expect(coverage.unclassifiedOutflow).toBeCloseTo(400, 2);
    expect(coverage.classified).toBe(0);
  });
});

// ─── Internal transfers are resolved by nature ────────────────────────────────
// Moving money between the company's own accounts needs no category, no
// destination and no project: there is nothing to classify. Leaving them in the
// backlog meant the coverage number could never reach 100% and the "€ pending
// assignment" figure quoted 72.8k € that nobody was ever meant to assign.

describe('internal transfers in the classification backlog', () => {
  const ownAccount = (overrides = {}) =>
    movement({ counterpartyName: 'UMTELKOMD GmbH', ...overrides });

  it('counts an internal transfer as classified without a category', () => {
    expect(isClassified(ownAccount({ id: 'own-out', direction: 'out', amount: 10000 }))).toBe(true);
    expect(isClassified(ownAccount({ id: 'own-in', direction: 'in', amount: 4000 }))).toBe(true);
    expect(isClassified(movement({ id: 'rebooking', description: 'SVWZ+Umbuchung Tagesgeld' }))).toBe(true);
  });

  it('still refuses a void internal transfer', () => {
    expect(isClassified(ownAccount({ status: 'void' }))).toBe(false);
  });

  it('does NOT absolve the UMTELKOMD ESPAÑA subcontractor of classification', () => {
    expect(isClassified(movement({ counterpartyName: 'UMTELKOMD ESPANA S.L.' }))).toBe(false);
    expect(isClassified(movement({ counterpartyName: 'UMTELKOMD ESPA.A SOCIEDAD LIMITADA' }))).toBe(false);
  });

  it('accepts the categorize form for an internal transfer with nothing filled in', () => {
    expect(validateClassification(ownAccount(), form({ categoryName: '', costScope: '', projectId: '' })))
      .toEqual({ valid: true, error: null });
  });

  it('keeps demanding a project from the subcontractor', () => {
    expect(validateClassification(
      movement({ counterpartyName: 'UMTELKOMD ESPANA S.L.' }),
      form({ categoryName: 'Subcontratos', costScope: COST_SCOPE.PROJECT, projectId: '' }),
    )).toEqual({ valid: false, error: 'Selecciona el proyecto de la obra' });
  });

  it('reports internal transfers in their own bucket and counts them as covered', () => {
    const coverage = classificationCoverage([
      ownAccount({ id: 'own-out', direction: 'out', amount: 10000 }),
      ownAccount({ id: 'own-in', direction: 'in', amount: 4000 }),
      movement({ id: 'pending', amount: 500 }),
    ]);

    expect(coverage.total).toBe(3);
    expect(coverage.classified).toBe(2);
    expect(coverage.byScope).toEqual({ project: 0, overhead: 0, transfer: 2, unresolved: 1 });
    // The 10.000 € own-account outflow is NOT money waiting to be assigned.
    expect(coverage.unclassifiedOutflow).toBeCloseTo(500, 2);
  });

  it('buckets an internal transfer as transfer even if it carries a stale project id', () => {
    const coverage = classificationCoverage([ownAccount({ id: 'own', projectId: 'proj-1' })]);
    expect(coverage.byScope).toEqual({ project: 0, overhead: 0, transfer: 1, unresolved: 0 });
  });
});

describe('internal-transfer category', () => {
  // A movement the user files under the taxonomy's internal category is an
  // own-account transfer by declaration, even before `kind` is stamped on it.
  it('needs no destination when the category is Transferencia interna', () => {
    expect(
      validateClassification(movement({ counterpartyName: 'Sparkasse Konto 2' }), form({ categoryName: 'Transferencia interna', costScope: '' })),
    ).toEqual({ valid: true, error: null });
  });

  it('counts as classified without a scope or project', () => {
    const transfer = movement({ counterpartyName: 'Sparkasse Konto 2', categoryName: 'Transferencia interna' });
    expect(isClassified(transfer)).toBe(true);

    const coverage = classificationCoverage([transfer]);
    expect(coverage.classified).toBe(1);
    expect(coverage.byScope.transfer).toBe(1);
    expect(coverage.unclassifiedOutflow).toBe(0);
  });
});
