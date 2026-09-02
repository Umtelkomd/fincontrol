/**
 * VAT (Umsatzsteuer) rates per category — the boundary between what the bank
 * moved and what a project actually cost.
 *
 * Three layers, three different numbers:
 *   - Cash / reconciliation / forecast → GROSS. The bank moves gross; nothing
 *     here may touch it.
 *   - Project cost / budget / margin  → NET. Input VAT (Vorsteuer) is reclaimed
 *     from the tax office, so it is not a project cost.
 *   - The VAT itself                  → a separate obligation, tracked in
 *     `settings/treasury` (monthly Voranmeldung), not derived here.
 *
 * The Volksbank statement this app imports (`kontobewegungen_export.csv`) has no
 * VAT column — 0 of 400 production rows mention MwSt/USt — so an imported
 * movement never carries a rate of its own. Defaulting that unknown to 19% once
 * invented 317.274 € of VAT across the ledger, including on taxes, statutory
 * insurance and salaries, none of which carry German VAT. An unknown rate is
 * therefore 0, and is reported as `unset` so the UI can say "nobody decided this
 * yet" instead of silently claiming "no VAT".
 */
import { computeNetFromGross, computeTaxFromGross } from '../utils/formatters';
import { resolveLegacyCategory } from './taxonomy';

/** Where a resolved rate came from, most specific first. */
export const VAT_RATE_SOURCE = {
  MOVEMENT: 'movement',
  DOCUMENT: 'document',
  CATEGORY: 'category',
  UNSET: 'unset',
};

/**
 * Seed rates for the categories German law does not debate:
 * payments to the tax office, statutory insurance, financial services under
 * §4 Nr. 8/10 UStG and wages carry no VAT.
 *
 * Everything else is deliberately ABSENT rather than guessed. Subcontratas in
 * particular hinges on whether the subcontractors invoice under §13b UStG
 * (Steuerschuldnerschaft des Leistungsempfängers) — a question only the owner
 * can answer, and getting it wrong shifts project cost by 19%.
 *
 * Keys are taxonomy v2 names (`src/finance/taxonomy.js`). A movement that still
 * carries a legacy name (2025 data is never rewritten) is resolved through the
 * taxonomy before the lookup, so `Impuestos` still finds the `IVA` rate.
 */
export const DEFAULT_CATEGORY_VAT_RATES = Object.freeze({
  Salarios: 0,
  'Seguridad social': 0,
  'Impuesto de nómina': 0,
  IVA: 0,
  'Impuesto sobre beneficios': 0,
  'Intereses y comisiones bancarias': 0,
  'Amortización de préstamos': 0,
  'Intereses de préstamos de socios': 0,
  'Aportes y préstamos de socios recibidos': 0,
  'Devoluciones e ingresos financieros': 0,
  'Transferencia interna': 0,
  'Tarjeta corporativa': 0,
});

/**
 * A VAT rate is a finite number in [0, 1] — 0.19, never 19. Strings are refused
 * on purpose: `Number('')` is 0, so coercing here would turn an emptied input
 * into a silent "no VAT".
 */
export const isValidVatRate = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * The rate a record actually has stored, or null.
 *
 * The adapters in `src/finance/adapters.js` materialize `taxRate` on every
 * record, defaulting to 0 when the source document has none. Reading that
 * default as an explicit 0 would shadow the category rate for every imported
 * movement, so when the raw source document is attached it is the only
 * authority on what was set.
 */
const storedRateOf = (record) => {
  if (!record || typeof record !== 'object') return null;
  const source = record.raw && typeof record.raw === 'object' ? record.raw : record;
  const stored = source.taxRate;
  // `Number(null)` and `Number('')` are both 0 — an absent field must not read
  // back as an explicit "no VAT".
  if (stored === null || stored === undefined || stored === '') return null;
  const rate = Number(stored);
  return isValidVatRate(rate) ? rate : null;
};

/**
 * Keys to try in `categoryRates`, most literal first: the name as stored on
 * the record, then the taxonomy v2 name it resolves to. A rate map written
 * before the taxonomy migration is keyed by legacy names and must keep
 * working; one written after it is keyed by v2 names and must serve the 2025
 * movements that still carry the legacy spelling.
 */
