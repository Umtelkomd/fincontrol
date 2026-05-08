import { describe, expect, it } from 'vitest';

import {
  buildClassificationPayload,
  findBestRule,
  groupUnclassifiedByCounterparty,
  matchRule,
  previewMatches,
} from './ruleEngine.js';

const movement = (overrides = {}) => ({
  id: 'mov-1',
  direction: 'out',
  amount: 119,
  counterpartyName: 'Telekom Deutschland GmbH',
  description: 'Fiber backbone monthly invoice',
  status: 'posted',
  ...overrides,
});

const rule = (overrides = {}) => ({
  id: 'rule-1',
  active: true,
  name: 'Telekom fiber',
  field: 'counterpartyName',
  matchType: 'contains',
  pattern: 'telekom',
  direction: 'both',
  applyTo: {
    categoryName: 'Telecomunicaciones',
    costCenterId: 'cc-network',
    projectId: 'project-fiber',
    projectName: 'Fiber rollout',
  },
  ...overrides,
});

describe('rule engine matching', () => {
  it('matches contains, exact, startsWith, and regex patterns case-insensitively', () => {
    expect(matchRule(movement(), rule({ matchType: 'contains', pattern: 'DEUTSCHLAND' }))).toBe(true);
    expect(matchRule(movement(), rule({ matchType: 'exact', pattern: ' telekom deutschland gmbh ' }))).toBe(true);
    expect(matchRule(movement(), rule({ matchType: 'startsWith', pattern: 'telekom' }))).toBe(true);
    expect(matchRule(
      movement({ description: 'Invoice RE-2026-0042 fiber backbone' }),
      rule({ field: 'description', matchType: 'regex', pattern: 're-\\d{4}-\\d{4}' }),
    )).toBe(true);
  });

  it('rejects empty, inactive, invalid regex, and non-matching pattern rules', () => {
    expect(matchRule(movement(), rule({ active: false }))).toBe(false);
    expect(matchRule(movement(), rule({ pattern: '' }))).toBe(false);
    expect(matchRule(movement(), rule({ matchType: 'regex', pattern: '[' }))).toBe(false);
    expect(matchRule(movement(), rule({ matchType: 'exact', pattern: 'Vodafone GmbH' }))).toBe(false);
    expect(matchRule(null, rule())).toBe(false);
    expect(matchRule(movement(), null)).toBe(false);
  });

  it('applies direction and absolute amount gates with inclusive boundaries', () => {
    expect(matchRule(movement({ direction: 'out', amount: -250 }), rule({ direction: 'out', amountMin: 250, amountMax: 250 }))).toBe(true);
    expect(matchRule(movement({ direction: 'in', amount: 250 }), rule({ direction: 'out' }))).toBe(false);
    expect(matchRule(movement({ amount: 99.99 }), rule({ amountMin: 100 }))).toBe(false);
    expect(matchRule(movement({ amount: 500.01 }), rule({ amountMax: 500 }))).toBe(false);
    expect(matchRule(movement({ amount: 100 }), rule({ amountMin: 'not-a-number' }))).toBe(true);
    expect(matchRule(movement({ amount: 0 }), rule({ amountMax: '' }))).toBe(true);
  });
});

