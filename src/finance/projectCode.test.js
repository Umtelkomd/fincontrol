/**
 * Project code scheme v2 (`CLI-SIT-LLn`) — see the module doc comment and
 * odd/tasks/invoice-classification-catalog.md for the full rationale.
 */
import { describe, expect, it } from 'vitest';

import {
  buildProjectCode,
  defaultCostCenterForProject,
  findProjectMentions,
  isStructuredProjectCode,
  LEGACY_PROJECT_CODE_MAP,
  lineOfProject,
  nextLot,
  parseProjectCode,
  PROJECT_CLIENTS,
  PROJECT_CODE_PATTERN,
  PROJECT_LINES,
  resolveLegacyProjectCode,
  validateProjectCodeParts,
} from './projectCode.js';

describe('PROJECT_LINES', () => {
  it('ships the six lines with their default cost center', () => {
    expect(PROJECT_LINES.map((l) => [l.code, l.label, l.costCenter])).toEqual([
      ['TB', 'Obra civil', 'CC-100'],
      ['BL', 'Soplado y fusiones', 'CC-110'],
      ['N4', 'NE4', 'CC-120'],
      ['MD', 'MDU', 'CC-130'],
      ['SV', 'Dirección de obra', 'CC-190'],
      ['OH', 'Estructura interna', 'CC-300'],
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PROJECT_LINES)).toBe(true);
    expect(Object.isFrozen(PROJECT_LINES[0])).toBe(true);
  });
});

describe('PROJECT_CLIENTS', () => {
  it('ships the known clients as a suggestion list', () => {
    expect(PROJECT_CLIENTS.map((c) => [c.code, c.label])).toEqual([
      ['INS', 'Insyte'],
      ['VAN', 'Vancom'],
      ['WSC', 'Wesconnect'],
      ['UMT', 'UMTELKOMD (interno)'],
    ]);
    expect(Object.isFrozen(PROJECT_CLIENTS)).toBe(true);
  });
});

describe('PROJECT_CODE_PATTERN / isStructuredProjectCode', () => {
  it('matches a well-formed code', () => {
    expect(PROJECT_CODE_PATTERN.test('INS-RSD-BL1')).toBe(true);
    expect(isStructuredProjectCode('INS-RSD-BL1')).toBe(true);
    expect(isStructuredProjectCode('WSC-GEN-N412')).toBe(true);
  });

  it('tolerates lowercase and surrounding whitespace', () => {
    expect(isStructuredProjectCode(' ins-rsd-bl1 ')).toBe(true);
  });

  it('rejects a legacy code and malformed shapes', () => {
    expect(isStructuredProjectCode('QFF')).toBe(false);
    expect(isStructuredProjectCode('INS-RSD-XX1')).toBe(false); // unknown line
    expect(isStructuredProjectCode('INS-RSD-BL0')).toBe(false); // lot 0
    expect(isStructuredProjectCode('INS-RSD-BL100')).toBe(false); // lot > 99
    expect(isStructuredProjectCode('INSY-RSD-BL1')).toBe(false); // client too long
    expect(isStructuredProjectCode('')).toBe(false);
    expect(isStructuredProjectCode(null)).toBe(false);
  });
});

describe('parseProjectCode', () => {
  it('parses a well-formed code into its parts', () => {
    expect(parseProjectCode('INS-RSD-BL1')).toEqual({ client: 'INS', site: 'RSD', line: 'BL', lot: 1 });
    expect(parseProjectCode('wsc-gen-n412')).toEqual({ client: 'WSC', site: 'GEN', line: 'N4', lot: 12 });
  });

  it('returns null for a non-structured code', () => {
    expect(parseProjectCode('QFF')).toBeNull();
    expect(parseProjectCode('')).toBeNull();
    expect(parseProjectCode(null)).toBeNull();
  });
});

