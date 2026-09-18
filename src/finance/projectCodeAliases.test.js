/**
 * Shared project code dictionary (Lumen ↔ FinControl) — regression coverage
 * added while unifying the three disagreeing project code sources (see
 * odd/tasks/invoice-classification-catalog.md "Problem"). Every existing
 * input keeps its existing output; the additions only recognize tokens that
 * previously fell through to the bare-uppercase fallback or, for legacy
 * ops-style refs, now merge into their existing master code.
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalizeProjectCode,
  canonicalObraKey,
  extractProjectToken,
  PROJECT_CODE_ALIASES,
  projectCodesMatch,
} from './projectCodeAliases.js';

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

  it('canonicalizes QFF-002 like QFF-001 — Roßdorf 1 and 2 are ONE project (owner decision 2026-09-18, T11)', () => {
    expect(canonicalizeProjectCode('QFF-002')).toBe('QFF');
    expect(projectCodesMatch('QFF-002', 'QFF')).toBe(true);
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

/**
 * Baseline table over the CURRENT outputs of the two normalizers, written
 * before teaching `extractProjectToken` about structured codes. Everything
 * here must keep its output forever: `canonicalizeProjectCode` is what
 * `useProjects.normalizeProjectPayload` persists as a project's `code` and
 * what `usePayables`/`useReceivables` store as `projectCode` on every document,
 * so a changed output here silently rewrites production data.
 */
describe('extractProjectToken / canonicalizeProjectCode — pinned existing outputs', () => {
  const PINNED = [
    // [input, extractProjectToken, canonicalizeProjectCode]
    ['', '', ''],
    ['   ', '', ''],
    ['QFF', 'QFF', 'QFF'],
    ['qff', 'QFF', 'QFF'],
    [' QFF ', 'QFF', 'QFF'],
    ['PROY-001', 'PROY-001', 'QFF'],
    ['QFF-001', 'QFF-001', 'QFF'],
    ['QFF-002', 'QFF-002', 'QFF'],
    ['UGG-001', 'UGG-001', 'UGG'],
    ['WEST-001', 'WEST-001', 'WSC'],
    ['WSC', 'WSC', 'WSC'],
    ['WESTC_MDU', 'WESTC_MDU', 'WESTC_MDU'],
    ['AMD-001', 'AMD-001', 'AMD-001'],
    ['Meschede', 'MESCHEDE', 'MESCHEDE'],
    ['unknown-token', 'UNKNOWN-TOKEN', 'UNKNOWN-TOKEN'],
    ['QFF (Roßdorf 1)', 'QFF', 'QFF'],
    ['QFF-002 (Roßdorf 2)', 'QFF-002', 'QFF'],
    ['RSD/misc', 'RSD', 'RSD'],
    // The head is NOT a structured code here, so the short parenthesized part
    // still wins — unchanged, however unhelpful.
    ['NE4 (Würzburg)', 'WÜRZBURG', 'WÜRZBURG'],
    ['ABC (DEF)', 'DEF', 'DEF'],
    ['ABC (DEFGHIJKL)', 'ABC', 'ABC'],
    ['Roßdorf 2', 'ROSSDORF', 'ROSSDORF'],
    ['Höxter Nord', 'HÖXTER', 'HÖXTER'],
    ['proyecto largo sin codigo', 'PROYECTO', 'PROYECTO'],
    // Structured codes, and shapes that only LOOK structured.
    ['INS-RSD-BL1', 'INS-RSD-BL1', 'INS-RSD-BL1'],
    ['ins-rsd-bl1', 'INS-RSD-BL1', 'INS-RSD-BL1'],
    ['WSC-GEN-MD12', 'WSC-GEN-MD12', 'WSC-GEN-MD12'],
    ['INS-RSD-BL99', 'INS-RSD-BL99', 'INS-RSD-BL99'],
    ['INS-RSD-XX1', 'INS-RSD-XX1', 'INS-RSD-XX1'],
    ['INS-RSD-BL0', 'INS-RSD-BL0', 'INS-RSD-BL0'],
    ['INS-WRZ-N41/nota', 'INS-WRZ-N41', 'INS-WRZ-N41'],
    ['INS-RSD-BL1 extra', 'INS-RSD-BL1', 'INS-RSD-BL1'],
    ['INS-RSD-BL1 (Roßdorf 1)', 'INS-RSD-BL1', 'INS-RSD-BL1'],
    ['INS-HXT-TB1 (Höxter Nord)', 'INS-HXT-TB1', 'INS-HXT-TB1'],
  ];

  it.each(PINNED)('%j → token %j, canonical %j', (input, token, canonical) => {
    expect(extractProjectToken(input)).toBe(token);
    expect(canonicalizeProjectCode(input)).toBe(canonical);
  });

  it('keeps treating null/undefined as empty', () => {
    expect(extractProjectToken(null)).toBe('');
    expect(extractProjectToken(undefined)).toBe('');
    expect(canonicalizeProjectCode(null)).toBe('');
    expect(canonicalizeProjectCode(undefined)).toBe('');
  });
});

