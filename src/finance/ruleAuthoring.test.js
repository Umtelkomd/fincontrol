import { describe, expect, it } from 'vitest';

import { classificationRuleDefaults } from './assetSchemas.js';
import { COST_SCOPE } from './costScope.js';
import {
  applyCostScopeToRuleForm,
  ruleSeedKey,
  selectMissingSeedRules,
  validateRuleForm,
} from './ruleAuthoring.js';
import { SEED_CLASSIFICATION_RULES } from './seedRules.js';

const formWith = (overrides = {}) => ({
  ...classificationRuleDefaults(),
  pattern: 'FINANZKASSE STRALSUND',
  ...overrides,
});

const applyTo = (overrides = {}) => ({
  ...classificationRuleDefaults().applyTo,
  ...overrides,
});

describe('validateRuleForm', () => {
  it('requires a pattern', () => {
    expect(validateRuleForm(formWith({ pattern: '   ' })))
      .toEqual({ valid: false, error: 'Ingresá un patrón a buscar' });
  });

  it('requires at least one classification target', () => {
    const result = validateRuleForm(formWith());
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/al menos un campo/i);
  });

  it('accepts a cost destination as the only classification target', () => {
    expect(validateRuleForm(formWith({ applyTo: applyTo({ costScope: COST_SCOPE.OVERHEAD }) })))
      .toEqual({ valid: true, error: null });
  });

  it('still accepts a category, a cost center or a project on their own', () => {
    expect(validateRuleForm(formWith({ applyTo: applyTo({ categoryName: 'Impuestos' }) })).valid)
      .toBe(true);
    expect(validateRuleForm(formWith({ applyTo: applyTo({ costCenterId: 'CC1' }) })).valid)
      .toBe(true);
    expect(validateRuleForm(formWith({ applyTo: applyTo({ projectId: 'proj-1' }) })).valid)
      .toBe(true);
  });

  it('rejects an uncompilable regular expression', () => {
    const result = validateRuleForm(formWith({
      matchType: 'regex',
      pattern: '([',
      applyTo: applyTo({ categoryName: 'Impuestos' }),
    }));
    expect(result).toEqual({ valid: false, error: 'La expresión regular no es válida' });
  });

  it('accepts a valid regular expression', () => {
    expect(validateRuleForm(formWith({
      matchType: 'regex',
      pattern: '^AOK.*$',
      applyTo: applyTo({ categoryName: 'Seguros' }),
    }))).toEqual({ valid: true, error: null });
  });

  it('rejects a structural rule that still carries a project', () => {
    const result = validateRuleForm(formWith({
      applyTo: applyTo({
        categoryName: 'Impuestos',
        costScope: COST_SCOPE.OVERHEAD,
        projectId: 'proj-1',
        projectName: 'NE4 Rossdorf',
      }),
    }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/estructura/i);
  });

  /**
   * The mirror of the overhead rule. Without it a rule saved with
   * destino = Obra and proyecto blank writes `costScope: 'project'` with no
   * projectId onto every movement it matches: `isClassified` says false while
   * `classificationCoverage` buckets the row under `byScope.project`, so the
   * row shows "Destino: Obra" and "Sin clasificar" at the same time.
   */
  it('rejects a site-work rule that carries no project', () => {
    const result = validateRuleForm(formWith({
      applyTo: applyTo({ categoryName: 'Material', costScope: COST_SCOPE.PROJECT }),
    }));

    expect(result).toEqual({ valid: false, error: 'Selecciona el proyecto de la obra' });
  });

  it('rejects a site-work rule whose project is only whitespace', () => {
    const result = validateRuleForm(formWith({
      applyTo: applyTo({ costScope: COST_SCOPE.PROJECT, projectId: '   ' }),
    }));

    expect(result.valid).toBe(false);
  });

  it('accepts a site-work rule that does carry its project', () => {
    expect(validateRuleForm(formWith({
      applyTo: applyTo({
        categoryName: 'Material',
        costScope: COST_SCOPE.PROJECT,
        projectId: 'proj-1',
        projectName: 'NE4 Rossdorf',
      }),
    }))).toEqual({ valid: true, error: null });
  });

  it('handles a missing form without throwing', () => {
    expect(validateRuleForm(undefined).valid).toBe(false);
  });
});

