/**
 * Confirming Abrechnung (BBVA / CaixaBank / Santander / Bankinter) — a bank
 * settlement statement, NOT an invoice. It names the Rechnungen it pays, the
 * gross it covers, the discount (fee) it keeps and the net it transfers.
 * Nothing in here may ever become a CxC row.
 */
import { describe, expect, it } from 'vitest';

import { parseConfirmingAbrechnung } from './confirmingAbrechnung.js';

const ABRECHNUNG = `
Abrechnung Wegen Faktorisierung
Lieferant: Umtelkomd GmbH
Rechnung 2025-262        3.542,00
R-263                    1.150,00
Rechnung Nr. 2025-264      460,00
Bruttobetrag             5.152,00
Abzug / Diskont             51,52
Nettobetrag              5.100,48
Valuta 21.08.2026
`;

describe('parseConfirmingAbrechnung', () => {
  it('extracts the Rechnung references in order, deduplicated', () => {
    const parsed = parseConfirmingAbrechnung(ABRECHNUNG);
    expect(parsed.rechnungRefs).toEqual(['2025-262', 'R-263', '2025-264']);
  });

  it('extracts gross, discount and net as numbers', () => {
    expect(parseConfirmingAbrechnung(ABRECHNUNG)).toMatchObject({
      gross: 5152,
      discount: 51.52,
      net: 5100.48,
    });
  });

  it('derives the discount from gross minus net when no discount line exists', () => {
    const text = 'Confirming Bankinter\nR-270 5.186,02\nBrutto 5.186,02\nNetto 5.134,16';
    expect(parseConfirmingAbrechnung(text)).toMatchObject({ gross: 5186.02, net: 5134.16, discount: 51.86 });
  });

  it('leaves amounts null instead of inventing them', () => {
    expect(parseConfirmingAbrechnung('Abrechnung\nR-270')).toEqual({
      rechnungRefs: ['R-270'],
      gross: null,
      discount: null,
      net: null,
    });
    expect(parseConfirmingAbrechnung('')).toEqual({ rechnungRefs: [], gross: null, discount: null, net: null });
    expect(parseConfirmingAbrechnung(null)).toEqual({ rechnungRefs: [], gross: null, discount: null, net: null });
  });

  it('is never a Rechnung: it exposes no rechnungId of its own', () => {
    expect(parseConfirmingAbrechnung(ABRECHNUNG)).not.toHaveProperty('rechnungId');
  });
});
