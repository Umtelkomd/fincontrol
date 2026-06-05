import { describe, it, expect } from 'vitest';
import {
  classifyPayrollPdf,
  parseAmountComma,
  parseAmountCompact,
  parseGermanPeriod,
  parseZakf,
  parseLops,
  parseLojo,
  buildPayrollFromTexts,
} from './datevPayrollParser';
import { computePayrollTotals } from './payroll';

// Real text extracted from the April 2026 DATEV PDFs (pdfjs line reconstruction).
const ZAKF = `Übersicht Zahlungen für April 2026
Nr. Empfänger PLZ Ort Zahlart Verwendungszweck Betrag
001 EK BARMER Lastschrift 83531045 7.721,08
004 AOK Rheinland/Hamburg Lastschrift 83531045 2.756,40
005 EK Techniker-Krankenka Lastschrift 83531045 2.343,42
006 BKK TUI Lastschrift 83531045 839,93
Fälligkeit bis: 28.04.2026 (1) 13.660,83 *
*** Bitte prüfen Sie, ob die Schätzbeiträge bereits gezahlt wurden. ***
4082 FA Stralsund 18409 Stralsund Überweisung LSt 04/2026 082/121/02610 3.742,93
Fälligkeit bis: 11.05.2026 3.742,93 *
Anzahl Zahlungen: 5
Lohn- und Gehaltszahlungen 21.065,46 *
G e s a m t s u m m e : 38.469,22 **`;

const LOPS = `Personalkostenübersicht April 2026
Pers.-Nr. Name Gesamtbrutto AG-Anteil bAV Nettobezüge / SV-AG-Anteil Umlage Pauschale Steuern Gesamtkosten
00001 Lesmes Linares, J. 3.66667 78266 2090 4.47023
00008 Lesmes Correa, J. 2.90000 61901 8903 3.60804
00009 Sandoval Penaranda 2.45000 52295 7522 3.04817
00010 Romero Lesmes, J. 5.00000 1.06725 15350 6.22075
00021 Herrera Romero, E. 3.42500 73108 10516 4.26124
00022 Pizarro Zapata, P. 3.00000 64035 7950 3.71985
00023 Pizarro Calfual, S. 3.00000 64035 7950 3.71985
00025 Horstmann, I. 3.00000 62850 7950 3.70800
00027 Herrera Romero, J. 2.75000 57874 7398 3.40272
00028 Agudelo Grajales, S. 2.41400 50802 6493 2.98695
Summen:
31.60567 6.71891 82122 39.14580`;

const LOJO = `Lohnjournal
April 2026
00001 4 rk Lesmes Linares, Juan Dios 3.66667 3.66667 3.66667 3.66667 3.66667
0 30 3.66667 45150 4063 32799 34100 4767 5683 1540
01111 2 30 32799 34100 4767 6600 550 2.40105
00008 1 Lesmes Correa, J. 2.90000 2.90000 2.90000 2.90000 7250 2.90000
0 30 2.90000 27458 25941 26970 3770 5220 1218
01111 30 25941 26970 3770 5220 435 2.00641
00009 4 rk Sandoval Penaranda, B. 2.45000 2.45000 2.45000 2.45000 6125 2.45000
1 30 2.45000 17958 1616 21915 22785 3185 4410 1029
01111 1 30 21915 22785 3185 4410 368 1.73131
00010 4 1,0 Romero Lesmes, J. 5.00000 5.00000 5.00000 5.00000 12500 5.00000
1 30 5.00000 78925 44725 46500 6500 9000 2100
01111 1 30 44725 46500 6500 9000 750 3.14350
00017 4 1,5 Santamaria Losada, J.
1 30
01111
00021 1 Herrera Romero, E. 3.42500 3.42500 3.42500 3.42500 8563 3.42500
1 30 3.42500 38625 30637 31853 4453 Z 8220 1439
01111 30 30637 31853 4453 6165 514 2.28712
00022 1 Pizarro Zapata, Pedro Luis 3.00000 3.00000 3.00000 3.00000 6150 3.00000
1 30 3.00000 29150 26835 27900 3900 Z 7200 1350
01111 30 26835 27900 3900 5400 450 2.05015
00023 1 Pizarro Calfual, S. 3.00000 3.00000 3.00000 3.00000 6150 3.00000
1 30 3.00000 29150 26835 27900 3900 Z 7200 1350
01111 30 26835 27900 3900 5400 450 2.05015
00025 4 1,0 Horstmann, Isabelle Joline 3.00000 3.00000 3.00000 3.00000 6300 3.00000
1 30 3.00000 29966 25650 27900 3900 5400 1200
01111 1 30 25650 27900 3900 5400 450 2.07184
00027 1 Herrera Romero, J. 2.75000 2.75000 2.75000 2.75000 5775 2.75000
1 30 2.75000 24016 23774 25575 3575 Z 6600 1210
01111 30 23774 25575 3575 4950 413 1.91460
00028 6 Agudelo Grajales, S. 2.41400 2.41400 2.41400 2.41400 5069 2.41400
1 30 2.41400 48216 20869 22450 3138 Z 5794 1062
01111 30 20869 22450 3138 4345 362 1.40933`;

