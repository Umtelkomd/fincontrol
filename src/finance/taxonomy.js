/**
 * Category taxonomy v2 — the single source of truth for what a movement,
 * invoice or budget line can be called.
 *
 * Nine groups, twenty-nine categories, approved 2026-09-02. The flat lists it
 * replaced (`Cuotas vehiculos` / `Alquiler vehiculo` / `Vehiculos`, `Otros` in
 * both directions, `Impuestos` holding VAT, wage tax and customs) grew by
 * free-form editing in Configuración; the catalogue is versioned now and only
 * changes here.
 *
 *   TAXONOMY                 → ordered [{ id, name, group, type, defaultScope }]
 *   CATEGORY_GROUPS          → ordered [{ id, label }] for reports
 *   categoryByName(name)     → entry | null  (v2 names only)
 *   groupOfCategory(name)    → group id | null (legacy names roll up too)
 *   resolveLegacyCategory()  → v2 name for a legacy name, decided from the
 *                              movement when the legacy name was a catch-all
 *   categoryOptions()        → dropdown rows with group labels
 *
 * `name` is what is STORED on documents (`categoryName` stays a free string);
 * `id` is a stable ASCII slug so a future rename never touches data.
 *
 * Pure: no React, no Firebase, no Date. The migration script and the app both
 * import this file, so they agree by construction.
 */

export const TAXONOMY_VERSION = 2;

export const CATEGORY_TYPE = Object.freeze({
  INCOME: 'income',
  EXPENSE: 'expense',
  INTERNAL: 'internal',
});

/** Group order is report order. `interno` never enters the P&L. */
export const CATEGORY_GROUPS = Object.freeze(
  [
    { id: 'ingresos', label: 'Ingresos' },
    { id: 'personal', label: 'Personal' },
    { id: 'subcontratas', label: 'Subcontratas' },
    { id: 'obra', label: 'Obra' },
    { id: 'vehiculos', label: 'Vehículos' },
    { id: 'estructura', label: 'Estructura' },
    { id: 'impuestos', label: 'Impuestos' },
    { id: 'financiero', label: 'Financiero' },
    { id: 'interno', label: 'Interno' },
  ].map(Object.freeze),
);

const category = (id, name, group, type, defaultScope = '') =>
  Object.freeze({ id, name, group, type, defaultScope });

export const TAXONOMY = Object.freeze([
  // ── Ingresos ──────────────────────────────────────────────────────────────
  category('facturacion-obra', 'Facturación obra', 'ingresos', 'income'),
  category('servicios-particulares', 'Servicios particulares', 'ingresos', 'income'),
  category('devoluciones-financieros', 'Devoluciones e ingresos financieros', 'ingresos', 'income'),
  category('otros-ingresos', 'Otros ingresos', 'ingresos', 'income'),
  // ── Personal ──────────────────────────────────────────────────────────────
  category('salarios', 'Salarios', 'personal', 'expense', 'overhead'),
  category('seguridad-social', 'Seguridad social', 'personal', 'expense', 'overhead'),
  category('impuesto-nomina', 'Impuesto de nómina', 'personal', 'expense', 'overhead'),
  category('alojamiento', 'Alojamiento trabajadores', 'personal', 'expense', 'project'),
  category('otros-personal', 'Otros de personal', 'personal', 'expense', 'overhead'),
  // ── Subcontratas ──────────────────────────────────────────────────────────
  category('subcontratas', 'Subcontratas', 'subcontratas', 'expense', 'project'),
  // ── Obra ──────────────────────────────────────────────────────────────────
  category('materiales', 'Materiales', 'obra', 'expense', 'project'),
  category('equipos', 'Equipos y herramienta', 'obra', 'expense', 'project'),
  category('reparaciones', 'Reparaciones', 'obra', 'expense', 'project'),
  category('danos-terceros', 'Daños a terceros', 'obra', 'expense', 'project'),
  // ── Vehículos ─────────────────────────────────────────────────────────────
  category('combustible', 'Combustible', 'vehiculos', 'expense', 'overhead'),
  category('cuotas-alquiler-vehiculos', 'Cuotas y alquiler de vehículos', 'vehiculos', 'expense', 'overhead'),
  category('mantenimiento-vehiculos', 'Mantenimiento, seguro e impuesto de vehículos', 'vehiculos', 'expense', 'overhead'),
  // ── Estructura ────────────────────────────────────────────────────────────
  category('asesoria', 'Asesoría y gestoría', 'estructura', 'expense', 'overhead'),
  category('oficina', 'Oficina, telefonía y software', 'estructura', 'expense', 'overhead'),
  category('seguros-empresa', 'Seguros de empresa', 'estructura', 'expense', 'overhead'),
  category('tarjeta-corporativa', 'Tarjeta corporativa', 'estructura', 'expense', 'overhead'),
  category('otros-administrativos', 'Otros administrativos', 'estructura', 'expense', 'overhead'),
  // ── Impuestos (pass-through: shown, kept out of operating spend) ──────────
  category('iva', 'IVA', 'impuestos', 'expense', 'overhead'),
  category('impuesto-beneficios', 'Impuesto sobre beneficios', 'impuestos', 'expense', 'overhead'),
  // ── Financiero ────────────────────────────────────────────────────────────
  category('intereses-comisiones', 'Intereses y comisiones bancarias', 'financiero', 'expense', 'overhead'),
  category('amortizacion-prestamos', 'Amortización de préstamos', 'financiero', 'expense', 'overhead'),
  category('intereses-socios', 'Intereses de préstamos de socios', 'financiero', 'expense', 'overhead'),
  category('aportes-socios', 'Aportes y préstamos de socios recibidos', 'financiero', 'income'),
  // ── Interno ───────────────────────────────────────────────────────────────
  category('transferencia-interna', 'Transferencia interna', 'interno', 'internal'),
]);

