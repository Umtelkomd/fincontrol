/**
 * FinControl — Category taxonomy v2 migration (2026 data)
 * ────────────────────────────────────────────────────────
 * Moves every category join key in production from the flat, duplicated
 * catalogue to the grouped taxonomy in `src/finance/taxonomy.js`. The mapping
 * is NOT reimplemented here: `resolveLegacyCategory` — the same function the
 * app uses to roll legacy names up — decides every rename, including the split
 * categories (Seguros / Impuestos / Administrativo / Intereses Bancos) that are
 * settled per document from counterparty and purpose line.
 *
 * Scope: 2026 only. 2025 bankMovements and the historical `transactions` are
 * NEVER rewritten; they keep reporting through the legacy map.
 *
 * Steps, in order:
 *   1. settings/categories       → versioned v2 document
 *   2. bankMovements (2026)      → categoryName renamed / split; `kind: 'transfer'`
 *                                  for Transferencia interna; an EMPTY costScope
 *                                  filled with 'overhead' when the category
 *                                  defaults to overhead (never 'project')
 *   3. classificationRules       → applyTo.categoryName renamed (split decided
 *                                  from the rule's own pattern)
 *   4. seed rules                → SEED_CLASSIFICATION_RULES missing by name and
 *                                  by field+pattern are created
 *   5. receivables, payables     → categoryName renamed (type-aware "Otros")
 *   6. budgets (year 2026)       → lines renamed and merged (monthlyBudget summed)
 *   7. settings/vatRates.rates   → keys renamed
 *   8. coverage before / after   → same definition as the app (costScope.js)
 *
 * HOW TO RUN:
 *   node scripts/migrate-category-taxonomy.cjs            # dry-run (default)
 *   node scripts/migrate-category-taxonomy.cjs --apply    # WRITES (backup first)
 *
 * --apply always runs `scripts/exportFirestoreBackup.mjs` BEFORE the first write
 * and aborts if the backup does not produce a readable file. Every touched
 * document gets an auditTrail entry `{ action: 'taxonomy-v2', before: { categoryName } }`.
 *
 * Idempotent: a second run resolves every v2 name to itself and finds nothing
 * to write. A failing batch does not abort the run — the report is printed with
 * the real applied/failed counts and the process exits 1.
 *
 * Afterwards: `node scripts/backfill-classification.cjs --rules=firestore --apply`
 * applies the new rules to still-empty movements (it never overwrites).
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

const BATCH_SIZE = 400;
const SAMPLE_LIMIT = 3;
const BOT_EMAIL = 'migrate-category-taxonomy@umtelkomd.com';
const BOT_NAME = 'migrate-category-taxonomy';
const YEAR_START = '2026-01-01';
const BUDGET_YEAR = 2026;

const SPLIT_LEGACY_NAMES = new Set(['Seguros', 'Impuestos', 'Administrativo', 'Intereses Bancos', 'Otros']);

// ── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};
const APPLY = argv.includes('--apply');
const unknown = argv.filter((entry) => entry !== '--apply');
if (unknown.length > 0) fail(`Argumento no reconocido: ${unknown.join(', ')}`);

// ── Formatting helpers (operator-facing output is Spanish) ──────────────────

const eurFormatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const eur = (value) => eurFormatter.format(Number(value) || 0);
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

/** Load an ES module from src/ into this CJS script. */
const loadEsm = (relativePath) => import(pathToFileURL(path.join(REPO_ROOT, relativePath)).href);

