/**
 * Category mapping for Budget vs Actual.
 *
 * Budget lines are named with taxonomy v2 category names, so a v2
 * `categoryName` resolves by identity in BudgetVsActual's resolve(). This
 * module only supplies the ALIASES that still have to land on a budget line:
 *
 *   - legacy category names (2025 bank data is never rewritten, and budget
 *     lines written before the migration), via the taxonomy's legacy map
 *   - the 2025 P&L sheet codes (EGR-* / ING-*)
 *   - a few stray spellings the sheet used (Gestión, Telefonos, Nómina,
 *     Gasolina, Alquiler)
 *
 * Both maps are derived, never hand-maintained: a category renamed in the
 * taxonomy renames here for free.
 */
import { EXPENSE_CATEGORY_NAMES, INCOME_CATEGORY_NAMES, LEGACY_CATEGORY_MAP, categoryByName } from '../../finance/taxonomy';

/** 2025 sheet codes and stray spellings → v2 name (expense side). */
const EXPENSE_ALIASES = {
  'EGR-ADM': 'Otros administrativos',
  'EGR-CXP': 'Subcontratas',
  'EGR-GES': 'Asesoría y gestoría',
  Gestión: 'Asesoría y gestoría',
  'EGR-SUB': 'Subcontratas',
  'EGR-SRV': 'Subcontratas',
  'EGR-MO': 'Salarios',
  Nómina: 'Salarios',
  Nomina: 'Salarios',
  'EGR-ARR': 'Alojamiento trabajadores',
  Alquiler: 'Alojamiento trabajadores',
  'EGR-SEG': 'Seguridad social',
  'EGR-TRN': 'Cuotas y alquiler de vehículos',
  'EGR-GAS': 'Combustible',
  Gasolina: 'Combustible',
  'EGR-MAT': 'Materiales',
  'EGR-FIN': 'Intereses y comisiones bancarias',
  'EGR-IMP': 'IVA',
  'EGR-EQP': 'Equipos y herramienta',
  'EGR-HERR': 'Equipos y herramienta',
  'EGR-OTR': 'Otros administrativos',
  Telefonos: 'Oficina, telefonía y software',
  // "Otros" existed on both sides; on the expense side it is administrative.
  Otros: 'Otros administrativos',
};

/** 2025 sheet codes → v2 name (income side). */
const INCOME_ALIASES = {
  'ING-FAC': 'Facturación obra',
  'ING-SRV': 'Facturación obra',
  'ING-OTR': 'Servicios particulares',
  Otros: 'Otros ingresos',
};

const buildMapping = (names, aliases) => {
  const mapping = Object.fromEntries(names.map((name) => [name, []]));
  const add = (alias, target) => {
    if (!mapping[target]) return; // target belongs to the other side
    if (!mapping[target].includes(alias)) mapping[target].push(alias);
  };
  Object.entries(LEGACY_CATEGORY_MAP).forEach(([legacy, target]) => add(legacy, target));
  Object.entries(aliases).forEach(([alias, target]) => {
    if (!categoryByName(target)) throw new Error(`categoryMapping: unknown target "${target}"`);
    add(alias, target);
  });
  return mapping;
};

/** budget (v2) expense name → aliases that resolve to it. */
export const CATEGORY_MAPPING = buildMapping(EXPENSE_CATEGORY_NAMES, EXPENSE_ALIASES);

/** budget (v2) income name → aliases that resolve to it. Separate to avoid key collision. */
export const INCOME_CATEGORY_MAPPING = buildMapping(INCOME_CATEGORY_NAMES, INCOME_ALIASES);

const reverse = (mapping) => {
  const map = new Map();
  for (const [budgetCat, aliases] of Object.entries(mapping)) {
    for (const alias of aliases) map.set(alias, budgetCat);
  }
  return map;
};

/**
 * Reverse lookup maps (direction-aware)
 * txToBudgetMap: expense alias → budget category
 * incToBudgetMap: income alias → budget category
 *
 * Identity mappings (budget line name = v2 category name) are handled by the
 * resolve() function's identity check, so they do not appear here.
 */
export const txToBudgetMap = reverse(CATEGORY_MAPPING);
export const incToBudgetMap = reverse(INCOME_CATEGORY_MAPPING);
