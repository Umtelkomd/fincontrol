export type ObligationFamily = "payable" | "receivable";
export interface InvoiceInput {
  family: ObligationFamily;
  sourceSystem: string;
  counterpartyName: string;
  invoiceNumber?: string;
  grossAmount?: number;
  issueDate?: string;
}
export interface ObligationCandidate {
  id: string;
  family: ObligationFamily;
  sourceSystem?: string;
  counterpartyName: string;
  documentNumber?: string;
  grossAmount?: number;
  openAmount?: number;
  issueDate?: string;
  dueDate?: string;
  status?: string;
}
export interface ShortlistedObligation extends ObligationCandidate {
  deterministicScore: number;
}
export interface MatcherScore {
  candidateId: string;
  score: number;
}
export interface ObligationMatcher {
  score(
    invoice: InvoiceInput,
    candidates: readonly ShortlistedObligation[],
  ): Promise<MatcherScore[]>;
}
export interface ObligationMatch {
  recordId: string;
  score: number;
  deterministicScore: number;
}
export interface RankingResponse {
  matches: ObligationMatch[];
  fallback: boolean;
}

export const PROVIDER_SHORTLIST_LIMIT = 20;
export const RESULT_LIMIT = 5;

const normalizeText = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/\b(gmbh|ag|ug|kg|mbh|ltd|limited|inc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
const compactText = (value: unknown): string =>
  normalizeText(value).replace(/\s/g, "");
const bigrams = (value: string): string[] =>
  value.length < 2
    ? value
      ? [value]
      : []
    : Array.from({ length: value.length - 1 }, (_, index) =>
        value.slice(index, index + 2),
      );
const similarity = (left: unknown, right: unknown): number => {
  const a = compactText(left);
  const b = compactText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const rightPairs = bigrams(b);
  let intersections = 0;
  for (const pair of bigrams(a)) {
    const index = rightPairs.indexOf(pair);
    if (index >= 0) {
      intersections += 1;
      rightPairs.splice(index, 1);
    }
  }
  return (2 * intersections) / (bigrams(a).length + bigrams(b).length);
};
const validDate = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value))
    return null;
  const milliseconds = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(milliseconds) ? milliseconds : null;
};
const amount = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const deterministicScore = (
  invoice: InvoiceInput,
  candidate: ObligationCandidate,
): number => {
  const counterparty = similarity(
    invoice.counterpartyName,
    candidate.counterpartyName,
  );
  const invoiceNumber = compactText(invoice.invoiceNumber);
  const documentNumber = compactText(candidate.documentNumber);
  const document =
    invoiceNumber && documentNumber
      ? invoiceNumber === documentNumber
        ? 1
        : similarity(invoiceNumber, documentNumber)
      : 0;
  const invoiceAmount = amount(invoice.grossAmount);
  const candidateAmount = amount(candidate.grossAmount);
  const amountScore =
    invoiceAmount !== null && candidateAmount !== null
      ? Math.max(
          0,
          1 -
            Math.abs(invoiceAmount - candidateAmount) /
              Math.max(invoiceAmount, candidateAmount, 1),
        )
      : 0;
  const invoiceDate = validDate(invoice.issueDate);
  const dates = [
    validDate(candidate.issueDate),
    validDate(candidate.dueDate),
  ].filter((value): value is number => value !== null);
  const date =
    invoiceDate !== null && dates.length
      ? Math.max(
          ...dates.map((value) =>
            Math.max(0, 1 - Math.abs(value - invoiceDate) / (180 * 86_400_000)),
          ),
        )
      : 0;
  return Number(
    (
      counterparty * 0.4 +
      document * 0.25 +
      amountScore * 0.25 +
      date * 0.1
    ).toFixed(6),
  );
};

export const prefilterObligations = (
  invoice: InvoiceInput,
  candidates: readonly ObligationCandidate[],
  limit = PROVIDER_SHORTLIST_LIMIT,
): ShortlistedObligation[] =>
  candidates
    .filter(
      (candidate) =>
        candidate.family === invoice.family &&
        (candidate.sourceSystem || "ordinary") ===
          (invoice.sourceSystem || "ordinary") &&
        typeof candidate.id === "string" &&
        candidate.id.trim() !== "" &&
        normalizeText(candidate.counterpartyName) !== "" &&
        candidate.status !== "cancelled",
    )
    .map((candidate) => ({
      ...candidate,
      deterministicScore: deterministicScore(invoice, candidate),
    }))
    .sort(
      (left, right) =>
        right.deterministicScore - left.deterministicScore ||
        left.id.localeCompare(right.id),
    )
    .slice(0, Math.max(0, limit));

const fallbackResponse = (
  shortlist: readonly ShortlistedObligation[],
): RankingResponse => ({
  fallback: true,
  matches: shortlist.slice(0, RESULT_LIMIT).map((candidate) => ({
    recordId: candidate.id,
    score: candidate.deterministicScore,
    deterministicScore: candidate.deterministicScore,
  })),
});
export const rankShortlist = async (
  invoice: InvoiceInput,
  shortlist: readonly ShortlistedObligation[],
  matcher: ObligationMatcher,
): Promise<RankingResponse> => {
  if (!shortlist.length) return { matches: [], fallback: false };
  try {
    const scores = await matcher.score(invoice, shortlist);
    if (scores.length !== shortlist.length) return fallbackResponse(shortlist);
    const byId = new Map<string, number>();
    for (const result of scores) {
      if (
        !shortlist.some(({ id }) => id === result.candidateId) ||
        byId.has(result.candidateId) ||
        !Number.isFinite(result.score) ||
        result.score < 0 ||
        result.score > 1
      )
        return fallbackResponse(shortlist);
      byId.set(result.candidateId, result.score);
    }
    return {
      fallback: false,
      matches: shortlist
        .map((candidate) => ({
          recordId: candidate.id,
          score: byId.get(candidate.id)!,
          deterministicScore: candidate.deterministicScore,
        }))
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.deterministicScore - left.deterministicScore ||
            left.recordId.localeCompare(right.recordId),
        )
        .slice(0, RESULT_LIMIT),
    };
  } catch {
    return fallbackResponse(shortlist);
  }
};