describe('classifyPayrollPdf', () => {
  it('classifies by filename prefix', () => {
    expect(classifyPayrollPdf('zakf_202604_0089089_60273_00000 (1).pdf')).toBe('zakf');
    expect(classifyPayrollPdf('lojo_202604.pdf')).toBe('lojo');
    expect(classifyPayrollPdf('lops_x.pdf')).toBe('lops');
    expect(classifyPayrollPdf('random.pdf')).toBe('unknown');
  });
});

describe('amount parsing', () => {
  it('parses comma format', () => {
    expect(parseAmountComma('7.721,08')).toBeCloseTo(7721.08, 2);
    expect(parseAmountComma('839,93')).toBeCloseTo(839.93, 2);
    expect(parseAmountComma('38.469,22')).toBeCloseTo(38469.22, 2);
  });
  it('parses compact format (last 2 digits are cents)', () => {
    expect(parseAmountCompact('4.47023')).toBeCloseTo(4470.23, 2);
    expect(parseAmountCompact('5.00000')).toBeCloseTo(5000.0, 2);
    expect(parseAmountCompact('78266')).toBeCloseTo(782.66, 2);
    expect(parseAmountCompact('2.40105')).toBeCloseTo(2401.05, 2);
  });
});

describe('parseGermanPeriod', () => {
  it('maps German month to YYYY-MM', () => {
    expect(parseGermanPeriod('Übersicht Zahlungen für April 2026')).toBe('2026-04');
    expect(parseGermanPeriod('Personalkostenübersicht Januar 2025')).toBe('2025-01');
  });
});

describe('parseZakf', () => {
  const r = parseZakf(ZAKF);
  it('extracts the period', () => expect(r.period).toBe('2026-04'));
  it('extracts the 4 Krankenkassen with due date', () => {
    expect(r.krankenkassen).toHaveLength(4);
    expect(r.krankenkassen[0]).toMatchObject({ payee: 'EK BARMER', dueDate: '2026-04-28' });
    expect(r.krankenkassen[0].amount).toBeCloseTo(7721.08, 2);
    expect(r.krankenkassen[3]).toMatchObject({ payee: 'BKK TUI' });
    expect(r.krankenkassen[3].amount).toBeCloseTo(839.93, 2);
  });
  it('extracts Lohnsteuer with payee and due date', () => {
    expect(r.tax.payee).toBe('Finanzamt Stralsund');
    expect(r.tax.amount).toBeCloseTo(3742.93, 2);
    expect(r.tax.dueDate).toBe('2026-05-11');
  });
  it('extracts net wages', () => expect(r.netWages.amount).toBeCloseTo(21065.46, 2));
  it('Krankenkassen sum to the social total', () => {
    const social = r.krankenkassen.reduce((s, k) => s + k.amount, 0);
    expect(social).toBeCloseTo(13660.83, 2);
  });
});

