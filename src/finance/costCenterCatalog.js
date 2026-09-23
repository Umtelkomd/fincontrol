/**
 * Cost center catalogue v2 — WHO/which unit is responsible for a euro.
 *
 * Production data mixed nature and responsibility freely: `CC-002..CC-009`,
 * `CC-NOM` plus free text (`Contratistas`, `Seguros`, `Gestorías`, `OPE`,
 * `Sin asignar`), while the code only declared five codes
 * (`src/constants/costCenters.js`, pre-v2). `costCenterId` was sometimes a
 * Firestore doc id, mostly a code or a label — not a reliable key.
 *
 * v2 fixes this with one ordered, frozen catalogue where the doc id EQUALS the
 * code, and a `kind` per entry:
 *   - `direct`   — obra work, tied to one of the six project lines (see
 *                  `src/finance/projectCode.js`); `costScope` derives to
 *                  `'project'`.
 *   - `indirect` — company structure; `costScope` derives to `'overhead'`.
 *   - `clearing` — payroll clearing (`CC-NOM`); the euro passes through here
 *                  before `allocatePayrollCost` spreads it across projects, so
 *                  it is neither obra cost nor plain overhead, but for
 *                  `costScope` purposes it reads as `'overhead'` too.
 *
 * `costScope` therefore stops being an independent field: it is DERIVED from
 * the cost center kind (see `scopeOfCostCenter`), never chosen freestanding.
 *
 * `resolveLegacyCostCenter` maps the old codes/labels to v2 codes. Five of them
 * (`CC-006..CC-009`, `Contratistas`) have no recorded meaning anywhere in the
 * repo — resolving them would be a guess, so they come back
 * `unresolved` and the migration script reports what is left instead of
 * inventing an answer. The one exception is by NAME: the migration can pass
 * the live Firestore doc's `name` as `liveName`, which is matched against the
 * same label table, so a doc stored as `CC-007` but named "NE4" still
 * resolves to `CC-120`.
 *
 * `resolveStoredCostCenter` sits on top for the callers that read a STORED
 * `costCenterId`, which in production may be any of four things: a v2 code, a
 * legacy code, a free-text label, or the Firestore doc id of a live (possibly
 * still legacy) cost-center doc. The migration planner and every screen that
 * filters by cost center share it, so they group a document identically.
 *
 * Pure: no React, no Firebase, no Date.now() — no I/O of any kind.
 */

import { COST_SCOPE } from './costScope.js';
import { categoryByName } from './taxonomy.js';

export const COST_CENTER_CATALOG_VERSION = 3;

export const COST_CENTER_KIND = Object.freeze({
  DIRECT: 'direct',
  INDIRECT: 'indirect',
  CLEARING: 'clearing',
});

const cc = (code, name, kind, line = '') => Object.freeze({ code, name, kind, line });

/** Report order === catalogue order === dropdown order. */
export const COST_CENTER_CATALOG = Object.freeze([
  // v3 (2026-09): the production lines as the owner runs them. Activaciones,
  // NAS, HBG and Reparaciones became their own centers; MDU folded into NE4
  // (CC-130 still resolves, to CC-120).
  cc('CC-100', 'Obra civil (Tiefbau)', COST_CENTER_KIND.DIRECT, 'TB'),
  cc('CC-110', 'Despliegue (soplado, DP y POP)', COST_CENTER_KIND.DIRECT, 'BL'),
  cc('CC-115', 'Activaciones (HÜP-GFTA-ONT)', COST_CENTER_KIND.DIRECT),
  cc('CC-120', 'NE4 (vivienda y MDU)', COST_CENTER_KIND.DIRECT, 'N4'),
  cc('CC-140', 'NAS (acometidas)', COST_CENTER_KIND.DIRECT),
  cc('CC-150', 'HBG (Hausbegehung)', COST_CENTER_KIND.DIRECT),
  cc('CC-160', 'Reparaciones y reclamaciones', COST_CENTER_KIND.DIRECT),
  cc('CC-190', 'Dirección de obra y Aufmaß', COST_CENTER_KIND.DIRECT, 'SV'),
  cc('CC-200', 'Flota y vehículos', COST_CENTER_KIND.INDIRECT),
  cc('CC-210', 'Equipos, almacén y herramienta', COST_CENTER_KIND.INDIRECT),
  cc('CC-220', 'Alojamientos (pool sin obra)', COST_CENTER_KIND.INDIRECT),
  cc('CC-300', 'Administración y finanzas', COST_CENTER_KIND.INDIRECT),
  cc('CC-310', 'Dirección general', COST_CENTER_KIND.INDIRECT),
  cc('CC-320', 'Personas: reclutamiento y formación', COST_CENTER_KIND.INDIRECT),
  cc('CC-330', 'Oficina, IT y telefonía', COST_CENTER_KIND.INDIRECT),
  cc('CC-900', 'Fiscal y financiero', COST_CENTER_KIND.INDIRECT),
  cc('CC-NOM', 'Nómina y seguridad social', COST_CENTER_KIND.CLEARING),
]);

