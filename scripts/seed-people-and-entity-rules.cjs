#!/usr/bin/env node
/**
 * Generate classification rules from the employee master, plus the recurring
 * entities the ledger keeps hitting.
 *
 * After the counterparty rules land, most of what stays unclassified is people
 * — and every one of them is already in the employee master with a type. So the
 * rules do not need to be authored by hand: derive one per person, from the
 * name and each alias, using the type to decide the classification.
 *
 *   internal  → Salarios, estructura. Payroll settlement: the real cost already
 *               reaches the obra through payrollAllocation, and ProyectoDashboard
 *               excludes these movements so the site is not billed twice. The
 *               category exists so the movement leaves the inbox.
 *   external  → Subcontratos, obra. A subcontractor payment IS direct site cost.
 *               The project comes from the person's file when they have exactly
 *               one; with several it is left for bulk assignment, since a rule
 *               cannot know which site a given payment belongs to.
 *
 *   node scripts/seed-people-and-entity-rules.cjs           # dry-run
 *   node scripts/seed-people-and-entity-rules.cjs --apply
 */
const path = require('node:path');
const os = require('node:os');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const KEY_PATH = path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;
const APPLY = process.argv.includes('--apply');
const line = (c = '─', w = 88) => c.repeat(w);

/**
 * Entities that are not people. Each is a recurring counterparty whose nature
 * is unambiguous from the name, so a rule is safe.
 * [pattern, category, costScope, direction, note]
 */
const ENTITIES = [
  ['TUI BKK', 'Seguros', 'overhead', 'out', 'Krankenkasse: seguridad social de la plantilla.'],
  ['Techniker Krankenkasse', 'Seguros', 'overhead', 'out', 'Krankenkasse: seguridad social de la plantilla.'],
  ['NÜRNBERGER', 'Seguros', 'overhead', 'out', 'Aseguradora: pólizas de la empresa.'],
  ['Monteurwohnungen', 'Vivienda', 'overhead', 'out', 'Alojamiento de montadores desplazados a obra.'],
  ['Kreditkartenkto', 'Administrativo', 'overhead', 'out', 'Liquidación de la tarjeta de empresa. Revisar el detalle si se quiere abrir por concepto.'],
  ['ALGUS TELECOM', 'Subcontratos', '', 'out', 'Subcontratista español, §13b (reverse charge): sin IVA alemán. Falta asignar obra.'],
];

/**
 * Inbound money. These are collections, not spend — they must stop looking like
 * unclassified noise on the income side.
 */
const INCOME = [
  ['INSYTE', 'Servicios', 'in', 'Cliente principal: cobros por servicios de obra.'],
  ['CAIXABANK', 'Servicios', 'in', 'Cobros recibidos vía CaixaBank. Verificar si son de Insyte u otro cliente.'],
  ['BANCO BILBAO VIZCAYA', 'Servicios', 'in', 'Cobros recibidos vía BBVA. Verificar el cliente de origen.'],
  ['SANTANDER FACTORING', 'Financiero', 'in', 'Factoring/confirming: anticipo de cobros, no venta nueva.'],
];

const norm = (s) => String(s || '').trim().toLowerCase();

