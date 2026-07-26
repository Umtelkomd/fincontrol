/**
 * FinControl — Retroactive classification backfill for bankMovements
 * ──────────────────────────────────────────────────────────────────
 * Applies the classification rules to the bank movements that are ALREADY in
 * production, so the historical ledger gets the same category / cost scope /
 * project the live app would assign to a freshly imported movement.
 *
 * The matching logic is NOT reimplemented here: `findBestRule` and
 * `buildClassificationPayload` are imported from `src/finance/ruleEngine.js`,
 * the same module `useClassificationRules` uses. Backfill and app therefore
 * classify identically by construction.
 *
 * Never overwrites data: `buildClassificationPayload` only fills fields that
 * are empty on the movement. A movement that already has a category keeps it.
 *
 * HOW TO RUN:
 *   node scripts/backfill-classification.cjs                      # dry-run (default)
 *   node scripts/backfill-classification.cjs --rules=seed         # only SEED_CLASSIFICATION_RULES
 *   node scripts/backfill-classification.cjs --rules=firestore    # only the live rules
 *   node scripts/backfill-classification.cjs --limit=50           # canary: cap patched movements
 *   node scripts/backfill-classification.cjs --apply              # WRITES (backup first)
 *
 * Flags:
 *   --apply          write to production. Without it NOTHING is written.
 *   --rules=<mode>   seed | firestore | both   (default: both)
 *   --limit=N        cap how many movements get patched (canary runs)
 *
 * --apply always runs `scripts/exportFirestoreBackup.mjs` BEFORE the first
 * write and aborts if the backup does not produce a readable file.
 *
 * A failing batch does NOT abort the run: the remaining batches still commit,
 * the report is always printed with the real applied/failed counts, and the
 * process exits 1 so a partial application is visible. Re-running is safe —
 * `buildClassificationPayload` only fills empty fields, so already-written
 * movements are skipped on the retry.
 *
 * Requires the service account key at ~/.credentials/umtelkomd-firebase.json
 */

const admin = require('firebase-admin');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

// ── Configuration ───────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKUP_SCRIPT = path.join(REPO_ROOT, 'scripts', 'exportFirestoreBackup.mjs');
const APP_ID = process.env.FINCONTROL_APP_ID || '1:597712756560:web:ad12cd9794f11992641655';
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');

const MOVEMENTS_COLLECTION = 'bankMovements';
const RULES_COLLECTION = 'classificationRules';
const BATCH_SIZE = 400;
const TOP_COUNTERPARTIES = 25;
const BOT_EMAIL = 'backfill-classification@umtelkomd.com';

// ── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const hit = argv.find((entry) => entry.startsWith(`${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 1);
};

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const APPLY = argv.includes('--apply');

const RULES_MODE = flagValue('--rules') ?? 'both';
if (!['seed', 'firestore', 'both'].includes(RULES_MODE)) {
  fail(`--rules inválido: "${RULES_MODE}". Usa seed | firestore | both.`);
}

const rawLimit = flagValue('--limit');
let LIMIT = null;
if (rawLimit !== undefined) {
  LIMIT = Number(rawLimit);
  if (!Number.isInteger(LIMIT) || LIMIT <= 0) fail(`--limit inválido: "${rawLimit}". Usa un entero > 0.`);
}

const unknown = argv.filter(
  (entry) => entry !== '--apply' && !entry.startsWith('--rules=') && !entry.startsWith('--limit='),
);
if (unknown.length > 0) fail(`Argumento no reconocido: ${unknown.join(', ')}`);

// ── Formatting helpers (operator-facing output is Spanish) ──────────────────

const eurFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const eur = (value) => eurFormatter.format(Number(value) || 0);
const pct = (part, total) => (total === 0 ? '0.0' : (Math.round((part / total) * 1000) / 10).toFixed(1));
const padEnd = (value, width) => String(value).padEnd(width).slice(0, width);
const padStart = (value, width) => String(value).padStart(width);
const rule = (char = '─', width = 78) => char.repeat(width);

