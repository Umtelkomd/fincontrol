import type {
  InvoiceInput,
  MatcherScore,
  ObligationMatcher,
  ShortlistedObligation,
} from "./ranking.js";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
interface Options {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}
const structuredCandidate = (candidate: ShortlistedObligation) => ({
  candidateId: candidate.id,
  counterpartyName: candidate.counterpartyName,
  documentNumber: candidate.documentNumber || "",
  grossAmount: candidate.grossAmount ?? null,
  issueDate: candidate.issueDate || "",
  dueDate: candidate.dueDate || "",
  status: candidate.status || "",
  deterministicScore: candidate.deterministicScore,
});

export class JevObligationMatcher implements ObligationMatcher {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  constructor(
    private readonly apiKey: string,
    options: Options = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }
  async score(
    invoice: InvoiceInput,
    candidates: readonly ShortlistedObligation[],
  ): Promise<MatcherScore[]> {
    if (!this.apiKey) throw new Error("Provider unavailable");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const questionKeys = candidates.map((_, index) => `candidate_${index}`);
      const response = await this.fetcher(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state: {
            task: "Score how likely each obligation is the existing accounting record for this invoice.",
            invoice: {
              family: invoice.family,
              sourceSystem: invoice.sourceSystem,
              counterpartyName: invoice.counterpartyName,
              invoiceNumber: invoice.invoiceNumber || "",
              grossAmount: invoice.grossAmount ?? null,
              issueDate: invoice.issueDate || "",
            },
            candidates: candidates.map(structuredCandidate),
          },
          model: "jev-latest",
          questions: Object.fromEntries(
            questionKeys.map((key, index) => [
              key,
              {
                type: "noul",
                instructions: `Determine whether state.candidates[${index}] is the same accounting obligation as state.invoice.`,
                criteria: {
                  true: "The records represent the same underlying accounting obligation.",
                  false:
                    "The candidate is merely similar, related, or a different accounting obligation.",
                },
              },
            ]),
          ),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Provider request failed");
      const payload = (await response.json()) as { answers?: unknown };
      if (
        !payload.answers ||
        typeof payload.answers !== "object" ||
        Array.isArray(payload.answers)
      ) {
        throw new Error("Provider response invalid");
      }
      const answers = payload.answers as Record<string, unknown>;
      if (
        Object.keys(answers).length !== questionKeys.length ||
        questionKeys.some((key) => !Object.hasOwn(answers, key))
      ) {
        throw new Error("Provider response invalid");
      }
      return questionKeys.map((key, index) => {
        const answer = answers[key] as { type?: unknown; noul?: unknown };
        if (
          answer.type !== "noul" ||
          typeof answer.noul !== "number" ||
          !Number.isFinite(answer.noul) ||
          answer.noul < 0 ||
          answer.noul > 1
        ) {
          throw new Error("Provider response invalid");
        }
        return { candidateId: candidates[index].id, score: answer.noul };
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