const categoryKeysOf = (record) => {
  const name = record?.categoryName || record?.category || '';
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return [];
  const resolved = resolveLegacyCategory({ categoryName: trimmed, direction: record?.direction });
  return resolved && resolved !== trimmed ? [trimmed, resolved] : [trimmed];
};

/**
 * Resolve the VAT rate that applies to a bank movement.
 *
 * Order, most specific first: an explicit rate on the movement → the rate on the
 * linked CXC/CXP document → the category default → unset (0).
 *
 * @param {{ movement?: object, linkedDocument?: object, categoryRates?: Record<string, number> }} [input]
 * @returns {{ rate: number, source: 'movement'|'document'|'category'|'unset' }}
 */
export const resolveVatRate = ({ movement, linkedDocument, categoryRates } = {}) => {
  const movementRate = storedRateOf(movement);
  if (movementRate != null) return { rate: movementRate, source: VAT_RATE_SOURCE.MOVEMENT };

  const documentRate = storedRateOf(linkedDocument);
  if (documentRate != null) return { rate: documentRate, source: VAT_RATE_SOURCE.DOCUMENT };

  for (const key of categoryKeysOf(movement)) {
    if (isValidVatRate(categoryRates?.[key])) {
      return { rate: categoryRates[key], source: VAT_RATE_SOURCE.CATEGORY };
    }
  }

  return { rate: 0, source: VAT_RATE_SOURCE.UNSET };
};

const usableGross = (gross) => {
  const value = Number(gross);
  return Number.isFinite(value) ? value : 0;
};

/**
 * Net amount behind a gross figure at an explicit rate.
 * `computeNetFromGross` still defaults a nullish rate to 19% for backwards
 * compatibility, so the rate is always passed explicitly and an unusable one
 * collapses to 0 (net = gross) rather than inventing VAT.
 */
export const netFromGross = (gross, rate) =>
  computeNetFromGross(usableGross(gross), isValidVatRate(rate) ? rate : 0);

/** VAT contained in a gross figure at an explicit rate. See `netFromGross`. */
export const vatFromGross = (gross, rate) =>
  computeTaxFromGross(usableGross(gross), isValidVatRate(rate) ? rate : 0);

/**
 * Build a `movement → net amount` function bound to one rate map and the
 * CXC/CXP documents movements can be reconciled against.
 *
 * Project cost and budget actuals both need exactly this, and both need the same
 * answer for the same movement, so the lookup lives here rather than being
 * re-derived per screen.
 *
 * @param {{ categoryRates?: Record<string, number>, documents?: object[] }} [input]
 *   `documents` is the flat list of receivables and payables to link against.
 * @returns {(movement: object) => number}
 */
export const createNetAmountResolver = ({ categoryRates, documents = [] } = {}) => {
  const byId = new Map();
  (Array.isArray(documents) ? documents : []).forEach((entry) => {
    if (entry?.id) byId.set(entry.id, entry);
  });

  return (movement) => {
    const linkedDocument =
      byId.get(movement?.payableId) || byId.get(movement?.receivableId) || null;
    const { rate } = resolveVatRate({ movement, linkedDocument, categoryRates });
    return netFromGross(movement?.amount, rate);
  };
};

/**
 * Categories with no usable rate configured — the list the settings screen nags
 * about, because an unset rate silently means "no VAT". Duplicates are collapsed
 * (`Otros` exists in both the expense and the income list) and first-seen order
 * is preserved.
 *
 * @param {string[]} categories
 * @param {Record<string, number>} categoryRates
 * @returns {string[]}
 */
export const categoriesMissingVatRate = (categories = [], categoryRates = {}) => {
  const seen = new Set();
  const missing = [];

  (Array.isArray(categories) ? categories : []).forEach((entry) => {
    const name = typeof entry === 'string' ? entry.trim() : '';
    if (!name || seen.has(name)) return;
    seen.add(name);
    if (!isValidVatRate(categoryRates?.[name])) missing.push(name);
  });

  return missing;
};
