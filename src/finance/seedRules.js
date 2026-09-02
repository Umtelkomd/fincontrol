/**
 * Seed Classification Rules
 * ─────────────────────────────────
 * Starter catalog of auto-classification rules for the counterparties and
 * purpose lines that actually recur in the UMTELKOMD ledger. Targets are
 * taxonomy v2 names (`src/finance/taxonomy.js`); the cost scope of every
 * seed is the category's own `defaultScope`, so structure spend lands in
 * overhead and site spend (materials, lodging, damages) is stamped `project`
 * and waits for the Bandeja to name the obra — a seed never carries a project.
 *
 *   SEED_CLASSIFICATION_RULES        → array of rule definitions
 *   seedRuleToDoc(rule, userEmail)   → Firestore document shape
 *
 * Priorities (all below the 100 default of classificationRuleDefaults(), so a
 * hand-made rule always wins):
 *   SEED_DESCRIPTION_RULE_PRIORITY (70)  purpose-line rules — LOHNST, UMS.ST,
 *                                         VISA, Zinsen Darlehn… They must beat
 *                                         the counterparty rule for the same
 *                                         payee: the Finanzkasse collects wage
 *                                         tax AND VAT, the Volksbank charges
 *                                         fees AND settles the credit card.
 *   SEED_RULE_PRIORITY (50)              counterparty rules
 *   SEED_FALLBACK_RULE_PRIORITY (45)     catch-alls that must lose to any
 *                                         counterparty rule
 *
 * The 14 original seeds keep their `name` verbatim: the migration script and
 * the operator recognise them by it. Only their targets moved to v2 names.
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
import { isCostScope } from './costScope.js';
import { categoryByName } from './taxonomy.js';

/** Counterparty seeds rank below classificationRuleDefaults().priority (100). */
export const SEED_RULE_PRIORITY = 50;
/** Purpose-line seeds outrank counterparty seeds for the same payee. */
export const SEED_DESCRIPTION_RULE_PRIORITY = 70;
/** Description seeds that must beat other description seeds (more specific text). */
const SEED_SPECIFIC_DESCRIPTION_PRIORITY = 75;
/** Catch-alls that must lose to any counterparty seed. */
const SEED_FALLBACK_RULE_PRIORITY = 45;

const scopeOf = (categoryName) => {
  const category = categoryByName(categoryName);
  if (!category) throw new Error(`seedRules: unknown category "${categoryName}"`);
  return category.defaultScope;
};

/**
 * One seed. `costScope` is taken from the taxonomy — except for inbound-only
 * rules, where a cost destination is meaningless and stays ''; `direction`
 * defaults to outbound; `amountMax` / `amountMin` / `matchType` only when a
 * rule needs them.
 */
const seed = ({
  name,
  field = 'counterpartyName',
  matchType = 'contains',
  pattern,
  direction = 'out',
  categoryName,
  amountMin = null,
  amountMax = null,
  priority = SEED_RULE_PRIORITY,
  notes = '',
}) => ({
  name,
  field,
  matchType,
  pattern,
  direction,
  amountMin,
  amountMax,
  applyTo: {
    categoryName,
    costCenterId: '',
    projectId: '',
    projectName: '',
    costScope: direction === 'in' ? '' : scopeOf(categoryName),
  },
  active: true,
  priority,
  notes,
});

/** Outbound counterparty `contains` seed — the common case. */
const counterparty = (name, pattern, categoryName, notes, extra = {}) =>
  seed({ name, pattern, categoryName, notes, ...extra });

/** Purpose-line seed, outranking counterparty seeds by default. */
const description = (name, pattern, categoryName, notes, extra = {}) =>
  seed({ name, field: 'description', pattern, categoryName, notes, priority: SEED_DESCRIPTION_RULE_PRIORITY, ...extra });

