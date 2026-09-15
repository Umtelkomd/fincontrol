import { describe, expect, it } from "vitest";
import {
  invoiceIdentityInput,
  planInvoiceLink,
  validateConfirmedInvoice,
  validateInvoiceFile,
} from "./invoiceArchive.js";

const invoice = (overrides = {}) => ({
  confirmed: true,
  documentType: "invoice",
  direction: "outgoing",
  sourceSystem: "ordinary",
  issuerId: "tenant-1",
  counterpartyId: "customer-1",
  invoiceNumber: " 2026-Ab/001 ",
  issueDate: "2026-02-28",
  currency: "EUR",
  netAmount: 100,
  taxAmount: 19,
  grossAmount: 119,
  ...overrides,
});
const reference = { family: "receivable", recordId: "row-1" };
const row = (overrides = {}) => ({
  ...reference,
  counterpartyId: "customer-1",
  sourceSystem: "ordinary",
  status: "settled",
  grossAmount: 119,
  payments: [{ amount: 119 }],
  ...overrides,
});
const attach = (overrides = {}) =>
  planInvoiceLink({
    invoice: invoice(),
    mode: "attach-existing",
    links: [reference],
    existingObligations: [row()],
    ...overrides,
  });

describe("confirmed invoice header", () => {
  it("preserves explicit totals and original number without importing accounting state", () => {
    const header = validateConfirmedInvoice(
      invoice({ paid: true, payments: [119], files: ["draft"] }),
    );
    expect(header).toEqual(invoice());
    expect(Object.isFrozen(header)).toBe(true);
  });

  it.each([
    { confirmed: false },
    { confirmed: undefined },
    { documentType: "credit-note" },
    { direction: "other" },
    { sourceSystem: "unknown" },
    { counterpartyId: "" },
    { issuerId: undefined },
    { issuerId: null },
    { issuerId: " " },
    { invoiceNumber: " " },
    { issueDate: "2026-02-29" },
    { issueDate: "2026-04-31" },
    { issueDate: "2026-2-01" },
    { issueDate: "0000-01-01" },
    { issueDate: "invalid" },
    { currency: "USD" },
    { currency: "" },
    { netAmount: -100 },
    { taxAmount: -1 },
    { grossAmount: -119 },
    { grossAmount: 0 },
    { netAmount: "100" },
    { taxAmount: undefined },
    { taxAmount: null },
    { grossAmount: NaN },
    { grossAmount: Infinity },
    { netAmount: 1.001 },
    { grossAmount: 119.02 },
    { grossAmount: Number.MAX_SAFE_INTEGER },
    { netAmount: undefined },
    { grossAmount: undefined },
    { sourceSystem: "insyte", direction: "incoming" },
    { invoiceNumber: "A\nB" },
  ])("rejects unsafe or unresolved confirmation: %j", (override) => {
    expect(() => validateConfirmedInvoice(invoice(override))).toThrow();
  });

  it("accepts real leap dates, explicit zero VAT and mixed-rate totals without a rate", () => {
    expect(
      validateConfirmedInvoice(
        invoice({ issueDate: "2024-02-29", taxAmount: 0, grossAmount: 100 }),
      ).taxAmount,
    ).toBe(0);
    const mixed = validateConfirmedInvoice(
      invoice({ netAmount: 200, taxAmount: 26, grossAmount: 226 }),
    );
    expect(mixed.taxAmount).toBe(26);
    expect(mixed).not.toHaveProperty("taxRate");
  });

  it("compares integer cents with one-cent tolerance and never rewrites totals", () => {
    expect(
      validateConfirmedInvoice(invoice({ grossAmount: 118.99 })).grossAmount,
    ).toBe(118.99);
    expect(
      validateConfirmedInvoice(invoice({ grossAmount: 119.01 })).grossAmount,
    ).toBe(119.01);
    expect(() =>
      validateConfirmedInvoice(invoice({ grossAmount: 118.98 })),
    ).toThrow();
    expect(
      validateConfirmedInvoice(
        invoice({ netAmount: 0.1, taxAmount: 0.2, grossAmount: 0.3 }),
      ).grossAmount,
    ).toBe(0.3);
  });
});

