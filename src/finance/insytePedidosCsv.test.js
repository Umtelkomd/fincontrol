/**
 * Insyte purchase-order export (pedidos de compra) — the source of truth for
 * pedido → presupuesto and for the Insyte NET amount of every CxC.
 * All inputs are invented test data; no private extracts or CSVs are loaded.
 */
import { describe, expect, it } from "vitest";

import { parseInsytePedidosCsv } from "./insytePedidosCsv.js";
import {
  parseDatevFooterPedidos,
  parseDatevRechnungHeader,
} from "./datevRechnungFooter.js";
import { resolvePresupuestoForPedido } from "./insyteContract.js";
import {
  SYNTHETIC_PEDIDOS_CSV,
  SYNTHETIC_SINGLE_PEDIDO,
  SYNTHETIC_SIX_PEDIDOS,
} from "./syntheticInvoiceFixtures.js";

describe("parseInsytePedidosCsv", () => {
  it("parses the 9-row export with EUR suffix and quoted references containing commas", () => {
    const rows = parseInsytePedidosCsv(SYNTHETIC_PEDIDOS_CSV);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual({
      numeroPedido: "9901001",
      fechaPedido: "2099-03-14",
      numeroPresupuesto: "0099010001",
      fechaPresupuesto: "2099-03-13",
      referenciaObra: "Synthetic Alpha KW10 2099",
      importePedido: 120,
      kw: "KW10",
    });
    expect(rows[3]).toMatchObject({
      numeroPedido: "9901004",
      referenciaObra: "Synthetic Delta A, B KW11 2099",
      importePedido: 480,
      kw: "KW11",
    });
    expect(rows[6]).toMatchObject({
      numeroPedido: "9901007",
      numeroPresupuesto: "0099010007",
      importePedido: 12345.67,
      kw: "",
    });
  });

  it("parses the full-export shape: every field quoted, extra columns, euro suffix, CRLF", () => {
    const text =
      "num_doc,fecha_pedido,codigo_presupuesto,fecha_presupuesto,cod_proveedor,proveedor,ref_proveedor,importe\r\n" +
      '"9901020","14/03/2099","0099010020","13/03/2099","99999","SYNTHETIC SUPPLIER - NOT REAL","Synthetic Alpha KW10 2099","120.00 €"\r\n' +
      '"9901021","14/03/2099","0099010021","12/03/2099","99999","SYNTHETIC SUPPLIER - NOT REAL","Synthetic Pair A, B KW09 2099","60.00 €"\r\n';
    expect(parseInsytePedidosCsv(text)).toEqual([
      {
        numeroPedido: "9901020",
        fechaPedido: "2099-03-14",
        numeroPresupuesto: "0099010020",
        fechaPresupuesto: "2099-03-13",
        referenciaObra: "Synthetic Alpha KW10 2099",
        importePedido: 120,
        kw: "KW10",
      },
      {
        numeroPedido: "9901021",
        fechaPedido: "2099-03-14",
        numeroPresupuesto: "0099010021",
        fechaPresupuesto: "2099-03-12",
        referenciaObra: "Synthetic Pair A, B KW09 2099",
        importePedido: 60,
        kw: "KW09",
      },
    ]);
  });

  it("handles escaped quotes, a thousands separator and returns nothing for empty input", () => {
    const text =
      'num_doc,fecha_pedido,codigo_presupuesto,fecha_presupuesto,ref_proveedor,importe\n"9901022","01/03/2099","99010022","01/03/2099","Synthetic Obra ""X""","2,345.60 €"\n';
    expect(parseInsytePedidosCsv(text)[0]).toMatchObject({
      numeroPresupuesto: "0099010022",
      referenciaObra: 'Synthetic Obra "X"',
      importePedido: 2345.6,
      fechaPedido: "2099-03-01",
    });
    expect(parseInsytePedidosCsv("")).toEqual([]);
    expect(parseInsytePedidosCsv(null)).toEqual([]);
  });

  it("skips rows without a pedido or presupuesto", () => {
    const text =
      "num_doc,fecha_pedido,codigo_presupuesto,fecha_presupuesto,ref_proveedor,importe\n,,,,,\n9901022,01/03/2099,,01/03/2099,Synthetic,1.00 EUR\n,01/03/2099,0099010022,01/03/2099,Synthetic,1.00 EUR\n";
    expect(parseInsytePedidosCsv(text)).toEqual([]);
  });
});

describe("synthetic DATEV footers resolved through the synthetic Insyte export", () => {
  const pedidos = parseInsytePedidosCsv(SYNTHETIC_PEDIDOS_CSV);
  const byPedido = new Map(pedidos.map((row) => [row.numeroPedido, row]));

  it("single invoice → pedido → presupuesto with the independent net amount", () => {
    const text = SYNTHETIC_SINGLE_PEDIDO;
    const [pedido] = parseDatevFooterPedidos(text);
    expect(pedido).toBe("9901007");
    expect(
      resolvePresupuestoForPedido(pedido, {
        pedidos,
        map: {},
        receivables: [],
      }),
    ).toBe("0099010007");
    expect(byPedido.get(pedido).importePedido).toBe(12345.67);
    // Sanity: the Insyte net equals the PDF Summe, not the tax-inclusive gross.
    expect(parseDatevRechnungHeader(text).summe).toBe(12345.67);
  });

  it("six pedidos → their presupuestos, whose importes sum to the PDF Summe", () => {
    const text = SYNTHETIC_SIX_PEDIDOS;
    const found = parseDatevFooterPedidos(text);
    expect(
      found.map((p) =>
        resolvePresupuestoForPedido(p, { pedidos, map: {}, receivables: [] }),
      ),
    ).toEqual([
      "0099010001",
      "0099010002",
      "0099010003",
      "0099010004",
      "0099010005",
      "0099010006",
    ]);
    const sum = found.reduce(
      (total, p) => total + byPedido.get(p).importePedido,
      0,
    );
    expect(Math.round(sum * 100) / 100).toBe(2520);
    expect(parseDatevRechnungHeader(text).summe).toBe(2520);
  });
});