const namesOfType = (type) => Object.freeze(TAXONOMY.filter((c) => c.type === type).map((c) => c.name));

export const EXPENSE_CATEGORY_NAMES = namesOfType(CATEGORY_TYPE.EXPENSE);
export const INCOME_CATEGORY_NAMES = namesOfType(CATEGORY_TYPE.INCOME);
export const INTERNAL_CATEGORY_NAMES = namesOfType(CATEGORY_TYPE.INTERNAL);

const GROUP_LABELS = new Map(CATEGORY_GROUPS.map((group) => [group.id, group.label]));

/** Lookup key: trimmed, lower-cased, accent-stripped. Data carries typos. */
const keyOf = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const BY_KEY = new Map(TAXONOMY.map((entry) => [keyOf(entry.name), entry]));
const BY_ID = new Map(TAXONOMY.map((entry) => [entry.id, entry]));

const nameOf = (id) => BY_ID.get(id).name;

/**
 * Find a v2 category by name. Whitespace, case and accents are forgiven;
 * legacy names are NOT — use `resolveLegacyCategory` for those.
 */
export const categoryByName = (name) => {
  const key = keyOf(name);
  if (!key) return null;
  return BY_KEY.get(key) || null;
};

/** Category entry for a v2 name, or null. */
export const categoryById = (id) => BY_ID.get(id) || null;

/**
 * §2a — legacy name → v2 name for every name whose target does not depend on
 * the movement. The four catch-alls (Seguros, Impuestos, Administrativo,
 * Intereses Bancos) carry their "otherwise" target here and are split per
 * movement by `resolveLegacyCategory`. "Otros" is deliberately absent: it
 * exists in both directions and is resolved by direction or document type.
 */
