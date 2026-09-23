import type { InvoiceInput, ObligationCandidate } from "./ranking.js";

const API_ROOT = "https://firestore.googleapis.com/v1";
const MAX_PAGES = 20;
const PAGE_SIZE = 100;
type FirestoreValue = Record<string, unknown>;
type DecodedValue =
  | null
  | string
  | number
  | boolean
  | DecodedValue[]
  | { [key: string]: DecodedValue };
interface FirestoreDocument {
  name?: unknown;
  fields?: Record<string, FirestoreValue>;
}
interface FirestoreList {
  documents?: FirestoreDocument[];
  nextPageToken?: unknown;
}

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const booleanValue = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;
const numericValue = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const fromFirestoreValue = (
  value: FirestoreValue,
): DecodedValue | undefined => {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return stringValue(value.stringValue);
  if ("booleanValue" in value) return booleanValue(value.booleanValue);
  if ("integerValue" in value) return numericValue(value.integerValue);
  if ("doubleValue" in value) return numericValue(value.doubleValue);
  if ("timestampValue" in value) return stringValue(value.timestampValue);
  if ("referenceValue" in value) return stringValue(value.referenceValue);
  if ("bytesValue" in value) return stringValue(value.bytesValue);
  if ("arrayValue" in value) {
    const array = value.arrayValue as { values?: FirestoreValue[] };
    return (array?.values || [])
      .map(fromFirestoreValue)
      .filter((entry): entry is DecodedValue => entry !== undefined);
  }
  if ("mapValue" in value) {
    const map = value.mapValue as { fields?: Record<string, FirestoreValue> };
    return decodeFields(map?.fields || {});
  }
  return undefined;
};
const decodeFields = (
  fields: Record<string, FirestoreValue>,
): Record<string, DecodedValue> =>
  Object.fromEntries(
    Object.entries(fields).flatMap(([key, value]) => {
      const decoded = fromFirestoreValue(value);
      return decoded === undefined ? [] : [[key, decoded]];
    }),
  );
const text = (...values: unknown[]): string => {
  const found = values.find(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  return typeof found === "string" ? found.trim() : "";
};
const number = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
};
const documentId = (name: unknown): string =>
  typeof name === "string"
    ? decodeURIComponent(name.split("/").at(-1) || "")
    : "";
const baseUrl = (projectId: string): string =>
  `${API_ROOT}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
const getJson = async (
  url: string,
  token: string,
  fetcher: typeof fetch,
): Promise<unknown> => {
  const response = await fetcher(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Firestore request failed");
  return response.json();
};

export const readRegistry = async (
  projectId: string,
  uid: string,
  token: string,
  fetcher: typeof fetch,
): Promise<Record<string, unknown> | undefined> => {
  const result = (await getJson(
    `${baseUrl(projectId)}/users/${encodeURIComponent(uid)}`,
    token,
    fetcher,
  )) as FirestoreDocument;
  return result.fields ? decodeFields(result.fields) : undefined;
};

export const readObligations = async (
  projectId: string,
  appId: string,
  family: InvoiceInput["family"],
  token: string,
  fetcher: typeof fetch,
): Promise<ObligationCandidate[]> => {
  const collection = family === "payable" ? "payables" : "receivables";
  const path = `artifacts/${encodeURIComponent(appId)}/public/data/${collection}`;
  const documents: FirestoreDocument[] = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) query.set("pageToken", pageToken);
    const result = (await getJson(
      `${baseUrl(projectId)}/${path}?${query}`,
      token,
      fetcher,
    )) as FirestoreList;
    if (Array.isArray(result.documents)) documents.push(...result.documents);
    pageToken =
      typeof result.nextPageToken === "string" ? result.nextPageToken : "";
    if (!pageToken) break;
    if (page === MAX_PAGES - 1)
      throw new Error("Firestore pagination limit exceeded");
  }
  return documents.map((document) => {
    const data = decodeFields(document.fields || {});
    const explicitSource = text(data.sourceSystem);
    const legacySource = text(data.source);
    return {
      id: documentId(document.name),
      family,
      sourceSystem:
        explicitSource ||
        (legacySource === "insyte" || legacySource === "lumen"
          ? legacySource
          : "ordinary"),
      counterpartyName: text(data.counterpartyName, data.vendor, data.client),
      documentNumber: text(
        data.documentNumber,
        data.invoiceNumber,
        data.numeroPresupuesto,
      ),
      grossAmount: number(
        data.grossAmount,
        data.amount,
        data.importePedido,
        data.importePresupuesto,
      ),
      openAmount: number(data.openAmount, data.pendingAmount),
      issueDate: text(data.issueDate, data.date, data.fechaPresupuesto),
      dueDate: text(data.dueDate),
      status: text(data.status),
    };
  });
};
