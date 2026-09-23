import { describe, expect, it, vi } from "vitest";
import { JevObligationMatcher } from "./jevMatcher.js";
import type { InvoiceInput, ShortlistedObligation } from "./ranking.js";

const invoice: InvoiceInput = {
  family: "receivable",
  sourceSystem: "ordinary",
  counterpartyName: "Example AG",
  invoiceNumber: "INV-1",
  grossAmount: 500,
  issueDate: "2026-01-10",
};
const candidates: ShortlistedObligation[] = [
  {
    id: "r-1",
    family: "receivable",
    sourceSystem: "ordinary",
    counterpartyName: "Example AG",
    documentNumber: "INV-1",
    grossAmount: 500,
    issueDate: "2026-01-10",
    deterministicScore: 1,
  },
];

describe("JevObligationMatcher", () => {
  it("uses the official map-shaped System One Noul contract", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            answers: { candidate_0: { type: "noul", noul: 0.95 } },
          }),
          { status: 200 },
        );
      },
    ) as typeof fetch;
    const matcher = new JevObligationMatcher("secret", { fetcher });
    await expect(matcher.score(invoice, candidates)).resolves.toEqual([
      { candidateId: "r-1", score: 0.95 },
    ]);
    expect(capturedUrl).toBe("https://api.typesafe.ai/v1/systemone");
    const init = capturedInit as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret",
    );
    const body = JSON.parse(String(init.body));
    expect(body.questions).toEqual({
      candidate_0: {
        type: "noul",
        instructions:
          "Determine whether state.candidates[0] is the same accounting obligation as state.invoice.",
        criteria: {
          true: "The records represent the same underlying accounting obligation.",
          false:
            "The candidate is merely similar, related, or a different accounting obligation.",
        },
      },
    });
  });
});
