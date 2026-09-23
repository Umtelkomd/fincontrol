import { auth } from '../../../services/firebase';

const ALLOWED_FIELDS = [
  'family',
  'sourceSystem',
  'counterpartyName',
  'invoiceNumber',
  'grossAmount',
  'issueDate',
];

const isValidMatch = (match) =>
  match &&
  typeof match === 'object' &&
  typeof match.recordId === 'string' &&
  match.recordId.trim() !== '' &&
  Number.isFinite(match.score) &&
  match.score >= 0 &&
  match.score <= 1;

export const normalizeObligationMatchResponse = (value) => {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.fallback !== 'boolean' ||
    !Array.isArray(value.matches)
  ) {
    throw new Error('Invalid obligation ranking response');
  }
  if (!value.matches.every(isValidMatch))
    throw new Error('Invalid obligation ranking response');

  const seen = new Set();
  const matches = [];
  for (const match of value.matches) {
    if (seen.has(match.recordId))
      throw new Error('Invalid obligation ranking response');
    seen.add(match.recordId);
    matches.push({
      recordId: match.recordId,
      score: match.score,
      ...(Number.isFinite(match.deterministicScore)
        ? { deterministicScore: match.deterministicScore }
        : {}),
    });
    if (matches.length === 5) break;
  }
  return { fallback: value.fallback, matches };
};

/** Calls the provider-neutral Worker with bounded invoice metadata only. */
export const rankInvoiceObligations = async (invoice) => {
  const endpoint = import.meta.env.VITE_OBLIGATION_MATCHER_URL?.trim();
  if (!endpoint) throw new Error('Obligation matcher endpoint is unavailable');
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication is required');
  const token = await user.getIdToken();
  if (!token) throw new Error('Authentication is required');

  const payload = Object.fromEntries(
    ALLOWED_FIELDS.map((field) => [field, invoice?.[field]]),
  );
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Obligation ranking is unavailable');
  return normalizeObligationMatchResponse(await response.json());
};
