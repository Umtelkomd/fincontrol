/**
 * FinControl — CXC/CXP data repair.
 *
 * DRY-RUN BY DEFAULT. Nothing is written unless you pass --apply.
 *
 * Repairs, each independently selectable with --only:
 *
 *   links       Link settlements that have an unambiguous DATEV counterpart.
 *               The document is reopened (dropping the unevidenced claim) and
 *               re-settled through a real payment carrying the bankMovementId,
 *               and the movement records the allocation.
 *   duplicates  Cancel documents whose amount is already settled and
 *               bank-linked by a different document (the same obligation
 *               captured twice under different spellings).
 *   arithmetic  Fix documents where grossAmount - paidAmount != openAmount.
 *   source      Move object-valued `source` into `sourceDocument` and leave a
 *               string tag, so origin breakdowns stop showing "[object Object]".
 *   legacy      Tag settlements that predate the bank-link policy so the UI can
 *               tell "unverifiable, historical" from "recent and unevidenced".
 *
 * DELIBERATELY NOT REPAIRED (reported, never written):
 *   - documents whose cash left the bank at a different granularity — a payroll
 *     run paid as many transfers, a consolidated fuel-card debit covering many
 *     rows. Those need the guided N:M reconciliation in /cxp, not a guess.
 *   - anything ambiguous between several equally plausible movements.
 *
 * HOW TO RUN:
 *   node scripts/repair-cxc-cxp.cjs                       # dry-run, everything
 *   node scripts/repair-cxc-cxp.cjs --only=duplicates     # dry-run, one class
 *   node scripts/repair-cxc-cxp.cjs --apply               # WRITE
 *
 * Take a backup first: npm run backup:firestore
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  candidatesFor,
  docNumber,
  duplicateOf,
  grossOf,
  isPrePolicy,
  isUnlinkedSettlement,
  iso,
  label,
  num,
  settledOn,
  verdictFor,
  POLICY_START,
} = require('./lib/settlementMatch.cjs');

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;

const APPLY = process.argv.includes('--apply');
/**
 * Read documents from a `npm run backup:firestore` snapshot instead of live
 * Firestore. Dry-runs are re-run many times while a plan is being reviewed and
 * each pass reads ~1,800 documents; against the live project that exhausts the
 * daily read quota. Refused together with --apply: a snapshot is a photograph,
 * and writing from stale reads would clobber whatever changed since.
 */
const FROM_BACKUP = process.argv.find((arg) => arg.startsWith('--from-backup='))?.split('=')[1];
const ONLY = (process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1] || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const ALL_CLASSES = ['links', 'duplicates', 'arithmetic', 'source', 'legacy'];
const enabled = (name) => (ONLY.length === 0 ? true : ONLY.includes(name));

const ACTOR = 'repair-script';
const money = (value) => `${num(value).toFixed(2)} €`;

admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

/** Every intended write, collected first and only committed under --apply. */
const plan = [];
const skipped = [];

let groupSeq = 0;
const nextGroup = () => `g${(groupSeq += 1)}`;
// `group` ties writes that must land together — linking a settlement patches
// BOTH the document and the bank movement, and half of that pair is corruption.
const intend = (klass, ref, patch, summary, group = nextGroup()) =>
  plan.push({ klass, ref, patch, summary, group });
const skip = (klass, summary) => skipped.push({ klass, summary });

const section = (title) => {
  console.log(`\n${'─'.repeat(76)}`);
  console.log(title);
  console.log('─'.repeat(76));
};

// ─── repairs ─────────────────────────────────────────────────────────────────