const makeRule = ({ name, pattern, category, costScope = '', direction = 'out', projectId = '', projectName = '', notes, priority = 58 }) => ({
  name,
  field: 'counterpartyName',
  matchType: 'contains',
  pattern,
  direction,
  amountMin: null,
  amountMax: null,
  applyTo: { categoryName: category, costCenterId: '', projectId, projectName, costScope },
  active: true,
  priority,
  notes,
  hits: 0,
  lastHitAt: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: 'seed-people-and-entity-rules',
});

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const db = admin.firestore();

  const [empSnap, projSnap, ruleSnap] = await Promise.all([
    db.collection(`${BASE}/employees`).get(),
    db.collection(`${BASE}/projects`).get(),
    db.collection(`${BASE}/classificationRules`).get(),
  ]);

  const projects = new Map(projSnap.docs.map((d) => [d.id, d.data()]));
  const projLabel = (id) => {
    const p = projects.get(id);
    return p ? String(p.nombre || p.name || p.codigo || p.code || id) : '';
  };

  const existing = new Set(
    ruleSnap.docs.map((d) => `${d.data().field}::${norm(d.data().pattern)}`),
  );

  const proposed = [];

  // ── One rule per person, per distinct name spelling ──────────────────────
  for (const doc of empSnap.docs) {
    const e = doc.data();
    const full = String(e.fullName || '').trim();
    if (!full) continue;
    const isInternal = e.type === 'internal';
    const projectIds = Array.isArray(e.projectIds) ? e.projectIds : [];
    // A subcontractor with exactly one site can carry it; with several, the rule
    // cannot know which payment belongs where, so leave it for bulk assignment.
    const single = !isInternal && projectIds.length === 1 ? projectIds[0] : '';

    const spellings = [full, ...(Array.isArray(e.aliases) ? e.aliases : [])]
      .map((s) => String(s || '').trim())
      .filter(Boolean);

    for (const spelling of new Set(spellings.map((s) => s))) {
      proposed.push(makeRule({
        name: `${full} — ${isInternal ? 'nómina' : 'subcontrata'}`,
        pattern: spelling,
        category: isInternal ? 'Salarios' : 'Subcontratos',
        costScope: isInternal ? 'overhead' : (single ? 'project' : ''),
        projectId: single,
        projectName: single ? projLabel(single) : '',
        notes: isInternal
          ? 'Liquidación de nómina. El coste real llega a la obra por la asignación de nómina, así que este movimiento NO se carga otra vez a ningún proyecto.'
          : 'Pago a subcontratista: coste directo de obra.',
        priority: 62, // above the generic counterparty rules
      }));
    }
  }

  for (const [pattern, category, costScope, direction, notes] of ENTITIES) {
    proposed.push(makeRule({ name: `${pattern} — ${category}`, pattern, category, costScope, direction, notes }));
  }
  for (const [pattern, category, direction, notes] of INCOME) {
    proposed.push(makeRule({ name: `${pattern} — ${category}`, pattern, category, direction, notes, priority: 56 }));
  }

  const fresh = proposed.filter((r) => !existing.has(`${r.field}::${norm(r.pattern)}`));

  console.log(`\n${line('═')}`);
  console.log('REGLAS DERIVADAS DEL MAESTRO Y DE LAS ENTIDADES RECURRENTES');
  console.log(line('═'));
  console.log(`Modo: ${APPLY ? '🔴 APLICAR' : '🟢 DRY-RUN (no escribe)'}`);
  console.log(`Reglas ya existentes: ${ruleSnap.size} · propuestas nuevas: ${fresh.length}\n`);

  const groups = {
    'NÓMINA (Salarios · estructura)': fresh.filter((r) => r.applyTo.categoryName === 'Salarios'),
    'SUBCONTRATA (Subcontratos)': fresh.filter((r) => r.applyTo.categoryName === 'Subcontratos'),
    'ENTIDADES (gasto de estructura)': fresh.filter((r) => r.direction === 'out' && !['Salarios', 'Subcontratos'].includes(r.applyTo.categoryName)),
    'INGRESOS': fresh.filter((r) => r.direction === 'in'),
  };
  for (const [title, rows] of Object.entries(groups)) {
    if (!rows.length) continue;
    console.log(line());
    console.log(`${title}  (${rows.length})`);
    console.log(line());
    for (const r of rows) {
      const dest = r.applyTo.projectName ? ` → ${r.applyTo.projectName}` : (r.applyTo.costScope ? ` · ${r.applyTo.costScope}` : '');
      console.log(`  ${r.pattern.slice(0, 44).padEnd(44)} ${r.applyTo.categoryName}${dest}`);
    }
    console.log('');
  }

  if (!APPLY) {
    console.log(line('═'));
    console.log(`🟢 DRY-RUN — se crearían ${fresh.length} reglas.`);
    console.log('   Para aplicar: node scripts/seed-people-and-entity-rules.cjs --apply');
    console.log('   Después: node scripts/backfill-classification.cjs --apply --rules=both');
    console.log(line('═'));
    process.exit(0);
  }

  let ok = 0, fail = 0;
  for (const r of fresh) {
    try { await db.collection(`${BASE}/classificationRules`).add(r); ok++; }
    catch (e) { console.error(`  ✖ ${r.pattern}: ${e.message}`); fail++; }
  }
  console.log(line('═'));
  console.log(`✅ ${ok} reglas creadas${fail ? `, ${fail} fallos` : ''}. Total: ${ruleSnap.size + ok}`);
  console.log('   Ahora: node scripts/backfill-classification.cjs --apply --rules=both');
  console.log(line('═'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
