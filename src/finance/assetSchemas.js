/**
 * Asset & RecurringCost Schemas
 * ─────────────────────────────────
 * Source of truth for the NEXUS.OS asset-management model.
 *
 *   employees      — payroll-bearing people (UMTELKOMD GmbH staff)
 *   properties     — properties: rented or owned (housing, offices)
 *   vehicles       — vehicles: owned, leased, rented
 *   recurringCosts — repeating cost rules attached to any of the above
 *                    (or 'general' when no asset applies)
 *
 * Each recurring cost generates payable instances on a fixed schedule.
 * Payable generation is handled by the generation service (separate),
 * NOT in these schemas.
 */

// ═══════════════════════════════════════════════════════════
// Employees
// ═══════════════════════════════════════════════════════════

export const EMPLOYEE_TYPES = ['internal', 'external', 'contractor'];
export const EMPLOYEE_STATUSES = ['active', 'on-leave', 'inactive'];

// German payroll tax classes
export const TAX_CLASSES = ['1', '2', '3', '4', '5', '6', '4 rk', '4 Faktor 1.0'];

// Health insurance providers seen in real data
export const KRANKENKASSEN = [
  'BARMER',
  'AOK Rheinland/Hamburg',
  'Techniker Krankenkasse',
  'BKK TUI',
  'Other',
];

export const employeeDefaults = () => ({
  fullName: '',
  firstName: '',
  lastName: '',
  persNr: '', // DATEV Personnel number — joins payroll lines to this employee
  aliases: [],
  type: 'internal',
  status: 'active',
  projectIds: [],
  role: '',
  defaultCostCenter: '',

  // Identity & contact
  email: '',
  phone: '',
  startDate: '',
  endDate: '',

  // Payroll specifics (German)
  iban: '',
  bic: '',
  taxClass: '',
  krankenkasse: '',
  bruttoMonthly: 0, // Salario bruto mensual €
  nettoMonthly: 0, // Salario neto al empleado €
  lstKistMonthly: 0, // Lohnsteuer + Kirchensteuer €
  svAnMonthly: 0, // Seguridad social Arbeitnehmer €
  svAgMonthly: 0, // Seguridad social Arbeitgeber €
  gesamtkostenMonthly: 0, // Costo total empresa €

  notes: '',
});

// ═══════════════════════════════════════════════════════════
// Properties
// ═══════════════════════════════════════════════════════════

export const PROPERTY_TYPES = ['rented', 'owned', 'mixed'];
export const PROPERTY_USES = ['housing', 'office', 'storage', 'mixed'];

export const propertyDefaults = () => ({
  name: '', // Friendly name: "Apto Bassendorf"
  address: '',
  city: '',
  postalCode: '',
  type: 'rented',
  use: 'housing',
  m2: 0,
  bedrooms: 0,
  status: 'active',
  startDate: '',
  endDate: '',
  landlordOrOwner: '', // Counterparty name
  defaultCostCenter: '',
  projectIds: [],
  notes: '',
});

// ═══════════════════════════════════════════════════════════
// Vehicles
// ═══════════════════════════════════════════════════════════

export const VEHICLE_TYPES = ['owned', 'leased', 'rented'];
export const VEHICLE_STATUSES = ['active', 'maintenance', 'inactive'];

export const vehicleDefaults = () => ({
  name: '', // Friendly: "Trafic 9", "Opel Combo"
  model: '',
  plate: '',
  type: 'owned',
  status: 'active',
  initialKm: 0,
  currentKm: 0,
  leaseStart: '',
  leaseEnd: '',
  assignedDriver: '', // Employee fullName or external
  fuelBudgetMonthly: 0, // Reference budget €
  defaultCostCenter: '',
  projectIds: [],
  notes: '',
});

// ═══════════════════════════════════════════════════════════
// Insurances
// ═══════════════════════════════════════════════════════════

export const INSURANCE_TYPES = [
  'haftpflicht', // Responsabilidad civil
  'kasko', // Vehículo (todo riesgo)
  'business', // Seguro empresa / Betriebshaftpflicht
  'health', // Salud / Krankenversicherung extra
  'life', // Vida
  'property', // Edificio / Inhaltversicherung
  'equipment', // Equipos / herramientas
  'liability', // Profesional
  'other',
];

export const INSURANCE_STATUSES = ['active', 'expired', 'cancelled'];

export const insuranceDefaults = () => ({
  name: '', // Friendly: "Haftpflicht UMTELKOMD GmbH"
  type: 'business',
  insurer: '', // Counterparty / aseguradora
  policyNumber: '',
  coverageAmount: 0, // Monto de cobertura €
  premiumAnnual: 0, // Prima anual € (referencia, real va en recurringCosts)
  startDate: '',
  endDate: '',
  renewalDate: '', // Próxima renovación
  status: 'active',
  // Optional cross-reference to another asset (e.g. seguro kasko de un vehículo).
  // Vacío si el seguro no está atado a un asset específico.
  linkedAssetType: '', // vehicle | property | employee | ''
  linkedAssetId: '',
  defaultCostCenter: '',
  notes: '',
});

// ═══════════════════════════════════════════════════════════
// RecurringCosts
// ═══════════════════════════════════════════════════════════

export const COST_OWNER_TYPES = ['employee', 'property', 'vehicle', 'insurance', 'general'];

export const COST_FREQUENCIES = ['monthly', 'quarterly', 'yearly', 'biweekly', 'weekly'];