describe('applyCostScopeToRuleForm', () => {
  it('clears the project when the cost becomes structural', () => {
    const form = formWith({
      applyTo: applyTo({
        categoryName: 'Impuestos',
        projectId: 'proj-1',
        projectName: 'NE4 Rossdorf',
      }),
    });

    const next = applyCostScopeToRuleForm(form, COST_SCOPE.OVERHEAD);

    expect(next.applyTo).toEqual(applyTo({
      categoryName: 'Impuestos',
      costScope: COST_SCOPE.OVERHEAD,
    }));
  });

  it('keeps the project when the cost is site work', () => {
    const form = formWith({
      applyTo: applyTo({ projectId: 'proj-1', projectName: 'NE4 Rossdorf' }),
    });

    const next = applyCostScopeToRuleForm(form, COST_SCOPE.PROJECT);

    expect(next.applyTo.projectId).toBe('proj-1');
    expect(next.applyTo.projectName).toBe('NE4 Rossdorf');
    expect(next.applyTo.costScope).toBe(COST_SCOPE.PROJECT);
  });

  it('treats an unknown scope as "no destination" and keeps the project', () => {
    const form = formWith({ applyTo: applyTo({ projectId: 'proj-1', projectName: 'NE4' }) });

    const next = applyCostScopeToRuleForm(form, 'structural');

    expect(next.applyTo.costScope).toBe('');
    expect(next.applyTo.projectId).toBe('proj-1');
  });

  it('never mutates the form it was given', () => {
    const form = formWith({ applyTo: applyTo({ projectId: 'proj-1', projectName: 'NE4' }) });
    const snapshot = JSON.stringify(form);

    applyCostScopeToRuleForm(form, COST_SCOPE.OVERHEAD);

    expect(JSON.stringify(form)).toBe(snapshot);
  });

  it('keeps every other field of the form untouched', () => {
    const form = formWith({ name: 'Impuestos', priority: 50, notes: 'nota' });
    const next = applyCostScopeToRuleForm(form, COST_SCOPE.OVERHEAD);

    expect(next.name).toBe('Impuestos');
    expect(next.priority).toBe(50);
    expect(next.notes).toBe('nota');
  });
});

describe('ruleSeedKey', () => {
  it('identifies a rule by field + pattern, case- and space-insensitively', () => {
    expect(ruleSeedKey({ field: 'counterpartyName', pattern: '  adyen  ' }))
      .toBe(ruleSeedKey({ field: 'counterpartyName', pattern: 'ADYEN' }));
  });

  it('separates the same field + pattern on a different direction', () => {
    // Jeisson is paid a salary (out) AND lends money to the company (in):
    // the same counterparty pattern is two different rules.
    const payroll = { field: 'counterpartyName', pattern: 'JEISSON ANDRES ROMERO LESMES', direction: 'out' };
    const loan = { ...payroll, direction: 'in' };
    expect(ruleSeedKey(payroll)).not.toBe(ruleSeedKey(loan));
  });

  it('normalises a missing or empty direction to both', () => {
    const base = { field: 'counterpartyName', pattern: 'ADYEN' };
    expect(ruleSeedKey(base)).toBe(ruleSeedKey({ ...base, direction: 'both' }));
    expect(ruleSeedKey({ ...base, direction: '' })).toBe(ruleSeedKey({ ...base, direction: 'both' }));
    expect(ruleSeedKey({ ...base, direction: 'both' })).not.toBe(ruleSeedKey({ ...base, direction: 'out' }));
  });

  it('separates a contains match from a regex match on the same text, defaulting to contains', () => {
    const base = { field: 'counterpartyName', pattern: 'NÜRNBERGER', direction: 'out' };
    expect(ruleSeedKey(base)).toBe(ruleSeedKey({ ...base, matchType: 'contains' }));
    expect(ruleSeedKey(base)).not.toBe(ruleSeedKey({ ...base, matchType: 'regex' }));
  });

  it('separates the same pattern on a different field', () => {
    expect(ruleSeedKey({ field: 'description', pattern: 'ADYEN' }))
      .not.toBe(ruleSeedKey({ field: 'counterpartyName', pattern: 'ADYEN' }));
  });

  it('defaults a missing field to counterpartyName', () => {
    expect(ruleSeedKey({ pattern: 'ADYEN' }))
      .toBe(ruleSeedKey({ field: 'counterpartyName', pattern: 'ADYEN' }));
  });

  it('returns an empty key for a patternless rule', () => {
    expect(ruleSeedKey({ field: 'counterpartyName', pattern: '   ' })).toBe('');
    expect(ruleSeedKey(undefined)).toBe('');
  });
});