/** Load an ES module from src/ into this CJS script. */
const loadEsm = (relativePath) => import(pathToFileURL(path.join(REPO_ROOT, relativePath)).href);

// ── Rule loading ────────────────────────────────────────────────────────────

/**
 * Mirrors the onSnapshot mapper in useClassificationRules so a Firestore rule
 * is shaped exactly the way the live app sees it before it reaches the engine.
 */
const mapFirestoreRule = (doc, schemas) => {
  const raw = doc.data() || {};
  const num = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    id: doc.id,
    source: 'firestore',
    name: raw.name || '',
    field: schemas.RULE_FIELDS.includes(raw.field) ? raw.field : 'counterpartyName',
    matchType: schemas.RULE_MATCH_TYPES.includes(raw.matchType) ? raw.matchType : 'contains',
    pattern: raw.pattern || '',
    direction: schemas.RULE_DIRECTIONS.includes(raw.direction) ? raw.direction : 'both',
    amountMin: raw.amountMin == null ? null : num(raw.amountMin, null),
    amountMax: raw.amountMax == null ? null : num(raw.amountMax, null),
    applyTo: schemas.normalizeRuleApplyTo(raw.applyTo),
    active: raw.active !== false,
    priority: num(raw.priority, 100),
    hits: num(raw.hits, 0),
    lastHitAt: raw.lastHitAt || '',
    notes: raw.notes || '',
  };
};

/**
 * Seed rules stay virtual — they are run through seedRuleToDoc so they carry
 * the exact persisted shape, but they are never written to Firestore by this
 * script, so their `hits` counter is not bumped either.
 */
const mapSeedRules = (seeds, seedRuleToDoc) =>
  seeds.map((seed, index) => ({
    ...seedRuleToDoc(seed, BOT_EMAIL),
    id: `seed:${index + 1}`,
    source: 'seed',
  }));

// ── Reporting ───────────────────────────────────────────────────────────────

const countsFor = (movements) => {
  let total = 0;
  let withCategory = 0;
  let withProject = 0;
  for (const movement of movements) {
    if (movement.status === 'void') continue;
    total += 1;
    if (String(movement.categoryName || '').trim()) withCategory += 1;
    if (String(movement.projectId || '').trim()) withProject += 1;
  }
  return { total, withCategory, withProject };
};

const printCoverage = (label, movements, finance) => {
  const coverage = finance.classificationCoverage(movements);
  const counts = countsFor(movements);
  console.log(`${label}`);
  console.log(`  Movimientos (no anulados):   ${counts.total}`);
  console.log(`  Con categoría:               ${counts.withCategory} (${pct(counts.withCategory, counts.total)} %)`);
  console.log(`  Con proyecto:                ${counts.withProject} (${pct(counts.withProject, counts.total)} %)`);
  console.log(`  Clasificados por completo:   ${coverage.classified} (${coverage.pct} %)`);
  console.log(`  Destino obra / estructura / sin resolver: ${coverage.byScope.project} / ${coverage.byScope.overhead} / ${coverage.byScope.unresolved}`);
  console.log(`  Salida sin clasificar:       ${eur(coverage.unclassifiedOutflow)}`);
  return coverage;
};

const printRuleImpact = (impacts) => {
  console.log(`\n${rule('═')}`);
  console.log('IMPACTO POR REGLA (ordenado por € de salida cubiertos)');
  console.log(rule());
  if (impacts.length === 0) {
    console.log('  Ninguna regla clasificaría movimientos.');
    return;
  }
  console.log(`  ${padEnd('Regla', 40)} ${padStart('Movs', 6)} ${padStart('Salida €', 16)} ${padStart('Ya OK', 6)}`);
  console.log(`  ${rule('-', 40)} ${rule('-', 6)} ${rule('-', 16)} ${rule('-', 6)}`);
  for (const impact of impacts) {
    const name = `${impact.source === 'seed' ? '[seed] ' : ''}${impact.name || impact.pattern}`;
    console.log(`  ${padEnd(name, 40)} ${padStart(impact.applied, 6)} ${padStart(eur(impact.outflow), 16)} ${padStart(impact.noop, 6)}`);
  }
  console.log('  ("Ya OK" = mejor regla coincidente pero el movimiento ya tenía esos datos → sin escritura)');
};

