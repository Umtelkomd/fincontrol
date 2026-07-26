import { describe, expect, it } from 'vitest';

import { EXPENSE_CATEGORIES } from '../constants/categories.js';
import { COST_SCOPE, validateClassification } from './costScope.js';
import { buildClassificationPayload, findBestRule } from './ruleEngine.js';
import { SEED_CLASSIFICATION_RULES, seedRuleToDoc } from './seedRules.js';

/** Counterparty strings as they really arrive from the DATEV import. */
const REAL_COUNTERPARTIES = [
  ['FINANZKASSE STRALSUND', 'Impuestos'],
  ['Finanzamt Stralsund', 'Impuestos'],
  ['AOK Rheinland/Hamburg', 'Seguros'],
  ['BARMER', 'Seguros'],
  ['Hauptzollamt Stralsund', 'Impuestos'],
  ['UNION TANK Eckstein GmbH & Co. KG', 'Combustible'],
  ['RCI Banque S.A. Niederlassung Deutschland', 'Cuotas vehiculos'],
  ['Telefonica Germany GmbH & Co. OHG', 'Facturas Telefonos'],
  ['Telefonica Insurance S.A.', 'Facturas Telefonos'],
  ['AMAZON PAYMENTS EUROPE S.C.A.', 'Miscelaneos Oficina'],
  ['Amazon EU S.a.r.l.', 'Miscelaneos Oficina'],
  ['ADYEN N.V.', 'Administrativo'],
  ['Volksbank Vorpommern eG', 'Intereses Bancos'],
  ['Kinder und Partner Steuerberater', 'Administrativo'],
];

const movementFrom = (counterpartyName, overrides = {}) => ({
  id: `mov-${counterpartyName}`,
  direction: 'out',
  amount: 480.25,
  counterpartyName,
  description: 'SEPA Lastschrift',
  postedDate: '2026-06-15',
  status: 'posted',
  ...overrides,
});

