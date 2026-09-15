import { describe, expect, it } from 'vitest';
import { normalizeInvoiceDate, parseMoneyToken, suggestInvoiceHeader } from './invoiceHeaderParser';

const GERMAN_INVOICE = `Muster Bau GmbH
Musterstraße 1
12345 Musterstadt

Rechnung

Rechnungsnummer: 2026-001
Rechnungsdatum: 15.03.2026

Leistung                Menge   Preis
Tiefbauarbeiten          1      1.000,00 €

Nettobetrag              1.000,00 €
zzgl. 19% MwSt              190,00 €
Gesamtbetrag             1.190,00 €

Zahlbar innerhalb 30 Tagen.`;

const ENGLISH_INVOICE = `Acme Supplies Ltd
221B Baker Street

Invoice Number: INV-2026-042
Invoice Date: 03/22/2026

Description            Qty   Price
Consulting services     1    500.00

Net: 500.00
VAT 19%: 95.00
Total: 595.00`;

const SPANISH_INVOICE = `Insyte Deutschland
Calle Falsa 123

Factura No: F-2026-0099
Fecha de factura: 2026-04-05

Concepto                Cant   Precio
Certificación julio      1     2.000,00

Base imponible: 2.000,00
IVA 19%: 380,00
Total a pagar: 2.380,00`;

describe('parseMoneyToken', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['1234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1234.56', 1234.56],
    ['1 234,56', 1234.56],
    ['190,00', 190],
    ['500.00', 500],
    ['€ 1.190,00', 1190],
    ['1.190,00 €', 1190],
    ['1.190,00 EUR', 1190],
    ['119,01-', -119.01],
    ['0,3', 0.3],
    ['100', 100],
  ])('parses %s as %s', (token, expected) => {
    expect(parseMoneyToken(token)).toBeCloseTo(expected, 2);
  });

  it.each([[''], [null], [undefined], ['abc'], ['12,34,56'], ['€'], ['-']])(
    'returns null for unparseable token: %j',
    (token) => {
      expect(parseMoneyToken(token)).toBeNull();
    },
  );

  it('treats the LAST separator as the decimal separator when both are present', () => {
    expect(parseMoneyToken('1.234,56')).toBeCloseTo(1234.56, 2);
    expect(parseMoneyToken('1,234.56')).toBeCloseTo(1234.56, 2);
  });

  it('treats a single separator with 3 trailing digits as a thousands separator', () => {
    expect(parseMoneyToken('1.234')).toBeCloseTo(1234, 2);
    expect(parseMoneyToken('1,234')).toBeCloseTo(1234, 2);
  });

  it('treats a single separator with exactly 2 trailing digits as decimal', () => {
    expect(parseMoneyToken('1.23')).toBeCloseTo(1.23, 2);
    expect(parseMoneyToken('1,23')).toBeCloseTo(1.23, 2);
  });
});

describe('normalizeInvoiceDate', () => {
  it.each([
    ['15.03.2026', '2026-03-15'],
    ['15/03/2026', '2026-03-15'],
    ['2026-03-15', '2026-03-15'],
    ['01.01.2026', '2026-01-01'],
  ])('normalizes %s to %s', (token, expected) => {
    expect(normalizeInvoiceDate(token)).toBe(expected);
  });

  it.each([['31.04.2026'], ['29.02.2026'], ['2026-13-01'], ['not-a-date'], [''], [null]])(
    'rejects impossible or unparseable dates: %j',
    (token) => {
      expect(normalizeInvoiceDate(token)).toBeNull();
    },
  );

  it('accepts a real leap date', () => {
    expect(normalizeInvoiceDate('29.02.2024')).toBe('2024-02-29');
  });
});