const printPendingCounterparties = (movements, finance) => {
  const map = new Map();
  for (const movement of movements) {
    if (movement.status === 'void') continue;
    if (finance.isClassified(movement)) continue;
    const key = String(movement.counterpartyName || '').trim() || 'Sin contraparte';
    if (!map.has(key)) map.set(key, { counterparty: key, count: 0, outflow: 0, inflow: 0 });
    const entry = map.get(key);
    entry.count += 1;
    const signed = finance.signedAmountOf(movement);
    if (signed < 0) entry.outflow += Math.abs(signed);
    else entry.inflow += signed;
  }

  const rows = Array.from(map.values()).sort(
    (a, b) => b.outflow - a.outflow || b.count - a.count || a.counterparty.localeCompare(b.counterparty),
  );

  console.log(`\n${rule('═')}`);
  console.log(`TOP ${TOP_COUNTERPARTIES} CONTRAPARTES AÚN SIN CLASIFICAR (lista de trabajo para nuevas reglas)`);
  console.log(rule());
  if (rows.length === 0) {
    console.log('  Nada pendiente. Cobertura completa.');
    return rows;
  }
  console.log(`  ${padEnd('#', 3)} ${padEnd('Contraparte', 38)} ${padStart('Movs', 5)} ${padStart('Salida €', 15)} ${padStart('Entrada €', 15)}`);
  console.log(`  ${rule('-', 3)} ${rule('-', 38)} ${rule('-', 5)} ${rule('-', 15)} ${rule('-', 15)}`);
  rows.slice(0, TOP_COUNTERPARTIES).forEach((row, index) => {
    console.log(`  ${padEnd(index + 1, 3)} ${padEnd(row.counterparty, 38)} ${padStart(row.count, 5)} ${padStart(eur(row.outflow), 15)} ${padStart(eur(row.inflow), 15)}`);
  });
  const rest = rows.slice(TOP_COUNTERPARTIES);
  if (rest.length > 0) {
    const restOutflow = rest.reduce((sum, row) => sum + row.outflow, 0);
    const restCount = rest.reduce((sum, row) => sum + row.count, 0);
    console.log(`  ... y ${rest.length} contrapartes más (${restCount} movs, ${eur(restOutflow)} de salida)`);
  }
  return rows;
};

// ── Backup (reuses the repo's own export script) ────────────────────────────