// Common concepts — UI hint, not enforced
export const COST_CONCEPTS = {
  employee: [
    'Salario neto',
    'Lohnsteuer + Kirchensteuer',
    'Seguro social — BARMER',
    'Seguro social — AOK Rheinland',
    'Seguro social — TK',
    'Seguro social — BKK TUI',
    'Bono',
    'Reembolso',
  ],
  property: ['Alquiler', 'Servicios (luz/agua/gas)', 'Internet/Telefon', 'Impuestos', 'Mantenimiento'],
  vehicle: [
    'Leasing',
    'Alquiler',
    'Seguro (Kasko)',
    'Seguro (Haftpflicht)',
    'TÜV / HU',
    'Combustible (presupuesto)',
    'Mantenimiento programado',
    'Impuesto vehicular (Kfz-Steuer)',
  ],
  insurance: [
    'Cuota mensual',
    'Cuota trimestral',
    'Cuota anual',
    'Renovación',
    'Franquicia',
  ],
  general: [
    'Subscripción software',
    'Gestoría',
    'Internet oficina',
    'Banco — comisiones',
    'Otros',
  ],
};

export const recurringCostDefaults = () => ({
  ownerType: 'general', // employee | property | vehicle | general
  ownerId: null, // null when ownerType === 'general'
  ownerName: '', // Cached display name (denormalized for UI speed)
  concept: '',
  counterpartyName: '', // Who gets paid: "Sixt", "BARMER", etc
  amount: 0,
  frequency: 'monthly',
  dayOfMonth: 1, // Day of month due (1..31). Use 31 for "last day"
  startDate: '', // YYYY-MM-DD when this rule starts producing instances
  endDate: '', // YYYY-MM-DD when it stops; empty = ongoing
  costCenterId: '',
  projectId: '',
  active: true,
  notes: '',
});

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

/**
 * Validate ownerId/ownerType pair:
 *   ownerType === 'general' → ownerId must be null
 *   otherwise → ownerId must be a non-empty string
 */
export const validateCostOwner = (ownerType, ownerId) => {
  if (!COST_OWNER_TYPES.includes(ownerType)) {
    return { valid: false, error: `Invalid ownerType: ${ownerType}` };
  }
  if (ownerType === 'general') {
    return ownerId == null
      ? { valid: true }
      : { valid: false, error: "ownerId must be null when ownerType is 'general'" };
  }
  return ownerId
    ? { valid: true }
    : { valid: false, error: `ownerId is required when ownerType is '${ownerType}'` };
};

/**
 * Compute the next due-date from a recurring rule.
 * Pass `from` ISO date (default: today) to compute the next occurrence at-or-after.
 */
export const computeNextDueDate = (rule, fromIso = null) => {
  const today = fromIso ? new Date(fromIso) : new Date();
  today.setHours(0, 0, 0, 0);

  const start = rule.startDate ? new Date(rule.startDate) : today;
  if (start > today) return rule.startDate || '';

  const dayOfMonth = Math.max(1, Math.min(31, Number(rule.dayOfMonth) || 1));

  switch (rule.frequency) {
    case 'monthly': {
      const candidate = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
      if (candidate < today) candidate.setMonth(candidate.getMonth() + 1);
      return candidate.toISOString().slice(0, 10);
    }
    case 'quarterly': {
      const candidate = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
      if (candidate < today) candidate.setMonth(candidate.getMonth() + 3);
      return candidate.toISOString().slice(0, 10);
    }
    case 'yearly': {
      const candidate = new Date(today.getFullYear(), 0, dayOfMonth);
      if (candidate < today) candidate.setFullYear(candidate.getFullYear() + 1);
      return candidate.toISOString().slice(0, 10);
    }
    case 'biweekly': {
      const candidate = new Date(start);
      while (candidate < today) candidate.setDate(candidate.getDate() + 14);
      return candidate.toISOString().slice(0, 10);
    }
    case 'weekly': {
      const candidate = new Date(start);
      while (candidate < today) candidate.setDate(candidate.getDate() + 7);
      return candidate.toISOString().slice(0, 10);
    }
    default:
      return today.toISOString().slice(0, 10);
  }
};

/**
 * Estimate the monthly equivalent of a recurring cost (for dashboard projections).
 */
export const monthlyEquivalent = (rule) => {
  const a = Number(rule.amount) || 0;
  switch (rule.frequency) {
    case 'monthly':
      return a;
    case 'biweekly':
      return a * 2.1666; // 26 occurrences / 12
    case 'weekly':
      return a * 4.3333; // 52 occurrences / 12
    case 'quarterly':
      return a / 3;
    case 'yearly':
      return a / 12;
    default:
      return a;
  }
};

// ═══════════════════════════════════════════════════════════
// Classification Rules — auto-classify bank movements
// ═══════════════════════════════════════════════════════════

export const RULE_MATCH_TYPES = ['contains', 'exact', 'startsWith', 'regex'];
export const RULE_DIRECTIONS = ['both', 'in', 'out'];
export const RULE_FIELDS = ['counterpartyName', 'description'];

export const classificationRuleDefaults = () => ({
  name: '',                  // Friendly label: "AOK Rheinland — Salud BARMER"
  field: 'counterpartyName', // Where to look: counterpartyName | description
  matchType: 'contains',     // contains | exact | startsWith | regex
  pattern: '',               // String/regex to match (case-insensitive)
  direction: 'both',         // both | in | out
  amountMin: null,           // Optional € threshold (null = ignore)
  amountMax: null,
  // Classification to apply when the rule matches
  applyTo: {
    categoryName: '',
    costCenterId: '',
    projectId: '',
    projectName: '',
  },
  active: true,
  priority: 100,             // Higher number = higher priority
  hits: 0,                   // Times this rule has been applied (incremented by engine)
  lastHitAt: '',             // ISO date of last application
  notes: '',
});