const chunk = (items, size) => {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// ── Tally helpers ───────────────────────────────────────────────────────────

/** old → new counter with a few sample lines per pair. */
const createTally = () => new Map();
const tally = (map, from, to, sample) => {
  const key = `${from}→${to}`;
  if (!map.has(key)) map.set(key, { from, to, count: 0, samples: [] });
  const entry = map.get(key);
  entry.count += 1;
  if (sample && entry.samples.length < SAMPLE_LIMIT) entry.samples.push(sample);
  return entry;
};
const sortedTally = (map) => Array.from(map.values()).sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

const printTally = (map, { fromLabel = 'Antes', toLabel = 'Después', withSamples = false } = {}) => {
  const rows = sortedTally(map);
  if (rows.length === 0) {
    console.log('  (nada que renombrar)');
    return;
  }
  console.log(`  ${padEnd(fromLabel, 28)} ${padEnd(toLabel, 46)} ${padStart('Docs', 6)}`);
  console.log(`  ${rule('-', 28)} ${rule('-', 46)} ${rule('-', 6)}`);
  for (const row of rows) {
    console.log(`  ${padEnd(row.from, 28)} ${padEnd(row.to, 46)} ${padStart(row.count, 6)}`);
    if (withSamples) row.samples.forEach((sample) => console.log(`      · ${clip(sample, 88)}`));
  }
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

(async () => {
  const [taxonomy, seedModule, ruleAuthoring, costScope, schemas, chunkedCommit] = await Promise.all([
    loadEsm('src/finance/taxonomy.js'),
    loadEsm('src/finance/seedRules.js'),
    loadEsm('src/finance/ruleAuthoring.js'),
    loadEsm('src/finance/costScope.js'),
    loadEsm('src/finance/assetSchemas.js'),
    loadEsm('src/utils/chunkedCommit.js'),
  ]);
  const {
    TAXONOMY_VERSION,
    EXPENSE_CATEGORY_NAMES,
    INCOME_CATEGORY_NAMES,
    INTERNAL_CATEGORY_NAMES,
    categoryByName,
    resolveLegacyCategory,
  } = taxonomy;

  if (!fs.existsSync(KEY_PATH)) fail(`No se encontró la clave de servicio: ${KEY_PATH}`);
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  }
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;
  const base = `artifacts/${APP_ID}/public/data`;
  const col = (name) => db.collection(`${base}/${name}`);
  const settingsDoc = (name) => db.doc(`${base}/settings/${name}`);

  console.log(rule('═'));
  console.log(`MIGRACIÓN TAXONOMÍA DE CATEGORÍAS v${TAXONOMY_VERSION} — datos 2026`);
  console.log(rule('═'));
  console.log(`Modo:        ${APPLY ? '🔴 APPLY (escribe en producción)' : '🟢 DRY-RUN (no escribe)'}`);
  console.log(`Base:        ${base}`);

  const nowIso = new Date().toISOString();
  const auditEntry = (before, detail) => ({
    action: 'taxonomy-v2',
    user: BOT_EMAIL,
    timestamp: nowIso,
    before,
    detail,
  });

  // ── Load everything up front (read-only) ──────────────────────────────────
  const [
    categoriesSnap,
    vatRatesSnap,
    movementsSnap,
    rulesSnap,
    receivablesSnap,
    payablesSnap,
    budgetsSnap,
  ] = await Promise.all([
    settingsDoc('categories').get(),
    settingsDoc('vatRates').get(),
    col('bankMovements').get(),
    col('classificationRules').get(),
    col('receivables').get(),
    col('payables').get(),
    col('budgets').get(),
  ]);
  const docsOf = (snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const allMovements = docsOf(movementsSnap);
  const rules = docsOf(rulesSnap);
  const receivables = docsOf(receivablesSnap);
  const payables = docsOf(payablesSnap);
  const budgets = docsOf(budgetsSnap);

  const movements2026 = allMovements.filter((m) => text(m.postedDate) >= YEAR_START);
  const live2026 = movements2026.filter((m) => m.status !== 'void');
  console.log(`Leído:       ${allMovements.length} bankMovements (${movements2026.length} de 2026, ${live2026.length} no anulados) · ${rules.length} reglas · ${receivables.length} CXC · ${payables.length} CXP · ${budgets.length} presupuestos`);

  const writes = []; // { collection, label, apply: (batch) => void }
  const unresolved = createTally(); // names the taxonomy does not know, per collection

  // ── 1. settings/categories ────────────────────────────────────────────────
  banner('1. settings/categories');
  const currentCategories = categoriesSnap.exists ? categoriesSnap.data() : null;
  const currentVersion = currentCategories ? Number(currentCategories.version) || 1 : null;
  const v2CategoriesDoc = {
    version: TAXONOMY_VERSION,
    expenseCategories: [...EXPENSE_CATEGORY_NAMES],
    incomeCategories: [...INCOME_CATEGORY_NAMES],
    internalCategories: [...INTERNAL_CATEGORY_NAMES],
  };
  const sameLists = currentCategories
    && currentVersion === TAXONOMY_VERSION
    && ['expenseCategories', 'incomeCategories', 'internalCategories'].every(
      (key) => JSON.stringify(currentCategories[key] || []) === JSON.stringify(v2CategoriesDoc[key]),
    );
  if (sameLists) {
    console.log(`  Ya está en v${TAXONOMY_VERSION} con las mismas listas → sin cambios.`);
  } else {
    console.log(`  Documento actual: ${currentCategories ? `versión ${currentVersion} (${(currentCategories.expenseCategories || []).length} gastos / ${(currentCategories.incomeCategories || []).length} ingresos)` : 'no existe'}`);
    console.log(`  Se escribe:       versión ${TAXONOMY_VERSION} (${v2CategoriesDoc.expenseCategories.length} gastos / ${v2CategoriesDoc.incomeCategories.length} ingresos / ${v2CategoriesDoc.internalCategories.length} internas)`);
    writes.push({
      collection: 'settings/categories',
      label: 'settings/categories',
      apply: (batch) => batch.set(settingsDoc('categories'), {
        ...v2CategoriesDoc,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: BOT_NAME,
      }),
    });
  }

  // ── 2. bankMovements 2026 ─────────────────────────────────────────────────
  banner('2. bankMovements 2026 — categoryName');
  const movementTally = createTally();
  const splitTally = createTally();
  const movementPatches = new Map(); // id → patch
  let transfersStamped = 0;
  let scopesFilled = 0;

  for (const movement of live2026) {
    const oldName = text(movement.categoryName);
    if (!oldName) continue;
    const newName = resolveLegacyCategory({
      categoryName: oldName,
      direction: movement.direction,
      counterpartyName: movement.counterpartyName,
      description: movement.description,
    });
    if (!newName) {
      tally(unresolved, 'bankMovements', oldName, `${movement.id} · ${movement.counterpartyName || '—'} · ${movement.description || ''}`);
      continue;
    }
    const category = categoryByName(newName);
    const patch = {};
    if (newName !== oldName) {
      patch.categoryName = newName;
      tally(movementTally, oldName, newName);
      if (SPLIT_LEGACY_NAMES.has(oldName) || movement.direction === 'in') {
        tally(splitTally, oldName, newName, `[${movement.direction}] ${movement.counterpartyName || '—'} · ${movement.description || ''}`);
      }
    }
    if (category.type === 'internal' && String(movement.kind || '').toLowerCase() !== 'transfer') {
      patch.kind = 'transfer';
      transfersStamped += 1;
    }
    if (
      movement.direction === 'out'
      && category.defaultScope === costScope.COST_SCOPE.OVERHEAD
      && !costScope.normalizeCostScope(movement)
    ) {
      patch.costScope = costScope.COST_SCOPE.OVERHEAD;
      scopesFilled += 1;
    }
    if (Object.keys(patch).length === 0) continue;
    movementPatches.set(movement.id, patch);
    writes.push({
      collection: 'bankMovements',
      label: `bankMovements/${movement.id}`,
      apply: (batch) => batch.update(col('bankMovements').doc(movement.id), {
        ...patch,
        updatedBy: BOT_EMAIL,
        updatedAt: FieldValue.serverTimestamp(),
        auditTrail: FieldValue.arrayUnion(auditEntry(
          { categoryName: oldName },
          `Taxonomía v${TAXONOMY_VERSION}: ${oldName} → ${newName}${patch.kind ? ' · kind=transfer' : ''}${patch.costScope ? ` · costScope=${patch.costScope}` : ''}`,
        )),
      }),
    });
  }
  console.log(`  Movimientos con categoría: ${live2026.filter((m) => text(m.categoryName)).length} · a renombrar: ${sortedTally(movementTally).reduce((sum, row) => sum + row.count, 0)} · kind=transfer: ${transfersStamped} · costScope=overhead rellenado: ${scopesFilled}`);
  console.log('');
  printTally(movementTally);
  console.log('\n  Decisiones por movimiento (categorías divididas y entradas), con muestras:');
  printTally(splitTally, { withSamples: true });

  // ── 3. classificationRules ────────────────────────────────────────────────
  banner('3. classificationRules — applyTo.categoryName');
  const ruleTally = createTally();
  const renamedRules = [];
  for (const entry of rules) {
    const applyTo = schemas.normalizeRuleApplyTo(entry.applyTo);
    const oldName = applyTo.categoryName;
    if (!oldName) continue;
    const field = schemas.RULE_FIELDS.includes(entry.field) ? entry.field : 'counterpartyName';
    const direction = entry.direction === 'in' || entry.direction === 'out' ? entry.direction : '';
    const newName = resolveLegacyCategory({
      categoryName: oldName,
      direction,
      counterpartyName: field === 'counterpartyName' ? entry.pattern : '',
      description: field === 'description' ? entry.pattern : '',
    });
    if (!newName) {
      tally(unresolved, 'classificationRules', oldName, `${entry.name || entry.pattern} (${field}: ${entry.pattern}, ${entry.direction || 'both'})`);
      continue;
    }
    if (newName === oldName) continue;
    tally(ruleTally, oldName, newName);
    renamedRules.push({ name: entry.name || entry.pattern, pattern: entry.pattern, oldName, newName });
    writes.push({
      collection: 'classificationRules',
      label: `classificationRules/${entry.id}`,
      apply: (batch) => batch.update(col('classificationRules').doc(entry.id), {
        'applyTo.categoryName': newName,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: BOT_EMAIL,
        auditTrail: FieldValue.arrayUnion(auditEntry({ categoryName: oldName }, `Taxonomía v${TAXONOMY_VERSION}: ${oldName} → ${newName}`)),
      }),
    });
  }
  console.log(`  Reglas con categoría: ${rules.filter((r) => text(r.applyTo?.categoryName)).length} · a renombrar: ${renamedRules.length}`);
  console.log('');
  printTally(ruleTally);
  if (renamedRules.length > 0) {
    console.log('');
    renamedRules
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((r) => console.log(`    ${padEnd(clip(r.name, 46), 46)} ${padEnd(r.oldName, 20)} → ${r.newName}`));
  }

  // ── 4. Seed rules missing ─────────────────────────────────────────────────
  banner('4. Reglas seed que faltan (SEED_CLASSIFICATION_RULES)');
  const existingNames = new Set(rules.map((r) => text(r.name)).filter(Boolean));
  const existingKeys = new Set(rules.map(ruleAuthoring.ruleSeedKey).filter(Boolean));
  const seedsToCreate = [];
  let seedsByName = 0;
  let seedsByKey = 0;
  for (const seed of seedModule.SEED_CLASSIFICATION_RULES) {
    if (existingNames.has(seed.name)) { seedsByName += 1; continue; }
    // Same field + pattern under another name (e.g. the rules the people/entity
    // script created): creating a twin would make two rules fight for one
    // movement, so it is skipped exactly like the app's seed import does.
    if (existingKeys.has(ruleAuthoring.ruleSeedKey(seed))) { seedsByKey += 1; continue; }
    seedsToCreate.push(seed);
  }
  console.log(`  Catálogo: ${seedModule.SEED_CLASSIFICATION_RULES.length} · ya existen por nombre: ${seedsByName} · ya existen por campo+patrón: ${seedsByKey} · a crear: ${seedsToCreate.length}`);
  if (seedsToCreate.length > 0) {
    console.log('');
    console.log(`  ${padEnd('Regla', 60)} ${padEnd('Campo', 16)} ${padEnd('Dir', 5)} ${padEnd('Categoría', 40)}`);
    console.log(`  ${rule('-', 60)} ${rule('-', 16)} ${rule('-', 5)} ${rule('-', 40)}`);
    for (const seed of seedsToCreate) {
      console.log(`  ${padEnd(seed.name, 60)} ${padEnd(seed.field, 16)} ${padEnd(seed.direction, 5)} ${padEnd(seed.applyTo.categoryName, 40)}`);
      writes.push({
        collection: 'classificationRules',
        label: `classificationRules/+${seed.name}`,
        apply: (batch) => batch.set(col('classificationRules').doc(), seedModule.seedRuleToDoc(seed, BOT_EMAIL)),
      });
    }
  }

  // ── 5. receivables / payables ─────────────────────────────────────────────
  const migrateDocuments = (collection, docs, type) => {
    const documentTally = createTally();
    let touched = 0;
    for (const entry of docs) {
      const oldName = text(entry.categoryName);
      if (!oldName) continue;
      const newName = resolveLegacyCategory({
        categoryName: oldName,
        type,
        counterpartyName: entry.counterpartyName || entry.client || entry.vendor || '',
        description: entry.description || entry.concept || '',
      });
      if (!newName) {
        tally(unresolved, collection, oldName, `${entry.id} · ${entry.counterpartyName || entry.client || entry.vendor || '—'}`);
        continue;
      }
      if (newName === oldName) continue;
      touched += 1;
      tally(documentTally, oldName, newName);
      writes.push({
        collection,
        label: `${collection}/${entry.id}`,
        apply: (batch) => batch.update(col(collection).doc(entry.id), {
          categoryName: newName,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: BOT_EMAIL,
          auditTrail: FieldValue.arrayUnion(auditEntry({ categoryName: oldName }, `Taxonomía v${TAXONOMY_VERSION}: ${oldName} → ${newName}`)),
        }),
      });
    }
    return { documentTally, touched };
  };
  banner('5. receivables (CXC) y payables (CXP) — categoryName');
  const cxc = migrateDocuments('receivables', receivables, 'income');
  const cxp = migrateDocuments('payables', payables, 'expense');
  console.log(`  CXC con categoría: ${receivables.filter((r) => text(r.categoryName)).length} · a renombrar: ${cxc.touched}`);
  printTally(cxc.documentTally);
  console.log(`\n  CXP con categoría: ${payables.filter((p) => text(p.categoryName)).length} · a renombrar: ${cxp.touched}`);
  printTally(cxp.documentTally);

  // ── 6. budgets 2026 ───────────────────────────────────────────────────────
  banner(`6. budgets ${BUDGET_YEAR} — lines[].categoryName / categoryId`);
  const budgets2026 = budgets.filter((b) => Number(b.year) === BUDGET_YEAR);
  const budgetTally = createTally();
  let budgetLinesRenamed = 0;
  let budgetLinesMerged = 0;
  for (const budget of budgets2026) {
    const lines = Array.isArray(budget.lines) ? budget.lines : [];
    if (lines.length === 0) continue;
    const merged = new Map(); // `${name}|${type}` → line
    let changed = false;
    for (const line of lines) {
      const oldName = text(line.categoryName);
      const type = line.type === 'income' ? 'income' : 'expense';
      let nextLine = { ...line };
      if (oldName) {
        const newName = resolveLegacyCategory({ categoryName: oldName, type });
        if (!newName) {
          tally(unresolved, `budgets/${budget.id}`, oldName, `línea ${line.id || '?'} (${type})`);
        } else if (newName !== oldName) {
          nextLine = { ...line, categoryName: newName, categoryId: newName };
          tally(budgetTally, oldName, newName);
          budgetLinesRenamed += 1;
          changed = true;
        } else if (text(line.categoryId) !== newName && categoryByName(oldName)) {
          // Already a v2 name but the id still carries the legacy value.
          nextLine = { ...line, categoryId: newName };
          changed = true;
        }
      }
      const key = `${text(nextLine.categoryName)}|${type}`;
      if (!merged.has(key)) {
        merged.set(key, nextLine);
        continue;
      }
      // Two legacy lines collapse into one v2 category: sum the twelve months.
      const target = merged.get(key);
      const sum = Array.from({ length: 12 }, (_, month) => (Number(target.monthlyBudget?.[month]) || 0) + (Number(nextLine.monthlyBudget?.[month]) || 0));
      merged.set(key, {
        ...target,
        monthlyBudget: sum,
        notes: [target.notes, nextLine.notes].map(text).filter(Boolean).join(' · '),
      });
      budgetLinesMerged += 1;
      changed = true;
    }
    if (!changed) continue;
    const nextLines = Array.from(merged.values());
    writes.push({
      collection: 'budgets',
      label: `budgets/${budget.id}`,
      apply: (batch) => batch.update(col('budgets').doc(budget.id), {
        lines: nextLines,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: BOT_EMAIL,
        auditTrail: FieldValue.arrayUnion(auditEntry(
          { lines: lines.map((line) => ({ id: line.id || '', categoryName: line.categoryName || '', type: line.type || '' })) },
          `Taxonomía v${TAXONOMY_VERSION}: ${lines.length} líneas → ${nextLines.length}`,
        )),
      }),
    });
  }
  console.log(`  Presupuestos ${BUDGET_YEAR}: ${budgets2026.length} · líneas renombradas: ${budgetLinesRenamed} · líneas fusionadas: ${budgetLinesMerged}`);
  printTally(budgetTally);

  // ── 7. settings/vatRates ──────────────────────────────────────────────────
  banner('7. settings/vatRates — claves de rates');
  const vatTally = createTally();
  if (!vatRatesSnap.exists) {
    console.log('  El documento no existe → nada que renombrar (la app lo siembra con claves v2).');
  } else {
    const rates = vatRatesSnap.data()?.rates || {};
    const nextRates = {};
    const conflicts = [];
    for (const [name, value] of Object.entries(rates)) {
      const newName = categoryByName(name) ? name : (resolveLegacyCategory({ categoryName: name, type: 'expense' }) || resolveLegacyCategory({ categoryName: name, type: 'income' }));
      if (!newName) {
        tally(unresolved, 'settings/vatRates', name, `tipo ${value}`);
        nextRates[name] = value;
        continue;
      }
      if (newName !== name) tally(vatTally, name, newName, `tipo ${value}`);
      if (newName in nextRates && nextRates[newName] !== value) {
        // Two legacy keys collapse into one v2 key with different rates: the
        // literal v2 key (if it existed) or the first one seen wins; report it.
        conflicts.push(`${newName}: se conserva ${nextRates[newName]}, se descarta ${value} (de "${name}")`);
        continue;
      }
      nextRates[newName] = value;
    }
    const changed = JSON.stringify(rates) !== JSON.stringify(nextRates);
    console.log(`  Claves: ${Object.keys(rates).length} → ${Object.keys(nextRates).length}${changed ? '' : ' · sin cambios'}`);
    printTally(vatTally, { withSamples: true });
    conflicts.forEach((line) => console.log(`  ⚠️  ${line}`));
    if (changed) {
      writes.push({
        collection: 'settings/vatRates',
        label: 'settings/vatRates',
        apply: (batch) => batch.update(settingsDoc('vatRates'), {
          rates: nextRates,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: BOT_NAME,
        }),
      });
    }
  }

  // ── Unresolved names ──────────────────────────────────────────────────────
  banner('Nombres que la taxonomía NO conoce (se dejan tal cual)');
  if (unresolved.size === 0) {
    console.log('  Ninguno.');
  } else {
    printTally(unresolved, { fromLabel: 'Colección', toLabel: 'Nombre', withSamples: true });
  }

  // ── 8. Coverage before / after (2026) ─────────────────────────────────────
  const printCoverage = (label, list) => {
    const coverage = costScope.classificationCoverage(list);
    const withCategory = list.filter((m) => m.status !== 'void' && text(m.categoryName)).length;
    console.log(`${label}`);
    console.log(`  Movimientos 2026 (no anulados): ${coverage.total}`);
    console.log(`  Con categoría:                  ${withCategory} (${coverage.total ? (Math.round((withCategory / coverage.total) * 1000) / 10).toFixed(1) : '0.0'} %)`);
    console.log(`  Clasificados por completo:      ${coverage.classified} (${coverage.pct} %)`);
    console.log(`  Destino obra / estructura / transferencia / sin resolver: ${coverage.byScope.project} / ${coverage.byScope.overhead} / ${coverage.byScope.transfer} / ${coverage.byScope.unresolved}`);
    console.log(`  Salida sin clasificar:          ${eur(coverage.unclassifiedOutflow)}`);
    return coverage;
  };
  banner('8. Cobertura 2026 — misma definición que la app (costScope.classificationCoverage)');
  const before = printCoverage('ANTES', live2026);
  const projected = live2026.map((m) => (movementPatches.has(m.id) ? { ...m, ...movementPatches.get(m.id) } : m));
  console.log('');
  const after = printCoverage('DESPUÉS (proyectado, sólo por esta migración; el backfill de reglas va aparte)', projected);
  console.log(`\n  Δ clasificados: +${after.classified - before.classified} (${before.pct} % → ${after.pct} %) · Δ salida sin clasificar: ${eur(after.unclassifiedOutflow - before.unclassifiedOutflow)}`);

  // ── Plan summary ──────────────────────────────────────────────────────────
  banner('PLAN DE ESCRITURA');
  const byCollection = writes.reduce((acc, write) => {
    acc[write.collection] = (acc[write.collection] || 0) + 1;
    return acc;
  }, {});
  if (writes.length === 0) {
    console.log('  Nada que escribir: todo está ya en la taxonomía v2.');
  } else {
    Object.entries(byCollection)
      .sort((a, b) => b[1] - a[1])
      .forEach(([collection, count]) => console.log(`  ${padEnd(collection, 24)} ${padStart(count, 6)} escrituras`));
    console.log(`  ${padEnd('TOTAL', 24)} ${padStart(writes.length, 6)}`);
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  let outcome = null;
  if (APPLY && writes.length > 0) {
    takeBackup();
    console.log(`\nEscribiendo ${writes.length} documentos en lotes de ${BATCH_SIZE}…`);
    outcome = await chunkedCommit.commitInChunks(
      chunk(writes, BATCH_SIZE),
      async (group) => {
        const batch = db.batch();
        for (const write of group) write.apply(batch);
        await batch.commit();
      },
      ({ ok, size, applied, failed, error }) => {
        if (ok) console.log(`  Lote confirmado: ${applied}/${writes.length}`);
        else console.error(`  ❌ Lote fallido (${size} documentos, ${failed} fallidos en total): ${error?.message || error}`);
      },
    );
    console.log(`  Resultado: ${outcome.applied} aplicados · ${outcome.failed} fallidos`);

    try {
      const verify = await col('bankMovements').where('postedDate', '>=', YEAR_START).get();
      const measured = docsOf(verify).filter((m) => m.status !== 'void');
      console.log('');
      printCoverage('COBERTURA 2026 DESPUÉS (real, releída de Firestore)', measured);
    } catch (error) {
      console.error(`  ⚠️  No se pudo releer bankMovements para medir la cobertura: ${error?.message || error}`);
    }
  }

  // ── Closing banner ────────────────────────────────────────────────────────
  console.log(`\n${rule('═')}`);
  if (!APPLY) {
    console.log('🟢 DRY RUN — no se escribió nada.');
    console.log('   Para aplicar: node scripts/migrate-category-taxonomy.cjs --apply');
    console.log('   Después:      node scripts/backfill-classification.cjs --rules=firestore --apply');
  } else if (writes.length === 0) {
    console.log('✅ Nada que escribir: la taxonomía v2 ya está aplicada.');
  } else if (outcome.failed > 0) {
    console.log(`⚠️  APLICADO PARCIALMENTE — ${outcome.applied} de ${writes.length} documentos, ${outcome.failed} sin escribir.`);
    console.log(`   Primer error: ${outcome.errors[0]?.message || outcome.errors[0]}`);
    console.log('   Volver a ejecutar es SEGURO: un nombre v2 se resuelve a sí mismo, así que sólo se reintenta lo que falta.');
  } else {
    console.log(`✅ APLICADO — ${outcome.applied} documentos actualizados.`);
    console.log('   Siguiente paso: node scripts/backfill-classification.cjs --rules=firestore --apply');
  }
  console.log(rule('═'));

  process.exit(outcome && outcome.failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error('ERROR:', error);
  process.exit(1);
});
