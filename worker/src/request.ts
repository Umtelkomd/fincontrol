import type { InvoiceInput } from "./ranking.js";
export class RequestValidationError extends Error {}
const optionalText = (
  value: unknown,
  maxLength: number,
): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > maxLength)
    throw new RequestValidationError();
  return value.trim();
};
export const parseRankingRequest = (value: unknown): InvoiceInput => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestValidationError();
  const input = value as Record<string, unknown>;
  if (input.family !== "payable" && input.family !== "receivable")
    throw new RequestValidationError();
  const counterpartyName = optionalText(input.counterpartyName, 200);
  if (!counterpartyName) throw new RequestValidationError();
  const sourceSystem = optionalText(input.sourceSystem, 50) || "ordinary";
  const invoiceNumber = optionalText(input.invoiceNumber, 100);
  const issueDate = optionalText(input.issueDate, 10);
  if (issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(issueDate))
    throw new RequestValidationError();
  let grossAmount: number | undefined;
  if (
    input.grossAmount !== undefined &&
    input.grossAmount !== null &&
    input.grossAmount !== ""
  ) {
    grossAmount = Number(input.grossAmount);
    if (!Number.isFinite(grossAmount) || grossAmount < 0)
      throw new RequestValidationError();
  }
  return {
    family: input.family,
    sourceSystem,
    counterpartyName,
    invoiceNumber,
    grossAmount,
    issueDate,
  };
};
