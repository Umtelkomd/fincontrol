import { describe, expect, it } from "vitest";
import {
  prefilterObligations,
  rankShortlist,
  type InvoiceInput,
  type ObligationCandidate,
  type ObligationMatcher,
} from "./ranking.js";

const invoice: InvoiceInput = {
  family: "payable",
  sourceSystem: "ordinary",
  counterpartyName: "Müller Bau GmbH",
  invoiceNumber: "RE-2026-42",
  grossAmount: 1190,
  issueDate: "2026-06-01",
};
const candidate = (
  overrides: Partial<ObligationCandidate> = {},
): ObligationCandidate => ({
  id: "p-1",
  family: "payable",
  sourceSystem: "ordinary",
  counterpartyName: "Mueller Bau GmbH",
  documentNumber: "RE 2026 42",
  grossAmount: 1190,
  issueDate: "2026-06-02",
  status: "issued",
  ...overrides,
});

describe("provider-neutral ranking", () => {
  it("bounds the shortlist and caps provider-ranked matches at five", async () => {
    const shortlist = prefilterObligations(
      invoice,
      Array.from({ length: 30 }, (_, index) => candidate({ id: `p-${index}` })),
    );
    expect(shortlist).toHaveLength(20);
    const matcher: ObligationMatcher = {
      score: async (_invoice, candidates) =>
        candidates.map((entry, index) => ({
          candidateId: entry.id,
          score: 1 - index / 100,
        })),
    };
    const result = await rankShortlist(invoice, shortlist, matcher);
    expect(result).toMatchObject({ fallback: false });
    expect(result.matches).toHaveLength(5);
  });

  it("uses deterministic fallback when the provider fails", async () => {
    const shortlist = prefilterObligations(invoice, [
      candidate(),
      candidate({ id: "p-2" }),
    ]);
    const matcher: ObligationMatcher = {
      score: async () => {
        throw new Error("offline");
      },
    };
    const result = await rankShortlist(invoice, shortlist, matcher);
    expect(result.fallback).toBe(true);
    expect(result.matches.map((match) => match.score)).toEqual(
      result.matches.map((match) => match.deterministicScore),
    );
  });
});
