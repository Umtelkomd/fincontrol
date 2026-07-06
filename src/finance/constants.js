export const MAIN_ACCOUNT_ID = 'main';
export const DEFAULT_CURRENCY = 'EUR';

export const DOCUMENT_STAGE = {
  ISSUED: 'issued',
  PARTIAL: 'partial',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
};

export const DOCUMENT_STATUS = {
  ISSUED: 'issued',
  PARTIAL: 'partial',
  SETTLED: 'settled',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
};

export const MOVEMENT_STATUS = {
  POSTED: 'posted',
  VOID: 'void',
};

export const MOVEMENT_KIND = {
  COLLECTION: 'collection',
  PAYMENT: 'payment',
  ADJUSTMENT: 'adjustment',
  LEGACY_COLLECTION: 'legacy-collection',
  LEGACY_PAYMENT: 'legacy-payment',
};

export const TREASURY_LOOKAHEAD_DAYS = 14;
export const TREASURY_PROJECTION_WEEKS = 8;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/**
 * OPERATIONAL_DATA_START — ISO date marking the boundary between static 2025
 * historical data (bundled in src/data/transactions2025.js) and live Firestore
 * operational data. Any date >= this value comes from Firestore; anything before
 * it comes from the static 2025 dataset. Do NOT make this dynamic — it is a
 * deliberate data-architecture boundary, not a UI preference.
 */
export const OPERATIONAL_DATA_START = '2026-01-01';

/**
 * LEDGER_OPENING_DATE — fallback opening date for the main bank account when the
 * settings doc lacks `balanceDate`. Every cash engine MUST use this same value:
 * divergent fallbacks (e.g. "today") make the ledger and the bank-account widget
 * disagree about which movements count toward the current balance.
 */
export const LEDGER_OPENING_DATE = '2025-12-31';