const planLinks = (docs, movements, collection, idField) => {
  const unlinked = docs.filter(isUnlinkedSettlement);

  for (const doc of unlinked) {
    const candidates = candidatesFor(doc, movements, idField);
    const verdict = verdictFor(candidates);
    const name = `${label(doc).slice(0, 40)} · ${money(grossOf(doc))}`;

    if (verdict !== 'CONFIABLE') {
      skip('links', `${verdict.padEnd(10)} ${name}`);
      continue;
    }

    const [best] = candidates;
    const gross = grossOf(doc);
    const group = nextGroup();
    const payment = {
      date: best.postedDate,
      amount: gross,
      method: 'Transferencia',
      reference: '',
      note: `Vinculado por auditoría: coincidencia exacta con movimiento DATEV ${best.id}`,
      bankMovementId: best.id,
      reconciliationMode: 'audit-link',
      registeredBy: ACTOR,
      timestamp: new Date().toISOString(),
    };

    intend(
      'links',
      db.collection(`${BASE}/${collection}`).doc(doc.id),
      {
        // Replace the unevidenced claim outright rather than appending to it —
        // paidAmount already asserted the full gross with nothing behind it.
        payments: [payment],
        paidAmount: gross,
        openAmount: 0,
        pendingAmount: 0,
        status: 'settled',
        settlementEvidence: 'bank-linked',
        updatedBy: ACTOR,
        updatedAt: FieldValue.serverTimestamp(),
        auditTrail: FieldValue.arrayUnion({
          action: 'audit-link',
          user: ACTOR,
          timestamp: new Date().toISOString(),
          detail: `Liquidación forzada respaldada con el movimiento ${best.id} (${best.postedDate}, ${money(best.amount)})`,
        }),
      },
      `${name}  ←  ${best.postedDate} ${money(best.amount)} "${best.counterparty.slice(0, 30)}" (score ${best.score})`,
      group,
    );

    intend(
      'links',
      db.collection(`${BASE}/bankMovements`).doc(best.id),
      {
        [idField]: doc.id,
        [idField === 'payableId' ? 'payableIds' : 'receivableIds']: [doc.id],
        reconciledAt: FieldValue.serverTimestamp(),
        reconciledAmount: gross,
        unallocatedAmount: 0,
        reconciliationMode: 'audit-link',
        updatedBy: ACTOR,
        updatedAt: FieldValue.serverTimestamp(),
      },
      `   movimiento ${best.id} → ${collection}/${doc.id}`,
      group,
    );
  }
};

const planDuplicates = (docs, movements, collection, idField) => {
  for (const doc of docs) {
    const duplicate = duplicateOf(doc, docs, movements, idField);
    if (!duplicate) continue;

    intend(
      'duplicates',
      db.collection(`${BASE}/${collection}`).doc(doc.id),
      {
        status: 'cancelled',
        openAmount: 0,
        pendingAmount: 0,
        paidAmount: 0,
        payments: [],
        duplicateOf: duplicate.twinId,
        updatedBy: ACTOR,
        updatedAt: FieldValue.serverTimestamp(),
        auditTrail: FieldValue.arrayUnion({
          action: 'audit-cancel-duplicate',
          user: ACTOR,
          timestamp: new Date().toISOString(),
          detail: `Duplicado de ${duplicate.twinId}, que ya está conciliado con el movimiento ${duplicate.movementId}`,
        }),
      },
      `${doc.id}  ${label(doc).slice(0, 30).padEnd(30)} ${money(grossOf(doc)).padStart(12)}  → duplicado de ${duplicate.twinId}`,
    );
  }
};

const planArithmetic = (docs, collection) => {
  for (const doc of docs) {
    if (doc.status === 'cancelled') continue;
    const gross = grossOf(doc);
    const paid = num(doc.paidAmount);
    const open = num(doc.openAmount ?? doc.pendingAmount);
    if (Math.abs(gross - paid - open) <= 0.01 && open >= -0.01) continue;

    const payments = Array.isArray(doc.payments) ? doc.payments : [];
    // Payments are the evidence; the stored totals are the derived values, so
    // rebuild the totals from the payments rather than the other way round.
    const evidenced = payments.reduce((sum, payment) => sum + num(payment?.amount), 0);
    const nextPaid = payments.length > 0 ? Math.min(evidenced, gross) : Math.min(paid, gross);
    const nextOpen = Math.max(0, gross - nextPaid);

    intend(
      'arithmetic',
      db.collection(`${BASE}/${collection}`).doc(doc.id),
      {
        paidAmount: nextPaid,
        openAmount: nextOpen,
        pendingAmount: nextOpen,
        status: nextOpen <= 0.01 ? 'settled' : nextPaid > 0.01 ? 'partial' : 'issued',
        updatedBy: ACTOR,
        updatedAt: FieldValue.serverTimestamp(),
        auditTrail: FieldValue.arrayUnion({
          action: 'audit-fix-amounts',
          user: ACTOR,
          timestamp: new Date().toISOString(),
          detail: `Importes recalculados desde los pagos: pagado ${paid.toFixed(2)} → ${nextPaid.toFixed(2)}, abierto ${open.toFixed(2)} → ${nextOpen.toFixed(2)}`,
        }),
      },
      `${doc.id}  bruto ${money(gross)}  pagado ${money(paid)} → ${money(nextPaid)}  abierto ${money(open)} → ${money(nextOpen)}`,
    );
  }
};

