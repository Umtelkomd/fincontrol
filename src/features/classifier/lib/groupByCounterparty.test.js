import { describe, expect, it } from 'vitest';

import { groupByCounterparty } from './groupByCounterparty.js';

const mov = (id, counterpartyName, amount, extra = {}) => ({
  id,
  counterpartyName,
  amount,
  direction: 'out',
  postedDate: '2026-06-01',
  ...extra,
});

describe('groupByCounterparty', () => {
  it('groups movements by counterparty with a count and a total', () => {
    const groups = groupByCounterparty([
      mov('a', 'Aral AG', 50),
      mov('b', 'Aral AG', 70.5),
      mov('c', 'Kabel Service GmbH', 4000),
    ]);

    expect(groups).toHaveLength(2);
    const aral = groups.find((group) => group.counterparty === 'Aral AG');
    expect(aral.count).toBe(2);
    expect(aral.total).toBe(120.5);
    expect(aral.movements.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(aral.ids).toEqual(['a', 'b']);
  });

  it('sorts groups by total descending, then by name', () => {
    const groups = groupByCounterparty([
      mov('a', 'Aral AG', 50),
      mov('b', 'Kabel Service GmbH', 4000),
      mov('c', 'Bauhaus', 50),
    ]);

    expect(groups.map((group) => group.counterparty)).toEqual(['Kabel Service GmbH', 'Aral AG', 'Bauhaus']);
  });

  it('merges spellings that differ only by case or padding', () => {
    const groups = groupByCounterparty([
      mov('a', 'Aral AG', 10),
      mov('b', '  ARAL  AG ', 10),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].counterparty).toBe('Aral AG');
  });

  it('collects movements without a counterparty under "Sin contraparte"', () => {
    const groups = groupByCounterparty([mov('a', '', 10), mov('b', undefined, 20)]);

    expect(groups).toHaveLength(1);
    expect(groups[0].counterparty).toBe('Sin contraparte');
    expect(groups[0].total).toBe(30);
  });

  it('sums magnitudes so a legacy negative amount does not cancel a positive one', () => {
    const groups = groupByCounterparty([mov('a', 'Aral AG', -30), mov('b', 'Aral AG', 20)]);

    expect(groups[0].total).toBe(50);
  });

  it('orders the movements inside a group newest first', () => {
    const groups = groupByCounterparty([
      mov('old', 'Aral AG', 10, { postedDate: '2026-01-05' }),
      mov('new', 'Aral AG', 10, { postedDate: '2026-03-05' }),
    ]);

    expect(groups[0].movements.map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('returns an empty array for nothing', () => {
    expect(groupByCounterparty([])).toEqual([]);
    expect(groupByCounterparty(null)).toEqual([]);
  });
});
