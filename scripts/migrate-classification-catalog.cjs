/**
 * FinControl — Classification catalogue v2 migration (cost centers + project codes)
 * ──────────────────────────────────────────────────────────────────────────────────
 * Moves every stored cost-center value (a doc id, a legacy code, or a free-text
 * label) to the v2 catalogue in `src/finance/costCenterCatalog.js`, and every
 * legacy project code to the structured `CLI-SIT-LLn` scheme in
 * `src/finance/projectCode.js`. Neither the resolution, the argv parsing, nor
 * the write-plan merging is reimplemented here — this script is a thin I/O
 * shell around the pure functions in `src/finance/classificationMigration.js`
 * (`planCostCenterMigration`, `planProjectCodeMigration`,
 * `planProjectNameRefresh`, `buildWritePlan`, `parseMigrationArgs`), which is
 * what the unit tests cover; this file only reads Firestore, prints the
 * plan, and — only behind `--apply` — executes the write plan verbatim.
 *
 * See `odd/tasks/invoice-classification-catalog.md` ("Legacy resolution" and
 * "Proposed legacy → new mapping") for the mapping this migration proposes.
 * The mapping is PROPOSED: the owner reviews the dry-run report (in
 * particular `unresolved` and `collisions`) before ever passing `--apply`.
 *
 * HOW TO RUN:
 *   node scripts/migrate-classification-catalog.cjs                       # dry-run (default)
 *   npm run migrate:classification                                       # same, via package.json
 *   node scripts/migrate-classification-catalog.cjs --apply --confirm=umtelkomd-finance
 *
 * Flags:
 *   --only=cost-centers|projects   Limit both the report and the writes to one axis.
 *   --min-confidence=high|medium|low
 *                                  Minimum confidence a project rename needs (default: high).
 *   --apply                       Write the plan. Requires --confirm and a fresh backup (below).
 *   --confirm=umtelkomd-finance   Must equal the Firebase project id, or --apply refuses to run.
 *
 * `--apply` refuses to run unless a `backups/firestore-backup-*.json` file
 * newer than 24h and containing BOTH `projects` and `costCenters` already
 * exists (run `npm run backup:firestore` first — this script never takes its
 * own backup, so a stale or missing one always blocks the write).
 *
 * Every changed document keeps its pre-migration value under
 * `migration.classificationCatalogV2.previous.<field>`, one dotted Firestore
 * path per changed field (never a shared object), so a document needing BOTH
 * a cost-center remap and a projectName refresh gets ONE write with both
 * originals preserved, and a re-run never overwrites an original already
 * recorded — see `buildWritePlan` for the merge/re-run-safety rules. Writes
 * go in batches of ≤399 document writes plus one `auditLog` entry (≤400
 * total per batch), in the same shape `reconcileMovement.js` writes. `retire`
 * and `unresolved` entries in the report are NEVER written by this script —
 * retiring a superseded cost-center doc stays a deliberate action in
 * Configuración → Centros de costo, and an unresolved value is never guessed.
 *
 * Requires the service account key at ~/.credentials/umtelkomd-firebase.json
 */

const admin = require('firebase-admin');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ── Configuration ───────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_ID = process.env.FINCONTROL_APP_ID || '1:597712756560:web:ad12cd9794f11992641655';
const FIREBASE_PROJECT_ID = 'umtelkomd-finance';
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');

// Firestore hard-caps a batch at 500 writes; this script stays well under it
// AND reserves one slot for the batch's own `auditLog` entry, so a batch of
// N document writes + 1 audit write never exceeds BATCH_SIZE in total.
const BATCH_SIZE = 400;
const MAX_DOCS_PER_BATCH = BATCH_SIZE - 1;
const BACKUP_DIR = path.join(REPO_ROOT, 'backups');
const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000;
const BOT_EMAIL = 'migrate-classification-catalog@umtelkomd.com';
const BOT_NAME = 'migrate-classification-catalog';

// ── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

// ── Formatting helpers (operator-facing output is Spanish) ──────────────────

const padEnd = (value, width) => String(value).padEnd(width).slice(0, width);
const padStart = (value, width) => String(value).padStart(width);
const rule = (char = '─', width = 96) => char.repeat(width);
const banner = (title) => {
  console.log(`\n${rule('═')}`);
  console.log(title);
  console.log(rule());
};
const clip = (value, width) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
};
const printTable = (rows, columns) => {
  if (rows.length === 0) {
    console.log('  (ninguno)');
    return;
  }
  console.log(`  ${columns.map(([label, width]) => padEnd(label, width)).join(' ')}`);
  console.log(`  ${columns.map(([, width]) => rule('-', width)).join(' ')}`);
  for (const row of rows) console.log(`  ${row}`);
};

