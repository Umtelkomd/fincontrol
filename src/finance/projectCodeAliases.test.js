/**
 * Shared project code dictionary (Lumen ↔ FinControl) — regression coverage
 * added while unifying the three disagreeing project code sources (see
 * odd/tasks/invoice-classification-catalog.md "Problem"). Every existing
 * input keeps its existing output; the additions only recognize tokens that
 * previously fell through to the bare-uppercase fallback or, for legacy
 * ops-style refs, now merge into their existing master code.
 */
import { describe, expect, it } from 'vitest';

import { canonicalizeProjectCode, extractProjectToken, PROJECT_CODE_ALIASES, projectCodesMatch } from './projectCodeAliases.js';

describe('PROJECT_CODE_ALIASES — existing behavior is unchanged', () => {
  it('keeps every pre-existing alias entry', () => {
    expect(PROJECT_CODE_ALIASES['PROY-001']).toBe('QFF');
    expect(PROJECT_CODE_ALIASES['PROY-002']).toBe('QDU');
    expect(PROJECT_CODE_ALIASES['PROY-003']).toBe('FBX');
    expect(PROJECT_CODE_ALIASES['PROY-004']).toBe('NE4');
    expect(PROJECT_CODE_ALIASES['PROY-005']).toBe('AUSTRIA');
    expect(PROJECT_CODE_ALIASES.QFF).toBe('QFF');
    expect(PROJECT_CODE_ALIASES.QDU).toBe('QDU');
    expect(PROJECT_CODE_ALIASES.FBX).toBe('FBX');
    expect(PROJECT_CODE_ALIASES.NE4).toBe('NE4');
    expect(PROJECT_CODE_ALIASES.HXT).toBe('HXT');
    expect(PROJECT_CODE_ALIASES.RSD).toBe('RSD');
    expect(PROJECT_CODE_ALIASES.WCB).toBe('WCB');
    expect(PROJECT_CODE_ALIASES.WRZ).toBe('WRZ');
    expect(PROJECT_CODE_ALIASES.EHR).toBe('EHR');
    expect(PROJECT_CODE_ALIASES.AUSTRIA).toBe('AUSTRIA');
    expect(PROJECT_CODE_ALIASES.GFP).toBe('GFP');
    expect(PROJECT_CODE_ALIASES.UGG).toBe('UGG');
    expect(PROJECT_CODE_ALIASES.DGF).toBe('DGF');
  });

  it('canonicalizes every pre-existing input exactly as before', () => {
    expect(canonicalizeProjectCode('PROY-001')).toBe('QFF');
    expect(canonicalizeProjectCode('QFF')).toBe('QFF');
    expect(canonicalizeProjectCode('RSD')).toBe('RSD');
    expect(canonicalizeProjectCode('QFF (Roßdorf 1)')).toBe('QFF');
    expect(canonicalizeProjectCode('unknown-token')).toBe('UNKNOWN-TOKEN');
    expect(canonicalizeProjectCode('')).toBe('');
    expect(canonicalizeProjectCode(null)).toBe('');
  });

  it('matches pre-existing pairs exactly as before', () => {
    expect(projectCodesMatch('PROY-001', 'QFF')).toBe(true);
    expect(projectCodesMatch('QFF', 'FBX')).toBe(false);
    expect(projectCodesMatch('', 'QFF')).toBe(false);
  });
});

describe('PROJECT_CODE_ALIASES — the four seed codes missing from the dictionary', () => {
  it('recognizes BIE, WUR, BAM and LGN (present in LUMEN_CANONICAL_PROJECT_SEED)', () => {
    expect(PROJECT_CODE_ALIASES.BIE).toBe('BIE');
    expect(PROJECT_CODE_ALIASES.WUR).toBe('WUR');
    expect(PROJECT_CODE_ALIASES.BAM).toBe('BAM');
    expect(PROJECT_CODE_ALIASES.LGN).toBe('LGN');
    expect(canonicalizeProjectCode('bie')).toBe('BIE');
    expect(canonicalizeProjectCode('wur')).toBe('WUR');
  });
});

describe('PROJECT_CODE_ALIASES — production drift tokens are recognized', () => {
  it('merges the ops-style work-order refs into their master code', () => {
    expect(canonicalizeProjectCode('QFF-001')).toBe('QFF');
    expect(canonicalizeProjectCode('UGG-001')).toBe('UGG');
    expect(canonicalizeProjectCode('WEST-001')).toBe('WSC');
  });

  it('keeps QFF-002 apart from QFF — it is a different site (Roßdorf 2)', () => {
    expect(canonicalizeProjectCode('QFF-002')).toBe('QFF-002');
    expect(projectCodesMatch('QFF-002', 'QFF')).toBe(false);
  });

  it('recognizes the new Wesconnect production tokens', () => {
    expect(canonicalizeProjectCode('WSC')).toBe('WSC');
    expect(canonicalizeProjectCode('WESTC_MDU')).toBe('WESTC_MDU');
    expect(projectCodesMatch('WEST-001', 'WSC')).toBe(true);
    expect(projectCodesMatch('WESTC_MDU', 'WSC')).toBe(false);
  });

  it('recognizes AMD-001 and Meschede', () => {
    expect(canonicalizeProjectCode('AMD-001')).toBe('AMD-001');
    expect(canonicalizeProjectCode('Meschede')).toBe('MESCHEDE');
  });
});

describe('extractProjectToken — unchanged for existing inputs', () => {
  it('extracts the head token before a space/paren/slash', () => {
    expect(extractProjectToken('QFF (Roßdorf 1)')).toBe('QFF');
    expect(extractProjectToken('RSD/misc')).toBe('RSD');
    expect(extractProjectToken('')).toBe('');
  });
});

// T7 (odd/tasks/invoice-classification-catalog.md): useProjects.normalizeProjectPayload
// runs every project.code through canonicalizeProjectCode before it is persisted or
// re-persisted on update. The Projects settings screen's new code builder assembles
// structured v2 codes (src/finance/projectCode.js, CLI-SIT-LLn) — this must survive
// that round trip unmangled, since the hyphens in a v2 code are NOT the same kind of
// separator extractProjectToken splits legacy "CODE (Name)"/"CODE/note" values on.
describe('canonicalizeProjectCode — structured v2 project codes pass through unmangled', () => {
  it('keeps a hyphenated CLI-SIT-LLn code exactly as given, not split at the hyphens', () => {
    expect(canonicalizeProjectCode('INS-RSD-BL1')).toBe('INS-RSD-BL1');
    expect(canonicalizeProjectCode('VAN-UGG-N41')).toBe('VAN-UGG-N41');
    expect(canonicalizeProjectCode('WSC-GEN-MD12')).toBe('WSC-GEN-MD12');
  });

  it('uppercases a lowercase structured code without altering its shape', () => {
    expect(canonicalizeProjectCode('ins-rsd-bl1')).toBe('INS-RSD-BL1');
  });
});