describe('validateProjectCodeParts', () => {
  it('accepts a valid set of parts', () => {
    expect(validateProjectCodeParts({ client: 'ins', site: 'rsd', line: 'bl', lot: 1 })).toEqual({ valid: true, errors: {} });
  });

  it('strips accents and non-alphanumerics before validating', () => {
    expect(validateProjectCodeParts({ client: 'Iñs', site: 'R-S D', line: 'BL', lot: 3 })).toEqual({ valid: true, errors: {} });
  });

  it('rejects a client that is not exactly 3 letters', () => {
    const result = validateProjectCodeParts({ client: 'IN', site: 'RSD', line: 'BL', lot: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.client).toBeTruthy();
  });

  it('rejects a client that carries digits', () => {
    const result = validateProjectCodeParts({ client: 'IN4', site: 'RSD', line: 'BL', lot: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.client).toBeTruthy();
  });

  it('rejects a site that is not exactly 3 alphanumerics', () => {
    const result = validateProjectCodeParts({ client: 'INS', site: 'RS', line: 'BL', lot: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.site).toBeTruthy();
  });

  it('rejects an unknown line', () => {
    const result = validateProjectCodeParts({ client: 'INS', site: 'RSD', line: 'XX', lot: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.line).toBeTruthy();
  });

  it('rejects a lot outside 1..99', () => {
    expect(validateProjectCodeParts({ client: 'INS', site: 'RSD', line: 'BL', lot: 0 }).errors.lot).toBeTruthy();
    expect(validateProjectCodeParts({ client: 'INS', site: 'RSD', line: 'BL', lot: 100 }).errors.lot).toBeTruthy();
    expect(validateProjectCodeParts({ client: 'INS', site: 'RSD', line: 'BL', lot: 'x' }).errors.lot).toBeTruthy();
  });

  it('reports every failing field at once', () => {
    const result = validateProjectCodeParts({ client: '', site: '', line: '', lot: '' });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(['client', 'line', 'lot', 'site']);
  });
});

describe('buildProjectCode', () => {
  it('builds a code from valid parts, uppercased', () => {
    expect(buildProjectCode({ client: 'ins', site: 'rsd', line: 'bl', lot: 1 })).toBe('INS-RSD-BL1');
  });

  it('strips accents and non-alphanumerics', () => {
    expect(buildProjectCode({ client: 'Iñs', site: 'R-S D', line: 'BL', lot: 3 })).toBe('INS-RSD-BL3');
  });

  it('does not pad the lot', () => {
    expect(buildProjectCode({ client: 'WSC', site: 'GEN', line: 'N4', lot: 12 })).toBe('WSC-GEN-N412');
  });

  it('returns "" for invalid parts', () => {
    expect(buildProjectCode({ client: 'IN', site: 'RSD', line: 'BL', lot: 1 })).toBe('');
    expect(buildProjectCode({ client: 'INS', site: 'RSD', line: 'XX', lot: 1 })).toBe('');
    expect(buildProjectCode({ client: 'INS', site: 'RSD', line: 'BL', lot: 0 })).toBe('');
    expect(buildProjectCode({})).toBe('');
  });
});

describe('nextLot', () => {
  it('returns 1 when there are no existing codes for the combination', () => {
    expect(nextLot([], { client: 'INS', site: 'RSD', line: 'BL' })).toBe(1);
  });

  it('returns the smallest free lot', () => {
    const existing = ['INS-GEN-BL1', 'INS-GEN-BL2', 'INS-GEN-BL4'];
    expect(nextLot(existing, { client: 'INS', site: 'GEN', line: 'BL' })).toBe(3);
  });

  it('ignores codes for a different client/site/line', () => {
    const existing = ['INS-RSD-BL1', 'VAN-UGG-N41', 'INS-RSD-N41'];
    expect(nextLot(existing, { client: 'INS', site: 'RSD', line: 'BL' })).toBe(2);
  });

  it('ignores non-structured (legacy) codes', () => {
    expect(nextLot(['QFF', 'INS-RSD-BL1'], { client: 'INS', site: 'RSD', line: 'BL' })).toBe(2);
  });
});

describe('LEGACY_PROJECT_CODE_MAP', () => {
  it('is frozen and carries the owner-validated mapping (2026-09-18, all entries confidence high)', () => {
    expect(Object.isFrozen(LEGACY_PROJECT_CODE_MAP)).toBe(true);
    const byCode = Object.fromEntries(LEGACY_PROJECT_CODE_MAP.map((e) => [e.code, e]));
    expect(byCode['INS-RSD-BL1']).toMatchObject({ confidence: 'high' });
    expect(byCode['INS-RSD-BL1'].match).toEqual(
      expect.arrayContaining(['QFF', 'QFF-001', 'QFF-002', 'PROY-001', 'RSD', 'Roßdorf 1', 'Roßdorf 2']),
    );
    expect(byCode['INS-WRZ-N41']).toMatchObject({ confidence: 'high' });
    expect(byCode['INS-WRZ-N41'].match).toEqual(expect.arrayContaining(['NE4', 'PROY-004', 'WRZ', 'WUR', 'Würzburg', 'Würzwurg']));
    expect(byCode['VAN-UGG-N41']).toMatchObject({ confidence: 'high' });
    expect(byCode['WSC-GEN-N41']).toMatchObject({ confidence: 'high' });
    expect(byCode['WSC-GEN-MD1']).toMatchObject({ confidence: 'high' });
    expect(byCode['INS-HXT-TB1']).toMatchObject({ confidence: 'high' });
    expect(byCode['INS-MSD-TB1']).toMatchObject({ confidence: 'high' });
    expect(byCode['UMT-ADM-OH1']).toMatchObject({ confidence: 'high' });
    expect(byCode['UMT-ADM-OH1'].match).toEqual(expect.arrayContaining(['AMD-001', 'Overhead']));
  });

  it('flags ONLY the Roßdorf entry as a merge group — every other entry stays a plain mapping', () => {
    const byCode = Object.fromEntries(LEGACY_PROJECT_CODE_MAP.map((e) => [e.code, e]));
    expect(byCode['INS-RSD-BL1'].merge).toBe(true);
    for (const code of ['INS-WRZ-N41', 'VAN-UGG-N41', 'WSC-GEN-N41', 'WSC-GEN-MD1', 'INS-HXT-TB1', 'INS-MSD-TB1', 'UMT-ADM-OH1']) {
      expect(byCode[code].merge).toBeUndefined();
    }
  });
});

describe('resolveLegacyProjectCode', () => {
  it('returns a current v2 code unchanged', () => {
    expect(resolveLegacyProjectCode('INS-RSD-BL1')).toEqual({ code: 'INS-RSD-BL1', confidence: null, status: 'current' });
    expect(resolveLegacyProjectCode(' wsc-gen-n412 ')).toEqual({ code: 'WSC-GEN-N412', confidence: null, status: 'current' });
  });

  it('maps a legacy code, accent/case-insensitive', () => {
    expect(resolveLegacyProjectCode('qff')).toEqual({ code: 'INS-RSD-BL1', confidence: 'high', status: 'mapped' });
    expect(resolveLegacyProjectCode('RSD')).toEqual({ code: 'INS-RSD-BL1', confidence: 'high', status: 'mapped' });
    expect(resolveLegacyProjectCode('wurzburg')).toEqual({ code: 'INS-WRZ-N41', confidence: 'high', status: 'mapped' });
    expect(resolveLegacyProjectCode('Würzwurg')).toEqual({ code: 'INS-WRZ-N41', confidence: 'high', status: 'mapped' });
  });

  it('maps a legacy name — Roßdorf 2 now resolves to the SAME merged project as Roßdorf 1 (owner decision 2026-09-18, T11)', () => {
    expect(resolveLegacyProjectCode('Roßdorf 2')).toEqual({ code: 'INS-RSD-BL1', confidence: 'high', status: 'mapped' });
    expect(resolveLegacyProjectCode('Vancom NE4')).toEqual({ code: 'VAN-UGG-N41', confidence: 'high', status: 'mapped' });
    expect(resolveLegacyProjectCode('Overhead')).toEqual({ code: 'UMT-ADM-OH1', confidence: 'high', status: 'mapped' });
  });

  it('tolerates the "CODE (Name)" displayName form', () => {
    expect(resolveLegacyProjectCode('QFF (Roßdorf 1)')).toEqual({ code: 'INS-RSD-BL1', confidence: 'high', status: 'mapped' });
    expect(resolveLegacyProjectCode('PROY-004 (Würzburg)')).toEqual({ code: 'INS-WRZ-N41', confidence: 'high', status: 'mapped' });
  });

  it('never guesses an unmapped legacy value — returns the canonicalized input', () => {
    expect(resolveLegacyProjectCode('QDU')).toEqual({ code: 'QDU', confidence: null, status: 'legacy' });
    expect(resolveLegacyProjectCode('AUSTRIA')).toEqual({ code: 'AUSTRIA', confidence: null, status: 'legacy' });
    expect(resolveLegacyProjectCode('BIE')).toEqual({ code: 'BIE', confidence: null, status: 'legacy' });
  });

  it('returns empty for blank input', () => {
    expect(resolveLegacyProjectCode('')).toEqual({ code: '', confidence: null, status: 'legacy' });
    expect(resolveLegacyProjectCode(null)).toEqual({ code: '', confidence: null, status: 'legacy' });
  });
});

describe('lineOfProject', () => {
  it('parses the line straight from a structured code', () => {
    expect(lineOfProject({ code: 'INS-RSD-BL1' })).toBe('BL');
    expect(lineOfProject({ code: 'wsc-gen-n412' })).toBe('N4');
  });

  it('falls back to resolveLegacyProjectCode for a legacy code', () => {
    expect(lineOfProject({ code: 'QFF' })).toBe('BL'); // -> INS-RSD-BL1
    expect(lineOfProject({ code: 'RSD' })).toBe('BL');
  });

  it('falls back to the project name when there is no usable code', () => {
    expect(lineOfProject({ code: '', name: 'Overhead' })).toBe('OH'); // -> UMT-ADM-OH1
  });

  it('returns "" when nothing resolves', () => {
    expect(lineOfProject({ code: 'QDU' })).toBe('');
    expect(lineOfProject({})).toBe('');
    expect(lineOfProject(null)).toBe('');
  });
});

describe('defaultCostCenterForProject', () => {
  it('derives the direct cost center from the project line', () => {
    expect(defaultCostCenterForProject({ code: 'INS-RSD-BL1' })).toBe('CC-110');
    expect(defaultCostCenterForProject({ code: 'QFF' })).toBe('CC-110');
  });

  it('returns "" when the line cannot be resolved', () => {
    expect(defaultCostCenterForProject({ code: 'QDU' })).toBe('');
  });
});

describe('findProjectMentions', () => {
  const projects = [
    { id: 'p-rsd', code: 'QFF', name: 'Roßdorf' },
    { id: 'p-wrz', code: 'INS-WRZ-N41', name: 'Würzburg' },
    { id: 'p-ugg', code: 'UGG', name: 'Vancom NE4' },
    // No entry in LEGACY_PROJECT_CODE_MAP targets this code, so its name is
    // reachable ONLY through the 'name' candidate group — every other project
    // above has its display name doubling as a legacy alias.
    { id: 'p-other', code: 'INS-XYZ-TB5', name: 'Proyecto Especial' },
  ];

  it('finds a structured/legacy code as a "code" match', () => {
    expect(findProjectMentions('Rechnung fuer Projekt QFF, Betrag 1200 EUR', projects)).toEqual([
      { projectId: 'p-rsd', code: 'QFF', matched: 'QFF', kind: 'code' },
    ]);
  });

  it('finds a legacy alias not equal to the stored code', () => {
    expect(findProjectMentions('Baustelle Roßdorf 1, Materiallieferung', projects)).toEqual([
      { projectId: 'p-rsd', code: 'QFF', matched: 'Roßdorf 1', kind: 'alias' },
    ]);
  });

  it('ranks an alias match (the legacy display name) over a would-be name match', () => {
    expect(findProjectMentions('Baustelle Würzburg, NE4 Ausbau', projects)).toEqual([
      { projectId: 'p-wrz', code: 'INS-WRZ-N41', matched: 'Würzburg', kind: 'alias' },
    ]);
  });

  it('finds a project name when neither its code nor any legacy alias appear', () => {
    expect(findProjectMentions('Factura del Proyecto Especial, obra civil', projects)).toEqual([
      { projectId: 'p-other', code: 'INS-XYZ-TB5', matched: 'Proyecto Especial', kind: 'name' },
    ]);
  });

  it('does not match NE4 inside a longer token (word-boundary safe)', () => {
    expect(findProjectMentions('Kabel LINE4X 500m', projects)).toEqual([]);
  });

  it('requires a 3-letter legacy code to be a standalone token', () => {
    expect(findProjectMentions('UGGABUGGA Systems GmbH', projects)).toEqual([]);
    expect(findProjectMentions('Werk UGG Halle 3', projects)).toEqual([
      { projectId: 'p-ugg', code: 'UGG', matched: 'UGG', kind: 'code' },
    ]);
  });

  it('orders multiple mentions by first occurrence and de-duplicates per project', () => {
    const text = 'Würzburg Ausbau, dann QFF Nacharbeit, außerdem nochmal QFF erwähnt';
    expect(findProjectMentions(text, projects)).toEqual([
      { projectId: 'p-wrz', code: 'INS-WRZ-N41', matched: 'Würzburg', kind: 'alias' },
      { projectId: 'p-rsd', code: 'QFF', matched: 'QFF', kind: 'code' },
    ]);
  });

  it('returns [] for empty text or no projects', () => {
    expect(findProjectMentions('', projects)).toEqual([]);
    expect(findProjectMentions('QFF', [])).toEqual([]);
    expect(findProjectMentions('QFF', null)).toEqual([]);
  });
});