/**
 * `useProjects.normalizeProjectPayload` stores a project's displayName as
 * `"CODE (Name)"`. Once CODE is a v2 code and the name is short, the old
 * "prefer the ≤8-char parenthesized part" rule threw the code away and
 * answered with the NAME: `VAN-UGG-N41 (UGG)` canonicalized to `UGG`, so a
 * document classified from a displayName was stored under the legacy code of a
 * project that had already been renamed. A structured head wins now.
 */
describe('extractProjectToken — a structured head code beats the parenthesized name', () => {
  it.each([
    ['INS-RSD-BL1 (Roßdorf)', 'INS-RSD-BL1'],
    ['VAN-UGG-N41 (UGG)', 'VAN-UGG-N41'],
    ['WSC-GEN-N41 (WSC)', 'WSC-GEN-N41'],
    ['UMT-ADM-OH1 (Overhead)', 'UMT-ADM-OH1'],
    ['ins-rsd-bl1 (roßdorf)', 'INS-RSD-BL1'],
  ])('%j → %j', (input, expected) => {
    expect(extractProjectToken(input)).toBe(expected);
    expect(canonicalizeProjectCode(input)).toBe(expected);
  });
});

/**
 * canonicalObraKey is the MATCHING key — one key per obra, derived from
 * LEGACY_PROJECT_CODE_MAP — and it is deliberately NOT the same function as
 * canonicalizeProjectCode, which stays the STORAGE normalizer (short legacy
 * code). Two projects are the same obra when their keys agree.
 */
describe('canonicalObraKey', () => {
  it('maps a structured code to itself', () => {
    expect(canonicalObraKey('INS-RSD-BL1')).toBe('INS-RSD-BL1');
    expect(canonicalObraKey('ins-rsd-bl1')).toBe('INS-RSD-BL1');
  });

  it('maps every legacy spelling of one obra to the same key', () => {
    ['QFF', 'QFF-001', 'QFF-002', 'PROY-001', 'RSD', 'Roßdorf 1', 'Roßdorf 2'].forEach((value) => {
      expect(canonicalObraKey(value)).toBe('INS-RSD-BL1');
    });
  });

  it('maps a legacy name and the "CODE (Name)" display form too', () => {
    expect(canonicalObraKey('Höxter Nord')).toBe('INS-HXT-TB1');
    expect(canonicalObraKey('QFF (Roßdorf 1)')).toBe('INS-RSD-BL1');
    expect(canonicalObraKey('INS-RSD-BL1 (Roßdorf)')).toBe('INS-RSD-BL1');
    expect(canonicalObraKey('Würzwurg')).toBe('INS-WRZ-N41');
  });

  it('falls back to the canonicalized value for an unmapped obra, never a guess', () => {
    expect(canonicalObraKey('QDU')).toBe('QDU');
    expect(canonicalObraKey('desconocido')).toBe('DESCONOCIDO');
    expect(canonicalObraKey('')).toBe('');
    expect(canonicalObraKey(null)).toBe('');
  });

  it('does NOT change what canonicalizeProjectCode stores', () => {
    expect(canonicalizeProjectCode('QFF-001')).toBe('QFF');
    expect(canonicalObraKey('QFF-001')).toBe('INS-RSD-BL1');
  });
});

describe('projectCodesMatch — legacy and structured codes of one obra match', () => {
  it.each([
    ['INS-RSD-BL1', 'QFF'],
    ['INS-RSD-BL1', 'QFF-002'],
    ['INS-RSD-BL1', 'Roßdorf 2'],
    ['QFF', 'QFF-002'],
    ['UGG', 'VAN-UGG-N41'],
    ['WESTC_MDU', 'WSC-GEN-MD1'],
    ['AMD-001', 'UMT-ADM-OH1'],
    ['Meschede', 'INS-MSD-TB1'],
  ])('%j ≡ %j', (a, b) => {
    expect(projectCodesMatch(a, b)).toBe(true);
    expect(projectCodesMatch(b, a)).toBe(true);
  });

  it.each([
    ['INS-RSD-BL1', 'INS-WRZ-N41'],
    ['WSC-GEN-N41', 'WSC-GEN-MD1'],
    ['QFF', 'NE4'],
    ['WESTC_MDU', 'WSC'],
    ['QDU', 'AUSTRIA'],
  ])('%j is NOT %j', (a, b) => {
    expect(projectCodesMatch(a, b)).toBe(false);
    expect(projectCodesMatch(b, a)).toBe(false);
  });

  it('matches two unknown codes only when they canonicalize to the same value', () => {
    expect(projectCodesMatch('desconocido', 'DESCONOCIDO')).toBe(true);
    expect(projectCodesMatch('desconocido', 'otro')).toBe(false);
  });

  /**
   * A consequence of the owner-validated dictionary, not of this function: the
   * legacy catalogue listed several codes per obra (QFF and RSD are both
   * Roßdorf, NE4/WRZ/WUR all Würzburg, FBX and HXT both Höxter), so they now
   * answer as ONE obra — which is exactly what the merge migration will make
   * of them.
   */
  it.each([
    ['QFF', 'RSD'],
    ['NE4', 'WRZ'],
    ['NE4', 'WUR'],
    ['FBX', 'HXT'],
  ])('reads the dictionary literally: %j ≡ %j', (a, b) => {
    expect(projectCodesMatch(a, b)).toBe(true);
  });
});
