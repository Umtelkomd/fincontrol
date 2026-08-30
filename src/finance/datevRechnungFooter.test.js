/**
 * DATEV Rechnung footer — the ONLY place a Rechnung names its Insyte pedidos.
 *
 * A DATEV `Rechnung 2025-NNN.pdf` groups N Insyte presupuestos. The positions
 * above `Endbetrag` carry 10-digit presupuesto codes and amounts; the 7-digit
 * Bestellnummern (pedidos) sit BELOW `Endbetrag`. Reading pedidos anywhere
 * else would confuse amounts, dates and presupuestos for pedidos.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseDatevFooterPedidos, parseDatevRechnungHeader, parseDatevRechnungNumber } from './datevRechnungFooter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, '__fixtures__', 'datev', name), 'utf8');

describe('parseDatevFooterPedidos', () => {
  it('returns the six pedidos of 2025-270 in order of appearance', () => {
    expect(parseDatevFooterPedidos(fixture('extract_2025-270.txt'))).toEqual([
      '2640070', '2640164', '2640165', '2640168', '2640169', '2640170',
    ]);
  });

  it('returns the two pedidos of 2025-272, deduplicated', () => {
    expect(parseDatevFooterPedidos(fixture('extract_2025-272.txt'))).toEqual(['2640321', '2640322']);
  });

  it('returns the single pedido of 2025-271', () => {
    expect(parseDatevFooterPedidos(fixture('extract_2025-271.txt'))).toEqual(['2640178']);
  });

  it('reads past a two-page Übertrag/Vortrag block and never leaks the bank footer', () => {
    // 2025-270 repeats the bank footer after the pedidos: phone +49 176 72195330
    // (8 digits), USt-IdNr DE342168532, Steuernummer 082/121/02610, IBAN groups.
    const pedidos = parseDatevFooterPedidos(fixture('extract_2025-270.txt'));
    expect(pedidos).not.toContain('7219533');
    expect(pedidos).not.toContain('3421685');
    expect(pedidos.every((p) => p.startsWith('264'))).toBe(true);
  });

  it('accepts a pedido with a trailing " ." as in 2025-272', () => {
    expect(parseDatevFooterPedidos('Endbetrag: 1,00\n2640321\n2640322 .\n')).toEqual(['2640321', '2640322']);
  });

  it('never reads seven digits out of a longer digit run', () => {
    expect(parseDatevFooterPedidos('Endbetrag: 1,00\n+49 176 72195330\nDE342168532\n12345678')).toEqual([]);
  });

  it('ignores everything above the last Endbetrag line', () => {
    const text = [
      ' 1  0026048420 Pos 2640070 vorab 1,00 230,00',
      'Endbetrag 1.000,00',
      'Nachtrag',
      'Endbetrag 5.186,02',
      'Bestellnummer 2640164',
    ].join('\n');
    expect(parseDatevFooterPedidos(text)).toEqual(['2640164']);
  });

  it('never reads a 7-digit run out of a longer number, a date or an amount', () => {
    const text = 'Endbetrag 5.186,02\n0026048420 · 24.08.2026 · 1234567890 · 1.234.567,00 · 2640070';
    expect(parseDatevFooterPedidos(text)).toEqual(['2640070']);
  });

  it('returns nothing without an Endbetrag line or for empty input', () => {
    expect(parseDatevFooterPedidos('2640070')).toEqual([]);
    expect(parseDatevFooterPedidos('')).toEqual([]);
    expect(parseDatevFooterPedidos(null)).toEqual([]);
  });
});

describe('parseDatevRechnungNumber', () => {
  it('reads the number from the DATEV filename, tolerant to case and spacing', () => {
    expect(parseDatevRechnungNumber('Rechnung 2025-270.pdf')).toBe('2025-270');
    expect(parseDatevRechnungNumber('rechnung  2025-271.PDF')).toBe('2025-271');
    expect(parseDatevRechnungNumber('Rechnung_2025-272.pdf')).toBe('2025-272');
  });

  it('returns null for anything that is not a Rechnung', () => {
    expect(parseDatevRechnungNumber('cnf_2026-08.pdf')).toBeNull();
    expect(parseDatevRechnungNumber('Abrechnung Wegen Faktorisierung.pdf')).toBeNull();
    expect(parseDatevRechnungNumber('')).toBeNull();
    expect(parseDatevRechnungNumber(undefined)).toBeNull();
  });
});

describe('parseDatevRechnungHeader', () => {
  it('reads number, Summe and Endbetrag from the three real invoices', () => {
    expect(parseDatevRechnungHeader(fixture('extract_2025-270.txt'))).toEqual({ rechnungId: '2025-270', summe: 4358, endbetrag: 5186.02 });
    expect(parseDatevRechnungHeader(fixture('extract_2025-271.txt'))).toEqual({ rechnungId: '2025-271', summe: 12608.36, endbetrag: 15003.95 });
    expect(parseDatevRechnungHeader(fixture('extract_2025-272.txt'))).toEqual({ rechnungId: '2025-272', summe: 4659, endbetrag: 5544.21 });
  });

  it('returns nulls for what it cannot find and takes the LAST Summe/Endbetrag', () => {
    expect(parseDatevRechnungHeader('')).toEqual({ rechnungId: null, summe: null, endbetrag: null });
    expect(parseDatevRechnungHeader('Summe: 1,00\nEndbetrag: 2,00\nSumme: 3,00\nEndbetrag: 4,00')).toEqual({ rechnungId: null, summe: 3, endbetrag: 4 });
  });
});