describe("invoice identity versus exact PDF bytes", () => {
  it("normalizes only surrounding whitespace and Unicode composition", () => {
    const key = invoiceIdentityInput(invoice({ invoiceNumber: " café/001 " }));
    expect(key).toBe(
      invoiceIdentityInput(invoice({ invoiceNumber: "cafe\u0301/001" })),
    );
    expect(invoiceIdentityInput(invoice())).not.toBe(
      invoiceIdentityInput(invoice({ invoiceNumber: "2026-ab/001" })),
    );
    expect(invoiceIdentityInput(invoice())).not.toBe(
      invoiceIdentityInput(invoice({ invoiceNumber: "2026-Ab001" })),
    );
  });

  it("uses issuer identity, not outgoing recipient, totals or file hashes", () => {
    const key = invoiceIdentityInput(invoice());
    expect(key).not.toBe(
      invoiceIdentityInput(invoice({ direction: "incoming" })),
    );
    expect(key).toBe(
      invoiceIdentityInput(invoice({ counterpartyId: "customer-2" })),
    );
    expect(key).not.toBe(
      invoiceIdentityInput(invoice({ issuerId: "tenant-2" })),
    );
    expect(key).toBe(
      invoiceIdentityInput(invoice({ grossAmount: 999, sha256: "other" })),
    );
    expect(() =>
      invoiceIdentityInput(invoice({ counterpartyId: null })),
    ).toThrow();
    expect(() => invoiceIdentityInput(invoice({ direction: "" }))).toThrow();
    expect(() =>
      invoiceIdentityInput(invoice({ invoiceNumber: "" })),
    ).toThrow();
  });

  it("distinguishes incoming suppliers that issue the same number", () => {
    const supplier = invoice({
      direction: "incoming",
      issuerId: "supplier-1",
      counterpartyId: "supplier-1",
    });
    expect(invoiceIdentityInput(supplier)).not.toBe(
      invoiceIdentityInput({
        ...supplier,
        issuerId: "supplier-2",
        counterpartyId: "supplier-2",
      }),
    );
    expect(() =>
      invoiceIdentityInput(invoice({ issuerId: undefined })),
    ).toThrow(/issuerId/);
    expect(() => invoiceIdentityInput(invoice({ issuerId: "\t" }))).toThrow(
      /issuerId/,
    );
  });

  const file = {
    sha256: "ab".repeat(32),
    sizeBytes: 1024,
    mimeType: "application/pdf",
    originalName: "invoice.pdf",
  };
  it("returns a detached immutable PDF descriptor; does not claim byte verification", () => {
    const result = validateInvoiceFile({ ...file, paid: true });
    expect(result).toEqual(file);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toBe(file);
    expect(
      validateInvoiceFile({ ...file, sha256: file.sha256.toUpperCase() }),
    ).toEqual(file);
    expect(
      validateInvoiceFile({ ...file, sha256: "cd".repeat(32) }).sha256,
    ).not.toBe(result.sha256);
  });

  it.each([
    { sha256: "x".repeat(64) },
    { sha256: "ab" },
    { sizeBytes: 0 },
    { sizeBytes: 1.5 },
    { sizeBytes: Number.MAX_SAFE_INTEGER + 1 },
    { mimeType: "image/png" },
    { originalName: " " },
  ])("rejects invalid file metadata: %j", (override) => {
    expect(() => validateInvoiceFile({ ...file, ...override })).toThrow();
  });
});

