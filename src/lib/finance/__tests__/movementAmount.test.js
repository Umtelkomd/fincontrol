import { describe, expect, it } from 'vitest';
import { isInternalTransfer, signedAmountOf, splitInternalTransfers } from '../movementAmount.js';

// ─── signedAmountOf — signedAmount wins only when it is a nonzero number ──────
// Movements imported before May 2026 have NO usable signedAmount (missing or 0)
// and must fall back to direction + amount.

describe('signedAmountOf', () => {
  it('uses a nonzero numeric signedAmount verbatim', () => {
    expect(signedAmountOf({ signedAmount: -250.5, direction: 'in', amount: 250.5 })).toBe(-250.5);
    expect(signedAmountOf({ signedAmount: 1200, direction: 'out', amount: 1200 })).toBe(1200);
  });

  it('falls back to direction+amount when signedAmount is 0 (legacy imports)', () => {
    expect(signedAmountOf({ signedAmount: 0, direction: 'out', amount: 99.9 })).toBe(-99.9);
    expect(signedAmountOf({ signedAmount: 0, direction: 'in', amount: 42 })).toBe(42);
  });

  it('falls back when signedAmount is missing or not a number', () => {
    expect(signedAmountOf({ direction: 'out', amount: 100 })).toBe(-100);
    expect(signedAmountOf({ signedAmount: NaN, direction: 'in', amount: 7 })).toBe(7);
    expect(signedAmountOf({ signedAmount: '-12', direction: 'in', amount: 12 })).toBe(12);
  });

  it('normalizes the fallback with Math.abs on amount', () => {
    expect(signedAmountOf({ direction: 'out', amount: -100 })).toBe(-100);
    expect(signedAmountOf({ direction: 'in', amount: -50 })).toBe(50);
  });

  it('treats any non-"out" direction as inflow (documented fallback rule)', () => {
    expect(signedAmountOf({ amount: 30 })).toBe(30);
    expect(signedAmountOf({ direction: 'unknown', amount: 30 })).toBe(30);
  });

  it('returns 0 for missing amounts or missing movement', () => {
    expect(signedAmountOf({ direction: 'out' })).toBe(0);
    expect(signedAmountOf({ direction: 'out', amount: 'x' })).toBe(0);
    expect(signedAmountOf(null)).toBe(0);
    expect(signedAmountOf(undefined)).toBe(0);
  });
});

// ─── isInternalTransfer — conservative heuristic used to exclude from burn ────

describe('isInternalTransfer', () => {
  it('matches kind === "transfer" (case-insensitive)', () => {
    expect(isInternalTransfer({ kind: 'transfer' })).toBe(true);
    expect(isInternalTransfer({ kind: 'Transfer' })).toBe(true);
  });

  it('matches the company itself as counterparty (own-account transfers)', () => {
    expect(isInternalTransfer({ counterpartyName: 'UMTELKOMD' })).toBe(true);
    expect(isInternalTransfer({ counterpartyName: 'Umtelkomd GmbH' })).toBe(true);
    // The exact string carrying the 29 own-account movements in the ledger.
    expect(isInternalTransfer({ counterpartyName: 'UMTELKOMD GmbH' })).toBe(true);
    // German legal-form noise around the own name is still the same company.
    expect(isInternalTransfer({ counterpartyName: 'UMTELKOMD GMBH & CO. KG' })).toBe(true);
  });

  // ── The false positive that would cost more than the bug ───────────────────
  // `UMTELKOMD ESPAÑA S.L.` is a SUBCONTRACTOR — a different legal entity a
  // contact of the manager registered under an almost identical name. Its ~48k €
  // of construction cost must keep reaching the obras. These are the exact
  // spellings present in the production ledger.
  describe('never matches the UMTELKOMD ESPAÑA subcontractor', () => {
    const SUBCONTRACTOR_SPELLINGS = [
      'UMTELKOMD ESPA.A SOCIEDAD LIMITADA',
      'UMTELKOMD ESPANA S.L.',
      'UMTELKOMD ESPANA SOCIEDAD LIMITADA',
      'UMTELKOMD ESPA.A S.L.',
      'UMTELKOMD ESPAÑA S.L.',
    ];

    it.each(SUBCONTRACTOR_SPELLINGS)('treats "%s" as a real third party', (counterpartyName) => {
      expect(isInternalTransfer({ counterpartyName, direction: 'out', amount: 2000 })).toBe(false);
    });

    it('keeps every subcontractor payment inside the operational split', () => {
      const movements = SUBCONTRACTOR_SPELLINGS.map((counterpartyName, index) => ({
        id: `sub-${index}`,
        counterpartyName,
        direction: 'out',
        amount: 1000,
      }));
      const split = splitInternalTransfers(movements);
      expect(split.internalTransfers).toEqual([]);
      expect(split.operationalMovements).toHaveLength(SUBCONTRACTOR_SPELLINGS.length);
      expect(split.excludedTotal).toBe(0);
    });
  });

  it('never reads the own-company name out of free text', () => {
    // Real ledger rows: the customs office, a supplier and a client all carry
    // "Umtelkomd GmbH" inside the DATEV purpose line. They are real money.
    expect(isInternalTransfer({
      counterpartyName: 'Hauptzollamt Stralsund Zollzahlstelle',
      description: 'SVWZ+022473-2026-9150-G21-Umtelkomd GmbHTAN: 5870',
      direction: 'out',
    })).toBe(false);
    expect(isInternalTransfer({
      counterpartyName: 'Osman Tekelioglu',
      description: 'SVWZ+Rechnung Nr. FR13-345259, Umtelkomd GmbH, 31',
      direction: 'out',
    })).toBe(false);
    expect(isInternalTransfer({
      counterpartyName: 'MONCOBRA S.A. German Branch',
      description: 'EREF: 8983 UMTELKOMD GmbH R.UMT-2026-0043',
      direction: 'in',
    })).toBe(false);
  });

  it('matches the German internal-rebooking keyword as a whole word', () => {
    expect(isInternalTransfer({ description: 'Umbuchung Tagesgeld' })).toBe(true);
    expect(isInternalTransfer({ counterpartyName: 'UMBUCHUNG' })).toBe(true);
    expect(isInternalTransfer({ categoryName: 'Umbuchung' })).toBe(true);
  });

  it('stays conservative: ordinary payments never match', () => {
    expect(isInternalTransfer({ kind: 'sepa-credit', description: 'Ueberweisung Miete Juli' })).toBe(false);
    // "Überweisung" is an ordinary bank transfer to a third party, in both spellings.
    expect(isInternalTransfer({ description: 'Überweisung Miete Juli' })).toBe(false);
    expect(isInternalTransfer({ counterpartyName: 'Überweisung Handwerker GmbH' })).toBe(false);
    expect(isInternalTransfer({ description: 'Umbuchungsservice GmbH Rechnung' })).toBe(false); // not a whole word
    expect(isInternalTransfer({ counterpartyName: 'Musterkunde AG' })).toBe(false);
    expect(isInternalTransfer({})).toBe(false);
    expect(isInternalTransfer(null)).toBe(false);
  });
});