/** Lookup key: trimmed, upper-cased. Codes are ASCII, no accents to fold. */
const codeKeyOf = (value) => String(value ?? '').trim().toUpperCase();

/** Lookup key: trimmed, lower-cased, accent-stripped. Mirrors taxonomy.js. */
const labelKeyOf = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const BY_CODE = new Map(COST_CENTER_CATALOG.map((entry) => [codeKeyOf(entry.code), entry]));

/** Catalogue entry for a v2 code — case/whitespace tolerant. Null if unknown. */
export const costCenterByCode = (code) => BY_CODE.get(codeKeyOf(code)) || null;

/**
 * scopeOfCostCenter — the destination an outbound movement resolves to from
 * its cost center alone: `direct` → `'project'`, `indirect`/`clearing` →
 * `'overhead'`. Accepts a legacy code/label too (resolved with no `liveName`,
 * i.e. only the six unresolved ones fail). Unknown → `''`, never a guess.
 */
export const scopeOfCostCenter = (codeOrLegacy) => {
  let entry = costCenterByCode(codeOrLegacy);
  if (!entry) {
    const resolved = resolveLegacyCostCenter(codeOrLegacy);
    entry = resolved.code ? costCenterByCode(resolved.code) : null;
  }
  if (!entry) return '';
  return entry.kind === COST_CENTER_KIND.DIRECT ? COST_SCOPE.PROJECT : COST_SCOPE.OVERHEAD;
};

/** §Legacy resolution — code/label (accent/case-insensitive) → v2 code. */
const LEGACY_KEY_MAP = new Map(
  [
    ['CC-001', 'CC-100'],
    ['CC-002', 'CC-120'],
    ['CC-003', 'CC-120'],
    ['CC-004', 'CC-300'],
    ['CC-005', 'CC-110'],
    // v2 → v3: MDU folded into NE4.
    ['CC-130', 'CC-120'],
    ['MDU', 'CC-120'],
    ['Activaciones', 'CC-115'],
    ['NAS', 'CC-140'],
    ['HBG', 'CC-150'],
    ['Hausbegehung', 'CC-150'],
    ['Reparaciones', 'CC-160'],
    ['Obra Civil', 'CC-100'],
    ['Instalaciones y Reparaciones', 'CC-120'],
    ['NE4', 'CC-120'],
    ['Despliegue', 'CC-110'],
    ['Administrativo', 'CC-300'],
    ['Gestorías', 'CC-300'],
    ['Gestorias', 'CC-300'],
    ['Seguros', 'CC-300'],
    ['Financiero', 'CC-900'],
    ['Nómina y Seguridad Social', 'CC-NOM'],
    // The budget screen (BudgetVsActual.jsx) used to carry a dictionary of its
    // own (`LEGACY_CC_MAP`), naming a v1 label for each of these tokens: OPE →
    // "Despliegue", ADM → "Administrativo", LOG → "Instalaciones y
    // Reparaciones", FIN → "Financiero", VEN → "NE4", plus the CC- prefixed
    // spelling of each. That table is the only recorded evidence of what the
    // tokens mean, and every row of it carries the same standing — so all five
    // fold in here, each resolved through the label it named, rather than being
    // dropped when that screen stopped carrying them.
    ['OPE', 'CC-110'],
    ['CC-OPE', 'CC-110'],
    ['ADM', 'CC-300'],
    ['CC-ADM', 'CC-300'],
    ['LOG', 'CC-120'],
    ['CC-LOG', 'CC-120'],
    ['FIN', 'CC-900'],
    ['CC-FIN', 'CC-900'],
    ['VEN', 'CC-120'],
    ['CC-VEN', 'CC-120'],
  ].map(([legacy, code]) => [labelKeyOf(legacy), code]),
);