export const SEED_CLASSIFICATION_RULES = [
  // ── Original catalog (names stable) ───────────────────────────────────────
  counterparty(
    'Finanzkasse Stralsund — Impuestos',
    'FINANZKASSE STRALSUND',
    'IVA',
    'Pagos a la hacienda alemana. Fallback: las reglas por concepto (LOHNST → Impuesto de nómina) van antes.',
  ),
  // Distinct from the Finanzkasse above: the Finanzamt is the assessing office
  // and pays out/collects on its own account, so it needs its own pattern.
  counterparty(
    'Finanzamt Stralsund — Impuestos',
    'FINANZAMT STRALSUND',
    'IVA',
    'Liquidaciones de la oficina tributaria. Fallback: GEWST / KÖRPERSCH van antes a Impuesto sobre beneficios.',
  ),
  // The DATEV import writes this counterparty as "AOK Rheinland/Hamburg",
  // so the pattern stops before the slash to match both spellings.
  counterparty(
    'AOK Rheinland/Hamburg — Seguridad social',
    'AOK RHEINLAND',
    'Seguridad social',
    'Krankenkasse: aportes de seguridad social de la plantilla.',
  ),
  counterparty(
    'BARMER — Seguridad social',
    'BARMER',
    'Seguridad social',
    'Segunda Krankenkasse de la plantilla.',
  ),
  counterparty(
    'Hauptzollamt Stralsund — Impuestos',
    'HAUPTZOLLAMT',
    'Seguridad social',
    'La aduana ejecuta los atrasos de Krankenkasse ("Bitte an BARMER zahlen"): es seguridad social, no impuesto.',
  ),
  counterparty(
    'Union Tank Eckstein — Combustible',
    'UNION TANK ECKSTEIN',
    'Combustible',
    'Tarjetas UTA de combustible de la flota. Estructura, no obra.',
  ),
  counterparty(
    'RCI Banque — Leasing vehículos',
    'RCI BANQUE',
    'Cuotas y alquiler de vehículos',
    'Cuotas de leasing/financiación de vehículos.',
  ),
  counterparty(
    'Telefónica Germany — Telefonía',
    'TELEFONICA GERMANY',
    'Oficina, telefonía y software',
    'Líneas móviles y datos de la empresa (O2).',
  ),
  counterparty(
    'Telefónica Insurance — Telefonía',
    'TELEFONICA INSURANCE',
    'Seguros de empresa',
    'Seguro de terminales facturado junto al contrato de telefonía: es una póliza, no telefonía.',
  ),
  counterparty(
    'Amazon Payments Europe — Suministros',
    'AMAZON PAYMENTS EUROPE',
    'Oficina, telefonía y software',
    'Compras de oficina y consumibles vía Amazon.',
  ),
  counterparty(
    'Amazon EU — Suministros',
    'AMAZON EU',
    'Oficina, telefonía y software',
    'Compras de oficina y consumibles facturadas por Amazon EU.',
  ),
  counterparty(
    'Adyen — Procesador de pagos',
    'ADYEN',
    'Materiales',
    'Adyen procesa las compras en OBI: material de obra. La Bandeja asigna el proyecto.',
  ),
  counterparty(
    'Volksbank Vorpommern — Comisiones bancarias',
    'VOLKSBANK VORPOMMERN',
    'Intereses y comisiones bancarias',
    'Comisiones y cargos financieros del banco. La liquidación VISA va antes a Tarjeta corporativa.',
  ),
  counterparty(
    'Kinder und Partner — Asesoría',
    'KINDER UND PARTNER',
    'Asesoría y gestoría',
    'Honorarios de la gestoría/Steuerberater.',
  ),

  // ── Impuestos por concepto (ganan a la contraparte) ───────────────────────
  description(
    'Lohnsteuer (LOHNST) — Impuesto de nómina',
    'LOHNST',
    'Impuesto de nómina',
    'Retención de IRPF de la plantilla pagada a la Finanzkasse. Coste de personal, no IVA.',
  ),
  description('Umsatzsteuer (UMS.ST) — IVA', 'UMS.ST', 'IVA', 'Liquidación mensual de IVA (Voranmeldung).'),
  description('Umsatzsteuer — IVA', 'Umsatzsteuer', 'IVA', 'Liquidación de IVA escrita en largo.'),
  description(
    'Steuernummer 8291210261040 — IVA',
    '8291210261040',
    'IVA',
    'Pagos parciales (Teilzahlung/Restzahlung) referenciados por el número de expediente de IVA.',
  ),
  description(
    'Umsatzsteuer auf Kontoabschluss — Intereses y comisiones bancarias',
    'Umsatzsteuer auf',
    'Intereses y comisiones bancarias',
    'IVA que el banco carga sobre sus propias comisiones: es parte de la comisión, no una liquidación.',
    { priority: SEED_SPECIFIC_DESCRIPTION_PRIORITY },
  ),
  description(
    'Gewerbesteuer (GEWST) — Impuesto sobre beneficios',
    'GEWST',
    'Impuesto sobre beneficios',
    'Impuesto municipal sobre la actividad.',
  ),
  description(
    'Körperschaftsteuer — Impuesto sobre beneficios',
    'k(ö|oe?)rpersch',
    'Impuesto sobre beneficios',
    'Impuesto de sociedades (con o sin diéresis).',
    { matchType: 'regex' },
  ),
  description(
    'Kfz-Steuer — Mantenimiento, seguro e impuesto de vehículos',
    'kfz[- ]?steuer',
    'Mantenimiento, seguro e impuesto de vehículos',
    'Impuesto de circulación (Bundeskasse).',
    { matchType: 'regex' },
  ),

  // ── Banco y tarjeta por concepto ──────────────────────────────────────────
  description(
    'VISA Abrechnung — Tarjeta corporativa',
    'VISA',
    'Tarjeta corporativa',
    'Liquidación mensual de la tarjeta de empresa cargada por el Volksbank.',
  ),
  description(
    'Zinsen Darlehen — Intereses de préstamos de socios',
    'Zinsen Darleh',
    'Intereses de préstamos de socios',
    'Intereses pagados a los socios por sus préstamos a la empresa.',
  ),
  description(
    'Kontoabschluss (ABSCHLUSS PER) — Intereses y comisiones bancarias',
    'ABSCHLUSS PER',
    'Intereses y comisiones bancarias',
    'Cierre trimestral de cuenta: comisiones e intereses. Llega sin contraparte.',
    { priority: SEED_RULE_PRIORITY },
  ),

  // ── Transferencias propias ────────────────────────────────────────────────
  counterparty(
    'UMTELKOMD GmbH — Transferencia interna',
    'UMTELKOMD GMBH',
    'Transferencia interna',
    'Movimiento entre cuentas propias. Ni ingreso ni gasto; queda fuera del P&L.',
    { direction: 'both' },
  ),
  description(
    'Interne Umbuchung — Transferencia interna',
    'interne Umbuchung',
    'Transferencia interna',
    'Traspaso interno indicado por el propio banco.',
    { direction: 'both', priority: SEED_RULE_PRIORITY },
  ),

  // ── Devoluciones y retrocesos (entradas) ──────────────────────────────────
  description(
    'Erstattung nach AAG — Seguridad social',
    'Erstattung nach AAG',
    'Seguridad social',
    'Reembolso de la Krankenkasse por baja/maternidad (AAG): reduce el coste de personal.',
    { direction: 'in', priority: SEED_SPECIFIC_DESCRIPTION_PRIORITY },
  ),
  description(
    'Stornierung Beitragsfestsetzung — Seguridad social',
    'STORNIERUNG BEITRAGSFESTSETZUNG',
    'Seguridad social',
    'Anulación de una liquidación de cuotas: reduce el coste de personal.',
    { direction: 'in', priority: SEED_SPECIFIC_DESCRIPTION_PRIORITY },
  ),
  description(
    'Erstattung (ERSTATT) — Devoluciones e ingresos financieros',
    'ERSTATT',
    'Devoluciones e ingresos financieros',
    'Devolución de Hacienda, Amt o Krankenkasse (Guthabenerstattung, ERSTATT UST…).',
    { direction: 'in' },
  ),
  description(
    'Lastschriftwiderspruch — IVA',
    'Lastschriftwiderspruch',
    'IVA',
    'Adeudo de la Finanzkasse devuelto: deshace el pago de IVA. Cualquier regla de contraparte gana.',
    { direction: 'in', priority: SEED_FALLBACK_RULE_PRIORITY },
  ),
  counterparty(
    'Hauptzollamt Stralsund — Devolución Seguridad social',
    'HAUPTZOLLAMT STRALSUND',
    'Seguridad social',
    'Ueberzahlung devuelta por la aduana: deshace un pago de seguridad social.',
    { direction: 'in' },
  ),

  // ── Seguridad social (Krankenkassen, BG) ──────────────────────────────────
  counterparty('Techniker Krankenkasse — Seguridad social', 'TECHNIKER KRANKENKASSE', 'Seguridad social', 'Krankenkasse de la plantilla.', { direction: 'both' }),
  counterparty('BKK — Seguridad social', '\\bbkk\\b', 'Seguridad social', 'Betriebskrankenkassen (TUI BKK, BKK firmus…).', { direction: 'both', matchType: 'regex' }),
  counterparty('BG ETEM — Seguridad social', 'BG ETEM', 'Seguridad social', 'Berufsgenossenschaft: seguro de accidentes obligatorio.', { direction: 'both' }),
  counterparty('IKK — Seguridad social', '\\bikk\\b', 'Seguridad social', 'Innungskrankenkasse.', { direction: 'both', matchType: 'regex' }),
  counterparty('DAK — Seguridad social', '\\bdak\\b', 'Seguridad social', 'DAK-Gesundheit.', { direction: 'both', matchType: 'regex' }),

  // ── Vehículos ─────────────────────────────────────────────────────────────
  counterparty('Kreis Lippe — Mantenimiento, seguro e impuesto de vehículos', 'KREIS LIPPE', 'Mantenimiento, seguro e impuesto de vehículos', 'Zulassung (matriculación) de vehículos.'),
  counterparty('Verti Versicherung — Mantenimiento, seguro e impuesto de vehículos', 'VERTI VERSICHERUNG', 'Mantenimiento, seguro e impuesto de vehículos', 'Seguro de vehículos.'),
  counterparty('KFZ-Kiss — Mantenimiento, seguro e impuesto de vehículos', 'KFZ-KISS', 'Mantenimiento, seguro e impuesto de vehículos', 'Taller / servicio de vehículos.'),
  counterparty('Renault Bank — Cuotas y alquiler de vehículos', 'RENAULT BANK', 'Cuotas y alquiler de vehículos', 'Financiación de vehículos.'),
  counterparty('Sixt — Cuotas y alquiler de vehículos', 'SIXT', 'Cuotas y alquiler de vehículos', 'Alquiler de vehículos.'),
  counterparty('Europcar — Cuotas y alquiler de vehículos', 'EUROPCAR', 'Cuotas y alquiler de vehículos', 'Alquiler de vehículos.'),
  counterparty('DZ Bank — Cuotas y alquiler de vehículos', 'DZ BANK', 'Cuotas y alquiler de vehículos', 'Leasing de vehículos.'),
  counterparty('ARAL — Combustible', 'ARAL', 'Combustible', 'Combustible.'),
  counterparty('Shell — Combustible', 'SHELL', 'Combustible', 'Combustible.'),
  counterparty('JET — Combustible', '\\bjet\\b', 'Combustible', 'Combustible (palabra completa: "Projekt" no cuenta).', { matchType: 'regex' }),
  counterparty('Tankstelle — Combustible', 'TANKSTELLE', 'Combustible', 'Gasolinera.'),
  counterparty('Tamoil — Combustible', 'TAMOIL', 'Combustible', 'Combustible.'),
  counterparty('HEM — Combustible', '\\bhem\\b', 'Combustible', 'Combustible (palabra completa).', { matchType: 'regex' }),
  counterparty('Esso — Combustible', '\\besso\\b', 'Combustible', 'Combustible (palabra completa).', { matchType: 'regex' }),
  counterparty('TotalEnergies — Combustible', 'TOTALENERGIES', 'Combustible', 'Combustible.'),

  // ── Obra: equipos y materiales (proyecto pendiente en la Bandeja) ─────────
  counterparty('HKL Baumaschinen — Equipos y herramienta', 'HKL BAUMASCHINEN', 'Equipos y herramienta', 'Alquiler de maquinaria de obra.'),
  counterparty('Boels — Equipos y herramienta', 'BOELS', 'Equipos y herramienta', 'Alquiler de maquinaria de obra.'),
  counterparty('Odenwälder Baumaschinen — Equipos y herramienta', 'odenw(ä|ae)lder baumaschinen', 'Equipos y herramienta', 'Alquiler de maquinaria de obra.', { matchType: 'regex' }),
  counterparty('Lym Bau — Equipos y herramienta', 'LYM BAU', 'Equipos y herramienta', 'Miete Ausrüstung.'),
  counterparty('TERRATEST — Equipos y herramienta', 'TERRATEST', 'Equipos y herramienta', 'Equipos de ensayo.'),
  counterparty('Bagela — Equipos y herramienta', 'BAGELA', 'Equipos y herramienta', 'Maquinaria de soplado.'),
  counterparty('BAUHAUS — Materiales', 'BAUHAUS', 'Materiales', 'Material de obra.'),
  counterparty('toom — Materiales', 'TOOM', 'Materiales', 'Material de obra.'),
  // The statement writes the store as "SONDERPREIS GERHARD WEISS" in the payee and
  // "SONDERPREIS BAUMARKT" in the purpose line, so both fields carry a rule.
  counterparty('Sonderpreis Baumarkt — Materiales', 'SONDERPREIS', 'Materiales', 'Material de obra (Sonderpreis Baumarkt, también "Sonderpreis Gerhard Weiss").'),
  description('Sonderpreis Baumarkt (concepto) — Materiales', 'SONDERPREIS BAUMARKT', 'Materiales', 'Material de obra: la tienda aparece en el concepto.', { priority: SEED_RULE_PRIORITY }),
  counterparty('Hagebau — Materiales', 'HAGEBAU', 'Materiales', 'Material de obra.'),
  counterparty('Bauking — Materiales', 'BAUKING', 'Materiales', 'Material de obra.'),
  counterparty('Globus — Materiales', 'GLOBUS', 'Materiales', 'Material de obra.'),
  counterparty('Linzmeier — Materiales', 'LINZMEIER', 'Materiales', 'Material de obra.'),
  counterparty('Baustoff — Materiales', 'BAUSTOFF', 'Materiales', 'Almacén de materiales de construcción.'),
  counterparty('Goetz + Moriz — Materiales', 'GOETZ + MORIZ', 'Materiales', 'Material de obra.'),
  counterparty('Handelshof — Materiales', 'HANDELSHOF', 'Materiales', 'Material de obra.'),
  counterparty('Otto Bitter — Materiales', 'OTTO BITTER', 'Materiales', 'Material de obra.'),
  counterparty('FICONET — Materiales', 'FICONET', 'Materiales', 'Material de fibra.'),
  counterparty('Secumundi — Materiales', 'SECUMUNDI', 'Materiales', 'Material de obra.'),
  counterparty('Fetzer — Materiales', 'FETZER', 'Materiales', 'Material de obra.'),
  counterparty('Action — Materiales', '\\baction\\b', 'Materiales', 'Material menor (palabra completa).', { matchType: 'regex' }),
  counterparty('OBI — Materiales', '\\bobi\\b', 'Materiales', 'Material de obra (palabra completa).', { matchType: 'regex' }),
  description('Schaden — Daños a terceros', 'Schaden', 'Daños a terceros', 'Facturas por daños a terceros tras los trabajos de fibra.', { priority: SEED_RULE_PRIORITY + 10 }),
  counterparty('Bauunternehmen Markus — Daños a terceros', 'BAUUNTERNEHMEN MARKUS', 'Daños a terceros', 'Sanierungsarbeiten tras daños.'),

  // ── Subcontratas recurrentes (proyecto pendiente en la Bandeja) ───────────
  counterparty('ALGUS TELECOM — Subcontratas', 'ALGUS TELECOM', 'Subcontratas', 'Subcontratista español, §13b (reverse charge): sin IVA alemán.'),
  counterparty('UMTELKOMD ESPAÑA — Subcontratas', 'UMTELKOMD ESPA', 'Subcontratas', 'Subcontratista con nombre casi idéntico al de la empresa: NO es una transferencia propia.'),

  // ── Alojamiento de trabajadores (proyecto pendiente en la Bandeja) ────────
  counterparty('Friedrich Epple — Alojamiento trabajadores', 'FRIEDRICH EPPLE', 'Alojamiento trabajadores', 'Alojamiento de montadores.'),
  counterparty('Caricasa — Alojamiento trabajadores', 'CARICASA', 'Alojamiento trabajadores', 'Alojamiento de montadores.'),
  counterparty('RAUMSCHMIDE — Alojamiento trabajadores', 'RAUMSCHMIDE', 'Alojamiento trabajadores', 'Alojamiento de montadores.'),
  counterparty('Vetter + Wasik — Alojamiento trabajadores', 'VETTER + WASIK', 'Alojamiento trabajadores', 'Alojamiento de montadores.'),
  counterparty('Eugen Eckert — Alojamiento trabajadores', 'EUGEN ECKERT', 'Alojamiento trabajadores', 'Alojamiento de montadores.'),
  counterparty('Jens Krämer — Alojamiento trabajadores', 'jens kr(ä|ae)mer', 'Alojamiento trabajadores', 'Alojamiento de montadores.', { matchType: 'regex' }),
  // On the statement the lodging word usually sits in the PAYEE ("Unterkunft
  // Takak", "Ferienwohnung Burg Lindenfels") while the purpose line is just an
  // invoice number, so each word carries a counterparty rule and a description rule.
  description('Ferienwohnung — Alojamiento trabajadores', 'Ferienwohnung', 'Alojamiento trabajadores', 'Alojamiento de montadores.', { priority: SEED_RULE_PRIORITY }),
  counterparty('Ferienwohnung (contraparte) — Alojamiento trabajadores', 'FERIENWOHNUNG', 'Alojamiento trabajadores', 'Alojamiento de montadores (la casa rural es la contraparte).'),
  description('FeWo — Alojamiento trabajadores', 'FeWo', 'Alojamiento trabajadores', 'Alojamiento de montadores.', { priority: SEED_RULE_PRIORITY }),
  counterparty('FeWo (contraparte) — Alojamiento trabajadores', 'FEWO', 'Alojamiento trabajadores', 'Alojamiento de montadores (la casa rural es la contraparte).'),
  description('Pension — Alojamiento trabajadores', '\\bpension\\b', 'Alojamiento trabajadores', 'Alojamiento de montadores (palabra completa: "Pensionskasse" no cuenta).', { matchType: 'regex', priority: SEED_RULE_PRIORITY }),
  counterparty('Pension (contraparte) — Alojamiento trabajadores', '\\bpension\\b', 'Alojamiento trabajadores', 'Alojamiento de montadores (palabra completa: "Pensionskasse" no cuenta).', { matchType: 'regex' }),
  description('Monteurwohnung — Alojamiento trabajadores', 'Monteurwohnung', 'Alojamiento trabajadores', 'Alojamiento de montadores.', { priority: SEED_RULE_PRIORITY }),
  description('Unterkunft — Alojamiento trabajadores', 'Unterkunft', 'Alojamiento trabajadores', 'Alojamiento de montadores (Unterkunft Takak…).', { priority: SEED_RULE_PRIORITY }),
  counterparty('Unterkunft (contraparte) — Alojamiento trabajadores', 'UNTERKUNFT', 'Alojamiento trabajadores', 'Alojamiento de montadores (Unterkunft Takak…).'),
  counterparty('Osman Tekelioglu — Alojamiento trabajadores', 'TEKELIOGLU', 'Alojamiento trabajadores', 'Alojamiento de montadores, facturado por quincena (confirmado por Jarl 2026-09-02).'),

  // ── Personal: ropa de trabajo y manutención ───────────────────────────────
  counterparty('Engelbert Strauss — Otros de personal', 'ENGELBERT STRAUSS', 'Otros de personal', 'Ropa de trabajo.'),
  counterparty('Arbeitsschutzhelden — Otros de personal', 'ARBEITSSCHUTZHELDEN', 'Otros de personal', 'Equipos de protección.'),
  counterparty('ALDI — Otros de personal', '\\baldi\\b', 'Otros de personal', 'Verpflegung (palabra completa).', { matchType: 'regex' }),
  counterparty('LIDL — Otros de personal', 'LIDL', 'Otros de personal', 'Verpflegung.'),
  counterparty('Brotladen — Otros de personal', 'BROTLADEN', 'Otros de personal', 'Verpflegung.'),
  counterparty('Restaurant — Otros de personal', 'RESTAURANT', 'Otros de personal', 'Verpflegung.'),
  counterparty('SumUp — Otros de personal', 'SUMUP', 'Otros de personal', 'Verpflegung pagada por TPV.'),

  // ── Estructura ────────────────────────────────────────────────────────────
  counterparty('DATEV eG — Asesoría y gestoría', 'DATEV EG', 'Asesoría y gestoría', 'Software y servicios de la gestoría.'),
  counterparty('Schomerus — Asesoría y gestoría', 'SCHOMERUS', 'Asesoría y gestoría', 'Asesoría fiscal.'),
  counterparty('Rundfunk — Oficina, telefonía y software', 'RUNDFUNK', 'Oficina, telefonía y software', 'Canon de radiodifusión.'),
  counterparty('Deutsche Post — Oficina, telefonía y software', 'DEUTSCHE POST', 'Oficina, telefonía y software', 'Correo.'),
  counterparty('Bundesanzeiger — Otros administrativos', 'BUNDESANZEIGER', 'Otros administrativos', 'Publicación de cuentas.'),
  counterparty('IHK — Otros administrativos', '\\bihk\\b', 'Otros administrativos', 'Cuota de la cámara de comercio (palabra completa).', { matchType: 'regex' }),
  counterparty('Stadt Freiburg — Otros administrativos', 'STADT FREIBURG', 'Otros administrativos', 'Tasas municipales.'),
  counterparty('Recyclinghof — Otros administrativos', 'RECYCLINGHOF', 'Otros administrativos', 'Tasas de vertedero.'),
  counterparty('NÜRNBERGER — Seguros de empresa', 'n(ü|ue)rnberger', 'Seguros de empresa', 'Pólizas de la empresa.', { matchType: 'regex' }),
  counterparty('Gothaer — Seguros de empresa', 'GOTHAER', 'Seguros de empresa', 'Pólizas de la empresa.'),

  // ── Ingresos ──────────────────────────────────────────────────────────────
  counterparty('MONCOBRA — Facturación obra', 'MONCOBRA', 'Facturación obra', 'Cliente.', { direction: 'in' }),
  counterparty('INSYTE — Facturación obra', 'INSYTE', 'Facturación obra', 'Cliente principal: cobros por servicios de obra.', { direction: 'in' }),
  counterparty('CAIXABANK — Facturación obra', 'CAIXABANK', 'Facturación obra', 'Cobro de INSYTE vía confirming. El banco es el canal, no el cliente.', { direction: 'in' }),
  counterparty('BANCO BILBAO VIZCAYA — Facturación obra', 'BANCO BILBAO VIZCAYA', 'Facturación obra', 'Cobro de INSYTE vía confirming de BBVA.', { direction: 'in' }),
  counterparty('SANTANDER FACTORING — Facturación obra', 'SANTANDER FACTORING', 'Facturación obra', 'Cobro de INSYTE vía confirming de Santander: facturación cobrada, no financiación.', { direction: 'in' }),
  counterparty(
    'JEISSON ANDRES ROMERO LESMES — Aportes y préstamos de socios recibidos',
    'JEISSON ANDRES ROMERO LESMES',
    'Aportes y préstamos de socios recibidos',
    'Aportación / préstamo del socio a la empresa.',
    { direction: 'in' },
  ),
  description(
    'Rechnung a particulares (≤ 400 €) — Servicios particulares',
    // Real spellings seen on the statement: "Rechnungs-Nr 2025-014", "RE NR 2025-021",
    // "R-NR. 2025-214/20.05.26", "RG-NR 2025-212", "Re.Nr.2025-217 vom 20.05.2026",
    // "RECHNUNGS-NR: 2025-179", "Rechnungs-Nr.: 2025-226", "Rechnung 2025-099".
    '\\b(?:(?:re|rg|r|rechn(?:ungs?)?)[.:\\- ]*(?:nr|no)\\.?|rechnung)[.:\\- ]*20\\d{2}-\\d+',
    'Servicios particulares',
    'Facturas de Hausanschluss a particulares (Rechnung 2025-NNN). Sólo importes pequeños; una regla de cliente siempre gana.',
    { matchType: 'regex', direction: 'in', amountMax: 400, priority: SEED_FALLBACK_RULE_PRIORITY },
  ),
  description(
    'Número de factura a particulares (≤ 400 €) — Servicios particulares',
    // Homeowners often type only the number: "2025-148 19.01.2026 Hoppe", "2025-169".
    // Anchored at the start so a client reference like "R.UMT-2026-0043" never matches.
    '^\\s*20\\d{2}-\\d{2,4}\\b',
    'Servicios particulares',
    'El concepto empieza por el número de factura (2025-NNN). Sólo importes pequeños; una regla de cliente siempre gana.',
    { matchType: 'regex', direction: 'in', amountMax: 400, priority: SEED_FALLBACK_RULE_PRIORITY },
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