const planSource = (docs, collection) => {
  for (const doc of docs) {
    if (doc.source == null || typeof doc.source !== 'object') continue;
    const tag = doc.source.type === 'gmail_attachment' ? 'gmail-import' : 'local-import';

    intend(
      'source',
      db.collection(`${BASE}/${collection}`).doc(doc.id),
      {
        source: tag,
        // Preserve the provenance rather than discarding it — it names the PDF
        // the document came from.
        sourceDocument: doc.sourceDocument || doc.source,
        updatedBy: ACTOR,
        updatedAt: FieldValue.serverTimestamp(),
      },
      `${doc.id}  ${label(doc).slice(0, 30).padEnd(30)} source → "${tag}"  (${doc.source.filename || 'sin archivo'})`,
    );
  }
};

const planLegacy = (docs, collection, resolvedIds) => {
  for (const doc of docs) {
    if (!isUnlinkedSettlement(doc)) continue;
    if (!isPrePolicy(doc)) continue;
    if (doc.settlementEvidence) continue;
    // Already being linked to a movement or cancelled as a duplicate: it is
    // getting a real answer, not an "unverifiable, historical" tag.
    if (resolvedIds.has(doc.id)) continue;

    intend(
      'legacy',
      db.collection(`${BASE}/${collection}`).doc(doc.id),
      {
        settlementEvidence: 'legacy-pre-policy',
        updatedBy: ACTOR,
        updatedAt: FieldValue.serverTimestamp(),
      },
      `${settledOn(doc)}  ${money(grossOf(doc)).padStart(12)}  ${label(doc).slice(0, 38)}`,
    );
  }
};

// ─── run ─────────────────────────────────────────────────────────────────────