const EMPTY_KEY = labelKeyOf('Sin asignar');

/**
 * resolveLegacyCostCenter — v2 code for a legacy value, never a guess.
 *
 *   - '' / null / undefined / "Sin asignar"  → { code: '', status: 'empty' }
 *   - a current v2 code                      → { code: <same>, status: 'current' }
 *   - a mapped legacy code or label           → { code, status: 'mapped' }
 *   - unknown, with `liveName` resolving too  → { code, status: 'mapped' }
 *   - unknown otherwise (CC-006..CC-009,
 *     "Contratistas" and anything else)        → { code: '', status: 'unresolved' }
 *
 * @param {string} value the stored legacy costCenterId/label
 * @param {{ liveName?: string }} [options] the live Firestore doc's `name`,
 *   used only when `value` alone does not resolve (see module doc).
 */
export const resolveLegacyCostCenter = (value, { liveName } = {}) => {
  const key = labelKeyOf(value);
  if (!key || key === EMPTY_KEY) return { code: '', status: 'empty' };

  const current = costCenterByCode(value);
  if (current) return { code: current.code, status: 'current' };

  const mapped = LEGACY_KEY_MAP.get(key);
  if (mapped) return { code: mapped, status: 'mapped' };

  const nameKey = labelKeyOf(liveName);
  if (nameKey) {
    if (nameKey === EMPTY_KEY) return { code: '', status: 'empty' };
    const byName = LEGACY_KEY_MAP.get(nameKey);
    if (byName) return { code: byName, status: 'mapped' };
  }

  return { code: '', status: 'unresolved' };
};

/** The live cost-center doc a stored value is the Firestore doc id OF, or null. */
const liveCostCenterById = (value, liveCostCenters) => {
  const id = String(value ?? '').trim();
  if (!id || !Array.isArray(liveCostCenters)) return null;
  return liveCostCenters.find((entry) => entry && entry.id === id) || null;
};

/**
 * resolveStoredCostCenter — `resolveLegacyCostCenter` for a value read off a
 * document, where the value may also be the Firestore doc id of a live
 * cost-center doc. Try it as a code/label first; only a value that resolves to
 * nothing on its own falls back to that doc, through the doc's OWN code/name.
 *
 * @param {string} value the stored `costCenterId`
 * @param {Array<{id:string, code?:string, name?:string}>} [liveCostCenters]
 */
export const resolveStoredCostCenter = (value, liveCostCenters = []) => {
  const direct = resolveLegacyCostCenter(value);
  if (direct.status !== 'unresolved') return direct;
  const live = liveCostCenterById(value, liveCostCenters);
  if (!live) return direct;
  return resolveLegacyCostCenter(live.code || live.name, { liveName: live.name });
};

/**
 * Default indirect center by category id — used only when a movement has no
 * project. `materiales`, `reparaciones`, `danos-terceros` and `subcontratas`
 * are deliberately absent: they always require a project (a direct center),
 * so there is no indirect default to offer.
 */
const CATEGORY_DEFAULTS = Object.freeze({
  combustible: 'CC-200',
  'cuotas-alquiler-vehiculos': 'CC-200',
  'mantenimiento-vehiculos': 'CC-200',
  equipos: 'CC-210',
  alojamiento: 'CC-220',
  asesoria: 'CC-300',
  'seguros-empresa': 'CC-300',
  'tarjeta-corporativa': 'CC-300',
  'otros-administrativos': 'CC-300',
  oficina: 'CC-330',
  'otros-personal': 'CC-320',
  salarios: 'CC-NOM',
  'seguridad-social': 'CC-NOM',
  'impuesto-nomina': 'CC-NOM',
  iva: 'CC-900',
  'impuesto-beneficios': 'CC-900',
  'intereses-comisiones': 'CC-900',
  'amortizacion-prestamos': 'CC-900',
  'intereses-socios': 'CC-900',
});

/** Default indirect/clearing center for a v2 category name. '' if none or unknown. */
export const defaultCostCenterForCategory = (categoryName) => {
  const entry = categoryByName(categoryName);
  if (!entry) return '';
  return CATEGORY_DEFAULTS[entry.id] || '';
};

