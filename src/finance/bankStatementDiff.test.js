import { describe, expect, it } from 'vitest';
import { diffBankStatementFiles, findOrphanLedgerRows, formatBankMatchingIssues } from './bankStatementDiff.js';
import { deriveBalance } from '../lib/finance/cashPosition.js';

const booking = {
  postedDate: '2026-05-31', amount: 100, direction: 'out', currency: 'EUR',
  counterpartyName: 'ACME GmbH', description: 'Invoice 123', rowHash: 'datev-a',
};

describe('unresolved report evidence', () => {
  it('quarantines both sides rather than asserting new payments, orphans or anchors', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ ...booking, rowHash: '', description: 'Payment',
      customerRef: i % 2 ? 'A' : '', balanceAfter: 900, signedAmount: -100, lineNumber: i + 2 }));
    const ledger = rows.map((row, i) => ({ ...row, id: `ledger-${i}`, customerRef: i % 2 ? 'B' : 'A' }));
    const safe = { ...booking, amount: 42, signedAmount: -42, postedDate: '2026-06-30', balanceAfter: 942, rowHash: 'safe' };
    const orphan = { ...booking, amount: 9, postedDate: '2026-06-15', rowHash: 'orphan', id: 'independent-orphan' };
    ledger.push(orphan);
    expect(diffBankStatementFiles([{ rows: [safe] }], []).openingAnchor).toEqual({ date: '2026-06-29', balance: 984 });
    const report = diffBankStatementFiles([{ name: 'synthetic.csv', rows: [...rows, safe] }], ledger);
    expect(report.newRows).toEqual([expect.objectContaining({ rowHash: 'safe' })]);
    expect(report.orphanLedgerRows).toEqual([orphan]);
    expect(report.unresolvedRows).toHaveLength(120);
    expect(report.unresolvedLedgerRows).toHaveLength(120);
    expect(report.unresolved[0].reason).toBe('unproven-booking-multiplicity');
    const text = formatBankMatchingIssues(report).join('\n');
    expect(text).toContain('NEEDS REVIEW: 120 source rows and 120 ledger rows withheld.');
    expect(text).toContain('orphan totals and balance drift are UNKNOWN');
    expect(text).toContain('synthetic.csv: line 2');
    expect(formatBankMatchingIssues({})).toEqual([]);
    expect(report.openingAnchor).toBeNull();
    expect(report.balances).toEqual([]);
    const reverse = findOrphanLedgerRows(rows, ledger);
    expect([...reverse]).toEqual([orphan]);
    expect(reverse.unresolved).toHaveLength(1);
  });
});

describe('multi-file report occurrence and opening evidence', () => {
  it.each([0, 0.1 + 0.2, Infinity])('validates cents and preserves independent observed intervals (closing=%s)', (last) => {
    const row = (postedDate, signedAmount, balanceAfter, lineNumber) => ({ ...booking, postedDate, signedAmount,
      amount: Math.abs(signedAmount), direction: signedAmount < 0 ? 'out' : 'in', balanceAfter, lineNumber });
    const files = [{ rows: [row('2026-01-30', 0.1, 0.1, 2), row('2026-02-01', last - 0.1, last, 3)] }];
    const report = diffBankStatementFiles(files, []);
    expect(report.balances).toEqual(Number.isFinite(last)
      ? [{ date: '2026-01-30', balance: 0.1 }, { date: '2026-02-01', balance: Math.round(last * 100) / 100 }] : []);
    expect(report.openingAnchor).toEqual(Number.isFinite(last) ? { date: '2026-01-29', balance: 0 } : null);
    if (!Number.isFinite(last)) expect(formatBankMatchingIssues(report).join('\n')).toContain('drift is UNKNOWN');
    const independent = { rows: [row('2026-03-15', 42, 42, 2)] };
    const mixed = diffBankStatementFiles([...files, independent], []);
    expect(mixed.balances.at(-1)).toEqual({ date: '2026-03-15', balance: 42 });
    expect(mixed.openingAnchor).toBeNull(); // No source proves coverage across the gap.
  });

  const payment = (balanceAfter, lineNumber) => ({ ...booking, signedAmount: -100, balanceAfter, lineNumber, sourceFormat: 'volksbank-umsaetze', rowHash: `datev-${balanceAfter}` });

  it('does not let overlapping exports explain an extra ledger document', () => {
    const row = payment(800, 2);
    const files = [{ rows: [row] }, { rows: [{ ...row }] }];
    const ledger = [{ ...row, id: 'first' }, { ...row, id: 'extra' }];
    for (const input of [files, [...files].reverse()]) {
      const report = diffBankStatementFiles(input, ledger);
      expect(report.rows).toHaveLength(1);
      expect(report.orphanLedgerRows).toEqual([ledger[1]]);
      expect(report.newRows).toEqual([]);
    }
  });

  it.each([false, true])('derives opening and drift from unique ordered occurrences (ascending=%s)', (ascending) => {
    const balances = ascending ? [900, 800] : [800, 900];
    const full = { rows: balances.map((balance, index) => payment(balance, index + 2)) };
    const subset = { rows: [payment(800, 2)] };
    const ledger = [payment(900, 2), payment(800, 3)];
    for (const files of [[full, subset], [subset, full]]) {
      const report = diffBankStatementFiles(files, ledger);
      expect(report.rows).toHaveLength(2);
      expect(report.orphanLedgerRows).toEqual([]);
      expect(report.openingAnchor).toEqual({ date: '2026-05-30', balance: 1000 });
      expect(deriveBalance({ anchors: [report.openingAnchor], movements: ledger, today: '2026-05-31' }).balance - 800).toBe(0);
    }
  });

  it('uses the richest alias for each occurrence, not the first alias of a richer file', () => {
    const early = payment(900, 2);
    const broad = { rows: [
      { ...early, balanceAfter: null },
      { ...payment(800, 3), postedDate: '2026-06-01' },
      { ...payment(700, 4), postedDate: '2026-06-02' },
    ] };
    const precise = { rows: [early] };
    for (const files of [[broad, precise], [precise, broad]]) {
      expect(diffBankStatementFiles(files, []).openingAnchor).toEqual({ date: '2026-05-30', balance: 1000 });
    }
  });

  it('withholds an opening when the earliest day cannot form a complete balance sequence', () => {
    for (const balances of [[900, null], [900, 750], [900, 800, 900]]) {
      const report = diffBankStatementFiles([{ rows: balances.map((balance, i) => payment(balance, i + 2)) }], []);
      expect(report.openingAnchor).toBeNull();
      // Different known balances prove cardinality, not necessarily a chain.
      const ambiguous = balances.includes(null) || new Set(balances).size !== balances.length;
      expect(report.rows).toHaveLength(ambiguous ? 0 : balances.length);
      expect(report.unresolvedRows?.length || 0).toBe(ambiguous ? balances.length : 0);
    }
  });
});