(async () => {
  if (FROM_BACKUP && APPLY) {
    console.error('--apply no se combina con --from-backup: escribir desde un snapshot pisaría lo que cambió después.');
    process.exit(1);
  }

  const unknown = ONLY.filter((entry) => !ALL_CLASSES.includes(entry));
  if (unknown.length) {
    console.error(`Clases desconocidas: ${unknown.join(', ')}. Válidas: ${ALL_CLASSES.join(', ')}`);
    process.exit(1);
  }

  console.log(APPLY ? 'FinControl — REPARACIÓN CXC/CXP  [APLICANDO CAMBIOS]' : 'FinControl — REPARACIÓN CXC/CXP  [SIMULACRO — no se escribe nada]');
  console.log('═'.repeat(76));
  console.log(`Clases: ${ONLY.length ? ONLY.join(', ') : 'todas'}   ·   corte de política: ${POLICY_START}`);

  let receivables;
  let payables;
  let rawMovements;

  if (FROM_BACKUP) {
    const snapshot = JSON.parse(fs.readFileSync(FROM_BACKUP, 'utf8'));
    const data = snapshot.data || snapshot;
    receivables = data.receivables || [];
    payables = data.payables || [];
    rawMovements = data.bankMovements || [];
    console.log(`Origen: snapshot ${path.basename(FROM_BACKUP)} (${snapshot.metadata?.exportDate || 'sin fecha'})`);
  } else {
    // bankMovements is ~1,576 documents — an order of magnitude more than the
    // other two collections combined. Only `links` and `duplicates` need it, so
    // the cheap repair classes must not pay for it: reading it unconditionally
    // is what exhausted the daily read quota mid-repair.
    const needsMovements = enabled('links') || enabled('duplicates');

    const [receivablesSnap, payablesSnap] = await Promise.all([
      db.collection(`${BASE}/receivables`).get(),
      db.collection(`${BASE}/payables`).get(),
    ]);
    receivables = receivablesSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    payables = payablesSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

    if (needsMovements) {
      const movementsSnap = await db.collection(`${BASE}/bankMovements`).get();
      rawMovements = movementsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    } else {
      rawMovements = [];
    }
    console.log(
      `Origen: Firestore en vivo · ${receivables.length + payables.length + rawMovements.length} documentos leídos`
      + (needsMovements ? '' : ' (movimientos bancarios no requeridos por estas clases)'),
    );
  }

  const movements = rawMovements.filter((movement) => movement.status !== 'void');

  const inflows = movements.filter((movement) => movement.direction === 'in');
  const outflows = movements.filter((movement) => movement.direction === 'out');

  const collections = [
    { docs: receivables, name: 'receivables', idField: 'receivableId', pool: inflows },
    { docs: payables, name: 'payables', idField: 'payableId', pool: outflows },
  ];

  for (const entry of collections) {
    if (enabled('links')) planLinks(entry.docs, entry.pool, entry.name, entry.idField);
    if (enabled('duplicates')) planDuplicates(entry.docs, entry.pool, entry.name, entry.idField);
  }
  const resolvedIds = new Set(
    plan
      .filter((item) => item.klass === 'links' || item.klass === 'duplicates')
      .map((item) => item.ref.id),
  );
  for (const entry of collections) {
    if (enabled('arithmetic')) planArithmetic(entry.docs, entry.name);
    if (enabled('source')) planSource(entry.docs, entry.name);
    if (enabled('legacy')) planLegacy(entry.docs, entry.name, resolvedIds);
  }

  // Two repair classes reaching the same document contradict each other — a
  // document cannot be both "settled by movement X" and "a duplicate that never
  // should have existed". Batched together the later write silently wins, so
  // both are withdrawn and the document goes to a human instead.
  const byPath = new Map();
  plan.forEach((item) => {
    const key = item.ref.path;
    if (!byPath.has(key)) byPath.set(key, new Set());
    byPath.get(key).add(item.klass);
  });
  // Only links-vs-duplicates genuinely contradict: a document cannot be both
  // "settled by movement X" and "a duplicate that never should have existed".
  // The other classes patch disjoint fields and merge safely.
  const conflictedPaths = new Set(
    Array.from(byPath.entries())
      .filter(([, classes]) => classes.has('links') && classes.has('duplicates'))
      .map(([key]) => key),
  );
  const conflictedGroups = new Set(
    plan.filter((item) => conflictedPaths.has(item.ref.path)).map((item) => item.group),
  );

  const conflicts = plan.filter((item) => conflictedGroups.has(item.group));
  for (let index = plan.length - 1; index >= 0; index -= 1) {
    if (conflictedGroups.has(plan[index].group)) plan.splice(index, 1);
  }

  for (const klass of ALL_CLASSES) {
    if (!enabled(klass)) continue;
    const rows = plan.filter((item) => item.klass === klass);
    section(`${klass.toUpperCase()} — ${rows.length} escritura(s)`);
    if (rows.length === 0) console.log('  (nada que reparar)');
    rows.forEach((row) => console.log(`  ${row.summary}`));
  }

  if (conflicts.length) {
    section(`CONFLICTOS — ${conflictedPaths.size} documento(s) retirados del plan`);
    console.log('  Dos reparaciones distintas apuntan al mismo documento. Decidí vos.\n');
    conflicts.forEach((row) => console.log(`  [${row.klass}] ${row.summary}`));
  }

  if (enabled('links') && skipped.length) {
    section(`NO SE TOCAN — ${skipped.length} documento(s) que requieren decisión humana`);
    console.log('  El dinero pudo haber salido igual: una nómina pagada en muchas');
    console.log('  transferencias, o un débito consolidado que cubre varias filas,');
    console.log('  nunca coincide 1:1. Conciliá estos desde /cxp o /cxc.\n');
    skipped.forEach((row) => console.log(`  ${row.summary}`));
  }

  section('RESUMEN');
  console.log(`  escrituras planificadas: ${plan.length}`);
  console.log(`  retiradas por conflicto:  ${conflicts.length}`);
  console.log(`  documentos sin tocar:    ${skipped.length}`);

  if (!APPLY) {
    console.log('\n  SIMULACRO. No se escribió nada. Para aplicar:');
    console.log(`    npm run backup:firestore && node scripts/repair-cxc-cxp.cjs --apply${ONLY.length ? ` --only=${ONLY.join(',')}` : ''}`);
    process.exit(0);
  }

  if (plan.length === 0) {
    console.log('\n  Nada que aplicar.');
    process.exit(0);
  }

  // Firestore caps a batch at 500 operations.
  let committed = 0;
  for (let index = 0; index < plan.length; index += 400) {
    const chunk = plan.slice(index, index + 400);
    const batch = db.batch();
    chunk.forEach((item) => batch.update(item.ref, item.patch));
    await batch.commit();
    committed += chunk.length;
    console.log(`  commit ${committed}/${plan.length}`);
  }

  console.log(`\n  ✓ ${committed} escrituras aplicadas.`);
  console.log('  Verificá con: node scripts/audit-cxc-cxp.cjs');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
