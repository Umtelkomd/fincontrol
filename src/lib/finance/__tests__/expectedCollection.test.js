import { describe, expect, it } from 'vitest';

import {
  AT_RISK_DAYS,
  buildPayerProfiles,
  expectedCollectionOf,
  payerKeyOf,
} from '../expectedCollection.js';

const insyte = (id, net, issueDate, extra = {}) => ({ id, counterpartyName: 'Insyte Deutschland GmbH', grossAmount: net, issueDate, status: 'settled', ...extra });
const receipt = (id, amount, postedDate, receivableIds) => ({ id, direction: 'in', status: 'posted', amount, postedDate, receivableIds });

// Three confirming advances: gross = net × 1.19, minus ~2.3 %.
const history = {
  receivables: [
    insyte('a', 7256, '2026-06-09'), insyte('b', 36336.46, '2026-06-22'), insyte('c', 49959.66, '2026-07-21'),
    { id: 'p1', counterpartyName: 'Anna Privat', grossAmount: 67.22, issueDate: '2026-05-01', status: 'settled' },
  ],
  movements: [
    receipt('m1', 8427.74, '2026-06-12', ['a']),
    receipt('m2', 42281.66, '2026-06-26', ['b']),
    receipt('m3', 58073.84, '2026-07-24', ['c']),
    receipt('m4', 79.99, '2026-05-20', ['p1']),
  ],
};

describe('payerKeyOf', () => {
  it('ignores legal form, case and punctuation', () => {
    expect(payerKeyOf({ counterpartyName: 'Insyte Deutschland GmbH' })).toBe(payerKeyOf({ counterpartyName: 'INSYTE DEUTSCHLAND' }));
  });
});

describe('buildPayerProfiles', () => {
  it('measures the cash ratio and the issue-to-cash lag per payer', () => {
    const profile = buildPayerProfiles(history).get(payerKeyOf({ counterpartyName: 'Insyte' + ' Deutschland' }));
    expect(profile.sampleSize).toBe(3);
    expect(profile.cashRatio).toBeGreaterThan(1.15);
    expect(profile.cashRatio).toBeLessThan(1.17);
    expect(profile.lagDays).toBe(3);
  });

  it('does not profile a payer with fewer than three receipts', () => {
    expect(buildPayerProfiles(history).has(payerKeyOf({ counterpartyName: 'Anna Privat' }))).toBe(false);
  });

  it('ignores void movements and outflows', () => {
    const profiles = buildPayerProfiles({
      receivables: history.receivables,
      movements: history.movements.map((m) => ({ ...m, status: 'void' })),
    });
    expect(profiles.size).toBe(0);
  });
});

describe('expectedCollectionOf', () => {
  const profiles = buildPayerProfiles(history);
  const context = { today: '2026-09-23', profiles, fallbackSlipDays: 7 };

  it('expects a profiled payer at issue date + lag, for the measured cash', () => {
    const result = expectedCollectionOf(insyte('n', 10000, '2026-09-22', { status: 'issued', dueDate: '2026-10-22' }), { ...context, openAmount: 10000 });
    expect(result).toMatchObject({ date: '2026-09-25', basis: 'payer', atRisk: false });
    expect(result.amount).toBeGreaterThan(11500);
  });

  it('falls back to due date + slip for an unprofiled payer, at the booked amount', () => {
    const doc = { id: 'x', counterpartyName: 'Nuevo Cliente', grossAmount: 500, issueDate: '2026-09-20', dueDate: '2026-10-20' };
    expect(expectedCollectionOf(doc, { ...context, openAmount: 500 })).toMatchObject({ date: '2026-10-27', amount: 500, basis: 'default' });
  });

  it('expects overdue money next week, not this week', () => {
    const doc = { id: 'o', counterpartyName: 'Nuevo Cliente', grossAmount: 300, dueDate: '2026-09-01' };
    expect(expectedCollectionOf(doc, { ...context, openAmount: 300 })).toMatchObject({ date: '2026-09-30', atRisk: false, daysLate: 15 });
  });

  it(`marks money more than ${AT_RISK_DAYS} days past its expected date as at risk`, () => {
    const doc = { id: 'r', counterpartyName: 'Nuevo Cliente', grossAmount: 300, dueDate: '2026-06-01' };
    expect(expectedCollectionOf(doc, { ...context, openAmount: 300 }).atRisk).toBe(true);
  });

  it('never expects a disputed receivable, however recent', () => {
    const doc = { id: 'v', counterpartyName: 'Vancom-IT GmbH', grossAmount: 84826, issueDate: '2026-09-16', dueDate: '2026-10-16', collectionStatus: 'disputed' };
    expect(expectedCollectionOf(doc, { ...context, openAmount: 84826 })).toMatchObject({ atRisk: true, disputed: true, basis: 'disputed', amount: 84826 });
  });
});