describe("explicit obligation linkage plans", () => {
  it("creates only an ordinary obligation intent, without inventing IDs or payments", () => {
    expect(
      planInvoiceLink({ invoice: invoice(), mode: "create-ordinary" }),
    ).toEqual({
      mode: "create-ordinary",
      family: "receivable",
      links: [],
    });
    expect(
      planInvoiceLink({
        invoice: invoice({ direction: "incoming" }),
        mode: "create-ordinary",
      }).family,
    ).toBe("payable");
    expect(() =>
      planInvoiceLink({
        invoice: invoice({ sourceSystem: "insyte" }),
        mode: "create-ordinary",
      }),
    ).toThrow();
    expect(() =>
      planInvoiceLink({
        invoice: invoice(),
        mode: "create-ordinary",
        links: [reference],
      }),
    ).toThrow();
  });

  it("attaches settled rows by explicit identity without mutating input or exposing monetary patches", () => {
    const existing = row();
    const before = structuredClone(existing);
    const result = attach({ existingObligations: [existing] });
    expect(result).toEqual({
      mode: "attach-existing",
      family: "receivable",
      links: [reference],
    });
    expect(existing).toEqual(before);
    expect(result.links[0]).not.toBe(reference);
    expect(Object.isFrozen(result.links[0])).toBe(true);
    expect(Object.isFrozen(result.links)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("links one invoice to multiple Insyte presupuestos, preserving their NET obligations", () => {
    const rows = [
      row({
        sourceSystem: "insyte",
        numeroPresupuesto: "001",
        grossAmount: 50,
      }),
      row({
        recordId: "row-2",
        sourceSystem: "insyte",
        numeroPresupuesto: "002",
        grossAmount: 50,
      }),
    ];
    const before = structuredClone(rows);
    const links = rows.map(({ family, recordId }) => ({ family, recordId }));
    expect(
      attach({
        invoice: invoice({ sourceSystem: "insyte" }),
        links,
        existingObligations: rows,
      }).links,
    ).toEqual(links);
    expect(rows).toEqual(before);
    expect(() =>
      attach({ invoice: invoice({ sourceSystem: "insyte" }) }),
    ).toThrow();
    expect(() =>
      attach({
        invoice: invoice({ sourceSystem: "insyte" }),
        existingObligations: [row({ sourceSystem: "insyte" })],
      }),
    ).toThrow();
  });

  it.each([
    { mode: "guess" },
    { links: [] },
    { links: [reference, reference] },
    { links: [{ family: "transaction", recordId: "row-1" }] },
    { links: [{ family: "receivable", recordId: "" }] },
    { links: [{ family: "receivable", recordId: "path/id" }] },
    { links: [reference, { family: "payable", recordId: "row-2" }] },
    { existingObligations: [] },
    { existingObligations: [row(), row()] },
    { existingObligations: [row({ counterpartyId: "other" })] },
    {
      existingObligations: [
        row({ sourceSystem: "insyte", numeroPresupuesto: "001" }),
      ],
    },
    { invoice: invoice({ confirmed: false }) },
  ])("rejects invalid, unresolved or ambiguous attachment: %j", (override) => {
    expect(() => attach(override)).toThrow();
  });

  it("rejects malformed selections rather than guessing or normalizing record IDs", () => {
    for (const recordId of [" row-1 ", "..", "row\t1"]) {
      expect(() => attach({ links: [{ ...reference, recordId }] })).toThrow();
    }
    expect(() => attach({ links: null })).toThrow();
    expect(() => attach({ links: [null] })).toThrow();
    expect(() => attach({ existingObligations: null })).toThrow();
  });

  it.each([
    { links: new Array(1) },
    { links: [reference, undefined] },
    { links: [undefined] },
    { links: [null] },
  ])("rejects missing selections, including sparse arrays: %j", (selection) => {
    expect(() => attach(selection)).toThrow(/selection/i);
  });

  it("validates every index of truly sparse and partially filled selections", () => {
    const mixed = new Array(2);
    mixed[0] = reference;
    expect(() => attach({ links: new Array(1) })).toThrow(/selection/i);
    expect(() => attach({ links: mixed })).toThrow(/selection/i);
  });

  it.each([
    { rechnungId: "2025-999" },
    { invoiceNumber: "other" },
    { invoiceNumber: "2026-ab/001" },
    { documentType: "invoice", documentNumber: "other" },
    {
      invoiceNumber: "2026-Ab/001",
      documentType: "invoice",
      documentNumber: "other",
    },
    { rechnungId: 2026001 },
    {
      archivedInvoiceIdentity: invoiceIdentityInput(
        invoice({ issuerId: "other" }),
      ),
    },
    {
      archivedInvoiceIdentity: invoiceIdentityInput(
        invoice({ invoiceNumber: "other" }),
      ),
    },
    { archivedInvoiceIdentity: "unresolved-archive-id" },
    {
      archivedInvoiceIdentity:
        '["invoice-v1","outgoing","customer-1","2026-Ab/001"]',
    },
    { archivedInvoiceIdentity: {} },
  ])(
    "rejects conflicting or malformed existing invoice bindings: %j",
    (binding) => {
      const existing = row(binding);
      const before = structuredClone(existing);
      expect(() => attach({ existingObligations: [existing] })).toThrow();
      expect(existing).toEqual(before);
    },
  );

  it("rejects a conflicting Insyte Rechnung without touching settled rows", () => {
    const existing = row({
      sourceSystem: "insyte",
      numeroPresupuesto: "001",
      rechnungId: "2025-999",
    });
    const before = structuredClone(existing);
    expect(() =>
      attach({
        invoice: invoice({ sourceSystem: "insyte", invoiceNumber: "2026-001" }),
        existingObligations: [existing],
      }),
    ).toThrow(/conflict/i);
    expect(existing).toEqual(before);
  });

  it("allows same-invoice reattachment without confusing presupuesto or generic document numbers", () => {
    const header = invoice({ sourceSystem: "insyte" });
    const existing = row({
      sourceSystem: "insyte",
      numeroPresupuesto: "001",
      documentNumber: "001",
      rechnungId: "2026-Ab/001",
      archivedInvoiceIdentity: invoiceIdentityInput(header),
    });
    const before = structuredClone(existing);
    expect(
      attach({ invoice: header, existingObligations: [existing] }).links,
    ).toEqual([reference]);
    expect(existing).toEqual(before);
    expect(
      attach({
        existingObligations: [row({ documentNumber: "purchase-order-1" })],
      }).links,
    ).toEqual([reference]);
    expect(
      attach({
        existingObligations: [
          row({
            invoiceNumber: "2026-Ab/001",
            documentType: "invoice",
            documentNumber: " 2026-Ab/001 ",
          }),
        ],
      }).links,
    ).toEqual([reference]);
  });

  it("supports existing payables and rejects direction/family mismatch", () => {
    const payable = { family: "payable", recordId: "row-1" };
    expect(
      attach({
        invoice: invoice({ direction: "incoming" }),
        links: [payable],
        existingObligations: [row({ family: "payable" })],
      }).links,
    ).toEqual([payable]);
    expect(() =>
      attach({ invoice: invoice({ direction: "incoming" }) }),
    ).toThrow();
  });
});