const takeBackup = () => {
  if (!fs.existsSync(BACKUP_SCRIPT)) fail(`No existe el script de backup: ${BACKUP_SCRIPT}`);
  console.log(`\nBackup previo obligatorio → node scripts/exportFirestoreBackup.mjs`);
  let stdout;
  try {
    stdout = execFileSync('node', [BACKUP_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (error) {
    console.error(error.stdout || '');
    console.error(error.stderr || '');
    fail('El backup falló. NO se escribió nada.');
  }
  process.stdout.write(stdout);
  const match = /Backup written: (.+)/.exec(stdout);
  if (!match) fail('El backup no informó ninguna ruta de salida. NO se escribió nada.');
  const backupPath = match[1].trim();
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    fail(`El fichero de backup no existe o está vacío: ${backupPath}. NO se escribió nada.`);
  }
  console.log(`✅ Backup verificado (${(fs.statSync(backupPath).size / 1024 / 1024).toFixed(2)} MB)`);
  return backupPath;
};

// ── Main ────────────────────────────────────────────────────────────────────

const chunk = (items, size) => {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
};

(async () => {
  const [engine, seedModule, costScope, movementAmount, schemas, chunkedCommit] = await Promise.all([
    loadEsm('src/finance/ruleEngine.js'),
    loadEsm('src/finance/seedRules.js'),
    loadEsm('src/finance/costScope.js'),
    loadEsm('src/lib/finance/movementAmount.js'),
    loadEsm('src/finance/assetSchemas.js'),
    loadEsm('src/utils/chunkedCommit.js'),
  ]);
  const finance = {
    classificationCoverage: costScope.classificationCoverage,
    isClassified: costScope.isClassified,
    signedAmountOf: movementAmount.signedAmountOf,
  };

  if (!fs.existsSync(KEY_PATH)) fail(`No se encontró la clave de servicio: ${KEY_PATH}`);
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  }
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;
  const base = `artifacts/${APP_ID}/public/data`;
  const movementsRef = db.collection(`${base}/${MOVEMENTS_COLLECTION}`);
  const rulesRef = db.collection(`${base}/${RULES_COLLECTION}`);

  console.log(rule('═'));
  console.log('BACKFILL DE CLASIFICACIÓN — bankMovements');
  console.log(rule('═'));
  console.log(`Modo:        ${APPLY ? '🔴 APPLY (escribe en producción)' : '🟢 DRY-RUN (no escribe)'}`);
  console.log(`Reglas:      ${RULES_MODE}`);
  console.log(`Límite:      ${LIMIT === null ? 'sin límite' : `${LIMIT} movimientos parcheados como máximo`}`);
  console.log(`Colección:   ${base}/${MOVEMENTS_COLLECTION}`);

  // ── Load rules ────────────────────────────────────────────────────────────
  const rules = [];
  if (RULES_MODE === 'firestore' || RULES_MODE === 'both') {
    const snapshot = await rulesRef.get();
    snapshot.docs.forEach((doc) => rules.push(mapFirestoreRule(doc, schemas)));
  }
  if (RULES_MODE === 'seed' || RULES_MODE === 'both') {
    rules.push(...mapSeedRules(seedModule.SEED_CLASSIFICATION_RULES, seedModule.seedRuleToDoc));
  }
  const activeRules = rules.filter((entry) => entry.active !== false);
  const firestoreCount = rules.filter((entry) => entry.source === 'firestore').length;
  const seedCount = rules.filter((entry) => entry.source === 'seed').length;
  console.log(`Reglas cargadas: ${rules.length} (${firestoreCount} en Firestore, ${seedCount} seed) — activas: ${activeRules.length}`);
  if (rules.length === 0) fail('No hay reglas que aplicar con este modo.');

  // ── Load movements ────────────────────────────────────────────────────────
  const snapshot = await movementsRef.get();
  const movements = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const voided = movements.filter((movement) => movement.status === 'void').length;
  console.log(`Movimientos leídos: ${movements.length} (${voided} anulados, se omiten)`);

  // ── Coverage BEFORE ───────────────────────────────────────────────────────
  console.log(`\n${rule('═')}`);
  console.log('COBERTURA ANTES');
  console.log(rule());
  const before = printCoverage('', movements, finance);

  // ── Plan ──────────────────────────────────────────────────────────────────
  const impactByRule = new Map();
  const planned = [];
  let capped = 0;

  for (const movement of movements) {
    if (movement.status === 'void') continue;
    const best = engine.findBestRule(movement, rules);
    if (!best) continue;

    if (!impactByRule.has(best.id)) {
      impactByRule.set(best.id, {
        id: best.id,
        name: best.name,
        pattern: best.pattern,
        source: best.source,
        applied: 0,
        noop: 0,
        outflow: 0,
      });
    }
    const impact = impactByRule.get(best.id);

    const patch = engine.buildClassificationPayload(best, movement);
    if (Object.keys(patch).length === 0) {
      impact.noop += 1;
      continue;
    }
    if (LIMIT !== null && planned.length >= LIMIT) {
      capped += 1;
      continue;
    }

    impact.applied += 1;
    const signed = finance.signedAmountOf(movement);
    if (signed < 0) impact.outflow += Math.abs(signed);
    planned.push({ movement, rule: best, patch });
  }

  const impacts = Array.from(impactByRule.values())
    .filter((impact) => impact.applied > 0 || impact.noop > 0)
    .sort((a, b) => b.outflow - a.outflow || b.applied - a.applied || (a.name || '').localeCompare(b.name || ''));

  console.log(`\n${rule('═')}`);
  console.log('PLAN');
  console.log(rule());
  console.log(`  Movimientos a parchear: ${planned.length}`);
  if (capped > 0) console.log(`  ⚠️  ${capped} movimientos adicionales coincidían pero quedaron fuera por --limit=${LIMIT}`);
  const fieldTally = planned.reduce((acc, entry) => {
    for (const key of Object.keys(entry.patch)) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const fieldSummary = Object.entries(fieldTally)
    .sort((a, b) => b[1] - a[1])
    .map(([field, count]) => `${field}: ${count}`)
    .join('  ·  ');
  console.log(`  Campos que se rellenan: ${fieldSummary || '(ninguno)'}`);

  printRuleImpact(impacts);

  // ── Apply (or simulate) ───────────────────────────────────────────────────
  let after;
  let writeOutcome = null;
  let afterIsMeasured = false;
  if (APPLY && planned.length > 0) {
    takeBackup();

    console.log(`\nEscribiendo ${planned.length} movimientos en lotes de ${BATCH_SIZE}…`);
    const nowIso = new Date().toISOString();

    // A failing lote must NOT abort the run: the operator needs the coverage
    // report and the real applied/failed counts, not a stack trace that hides
    // how much already landed. Re-running afterwards is safe — the payload
    // builder only fills empty fields, so it is idempotent.
    writeOutcome = await chunkedCommit.commitInChunks(
      chunk(planned, BATCH_SIZE),
      async (group) => {
        const batch = db.batch();
        for (const entry of group) {
          batch.update(movementsRef.doc(entry.movement.id), {
            ...entry.patch,
            updatedBy: BOT_EMAIL,
            updatedAt: FieldValue.serverTimestamp(),
            auditTrail: FieldValue.arrayUnion({
              action: 'auto-classify',
              user: BOT_EMAIL,
              timestamp: nowIso,
              detail: `Backfill retroactivo por regla "${entry.rule.name || entry.rule.pattern}"`,
            }),
          });
        }
        await batch.commit();
      },
      ({ ok, size, applied, failed, error }) => {
        if (ok) {
          console.log(`  Lote confirmado: ${applied}/${planned.length}`);
        } else {
          console.error(`  ❌ Lote fallido (${size} movimientos, ${failed} fallidos en total): ${error?.message || error}`);
        }
      },
    );

    console.log(`  Resultado de escritura: ${writeOutcome.applied} aplicados · ${writeOutcome.failed} fallidos`);

    // Bump hits only for rules that actually live in Firestore. Seed rules are
    // virtual in this script, so they have no document to increment. A failure
    // here is cosmetic (counters only) and must not hide the report either.
    const hitBumps = impacts.filter((impact) => impact.source === 'firestore' && impact.applied > 0);
    if (hitBumps.length > 0 && writeOutcome.applied > 0) {
      try {
        const batch = db.batch();
        for (const impact of hitBumps) {
          batch.update(rulesRef.doc(impact.id), {
            hits: FieldValue.increment(impact.applied),
            lastHitAt: nowIso,
          });
        }
        await batch.commit();
        console.log(`  Contadores de hits actualizados en ${hitBumps.length} regla(s) de Firestore`);
      } catch (error) {
        console.error(`  ⚠️  No se pudieron actualizar los contadores de hits: ${error?.message || error}`);
      }
    }
    if (impacts.some((impact) => impact.source === 'seed' && impact.applied > 0)) {
      console.log('  ℹ️  Las reglas seed no existen en Firestore: no se incrementó su contador de hits.');
    }

    // Re-read so the AFTER report is measured, not simulated. If the re-read
    // fails the run still reports: fall back to the simulated projection.
    try {
      const verify = await movementsRef.get();
      after = verify.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      afterIsMeasured = true;
    } catch (error) {
      console.error(`  ⚠️  No se pudo releer la colección para el informe: ${error?.message || error}`);
      console.error('     La cobertura DESPUÉS que sigue es una simulación, no una medición.');
      const patchById = new Map(planned.map((entry) => [entry.movement.id, entry.patch]));
      after = movements.map((movement) =>
        patchById.has(movement.id) ? { ...movement, ...patchById.get(movement.id) } : movement,
      );
    }
  } else {
    const patchById = new Map(planned.map((entry) => [entry.movement.id, entry.patch]));
    after = movements.map((movement) =>
      patchById.has(movement.id) ? { ...movement, ...patchById.get(movement.id) } : movement,
    );
  }

  // ── Coverage AFTER ────────────────────────────────────────────────────────
  console.log(`\n${rule('═')}`);
  console.log(afterIsMeasured ? 'COBERTURA DESPUÉS (real, releída de Firestore)' : 'COBERTURA DESPUÉS (simulada)');
  console.log(rule());
  const afterCoverage = printCoverage('', after, finance);

  const beforeCounts = countsFor(movements);
  const afterCounts = countsFor(after);
  console.log(`\n  Δ categoría:            +${afterCounts.withCategory - beforeCounts.withCategory} movs  (${pct(beforeCounts.withCategory, beforeCounts.total)} % → ${pct(afterCounts.withCategory, afterCounts.total)} %)`);
  console.log(`  Δ proyecto:             +${afterCounts.withProject - beforeCounts.withProject} movs  (${pct(beforeCounts.withProject, beforeCounts.total)} % → ${pct(afterCounts.withProject, afterCounts.total)} %)`);
  console.log(`  Δ clasificados:         +${afterCoverage.classified - before.classified} movs  (${before.pct} % → ${afterCoverage.pct} %)`);
  console.log(`  Δ salida sin clasificar: ${eur(afterCoverage.unclassifiedOutflow - before.unclassifiedOutflow)}  (${eur(before.unclassifiedOutflow)} → ${eur(afterCoverage.unclassifiedOutflow)})`);

  // ── Worklist ──────────────────────────────────────────────────────────────
  printPendingCounterparties(after, finance);

  // ── Closing banner ────────────────────────────────────────────────────────
  const rerunCommand = `node scripts/backfill-classification.cjs --apply --rules=${RULES_MODE}${LIMIT === null ? '' : ` --limit=${LIMIT}`}`;

  console.log(`\n${rule('═')}`);
  if (!APPLY) {
    console.log('🟢 DRY RUN — no se escribió nada.');
    console.log(`   Para aplicar: ${rerunCommand}`);
  } else if (planned.length === 0) {
    console.log('✅ Nada que escribir: ninguna regla aportaba datos nuevos.');
  } else if (writeOutcome.failed > 0) {
    console.log(`⚠️  APLICADO PARCIALMENTE — ${writeOutcome.applied} de ${planned.length} movimientos actualizados, ${writeOutcome.failed} sin escribir.`);
    console.log(`   Lotes fallidos: ${writeOutcome.errors.length}. Primer error: ${writeOutcome.errors[0]?.message || writeOutcome.errors[0]}`);
    console.log('   Volver a ejecutar es SEGURO: el payload sólo rellena campos vacíos, así que');
    console.log('   los movimientos ya escritos se saltan y sólo se reintentan los que faltan.');
    console.log(`   Reintento: ${rerunCommand}`);
  } else {
    console.log(`✅ APLICADO — ${writeOutcome.applied} movimientos actualizados.`);
  }
  console.log(rule('═'));

  // Partial application is a failure for the caller, but only AFTER the full
  // report has been printed.
  process.exit(writeOutcome && writeOutcome.failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error('ERROR:', error);
  process.exit(1);
});
