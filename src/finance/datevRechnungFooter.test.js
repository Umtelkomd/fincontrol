/**
 * DATEV Rechnung footer — the ONLY place a Rechnung names its Insyte pedidos.
 *
 * A DATEV Rechnung groups N Insyte presupuestos. The positions
 * above `Endbetrag` carry 10-digit presupuesto codes and amounts; the 7-digit
 * Bestellnummern (pedidos) sit BELOW `Endbetrag`. Reading pedidos anywhere
 * else would confuse amounts, dates and presupuestos for pedidos.
 * All inputs below are synthetic; no private extracts are loaded.
 */
import { describe, expect, it } from "vitest";

import {
  parseDatevFooterPedidos,
  parseDatevRechnungHeader,
  parseDatevRechnungNumber,
} from "./datevRechnungFooter.js";
import {
  SYNTHETIC_SIX_PEDIDOS,
  SYNTHETIC_SINGLE_PEDIDO,
  SYNTHETIC_TWO_PEDIDOS,
} from "./syntheticInvoiceFixtures.js";

describe("parseDatevFooterPedidos", () => {
  it("returns the six synthetic pedidos in order of appearance", () => {
    expect(parseDatevFooterPedidos(SYNTHETIC_SIX_PEDIDOS)).toEqual([
      "9901001",
      "9901002",
      "9901003",
      "9901004",
      "9901005",
      "9901006",
    ]);
  });

  it("returns the two synthetic pedidos, deduplicated", () => {
    expect(parseDatevFooterPedidos(SYNTHETIC_TWO_PEDIDOS)).toEqual([
      "9901008",
      "9901009",
    ]);
  });

  it("returns the single synthetic pedido", () => {
    expect(parseDatevFooterPedidos(SYNTHETIC_SINGLE_PEDIDO)).toEqual([
      "9901007",
    ]);
  });

  it("reads past a two-page Übertrag/Vortrag block and never leaks the bank footer", () => {
    // Invalid synthetic phone (8 digits), VAT (9 digits), tax and IBAN groups
    // repeat above the page break and below the pedidos.
    const pedidos = parseDatevFooterPedidos(SYNTHETIC_SIX_PEDIDOS);
    expect(pedidos).not.toContain("8888888");
    expect(pedidos).not.toContain("0000000");
    expect(pedidos.every((p) => p.startsWith("990"))).toBe(true);
  });

  it('accepts a pedido with a trailing " ."', () => {
    expect(
      parseDatevFooterPedidos("Endbetrag: 1,00\n9901008\n9901009 .\n"),
    ).toEqual(["9901008", "9901009"]);
  });

  it("never reads seven digits out of a longer digit run", () => {
    expect(
      parseDatevFooterPedidos(
        "Endbetrag: 1,00\n+00 000 88888888\nDE000000000\n99999999",
      ),
    ).toEqual([]);
  });

  it("ignores everything above the last Endbetrag line", () => {
    const text = [
      " 1  0099010001 Pos 9901001 vorab 1,00 120,00",
      "Endbetrag 1.000,00",
      "Nachtrag 9901003",
      "Endbetrag 2.998,80",
      "Bestellnummer 9901002",
    ].join("\n");
    expect(parseDatevFooterPedidos(text)).toEqual(["9901002"]);
  });

  it("never reads a 7-digit run out of a longer number, a date or an amount", () => {
    const text =
      "Endbetrag 2.998,80\n0099010001 · 14.03.2099 · 9999999999 · 9.876.543,00 · 9901777,00 · 9901888.00 · 9901001";
    expect(parseDatevFooterPedidos(text)).toEqual(["9901001"]);
  });

  it("returns nothing without an Endbetrag line or for empty input", () => {
    expect(parseDatevFooterPedidos("9901001")).toEqual([]);
    expect(parseDatevFooterPedidos("")).toEqual([]);
    expect(parseDatevFooterPedidos(null)).toEqual([]);
  });
});

describe("parseDatevRechnungNumber", () => {
  it("reads the number from the DATEV filename, tolerant to case and spacing", () => {
    expect(parseDatevRechnungNumber("Rechnung 2099-901.pdf")).toBe("2099-901");
    expect(parseDatevRechnungNumber("rechnung  2099-902.PDF")).toBe("2099-902");
    expect(parseDatevRechnungNumber("Rechnung_2099-903.pdf")).toBe("2099-903");
  });

  it("returns null for anything that is not a Rechnung", () => {
    expect(parseDatevRechnungNumber("cnf_2099-03.pdf")).toBeNull();
    expect(
      parseDatevRechnungNumber("Abrechnung Wegen Faktorisierung.pdf"),
    ).toBeNull();
    expect(parseDatevRechnungNumber("")).toBeNull();
    expect(parseDatevRechnungNumber(undefined)).toBeNull();
  });
});

describe("parseDatevRechnungHeader", () => {
  it("reads number, Summe and Endbetrag from the three synthetic invoices", () => {
    expect(parseDatevRechnungHeader(SYNTHETIC_SIX_PEDIDOS)).toEqual({
      rechnungId: "2099-901",
      summe: 2520,
      endbetrag: 2998.8,
    });
    expect(parseDatevRechnungHeader(SYNTHETIC_SINGLE_PEDIDO)).toEqual({
      rechnungId: "2099-902",
      summe: 12345.67,
      endbetrag: 14691.35,
    });
    expect(parseDatevRechnungHeader(SYNTHETIC_TWO_PEDIDOS)).toEqual({
      rechnungId: "2099-903",
      summe: 1700,
      endbetrag: 2023,
    });
  });

  it("returns nulls for what it cannot find and takes the LAST Summe/Endbetrag", () => {
    expect(parseDatevRechnungHeader("")).toEqual({
      rechnungId: null,
      summe: null,
      endbetrag: null,
    });
    expect(
      parseDatevRechnungHeader(
        "Summe: 1,00\nEndbetrag: 2,00\nSumme: 3,00\nEndbetrag: 4,00",
      ),
    ).toEqual({ rechnungId: null, summe: 3, endbetrag: 4 });
  });
});