export const LEGACY_CATEGORY_MAP = Object.freeze({
  Subcontratos: nameOf('subcontratas'),
  'Factura CXP': nameOf('subcontratas'),
  Vivienda: nameOf('alojamiento'),
  'Transporte/Combustible': nameOf('combustible'),
  'Cuotas vehiculos': nameOf('cuotas-alquiler-vehiculos'),
  'Alquiler vehiculo': nameOf('cuotas-alquiler-vehiculos'),
  Vehiculos: nameOf('cuotas-alquiler-vehiculos'),
  'Impuestos Vehiculos': nameOf('mantenimiento-vehiculos'),
  'Inpuestos Vehiculos': nameOf('mantenimiento-vehiculos'),
  Equipos: nameOf('equipos'),
  'Equipos Alquileres': nameOf('equipos'),
  'Facturas Telefonos': nameOf('oficina'),
  'Miscelaneos Oficina': nameOf('oficina'),
  'Intereses prestamos': nameOf('intereses-socios'),
  Servicios: nameOf('facturacion-obra'),
  'Ingresos Servicios': nameOf('facturacion-obra'),
  SP: nameOf('servicios-particulares'),
  'Factura CXC': nameOf('servicios-particulares'),
  'Por Venta': nameOf('otros-ingresos'),
  Consultoria: nameOf('otros-ingresos'),
  Consultoría: nameOf('otros-ingresos'),
  Financiero: nameOf('devoluciones-financieros'),
  // Split categories — default branch of §2b.
  Seguros: nameOf('seguridad-social'),
  Impuestos: nameOf('iva'),
  Administrativo: nameOf('otros-administrativos'),
  'Intereses Bancos': nameOf('intereses-comisiones'),
});

const LEGACY_BY_KEY = new Map(Object.entries(LEGACY_CATEGORY_MAP).map(([legacy, next]) => [keyOf(legacy), next]));

const LEGACY_OTROS_KEY = keyOf('Otros');

const isIncomeContext = ({ direction, type }) => {
  if (direction === 'in') return true;
  if (direction === 'out') return false;
  if (type === 'income') return true;
  if (type === 'expense') return false;
  return null;
};

const resolveOtros = (context) => {
  const income = isIncomeContext(context);
  if (income === null) return null;
  return income ? nameOf('otros-ingresos') : nameOf('otros-administrativos');
};

// ── §2b split rules ─────────────────────────────────────────────────────────
// Every pattern is tested case-insensitively against the raw counterparty /
// description. Order inside a split is significance order: first match wins.

const COMPANY_INSURERS = /n[üu]e?rnberger|gothaer|telefonica insurance/i;
const HEALTH_INSURERS = /\baok\b|barmer|techniker|tui bkk|\bbkk\b|\bikk\b|\bdak\b|krankenkasse|bg etem/i;
const TAX_OFFICES = /finanzkasse|finanzamt/i;
const REFUND_BODIES = /finanzkasse|finanzamt|hauptzollamt|\bamt\b/i;
const WAGE_TAX = /lohnst/i;
const PROFIT_TAX = /gewst|gewerbest|k[öo]e?rpersch|\bkst\b/i;
const VEHICLE_TAX = /kfz[- ]?steuer/i;
const BOUNCED_DEBIT = /return\/refund|retoure sepa|lastschriftwiderspruch/i;
const REFUND = /erstatt|stornierung/i;
const PERSONNEL_REFUND = /erstattung nach aag|stornierung beitragsfestsetzung/i;
const CARD_SETTLEMENT = /visa|kreditkarte/i;

const splitSeguros = ({ counterpartyName }) =>
  COMPANY_INSURERS.test(counterpartyName) ? nameOf('seguros-empresa') : nameOf('seguridad-social');

const splitImpuestos = ({ counterpartyName, description }) => {
  if (WAGE_TAX.test(description)) return nameOf('impuesto-nomina');
  if (/hauptzollamt/i.test(counterpartyName)) return nameOf('seguridad-social');
  if (PROFIT_TAX.test(description)) return nameOf('impuesto-beneficios');
  if (VEHICLE_TAX.test(description)) return nameOf('mantenimiento-vehiculos');
  return nameOf('iva');
};

const splitAdministrativo = ({ counterpartyName, description }) => {
  if (/kinder und partner|schomerus|steuerberat|datev eg/i.test(counterpartyName)) return nameOf('asesoria');
  if (/kreditkartenkto|firmenkarte/i.test(counterpartyName)) return nameOf('tarjeta-corporativa');
  if (/arbeitsschutzhelden|engelbert strauss/i.test(counterpartyName)) return nameOf('otros-personal');
  if (/adyen/i.test(counterpartyName) && /\bobi\b/i.test(description)) return nameOf('materiales');
  return nameOf('otros-administrativos');
};