describe('statement reverse diff consumes every matching path', () => {
  it.each(['hash', 'fingerprint', 'truncated'])('reports an extra ledger document via %s matching', (path) => {
    const row = { ...booking, counterpartyName: 'ACME GmbH Long Counterparty Name' };
    const movement = { ...row };
    if (path !== 'hash') movement.rowHash = 'datev-other-format';
    if (path === 'truncated') movement.counterpartyName = 'ACME GmbH Long Counterparty';
    const ledger = [{ ...movement, id: 'first' }, { ...movement, id: 'extra' }];
    expect(findOrphanLedgerRows([row], ledger)).toEqual([ledger[1]]);
    const ambiguous = findOrphanLedgerRows([row, { ...row }], ledger);
    expect([...ambiguous]).toEqual([]);
    expect(ambiguous.unresolved).toHaveLength(1);
    expect(ambiguous.unresolved[0].reason).toBe('unproven-booking-multiplicity');
  });

  it.each([{ sepa: { customerRef: 'OTHER' } }, { description: 'Invoice B' }])('report and reverse diff retain a conflicting booking: %j', (change) => {
    const row = { ...booking, sepa: { customerRef: 'REF-A' } };
    const existing = { ...row, ...change };
    expect(findOrphanLedgerRows([row], [existing])).toEqual([existing]);
    const report = diffBankStatementFiles([{ rows: [row] }], [existing]);
    expect(report.newRows).toHaveLength(1);
    expect(report.orphanLedgerRows).toEqual([existing]);
  });

  it('reserves exact matches before a looser match can steal their occurrence', () => {
    const exact = { ...booking, id: 'exact' };
    const loose = { ...booking, rowHash: 'datev-other', id: 'loose' };
    expect(findOrphanLedgerRows([booking], [loose, exact])).toEqual([loose]);
    expect(findOrphanLedgerRows([booking], [exact, loose])).toEqual([loose]);
  });

  it('does not explain an unrelated payment with a blank-counterparty fee', () => {
    const fee = { ...booking, counterpartyName: '', description: 'Account fee', rowHash: 'datev-fee' };
    expect(findOrphanLedgerRows([fee], [booking])).toEqual([booking]);
    expect(findOrphanLedgerRows([fee], [{ ...fee, counterpartyName: 'Volksbank', rowHash: 'datev-legacy' }])).toEqual([]);
  });

  it('preserves inputs and handles empty sides', () => {
    const row = Object.freeze({ ...booking });
    const ledger = Object.freeze([row]);
    expect(findOrphanLedgerRows([], ledger)).toEqual([row]);
    expect(findOrphanLedgerRows([row], [])).toEqual([]);
    expect(findOrphanLedgerRows([row], ledger)).toEqual([]);
  });
});
