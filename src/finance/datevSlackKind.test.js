/**
 * What a file posted to Slack #facturas actually is.
 *
 * Only two kinds are income and may become a CxC: an Insyte UT Rechnung
 * (which NEVER becomes a row on its own — it is attached to the Insyte
 * presupuestos it groups) and a B2C Servicepaket Leitungsweg (one invoice,
 * one row). Everything else — confirming settlements, HKL/diesel, FeWo,
 * Korrektur/Storno — is not income and must never create a receivable.
 */
import { describe, expect, it } from 'vitest';

import {
  assertSlackCxcAllowed,
  classifyDatevSlackFile,
  isIncomeKind,
  parseSlackCaption,
} from './datevSlackKind.js';

describe('classifyDatevSlackFile', () => {
  it('flags confirming settlements by filename or bank name', () => {
    expect(classifyDatevSlackFile({ filename: 'cnf_2026-08-21.pdf', caption: '' })).toBe('confirming');
    expect(classifyDatevSlackFile({ filename: 'Abrechnung Wegen Faktorisierung.pdf', caption: '' })).toBe('confirming');
    expect(classifyDatevSlackFile({ filename: 'doc.pdf', caption: 'Confirming Bankinter' })).toBe('confirming');
    expect(classifyDatevSlackFile({ filename: 'doc.pdf', caption: 'Liquidación CaixaBank' })).toBe('confirming');
    expect(classifyDatevSlackFile({ filename: 'BBVA settlement.pdf', caption: '' })).toBe('confirming');
    expect(classifyDatevSlackFile({ filename: 'Santander.pdf', caption: '' })).toBe('confirming');
  });

  it('flags HKL and diesel as otro', () => {
    expect(classifyDatevSlackFile({ filename: 'Rechnung 2025-260.pdf', caption: 'HKL Baumaschinen' })).toBe('otro');
    expect(classifyDatevSlackFile({ filename: 'diesel_august.pdf', caption: '' })).toBe('otro');
  });

  it('flags FeWo and Korrektur/Storno', () => {
    expect(classifyDatevSlackFile({ filename: 'FeWo Rossdorf.pdf', caption: '' })).toBe('fewo');
    expect(classifyDatevSlackFile({ filename: 'Rechnung 2025-250.pdf', caption: 'Korrektur zu 2025-240' })).toBe('korrektur');
    expect(classifyDatevSlackFile({ filename: 'Storno 2025-241.pdf', caption: '' })).toBe('korrektur');
  });

  it('recognises a B2C Servicepaket Leitungsweg', () => {
    expect(classifyDatevSlackFile({ filename: 'Rechnung 2025-257.pdf', caption: 'Servicepaket Leitungsweg Weicker' })).toBe('sp_leitungsweg');
    expect(classifyDatevSlackFile({ filename: 'SP 2025-258.pdf', caption: '' })).toBe('sp_leitungsweg');
  });

  it('recognises an Insyte UT Rechnung only with an Insyte/UT/NE3/NE4 caption', () => {
    expect(classifyDatevSlackFile({ filename: 'Rechnung 2025-270.pdf', caption: 'Insyte KW34 Rossdorf' })).toBe('insyte_ut');
    expect(classifyDatevSlackFile({ filename: 'Rechnung 2025-272.pdf', caption: 'NE4 Harsewinkel 4.659 €' })).toBe('insyte_ut');
    expect(classifyDatevSlackFile({ filename: 'Rechnung 2025-269.pdf', caption: 'UT NE3 Dieburg' })).toBe('insyte_ut');
    expect(classifyDatevSlackFile({ filename: 'Rechnung 2025-269.pdf', caption: '' })).toBe('otro');
  });

  it('defaults to otro and tolerates missing input', () => {
    expect(classifyDatevSlackFile({ filename: 'foto.jpg', caption: 'obra' })).toBe('otro');
    expect(classifyDatevSlackFile({})).toBe('otro');
    expect(classifyDatevSlackFile()).toBe('otro');
  });
});

describe('isIncomeKind', () => {
  it('is true only for insyte_ut and sp_leitungsweg', () => {
    expect(isIncomeKind('insyte_ut')).toBe(true);
    expect(isIncomeKind('sp_leitungsweg')).toBe(true);
    ['fewo', 'confirming', 'korrektur', 'otro', '', undefined].forEach((kind) => {
      expect(isIncomeKind(kind)).toBe(false);
    });
  });
});

describe('parseSlackCaption', () => {
  it('extracts DATEV number, KW, obra and tier', () => {
    expect(parseSlackCaption('Rechnung 2025-270 · KW34 Rossdorf · NE4 · 5.186,02 €')).toEqual({
      datev: '2025-270',
      kw: 'KW34',
      obra: 'Rossdorf',
      tier: 'NE4',
      euro: 5186.02,
    });
  });

  it('never fills the euro amount when the caption has none', () => {
    expect(parseSlackCaption('Rechnung 2025-269 NE3 Dieburg KW 33')).toEqual({
      datev: '2025-269',
      kw: 'KW33',
      obra: 'Dieburg',
      tier: 'NE3',
      euro: null,
    });
  });

  it('returns nulls for an empty caption', () => {
    expect(parseSlackCaption('')).toEqual({ datev: null, kw: null, obra: null, tier: null, euro: null });
    expect(parseSlackCaption()).toEqual({ datev: null, kw: null, obra: null, tier: null, euro: null });
  });
});

describe('assertSlackCxcAllowed — the guard scripts/add-cxc-from-slack.cjs runs', () => {
  it('lets a B2C Servicepaket Leitungsweg through', () => {
    expect(() =>
      assertSlackCxcAllowed({ documentNumber: '2025-257', filename: 'Rechnung 2025-257.pdf', caption: 'Servicepaket Leitungsweg' }),
    ).not.toThrow();
    expect(assertSlackCxcAllowed({ documentNumber: '2025-258', kind: 'sp_leitungsweg' })).toBe('sp_leitungsweg');
  });

  it('refuses an Insyte UT Rechnung — those attach to presupuestos, never create rows', () => {
    expect(() =>
      assertSlackCxcAllowed({ documentNumber: '2025-270', filename: 'Rechnung 2025-270.pdf', caption: 'Insyte KW34' }),
    ).toThrow(/insyte_ut/);
  });

  it('refuses a confirming settlement', () => {
    expect(() => assertSlackCxcAllowed({ documentNumber: 'x', filename: 'cnf_2026-08.pdf' })).toThrow(/confirming/);
  });

  it('refuses an explicit kind that is not sp_leitungsweg and an unknown one', () => {
    expect(() => assertSlackCxcAllowed({ documentNumber: '2025-256', kind: 'insyte_ut' })).toThrow(/2025-256/);
    expect(() => assertSlackCxcAllowed({ documentNumber: '2025-256', kind: 'otro' })).toThrow(/otro/);
    expect(() => assertSlackCxcAllowed({ documentNumber: '2025-256' })).toThrow(/otro/);
  });
});