/** Default direct center for a project line code (TB/BL/N4/MD/SV/OH). '' if unknown. */
const LINE_DEFAULTS = Object.freeze({
  TB: 'CC-100',
  BL: 'CC-110',
  N4: 'CC-120',
  MD: 'CC-120',
  SV: 'CC-190',
  OH: 'CC-300',
});

export const defaultCostCenterForLine = (line) => LINE_DEFAULTS[codeKeyOf(line)] || '';

/** Dropdown rows in catalogue order. A new array every call. */
export const costCenterOptions = () =>
  COST_CENTER_CATALOG.map((entry) => ({
    value: entry.code,
    label: `${entry.code} · ${entry.name}`,
    kind: entry.kind,
  }));

/**
 * §Filtering by cost center — the group a stored value belongs to, and the
 * buckets a dropdown may offer. A filter dropdown and its predicate have to
 * compare the SAME thing, and the only thing every stored spelling can be
 * reduced to is a catalogue CODE: `CC-002`, "Instalaciones y Reparaciones",
 * a live doc id and `CC-120` are one bucket.
 */

/**
 * costCenterFilterKey — the bucket a stored `costCenterId` filters under: its
 * v2 code, or, when nothing resolves it, the value's OWN label as its own
 * legacy bucket (via the live doc's code when the value was a doc id, so both
 * spellings land together). Never a guessed v2 center: an unresolved value
 * stays visible and filterable under what it actually says. '' means the
 * document has no cost center at all.
 */
export const costCenterFilterKey = (value, liveCostCenters = []) => {
  const resolved = resolveStoredCostCenter(value, liveCostCenters);
  if (resolved.status === 'empty') return '';
  if (resolved.code) return resolved.code;
  const live = liveCostCenterById(value, liveCostCenters);
  return codeKeyOf(live?.code || live?.name || value);
};

/** Does a document stored under `value` belong to `selectedKey`? A blank selection is the "all centers" view. */
export const matchesCostCenterFilter = (value, selectedKey, liveCostCenters = []) => {
  const selected = codeKeyOf(selectedKey);
  if (!selected) return true;
  return costCenterFilterKey(value, liveCostCenters) === selected;
};

/**
 * costCenterFilterOptions — the v2 catalogue, plus one bucket per live
 * cost-center doc that resolves to no v2 code, so a center the operator can
 * pick today never disappears from the dropdown before the migration runs. A
 * doc that already resolves into the catalogue adds nothing (its documents
 * filter under the catalogue code), and an unassigned doc adds nothing either
 * (its documents read as having no center).
 */
export const costCenterFilterOptions = (liveCostCenters = []) => {
  const options = costCenterOptions();
  const seen = new Set(options.map((option) => option.value));

  for (const entry of Array.isArray(liveCostCenters) ? liveCostCenters : []) {
    if (!entry) continue;
    const resolved = resolveLegacyCostCenter(entry.code || entry.name || entry.id, { liveName: entry.name });
    if (resolved.status !== 'unresolved') continue;
    const value = codeKeyOf(entry.code || entry.name || entry.id);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: `${entry.code || entry.id} · ${entry.name || entry.code || entry.id}`,
      kind: 'unresolved',
    });
  }

  return options;
};

/**
 * validateCostCenterAssignment — the axiom behind the whole catalogue: a
 * direct (obra) center demands a project, an indirect/clearing one forbids
 * one. An unrecognized or empty `costCenterId` is valid HERE — whether a
 * center is required at all is the caller's call (see `costScope.js`'s
 * `validateClassification`).
 */
export const validateCostCenterAssignment = ({ costCenterId, projectId } = {}) => {
  const center = costCenterByCode(costCenterId);
  if (!center) return { valid: true, error: null };

  const hasProject = Boolean(String(projectId || '').trim());

  if (center.kind === COST_CENTER_KIND.DIRECT && !hasProject) {
    return { valid: false, error: 'Un centro de costo de obra requiere un proyecto' };
  }
  if (center.kind !== COST_CENTER_KIND.DIRECT && hasProject) {
    return { valid: false, error: 'Un gasto con proyecto debe ir a un centro de costo de obra' };
  }
  return { valid: true, error: null };
};