/** Load an ES module from src/ into this CJS script. */
const loadEsm = (relativePath) => import(pathToFileURL(path.join(REPO_ROOT, relativePath)).href);

const chunk = (items, size) => {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
};

// ── Backup freshness gate ────────────────────────────────────────────────────

/**
 * Returns the path to a usable backup, or null. Unlike
 * migrate-category-taxonomy.cjs's `takeBackup()`, this script never takes its
 * own backup — `--apply` on classification data is rarer and more deliberate
 * than a category rename, so the owner runs `npm run backup:firestore`
 * themselves and this only verifies it is recent and covers what this
 * migration touches.
 */
const findFreshBackup = () => {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const candidates = fs.readdirSync(BACKUP_DIR)
    .filter((name) => /^firestore-backup-.*\.json$/.test(name))
    .map((name) => path.join(BACKUP_DIR, name))
    .filter((file) => Date.now() - fs.statSync(file).mtimeMs <= MAX_BACKUP_AGE_MS)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  for (const file of candidates) {
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const collections = new Set((payload?.metadata?.collections || []).map((entry) => entry.name));
    if (collections.has('projects') && collections.has('costCenters')) return file;
  }
  return null;
};

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  const { parseMigrationArgs, planCostCenterMigration, planProjectCodeMigration, planProjectNameRefresh, buildWritePlan } =
    await loadEsm('src/finance/classificationMigration.js');
  const chunkedCommit = await loadEsm('src/utils/chunkedCommit.js');

  // Fails CLOSED on a misspelled or empty flag (see parseMigrationArgs) rather
  // than silently degrading a restricted dry-run into a full one.
  const parsed = parseMigrationArgs(argv);
  if (!parsed.ok) fail(parsed.error);
  const APPLY = parsed.apply;
  const CONFIRM = parsed.confirm;
  const ONLY = parsed.only;
  const MIN_CONFIDENCE = parsed.minConfidence;
  const includesCostCenters = ONLY !== 'projects';
  const includesProjects = ONLY !== 'cost-centers';

  if (APPLY && CONFIRM !== FIREBASE_PROJECT_ID) {
    fail(`--apply requiere --confirm=${FIREBASE_PROJECT_ID}`);
  }
  let backupPath = null;
  if (APPLY) {
    backupPath = findFreshBackup();
    if (!backupPath) {
      fail(
        'No hay un backup reciente (< 24h) con projects + costCenters en backups/. '
        + 'Ejecuta primero: npm run backup:firestore',
      );
    }
  }

  if (!fs.existsSync(KEY_PATH)) fail(`No se encontró la clave de servicio: ${KEY_PATH}`);
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  }
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;
  const base = `artifacts/${APP_ID}/public/data`;
  const col = (name) => db.collection(`${base}/${name}`);

  console.log(rule('═'));
  console.log('MIGRACIÓN CATÁLOGO DE CLASIFICACIÓN v2 — centros de costo + códigos de proyecto');
  console.log(rule('═'));
  console.log(`Modo:            ${APPLY ? '🔴 APPLY (escribe en producción)' : '🟢 DRY-RUN (no escribe)'}`);
  console.log(`Alcance:         ${ONLY || 'cost-centers + projects'}`);
  console.log(`Confianza mín.:  ${MIN_CONFIDENCE} (solo afecta a proyectos)`);
  console.log(`Base:            ${base}`);
  if (backupPath) console.log(`Backup:          ${backupPath}`);

  // ── Read (read-only) ────────────────────────────────────────────────────
  const docsOf = (snap) => snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const [
    costCentersSnap,
    projectsSnap,
    payablesSnap,
    receivablesSnap,
    bankMovementsSnap,
    recurringCostsSnap,
    classificationRulesSnap,
    workInProgressSnap,
  ] = await Promise.all([
    col('costCenters').get(),
    col('projects').get(),
    col('payables').get(),
    col('receivables').get(),
    col('bankMovements').get(),
    col('recurringCosts').get(),
    col('classificationRules').get(),
    col('workInProgress').get(),
  ]);

  const costCenters = docsOf(costCentersSnap);
  const projects = docsOf(projectsSnap);
  const documentsByCollection = {
    payables: docsOf(payablesSnap),
    receivables: docsOf(receivablesSnap),
    bankMovements: docsOf(bankMovementsSnap),
    recurringCosts: docsOf(recurringCostsSnap),
    classificationRules: docsOf(classificationRulesSnap),
    workInProgress: docsOf(workInProgressSnap),
  };
  console.log(
    `Leído:           ${costCenters.length} centros de costo · ${projects.length} proyectos · `
    + `${documentsByCollection.payables.length} CXP · ${documentsByCollection.receivables.length} CXC · `
    + `${documentsByCollection.bankMovements.length} movimientos · ${documentsByCollection.recurringCosts.length} costos recurrentes · `
    + `${documentsByCollection.classificationRules.length} reglas · ${documentsByCollection.workInProgress.length} obra en curso`,
  );

  // ── Plan (pure) ──────────────────────────────────────────────────────────
  const costCenterPlan = includesCostCenters
    ? planCostCenterMigration({ costCenters, documentsByCollection })
    : { catalogUpserts: [], remaps: [], unresolved: [], retire: [], summary: {} };
  const projectPlan = includesProjects
    ? planProjectCodeMigration({ projects, minConfidence: MIN_CONFIDENCE })
    : { renames: [], skipped: [], collisions: [], summary: {} };
  const nameRefreshPlan = includesProjects
    ? planProjectNameRefresh({ renames: projectPlan.renames, documentsByCollection })
    : { updates: [], summary: {} };

  // ── Report ───────────────────────────────────────────────────────────────
  if (includesCostCenters) {
    banner('CENTROS DE COSTO — catálogo v2');
    console.log(`  Upserts al catálogo: ${costCenterPlan.catalogUpserts.length}`);
    printTable(
      costCenterPlan.catalogUpserts.map((u) => `${padEnd(u.code, 10)} ${padEnd(u.data.name, 46)} ${padEnd(u.data.kind, 10)}`),
      [['Código', 10], ['Nombre', 46], ['Tipo', 10]],
    );

    banner('CENTROS DE COSTO — remaps por colección');
    console.log(`  Total: ${costCenterPlan.remaps.length}`);
    printTable(
      costCenterPlan.remaps.map((r) => `${padEnd(r.collection, 22)} ${padEnd(r.id, 22)} ${padEnd(r.from, 20)} → ${r.to}`),
      [['Colección', 22], ['Id', 22], ['Antes', 20], ['Después', 20]],
    );

    banner('CENTROS DE COSTO — sin resolver (nunca se reescriben)');
    printTable(
      costCenterPlan.unresolved.map((u) => `${padEnd(u.collection, 22)} ${padEnd(u.id, 22)} ${clip(u.value, 40)}`),
      [['Colección', 22], ['Id', 22], ['Valor', 40]],
    );

    banner('CENTROS DE COSTO — docs legacy a retirar (solo informe, nunca se escriben aquí)');
    printTable(
      costCenterPlan.retire.map((r) => `${padEnd(r.id, 22)} ${padEnd(r.code || '(sin código)', 12)} ${padEnd(clip(r.name, 30), 30)} → ${r.resolvedTo}`),
      [['Id', 22], ['Código', 12], ['Nombre', 30], ['Retirado a', 12]],
    );
  }

  if (includesProjects) {
    banner('PROYECTOS — renombres propuestos (CLI-SIT-LLn)');
    console.log(`  Total: ${projectPlan.renames.length}`);
    printTable(
      projectPlan.renames.map((r) => `${padEnd(r.id, 14)} ${padEnd(r.from, 14)} → ${padEnd(r.to, 14)} ${padEnd(r.confidence, 8)} ${clip(r.fields.displayName, 30)}`),
      [['Id', 14], ['Antes', 14], ['Después', 17], ['Confianza', 8], ['Nombre', 30]],
    );

    banner('PROYECTOS — omitidos');
    printTable(
      projectPlan.skipped.map((s) => `${padEnd(s.id, 14)} ${padEnd(s.code, 14)} ${padEnd(s.reason, 22)} ${s.confidence || '—'}`),
      [['Id', 14], ['Código', 14], ['Motivo', 22], ['Confianza', 10]],
    );

    banner('PROYECTOS — colisiones (ninguno de los dos se renombra)');
    for (const collision of projectPlan.collisions) {
      console.log(`  ${collision.code}:`);
      collision.projects.forEach((p) => console.log(`    · ${p.id} (${p.from}, confianza ${p.confidence})`));
    }
    if (projectPlan.collisions.length === 0) console.log('  (ninguna)');

    banner('PROYECTOS — refresco de projectName denormalizado');
    console.log(`  Total: ${nameRefreshPlan.updates.length}`);
    printTable(
      nameRefreshPlan.updates.map((u) => `${padEnd(u.collection, 20)} ${padEnd(u.id, 20)} ${padEnd(u.field, 20)} ${padEnd(clip(u.from, 16), 16)} → ${u.to}`),
      [['Colección', 20], ['Id', 20], ['Campo', 20], ['Antes', 16], ['Después', 16]],
    );
  }

  // ── Write plan — merged into exactly one write per document by the PURE
  // planner (buildWritePlan); this script only executes it, never decides it.
  // ─────────────────────────────────────────────────────────────────────────
  const writePlan = buildWritePlan({
    costCenterPlan,
    projectPlan,
    nameRefreshPlan,
    existingDocsByCollection: { costCenters, projects, ...documentsByCollection },
  });

  banner('PLAN DE ESCRITURA');
  console.log(`  ${padEnd('TOTAL', 24)} ${padStart(writePlan.length, 6)} escrituras (lotes de ${MAX_DOCS_PER_BATCH} + 1 auditLog = ${BATCH_SIZE})`);

  // ── Save report (dry-run and apply both write one, before any write) ────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const reportPath = path.join(BACKUP_DIR, `classification-migration-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    only: ONLY || null,
    minConfidence: MIN_CONFIDENCE,
    costCenterPlan,
    projectPlan,
    nameRefreshPlan,
    writePlan,
  }, null, 2));
  console.log(`\nInforme escrito: ${reportPath}`);

  // ── Apply — a dumb executor of `writePlan`: no merging or previous-key
  // decisions happen here, only the Firestore-specific bookkeeping
  // (`updatedAt`/`updatedBy`) the pure planner cannot express. ─────────────
  const applyWriteEntry = (batch, entry) => {
    const ref = col(entry.collection).doc(entry.id);
    if (entry.kind === 'set') {
      batch.set(
        ref,
        { ...entry.data, type: 'Costos', updatedAt: FieldValue.serverTimestamp(), updatedBy: BOT_NAME },
        { merge: entry.merge !== false },
      );
    } else {
      batch.update(ref, { ...entry.data, updatedAt: FieldValue.serverTimestamp(), updatedBy: BOT_EMAIL });
    }
  };

  let outcome = null;
  if (APPLY && writePlan.length > 0) {
    console.log(`\nEscribiendo ${writePlan.length} documentos en lotes de ${MAX_DOCS_PER_BATCH}…`);
    const groups = chunk(writePlan, MAX_DOCS_PER_BATCH);
    outcome = await chunkedCommit.commitInChunks(
      groups,
      async (group, index) => {
        const batch = db.batch();
        for (const entry of group) applyWriteEntry(batch, entry);
        const auditRef = col('auditLog').doc();
        batch.set(auditRef, {
          action: 'classification-catalog-migration',
          entityType: 'batch',
          entityId: `batch-${index}`,
          description: `Migración catálogo de clasificación: lote ${index + 1}/${groups.length} (${group.length} documentos)`,
          before: null,
          after: null,
          metadata: { only: ONLY || 'all', minConfidence: MIN_CONFIDENCE, backupPath, labels: group.map((w) => w.label) },
          user: BOT_EMAIL,
          timestamp: FieldValue.serverTimestamp(),
        });
        await batch.commit();
      },
      ({ ok, size, applied, failed, error }) => {
        if (ok) console.log(`  Lote confirmado: ${applied}/${writePlan.length}`);
        else console.error(`  ❌ Lote fallido (${size} documentos, ${failed} fallidos en total): ${error?.message || error}`);
      },
    );
    console.log(`  Resultado: ${outcome.applied} aplicados · ${outcome.failed} fallidos`);
  }

  // ── Closing banner ────────────────────────────────────────────────────────
  console.log(`\n${rule('═')}`);
  if (!APPLY) {
    console.log('🟢 DRY RUN — no se escribió nada.');
    console.log(`   Revisa especialmente "sin resolver" y "colisiones" antes de aplicar.`);
    console.log(`   Para aplicar: node scripts/migrate-classification-catalog.cjs --apply --confirm=${FIREBASE_PROJECT_ID}`);
  } else if (writePlan.length === 0) {
    console.log('✅ Nada que escribir: el catálogo v2 ya está aplicado.');
  } else if (outcome.failed > 0) {
    console.log(`⚠️  APLICADO PARCIALMENTE — ${outcome.applied} de ${writePlan.length} documentos, ${outcome.failed} sin escribir.`);
    console.log('   Volver a ejecutar es SEGURO: un valor ya migrado no produce remap, así que solo se reintenta lo que falta.');
  } else {
    console.log(`✅ APLICADO — ${outcome.applied} documentos actualizados.`);
    console.log('   Siguiente paso: revisar "retirar" en Configuración → Centros de costo y desactivar los superados a mano.');
  }
  console.log(rule('═'));

  process.exit(outcome && outcome.failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error('ERROR:', error);
  process.exit(1);
});
