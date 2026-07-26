/**
 * Seed Classification Rules
 * ─────────────────────────────────
 * Starter catalog of auto-classification rules for the counterparties that
 * actually dominate the UMTELKOMD ledger. Every one of them is structural
 * spend — taxes, health insurance, fuel, vehicle leasing, telecom, supplies,
 * payment processing, bank fees and the tax advisor — so all of them are
 * seeded with `costScope: 'overhead'` and never carry a project.
 *
 *   SEED_CLASSIFICATION_RULES        → array of rule definitions
 *   seedRuleToDoc(rule, userEmail)   → Firestore document shape
 *
 * Priority is deliberately below the 100 default used by
 * classificationRuleDefaults(): any rule a human creates by hand outranks a
 * seeded one when both match the same movement.
 *
 * This module is a pure catalog — it never touches Firestore. Writing the
 * documents is the caller's job (see useClassificationRules.createRule).
 * `name` and `notes` stay in Spanish because they are rendered verbatim in
 * the rules UI.
 */

import {
  RULE_DIRECTIONS,
  RULE_FIELDS,
  RULE_MATCH_TYPES,
} from './assetSchemas.js';
import { COST_SCOPE, isCostScope } from './costScope.js';

/** Seeds rank below classificationRuleDefaults().priority (100). */
export const SEED_RULE_PRIORITY = 50;

/**
 * Shorthand builder — every seed shares the same skeleton: an outbound
 * counterparty `contains` match that assigns a category and marks the cost
 * as structural.
 */
const overheadSeed = (name, pattern, categoryName, notes) => ({
  name,
  field: 'counterpartyName',
  matchType: 'contains',
  pattern,
  direction: 'out',
  amountMin: null,
  amountMax: null,
  applyTo: {
    categoryName,
    costCenterId: '',
    projectId: '',
    projectName: '',
    costScope: COST_SCOPE.OVERHEAD,
  },
  active: true,
  priority: SEED_RULE_PRIORITY,
  notes,
});

export const SEED_CLASSIFICATION_RULES = [
  overheadSeed(
    'Finanzkasse Stralsund — Impuestos',
    'FINANZKASSE STRALSUND',
    'Impuestos',
    'Pagos a la hacienda alemana (IVA, Lohnsteuer). Mayor contraparte de gasto: ~259.016 €.',
  ),
  // Distinct from the Finanzkasse above: the Finanzamt is the assessing office
  // and pays out/collects on its own account, so it needs its own pattern.
  overheadSeed(
    'Finanzamt Stralsund — Impuestos',
    'FINANZAMT STRALSUND',
    'Impuestos',
    'Liquidaciones de la oficina tributaria. ~91.989 € en el histórico.',
  ),
  // The DATEV import writes this counterparty as "AOK Rheinland/Hamburg",
  // so the pattern stops before the slash to match both spellings.
  overheadSeed(
    'AOK Rheinland/Hamburg — Seguridad social',
    'AOK RHEINLAND',
    'Seguros',
    'Krankenkasse: aportes de seguridad social de la plantilla.',
  ),
  overheadSeed(
    'BARMER — Seguridad social',
    'BARMER',
    'Seguros',
    'Segunda Krankenkasse de la plantilla. ~112.147 € en el histórico.',
  ),
  overheadSeed(
    'Hauptzollamt Stralsund — Impuestos',
    'HAUPTZOLLAMT',
    'Impuestos',
    'Aduana principal: impuestos especiales y control de Mindestlohn.',
  ),
  overheadSeed(
    'Union Tank Eckstein — Combustible',
    'UNION TANK ECKSTEIN',
    'Combustible',
    'Tarjetas UTA de combustible de la flota. Estructura, no obra.',
  ),
  overheadSeed(
    'RCI Banque — Leasing vehículos',
    'RCI BANQUE',
    'Cuotas vehiculos',
    'Cuotas de leasing/financiación de vehículos.',
  ),
  overheadSeed(
    'Telefónica Germany — Telefonía',
    'TELEFONICA GERMANY',
    'Facturas Telefonos',
    'Líneas móviles y datos de la empresa (O2).',
  ),
  overheadSeed(
    'Telefónica Insurance — Telefonía',
    'TELEFONICA INSURANCE',
    'Facturas Telefonos',
    'Seguro de terminales facturado junto al contrato de telefonía.',
  ),
  overheadSeed(
    'Amazon Payments Europe — Suministros',
    'AMAZON PAYMENTS EUROPE',
    'Miscelaneos Oficina',
    'Compras de oficina y consumibles vía Amazon.',
  ),
  overheadSeed(
    'Amazon EU — Suministros',
    'AMAZON EU',
    'Miscelaneos Oficina',
    'Compras de oficina y consumibles facturadas por Amazon EU.',
  ),
  overheadSeed(
    'Adyen — Procesador de pagos',
    'ADYEN',
    'Administrativo',
    'Cargos del procesador de pagos. No existe categoría de comisiones: va a Administrativo.',
  ),
  overheadSeed(
    'Volksbank Vorpommern — Comisiones bancarias',
    'VOLKSBANK VORPOMMERN',
    'Intereses Bancos',
    'Comisiones y cargos financieros del banco.',
  ),
  overheadSeed(
    'Kinder und Partner — Asesoría',
    'KINDER UND PARTNER',
    'Administrativo',
    'Honorarios de la gestoría/Steuerberater.',
  ),
];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const oneOf = (allowed, value, fallback) => (allowed.includes(value) ? value : fallback);

const numberOrNull = (value) => {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const priorityOf = (value) => {
  const parsed = Number(value);
  const resolved = Number.isFinite(parsed) ? parsed : 100;
  return Math.max(0, Math.floor(resolved || 100));
};

/**
 * seedRuleToDoc — turn one catalog entry into the exact document shape that
 * useClassificationRules.createRule writes to
 * artifacts/{appId}/public/data/classificationRules.
 *
 * The hook stamps createdAt/updatedAt with Firestore's serverTimestamp();
 * this module must stay Firebase-free, so it writes ISO strings instead.
 * `now` is injectable to keep the output deterministic in tests.
 */
export const seedRuleToDoc = (rule, userEmail, now = new Date()) => {
  const seed = rule || {};
  const applyTo = seed.applyTo || {};
  const timestamp = now instanceof Date ? now.toISOString() : String(now);

  return {
    name: text(seed.name),
    field: oneOf(RULE_FIELDS, seed.field, 'counterpartyName'),
    matchType: oneOf(RULE_MATCH_TYPES, seed.matchType, 'contains'),
    pattern: text(seed.pattern),
    direction: oneOf(RULE_DIRECTIONS, seed.direction, 'both'),
    amountMin: numberOrNull(seed.amountMin),
    amountMax: numberOrNull(seed.amountMax),
    applyTo: {
      categoryName: text(applyTo.categoryName),
      costCenterId: text(applyTo.costCenterId),
      projectId: text(applyTo.projectId),
      projectName: text(applyTo.projectName),
      costScope: isCostScope(applyTo.costScope) ? applyTo.costScope : '',
    },
    active: seed.active !== false,
    priority: priorityOf(seed.priority),
    notes: text(seed.notes),
    hits: 0,
    lastHitAt: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: userEmail || '',
  };
};

export default SEED_CLASSIFICATION_RULES;