describe('rule engine priority and payloads', () => {
  it('chooses the best rule by priority, then last hit, hits, and alphabetical name', () => {
    const base = { pattern: 'telekom', direction: 'both' };

    expect(findBestRule(movement(), [
      rule({ id: 'low', name: 'Low priority', priority: 1, ...base }),
      rule({ id: 'high', name: 'High priority', priority: 5, ...base }),
    ])?.id).toBe('high');

    expect(findBestRule(movement(), [
      rule({ id: 'older', priority: 5, lastHitAt: '2026-03-01', ...base }),
      rule({ id: 'newer', priority: 5, lastHitAt: '2026-04-01', ...base }),
    ])?.id).toBe('newer');

    expect(findBestRule(movement(), [
      rule({ id: 'few', priority: 5, lastHitAt: '2026-04-01', hits: 2, ...base }),
      rule({ id: 'many', priority: 5, lastHitAt: '2026-04-01', hits: 8, ...base }),
    ])?.id).toBe('many');

    expect(findBestRule(movement(), [
      rule({ id: 'zeta', name: 'Zeta rule', priority: 5, lastHitAt: '2026-04-01', hits: 8, ...base }),
      rule({ id: 'alpha', name: 'Alpha rule', priority: 5, lastHitAt: '2026-04-01', hits: 8, ...base }),
    ])?.id).toBe('alpha');
  });

  it('returns null when no configured rule matches', () => {
    expect(findBestRule(movement(), [])).toBeNull();
    expect(findBestRule(movement(), [rule({ pattern: 'vodafone' }), rule({ active: false })])).toBeNull();
    expect(findBestRule(movement(), null)).toBeNull();
  });

  it('builds classification payloads without overwriting existing movement fields', () => {
    expect(buildClassificationPayload(rule(), movement())).toEqual({
      categoryName: 'Telecomunicaciones',
      costCenterId: 'cc-network',
      projectId: 'project-fiber',
      projectName: 'Fiber rollout',
    });

    expect(buildClassificationPayload(rule(), movement({
      categoryName: 'Existing category',
      costCenterId: 'cc-existing',
      projectId: 'project-existing',
      projectName: 'Existing project',
    }))).toEqual({});

    expect(buildClassificationPayload(rule({ applyTo: { categoryName: '', costCenterId: 'cc-network' } }), movement()))
      .toEqual({ costCenterId: 'cc-network' });
    expect(buildClassificationPayload(null, movement())).toEqual({});
  });
});

describe('rule engine previews and unclassified grouping', () => {
  it('previews matching movements without mutating them and respects the result limit', () => {
    const movements = [
      movement({ id: 'mov-1', counterpartyName: 'Telekom Deutschland GmbH' }),
      movement({ id: 'mov-2', counterpartyName: 'Telekom Austria' }),
      movement({ id: 'mov-3', counterpartyName: 'Vodafone GmbH' }),
    ];

    expect(previewMatches(movements, rule(), 1)).toEqual([movements[0]]);
    expect(previewMatches(movements, rule())).toEqual([movements[0], movements[1]]);
    expect(movements[0]).not.toHaveProperty('categoryName');
    expect(previewMatches(null, rule())).toEqual([]);
    expect(previewMatches(movements, null)).toEqual([]);
  });

  it('groups only unclassified non-void movements by counterparty with direction totals and samples', () => {
    const grouped = groupUnclassifiedByCounterparty([
      movement({ id: 't-1', counterpartyName: 'Telekom', direction: 'out', amount: -100 }),
      movement({ id: 't-2', counterpartyName: 'Telekom', direction: 'out', amount: 50 }),
      movement({ id: 't-3', counterpartyName: 'Telekom', direction: 'in', amount: 25 }),
      movement({ id: 't-4', counterpartyName: 'Telekom', categoryName: 'Already classified', amount: 999 }),
      movement({ id: 't-5', counterpartyName: 'Telekom', status: 'void', amount: 999 }),
      movement({ id: 'rent-1', counterpartyName: 'Rent GmbH', direction: 'out', amount: 500 }),
      movement({ id: 'blank-1', counterpartyName: '   ', direction: 'in', amount: 10 }),
    ], 2);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      counterparty: 'Telekom',
      count: 3,
      totalIn: 25,
      totalOut: 150,
    });
    expect(grouped[0].samples.map((sample) => sample.id)).toEqual(['t-1', 't-2', 't-3']);
    expect(grouped[1]).toMatchObject({
      counterparty: 'Rent GmbH',
      count: 1,
      totalIn: 0,
      totalOut: 500,
    });
  });
});