describe('suggestInvoiceHeader', () => {
  it('extracts every field from a German supplier invoice', () => {
    const { suggestions } = suggestInvoiceHeader(GERMAN_INVOICE, { direction: 'incoming' });
    expect(suggestions.invoiceNumber?.value).toBe('2026-001');
    expect(suggestions.issueDate?.value).toBe('2026-03-15');
    expect(suggestions.netAmount?.value).toBe(1000);
    expect(suggestions.taxAmount?.value).toBe(190);
    expect(suggestions.taxRate?.value).toBe(19);
    expect(suggestions.grossAmount?.value).toBe(1190);
    expect(suggestions.counterpartyName?.value).toBe('Muster Bau GmbH');
  });

  it('extracts every field from an English invoice', () => {
    const { suggestions } = suggestInvoiceHeader(ENGLISH_INVOICE, { direction: 'incoming' });
    expect(suggestions.invoiceNumber?.value).toBe('INV-2026-042');
    expect(suggestions.netAmount?.value).toBe(500);
    expect(suggestions.taxAmount?.value).toBe(95);
    expect(suggestions.taxRate?.value).toBe(19);
    expect(suggestions.grossAmount?.value).toBe(595);
  });

  it('extracts every field from a Spanish invoice', () => {
    const { suggestions } = suggestInvoiceHeader(SPANISH_INVOICE, { direction: 'outgoing' });
    expect(suggestions.invoiceNumber?.value).toBe('F-2026-0099');
    expect(suggestions.issueDate?.value).toBe('2026-04-05');
    expect(suggestions.netAmount?.value).toBe(2000);
    expect(suggestions.taxAmount?.value).toBe(380);
    expect(suggestions.taxRate?.value).toBe(19);
    expect(suggestions.grossAmount?.value).toBe(2380);
  });

  it('every suggested field carries the source line it was read from', () => {
    const { suggestions } = suggestInvoiceHeader(GERMAN_INVOICE);
    expect(suggestions.invoiceNumber?.line).toContain('Rechnungsnummer');
    expect(suggestions.issueDate?.line).toContain('Rechnungsdatum');
    expect(suggestions.grossAmount?.line).toContain('Gesamtbetrag');
  });

  it('falls back to the first date-looking token in the first 15 lines when no label matches', () => {
    const text = ['Some Company', 'Random line', '15.03.2026 was the day', 'more text'].join('\n');
    const { suggestions } = suggestInvoiceHeader(text);
    expect(suggestions.issueDate?.value).toBe('2026-03-15');
  });

  it('does not fall back to a date beyond the first 15 lines', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    lines[16] = '15.03.2026';
    const { suggestions } = suggestInvoiceHeader(lines.join('\n'));
    expect(suggestions.issueDate).toBeNull();
  });

  it('returns null for every field missing from the text', () => {
    const { suggestions } = suggestInvoiceHeader('Just some unrelated text\nwith no invoice fields at all');
    expect(suggestions.invoiceNumber).toBeNull();
    expect(suggestions.grossAmount).toBeNull();
    expect(suggestions.netAmount).toBeNull();
    expect(suggestions.taxAmount).toBeNull();
    expect(suggestions.taxRate).toBeNull();
  });

  it('rejects impossible calendar dates as null rather than guessing', () => {
    const text = 'Rechnungsdatum: 31.04.2026\nGesamtbetrag: 100,00 €';
    const { suggestions } = suggestInvoiceHeader(text);
    expect(suggestions.issueDate).toBeNull();
  });

  it('does not enforce net + tax ≈ gross — that is the core validator responsibility', () => {
    const text = 'Rechnungsnummer: 1\nNettobetrag: 100,00\nMwSt: 50,00\nGesamtbetrag: 999,00';
    const { suggestions } = suggestInvoiceHeader(text);
    expect(suggestions.netAmount?.value).toBe(100);
    expect(suggestions.taxAmount?.value).toBe(50);
    expect(suggestions.grossAmount?.value).toBe(999);
  });

  it('prefers Gesamtbetrag over lower-priority gross labels when both appear', () => {
    const text = 'Rechnungsbetrag: 50,00\nGesamtbetrag: 100,00';
    const { suggestions } = suggestInvoiceHeader(text);
    expect(suggestions.grossAmount?.value).toBe(100);
  });

  it('caps evidence.lines at 200 trimmed non-empty lines', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`);
    const { evidence } = suggestInvoiceHeader(lines.join('\n'));
    expect(evidence.lines.length).toBe(200);
  });

  it('evidence.lines excludes empty lines and is trimmed', () => {
    const { evidence } = suggestInvoiceHeader('  first line  \n\n\n  second line  ');
    expect(evidence.lines).toEqual(['first line', 'second line']);
  });

  it('handles missing text gracefully', () => {
    const { suggestions, evidence } = suggestInvoiceHeader('');
    expect(suggestions.invoiceNumber).toBeNull();
    expect(evidence.lines).toEqual([]);
  });

  it('recognizes Re-Nr and RE-Nr. label variants', () => {
    expect(suggestInvoiceHeader('Re-Nr: 123').suggestions.invoiceNumber?.value).toBe('123');
    expect(suggestInvoiceHeader('RE-Nr. 456').suggestions.invoiceNumber?.value).toBe('456');
  });

  it('recognizes Invoice # and Nº de factura label variants', () => {
    expect(suggestInvoiceHeader('Invoice #: 789').suggestions.invoiceNumber?.value).toBe('789');
    expect(suggestInvoiceHeader('Nº de factura: F-1').suggestions.invoiceNumber?.value).toBe('F-1');
  });
});