describe('parseLops', () => {
  const rows = parseLops(LOPS);
  it('extracts 10 employees (skips the totals line)', () => expect(rows).toHaveLength(10));
  it('parses gross and employer cost', () => {
    expect(rows[0]).toMatchObject({ persNr: '00001', name: 'Lesmes Linares, J.' });
    expect(rows[0].brutto).toBeCloseTo(3666.67, 2);
    expect(rows[0].gesamtkosten).toBeCloseTo(4470.23, 2);
    expect(rows[3]).toMatchObject({ persNr: '00010', name: 'Romero Lesmes, J.' });
    expect(rows[3].gesamtkosten).toBeCloseTo(6220.75, 2);
  });
  it('employer cost sums to the Personalkosten total', () => {
    const total = rows.reduce((s, r) => s + r.gesamtkosten, 0);
    expect(total).toBeCloseTo(39145.80, 2);
  });
});

describe('parseLojo', () => {
  const map = parseLojo(LOJO);
  it('maps personnel number to net pay', () => {
    expect(map['00001']).toBeCloseTo(2401.05, 2);
    expect(map['00010']).toBeCloseTo(3143.50, 2);
    expect(map['00028']).toBeCloseTo(1409.33, 2);
  });
  it('does not record a net for the unpaid employee', () => {
    expect(map['00017']).toBeUndefined();
  });
  it('all nets sum to the net wages total', () => {
    const total = Object.values(map).reduce((s, n) => s + n, 0);
    expect(total).toBeCloseTo(21065.46, 2);
  });
});

describe('buildPayrollFromTexts (full reconciliation)', () => {
  const form = buildPayrollFromTexts({ zakf: ZAKF, lojo: LOJO, lops: LOPS });
  it('produces a complete form with 10 employee lines', () => {
    expect(form.period).toBe('2026-04');
    expect(form.krankenkassen).toHaveLength(4);
    expect(form.lines).toHaveLength(10);
  });
  it('joins net (lojo) with gross/cost (lops) by Pers.-Nr.', () => {
    const lesmes = form.lines.find((l) => l.persNr === '00001');
    expect(lesmes.netto).toBeCloseTo(2401.05, 2);
    expect(lesmes.brutto).toBeCloseTo(3666.67, 2);
    expect(lesmes.gesamtkosten).toBeCloseTo(4470.23, 2);
  });
  it('reconciles to the DATEV control totals', () => {
    const totals = computePayrollTotals(form);
    expect(totals.socialTotal).toBeCloseTo(13660.83, 2);
    expect(totals.taxTotal).toBeCloseTo(3742.93, 2);
    expect(totals.netWagesTotal).toBeCloseTo(21065.46, 2);
    expect(totals.cashTotal).toBeCloseTo(38469.22, 2);
    expect(totals.employerCostTotal).toBeCloseTo(39145.80, 2);
    expect(totals.payCount).toBe(10);
  });

  // Phase 2, item 1 — German due dates stamped at import.
  it('preserves the parsed KK and LSt Fälligkeit dates untouched', () => {
    // Parsed: KK 2026-04-28, LSt 2026-05-11 — must survive backfill verbatim.
    expect(form.krankenkassen.every((k) => k.dueDate === '2026-04-28')).toBe(true);
    expect(form.tax.dueDate).toBe('2026-05-11');
  });
  it('backfills the missing net-wages due date with the last banking day', () => {
    // ZAKF carries no Lohn-und-Gehaltszahlungen Fälligkeit → computed to the
    // last banking day of April 2026 = 2026-04-30 (Thursday).
    expect(form.netWages.dueDate).toBe('2026-04-30');
  });
});