describe('selectMissingSeedRules', () => {
  it('offers the whole catalog when no rule exists yet', () => {
    const { toCreate, skipped } = selectMissingSeedRules([]);

    expect(toCreate).toHaveLength(SEED_CLASSIFICATION_RULES.length);
    expect(skipped).toBe(0);
  });

  it('skips a seed whose field + pattern + direction already exists', () => {
    const existing = [{ field: 'counterpartyName', pattern: 'adyen', direction: 'out', name: 'Mi propia regla' }];

    const { toCreate, skipped } = selectMissingSeedRules(existing);

    expect(skipped).toBe(1);
    expect(toCreate).toHaveLength(SEED_CLASSIFICATION_RULES.length - 1);
    expect(toCreate.map((r) => r.pattern)).not.toContain('ADYEN');
  });

  it('still offers a seed when the existing twin only differs by direction', () => {
    const payroll = { field: 'counterpartyName', pattern: 'JEISSON ANDRES ROMERO LESMES', direction: 'out', name: 'Jeisson — nómina' };

    const { toCreate, skipped } = selectMissingSeedRules([payroll]);

    expect(skipped).toBe(0);
    expect(toCreate.map((r) => r.name)).toContain('JEISSON ANDRES ROMERO LESMES — Aportes y préstamos de socios recibidos');
  });

  it('dedupes a production-like set: same field, pattern and direction under other names', () => {
    // Rules the people/entity script wrote before the seeds existed: same
    // text, same direction, different names. Every one of them is a duplicate
    // of a seed and must be skipped; a direction flip is not a duplicate.
    const twins = SEED_CLASSIFICATION_RULES.slice(0, 13).map((seed, index) => ({
      name: `Regla histórica ${index + 1}`,
      field: seed.field,
      matchType: seed.matchType,
      pattern: seed.pattern.toLowerCase(),
      direction: seed.direction,
    }));
    const flipped = { ...twins[0], name: 'Misma contraparte, otra dirección', direction: twins[0].direction === 'in' ? 'out' : 'in' };

    const { toCreate, skipped } = selectMissingSeedRules([...twins, flipped]);

    expect(skipped).toBe(13);
    expect(toCreate).toHaveLength(SEED_CLASSIFICATION_RULES.length - 13);
  });

  it('is idempotent — a second run after seeding creates nothing', () => {
    const { toCreate } = selectMissingSeedRules([]);
    const secondRun = selectMissingSeedRules(toCreate);

    expect(secondRun.toCreate).toHaveLength(0);
    expect(secondRun.skipped).toBe(SEED_CLASSIFICATION_RULES.length);
  });

  it('ignores an existing rule that matches the pattern on another field', () => {
    const existing = [{ field: 'description', pattern: 'ADYEN' }];

    expect(selectMissingSeedRules(existing).skipped).toBe(0);
  });

  it('tolerates a null rule list and rules without a pattern', () => {
    expect(selectMissingSeedRules(null).toCreate).toHaveLength(SEED_CLASSIFICATION_RULES.length);
    expect(selectMissingSeedRules([{}, null]).toCreate)
      .toHaveLength(SEED_CLASSIFICATION_RULES.length);
  });

  it('accepts an explicit catalog', () => {
    const catalog = [
      { field: 'counterpartyName', pattern: 'ONE' },
      { field: 'counterpartyName', pattern: 'TWO' },
    ];

    const { toCreate, skipped } = selectMissingSeedRules(
      [{ field: 'counterpartyName', pattern: 'one' }],
      catalog,
    );

    expect(toCreate).toEqual([catalog[1]]);
    expect(skipped).toBe(1);
  });
});
