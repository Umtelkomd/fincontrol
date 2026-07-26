import { describe, expect, it } from 'vitest';

import {
  classificationRuleDefaults,
  normalizeRuleApplyTo,
  ruleHasClassificationTarget,
} from './assetSchemas.js';
import { COST_SCOPE } from './costScope.js';

describe('classificationRuleDefaults', () => {
  it('declares costScope so the field survives the Firestore round-trip', () => {
    expect(classificationRuleDefaults().applyTo).toEqual({
      categoryName: '',
      costCenterId: '',
      projectId: '',
      projectName: '',
      costScope: '',
    });
  });
});

describe('normalizeRuleApplyTo', () => {
  it('keeps a valid cost scope', () => {
    expect(normalizeRuleApplyTo({ costScope: COST_SCOPE.OVERHEAD }).costScope)
      .toBe(COST_SCOPE.OVERHEAD);
    expect(normalizeRuleApplyTo({ costScope: COST_SCOPE.PROJECT }).costScope)
      .toBe(COST_SCOPE.PROJECT);
  });

  it('drops an arbitrary string instead of storing it', () => {
    expect(normalizeRuleApplyTo({ costScope: 'structural' }).costScope).toBe('');
    expect(normalizeRuleApplyTo({ costScope: 42 }).costScope).toBe('');
    expect(normalizeRuleApplyTo({ costScope: null }).costScope).toBe('');
  });

  it('trims the text fields and fills in the missing ones', () => {
    expect(normalizeRuleApplyTo({
      categoryName: '  Impuestos  ',
      projectId: '  proj-1  ',
    })).toEqual({
      categoryName: 'Impuestos',
      costCenterId: '',
      projectId: 'proj-1',
      projectName: '',
      costScope: '',
    });
  });

  it('returns a complete shape for a missing applyTo', () => {
    const empty = {
      categoryName: '',
      costCenterId: '',
      projectId: '',
      projectName: '',
      costScope: '',
    };
    expect(normalizeRuleApplyTo(undefined)).toEqual(empty);
    expect(normalizeRuleApplyTo(null)).toEqual(empty);
  });

  it('never returns undefined for any key, so Firestore accepts the document', () => {
    const normalized = normalizeRuleApplyTo({ categoryName: undefined, costScope: undefined });
    Object.values(normalized).forEach((value) => expect(value).not.toBeUndefined());
  });
});

describe('ruleHasClassificationTarget', () => {
  it('counts costScope as a classification target on its own', () => {
    expect(ruleHasClassificationTarget({ costScope: COST_SCOPE.OVERHEAD })).toBe(true);
  });

  it('counts category, cost center and project as targets', () => {
    expect(ruleHasClassificationTarget({ categoryName: 'Impuestos' })).toBe(true);
    expect(ruleHasClassificationTarget({ costCenterId: 'CC1' })).toBe(true);
    expect(ruleHasClassificationTarget({ projectId: 'proj-1' })).toBe(true);
  });

  it('is false for an empty or missing applyTo', () => {
    expect(ruleHasClassificationTarget({})).toBe(false);
    expect(ruleHasClassificationTarget(undefined)).toBe(false);
    expect(ruleHasClassificationTarget({ categoryName: '   ', costScope: 'nope' })).toBe(false);
  });
});