const splitInteresesBancos = ({ counterpartyName, description }) => {
  if (/zinsen darleh/i.test(description) || /romero lesmes|lesmes sandoval/i.test(counterpartyName)) {
    return nameOf('intereses-socios');
  }
  if (CARD_SETTLEMENT.test(description)) return nameOf('tarjeta-corporativa');
  return nameOf('intereses-comisiones');
};

const SPLIT_RESOLVERS = new Map([
  [keyOf('Seguros'), splitSeguros],
  [keyOf('Impuestos'), splitImpuestos],
  [keyOf('Administrativo'), splitAdministrativo],
  [keyOf('Intereses Bancos'), splitInteresesBancos],
]);

/**
 * §2c — inbound money from a tax office or a Krankenkasse is either a bounced
 * direct debit (undoes a payment → same bucket as the payment) or a refund
 * (financial income), except the two Krankenkasse reimbursements that reduce
 * personnel cost. Returns null when no refund rule applies.
 */
const resolveRefund = ({ direction, counterpartyName, description }) => {
  if (direction !== 'in') return null;
  if (BOUNCED_DEBIT.test(description)) {
    if (TAX_OFFICES.test(counterpartyName)) {
      return WAGE_TAX.test(description) ? nameOf('impuesto-nomina') : nameOf('iva');
    }
    if (HEALTH_INSURERS.test(counterpartyName)) return nameOf('seguridad-social');
  }
  if (!REFUND.test(description)) return null;
  if (HEALTH_INSURERS.test(counterpartyName)) {
    return PERSONNEL_REFUND.test(description) ? nameOf('seguridad-social') : nameOf('devoluciones-financieros');
  }
  if (REFUND_BODIES.test(counterpartyName)) return nameOf('devoluciones-financieros');
  return null;
};

const text = (value) => (typeof value === 'string' ? value : '');

/**
 * The v2 name a legacy category resolves to for THIS movement / document.
 *
 *   - a v2 name comes back unchanged (idempotent — the migration can re-run)
 *   - "Otros" is decided by `direction`, else by `type` (income | expense)
 *   - the four catch-alls are split by counterparty / description (§2b)
 *   - inbound refunds and reversals follow §2c before anything else
 *   - anything unknown → null (the caller decides what to do with it)
 *
 * @param {{ categoryName?: string, direction?: 'in'|'out'|'', type?: 'income'|'expense'|'',
 *           counterpartyName?: string, description?: string }} [input]
 * @returns {string|null}
 */
export const resolveLegacyCategory = (input = {}) => {
  const source = input || {};
  const current = categoryByName(source.categoryName);
  if (current) return current.name;

  const key = keyOf(source.categoryName);
  if (!key) return null;
  const isLegacy = LEGACY_BY_KEY.has(key) || key === LEGACY_OTROS_KEY;
  if (!isLegacy) return null;

  const context = {
    direction: source.direction,
    type: source.type,
    counterpartyName: text(source.counterpartyName),
    description: text(source.description),
  };

  const refund = resolveRefund(context);
  if (refund) return refund;

  if (key === LEGACY_OTROS_KEY) return resolveOtros(context);

  const split = SPLIT_RESOLVERS.get(key);
  if (split) return split(context);

  return LEGACY_BY_KEY.get(key) || null;
};

/**
 * Group id of a category name — v2 or legacy. Legacy names roll up through
 * the legacy map so 2025 data (never rewritten) still lands in a group.
 * "Otros" needs `{ direction }` or `{ type }` to pick a side.
 *
 * @param {string} name
 * @param {{ direction?: string, type?: string }} [context]
 * @returns {string|null}
 */
export const groupOfCategory = (name, context = {}) => {
  const resolved = resolveLegacyCategory({ ...(context || {}), categoryName: name });
  const entry = resolved ? categoryByName(resolved) : null;
  return entry ? entry.group : null;
};

/**
 * Dropdown rows: `{ name, type, group, groupLabel }` in taxonomy order. A new
 * array every call so a screen can filter or sort it freely.
 */
export const categoryOptions = () =>
  TAXONOMY.map((entry) => ({
    name: entry.name,
    type: entry.type,
    group: entry.group,
    groupLabel: GROUP_LABELS.get(entry.group) || entry.group,
  }));

export default TAXONOMY;
