import { describe, expect, it } from 'vitest';

import { costCenterForWork } from './workCostCenter.js';

describe('costCenterForWork', () => {
  it.each([
    ['DGF activaciones HUEP-GFTA-ONT (13x fusion+act+bohrung)', 'CC-115'],
    ['HÜP-GFTA-ONT, FUSION + ACTIVAC.+ BOHRUNG DGF_ACT_001', 'CC-115'],
    ['DGF_BLOW_002 SOPLADO DESDE 48', 'CC-110'],
    ['Montaje DP + soplado DGF_BLOW_001', 'CC-110'],
    ['WESTC_MDU Standard Ausbau/ONT Montage NE4 Westconnect', 'CC-120'],
    ['KW33_HARSEWINKEL-OST_Umtelkomd_NE4', 'CC-120'],
    ['NAS Reinheim QFC-002, 003 KW36 2026', 'CC-140'],
    ['NAS_DGF Kopfloecher Einblasen + Hausanschluss', 'CC-140'],
    ['NAS DGF: 18x Hausanschluss + 18x zusatz. Kopfloecher Einblasen', 'CC-140'],
    ['Hausbegehung Breslauer Straße 12', 'CC-150'],
    ['Tiefbau Graben 120 m', 'CC-100'],
    ['Aufmaß und Dokumentation KW20', 'CC-190'],
    ['SP Leitungsweg', 'CC-170'],
    ['Servicepaket Leitungsweg — Claudiusweg 10, 64380 Roßdorf', 'CC-170'],
  ])('%s → %s', (text, code) => {
    expect(costCenterForWork(text).code).toBe(code);
  });

  it('files a claim certificate under repairs, whatever work it re-does', () => {
    expect(costCenterForWork('KW31_BDRIB-KERN_Umtelkomd_NE4 Reklamation').code).toBe('CC-160');
    expect(costCenterForWork('COMP PO 2539810 TICKET AVERIA Regulariza').code).toBe('CC-160');
  });

  it('keeps a first survey inside an NE4 install as NE4', () => {
    expect(costCenterForWork('WESTC_MDU_100 Ausbau', 'WESTC_MDU_350 ERSTBEGEHUNG').code).toBe('CC-120');
  });

  it('refuses to guess when the text mixes production lines', () => {
    const result = costCenterForWork('DGF soplado 27.516 m + GFPLUS MDU/ACT + 9x montaje DP', 'DGF_ACT_001 activación');
    expect(result.code).toBe('');
    expect(result.candidates).toEqual(expect.arrayContaining(['CC-115', 'CC-110']));
  });

  it('returns nothing for unrelated or empty text', () => {
    expect(costCenterForWork('Rechnung 2025-248 — Insyte Deutschland GmbH (neto sin IVA)')).toEqual({ code: '', candidates: [] });
    expect(costCenterForWork('', null)).toEqual({ code: '', candidates: [] });
  });
});