// ─── splitInternalTransfers — the P&L-side exclusion, cash-side untouched ─────

describe('splitInternalTransfers', () => {
  const ownAccount = (overrides = {}) => ({
    id: 'own-1',
    counterpartyName: 'UMTELKOMD GmbH',
    direction: 'out',
    amount: 10000,
    ...overrides,
  });

  it('separates own-account movements from operational ones', () => {
    const supplier = { id: 'sup-1', counterpartyName: 'Musterkunde AG', direction: 'out', amount: 500 };
    const split = splitInternalTransfers([ownAccount(), supplier]);

    expect(split.internalTransfers.map((entry) => entry.id)).toEqual(['own-1']);
    expect(split.operationalMovements.map((entry) => entry.id)).toEqual(['sup-1']);
  });

  it('totals both legs separately so the UI can explain the exclusion', () => {
    const split = splitInternalTransfers([
      ownAccount({ id: 'out-1', direction: 'out', amount: 72872.8 }),
      ownAccount({ id: 'in-1', direction: 'in', amount: 85667.6 }),
    ]);

    expect(split.outflowTotal).toBeCloseTo(72872.8, 2);
    expect(split.inflowTotal).toBeCloseTo(85667.6, 2);
    expect(split.excludedTotal).toBeCloseTo(158540.4, 2);
  });

  it('honours a caller-supplied amount resolver, like the payroll split does', () => {
    const split = splitInternalTransfers([ownAccount({ amount: 119, netAmount: 100 })], {
      amountOf: (entry) => Number(entry.netAmount || 0),
    });

    expect(split.outflowTotal).toBe(100);
  });

  it('returns empty results for a missing or invalid list', () => {
    expect(splitInternalTransfers(null)).toEqual({
      operationalMovements: [],
      internalTransfers: [],
      inflowTotal: 0,
      outflowTotal: 0,
      excludedTotal: 0,
    });
  });
});

describe('isInternalTransfer — taxonomy internal category', () => {
  it('treats a movement filed under "Transferencia interna" as internal before kind is stamped', () => {
    expect(isInternalTransfer({ counterpartyName: 'Sparkasse Konto 2', categoryName: 'Transferencia interna' })).toBe(true);
    expect(isInternalTransfer({ counterpartyName: 'Sparkasse Konto 2', category: 'Transferencia interna' })).toBe(true);
  });

  it('does not read any other category as internal', () => {
    expect(isInternalTransfer({ counterpartyName: 'Sparkasse Konto 2', categoryName: 'Otros administrativos' })).toBe(false);
  });
});