describe('seed classification rules catalog', () => {
  it('ships one rule per measured top counterparty', () => {
    expect(SEED_CLASSIFICATION_RULES).toHaveLength(REAL_COUNTERPARTIES.length);
    const patterns = SEED_CLASSIFICATION_RULES.map((r) => r.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    const names = SEED_CLASSIFICATION_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('matches counterparty names with a case-insensitive contains on outbound movements only', () => {
    for (const rule of SEED_CLASSIFICATION_RULES) {
      expect(rule.field).toBe('counterpartyName');
      expect(rule.matchType).toBe('contains');
      expect(rule.direction).toBe('out');
      expect(rule.active).toBe(true);
      expect(rule.pattern.trim()).not.toBe('');
      expect(rule.amountMin).toBeNull();
      expect(rule.amountMax).toBeNull();
    }
  });

  it('classifies every seeded counterparty as overhead without touching any project', () => {
    for (const rule of SEED_CLASSIFICATION_RULES) {
      expect(rule.applyTo.costScope).toBe(COST_SCOPE.OVERHEAD);
      expect(rule.applyTo.projectId).toBe('');
      expect(rule.applyTo.projectName).toBe('');
    }
  });

  it('only uses category names that exist in the project constants', () => {
    for (const rule of SEED_CLASSIFICATION_RULES) {
      expect(EXPENSE_CATEGORIES).toContain(rule.applyTo.categoryName);
    }
  });

  it('sits below the default priority so hand-made rules always win a conflict', () => {
    for (const rule of SEED_CLASSIFICATION_RULES) {
      expect(rule.priority).toBeLessThan(100);
      expect(rule.priority).toBeGreaterThan(0);
    }
  });

  it('routes each real counterparty to its category and to overhead through the engine', () => {
    for (const [counterpartyName, expectedCategory] of REAL_COUNTERPARTIES) {
      const movement = movementFrom(counterpartyName);
      const rule = findBestRule(movement, SEED_CLASSIFICATION_RULES);

      expect(rule, `no seed rule matched "${counterpartyName}"`).not.toBeNull();
      expect(buildClassificationPayload(rule, movement)).toEqual({
        categoryName: expectedCategory,
        costScope: COST_SCOPE.OVERHEAD,
      });
    }
  });

  it('produces a valid classification with no project selected', () => {
    for (const [counterpartyName] of REAL_COUNTERPARTIES) {
      const movement = movementFrom(counterpartyName);
      const payload = buildClassificationPayload(findBestRule(movement, SEED_CLASSIFICATION_RULES), movement);

      expect(validateClassification(movement, {
        categoryName: payload.categoryName,
        costScope: payload.costScope,
        projectId: '',
      })).toEqual({ valid: true, error: null });
    }
  });

  it('leaves inbound movements from the same counterparties untouched', () => {
    for (const [counterpartyName] of REAL_COUNTERPARTIES) {
      const inbound = movementFrom(counterpartyName, { direction: 'in' });
      expect(findBestRule(inbound, SEED_CLASSIFICATION_RULES)).toBeNull();
    }
  });

  it('never overwrites a movement that already has a destination', () => {
    const movement = movementFrom('FINANZKASSE STRALSUND', {
      categoryName: 'Impuestos',
      projectId: 'proj-1',
    });
    expect(buildClassificationPayload(findBestRule(movement, SEED_CLASSIFICATION_RULES), movement))
      .toEqual({});
  });
});

describe('seedRuleToDoc', () => {
  const clock = new Date('2026-07-26T08:30:00.000Z');

  it('shapes a seed entry exactly like the document createRule writes', () => {
    const [taxRule] = SEED_CLASSIFICATION_RULES;
    const doc = seedRuleToDoc(taxRule, 'jromero@umtelkomd.com', clock);

    expect(doc).toEqual({
      name: taxRule.name,
      field: 'counterpartyName',
      matchType: 'contains',
      pattern: taxRule.pattern,
      direction: 'out',
      amountMin: null,
      amountMax: null,
      applyTo: {
        categoryName: taxRule.applyTo.categoryName,
        costCenterId: '',
        projectId: '',
        projectName: '',
        costScope: COST_SCOPE.OVERHEAD,
      },
      active: true,
      priority: taxRule.priority,
      notes: taxRule.notes,
      hits: 0,
      lastHitAt: '',
      createdAt: '2026-07-26T08:30:00.000Z',
      updatedAt: '2026-07-26T08:30:00.000Z',
      createdBy: 'jromero@umtelkomd.com',
    });
  });

  it('defaults the author to an empty string when no user email is given', () => {
    expect(seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], undefined, clock).createdBy).toBe('');
    expect(seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], null, clock).createdBy).toBe('');
  });

  it('trims text and falls back to the hook defaults for invalid enum values', () => {
    const doc = seedRuleToDoc({
      name: '  Manual rule  ',
      field: 'iban',
      matchType: 'fuzzy',
      pattern: '  ADYEN  ',
      direction: 'sideways',
      applyTo: { categoryName: '  Otros  ', costScope: 'structural' },
      notes: '  note  ',
    }, 'bsandoval@umtelkomd.com', clock);

    expect(doc.name).toBe('Manual rule');
    expect(doc.pattern).toBe('ADYEN');
    expect(doc.notes).toBe('note');
    expect(doc.field).toBe('counterpartyName');
    expect(doc.matchType).toBe('contains');
    expect(doc.direction).toBe('both');
    expect(doc.priority).toBe(100);
    expect(doc.active).toBe(true);
    expect(doc.applyTo).toEqual({
      categoryName: 'Otros',
      costCenterId: '',
      projectId: '',
      projectName: '',
      costScope: '',
    });
  });

  it('keeps priority a non-negative integer and honours an explicit inactive flag', () => {
    expect(seedRuleToDoc({ priority: 12.9 }, '', clock).priority).toBe(12);
    expect(seedRuleToDoc({ priority: -5 }, '', clock).priority).toBe(0);
    expect(seedRuleToDoc({ priority: 'nope' }, '', clock).priority).toBe(100);
    expect(seedRuleToDoc({ active: false }, '', clock).active).toBe(false);
  });

  it('stamps both timestamps from the same clock and stays serializable', () => {
    const doc = seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], 'jromero@umtelkomd.com', clock);
    expect(doc.createdAt).toBe(doc.updatedAt);
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], '').createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('never mutates the source catalog', () => {
    const snapshot = JSON.stringify(SEED_CLASSIFICATION_RULES);
    const doc = seedRuleToDoc(SEED_CLASSIFICATION_RULES[0], 'jromero@umtelkomd.com', clock);
    doc.applyTo.categoryName = 'mutated';
    doc.priority = 999;
    expect(JSON.stringify(SEED_CLASSIFICATION_RULES)).toBe(snapshot);
  });
});
