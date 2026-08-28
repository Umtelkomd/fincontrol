/**
 * FinControl — Match unlinked settlements against DATEV bank movements (READ-ONLY)
 *
 * Context: 89 CXC/CXP documents sit in status "settled"/"partial" with no payment
 * linked to a bankMovement (see scripts/audit-cxc-cxp.cjs, class A). Most reached
 * that state through the `forceStatus` admin override, which skips the
 * "every payment links a bankMovement" policy.
 *
 * This script answers the only question that matters before repairing anything:
 *   did the cash actually move?
 *
 * For each unlinked document it searches bankMovements for a plausible
 * counterpart and scores the match, so the repair splits into:
 *   - CONFIABLE  -> a single strong candidate; link it, the settlement was real
 *   - AMBIGUO    -> several plausible candidates; a human picks
 *   - SIN RASTRO -> no candidate; the settlement has NO cash behind it
 *
 * DOES NOT WRITE OR DELETE ANYTHING.
 *
 * HOW TO RUN:
 *   node scripts/match-unlinked-settlements.cjs                 # post-policy CXP (the real problem)
 *   node scripts/match-unlinked-settlements.cjs --all           # every unlinked doc, both collections
 *   node scripts/match-unlinked-settlements.cjs --json          # machine-readable, for the repair step
 */

const admin = require('firebase-admin');
const path = require('path');
const os = require('os');

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;
const POLICY_START = '2026-05-09';

const ALL = process.argv.includes('--all');
const AS_JSON = process.argv.includes('--json');

/** A movement this far from the document's settlement date is not the same event. */
const DATE_WINDOW_DAYS = 45;
/** Cents of tolerance when comparing a document total to a bank movement. */
const AMOUNT_TOLERANCE = 0.01;
/** Below this score a candidate is noise, not a lead. */
const MIN_SCORE = 50;
/** A single candidate at or above this score is safe to link without review. */
const CONFIDENT_SCORE = 85;

admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => `${num(value).toFixed(2)} €`;

const iso = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  if (value._seconds) return new Date(value._seconds * 1000).toISOString().slice(0, 10);
  return '';
};

const daysBetween = (left, right) => {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((new Date(left) - new Date(right)) / 86400000));
};

const label = (doc) => doc.counterpartyName || doc.vendor || doc.client || doc.description || doc.id;

/** Words long enough to identify a counterparty; drops legal-form noise. */
const NOISE = new Set(['gmbh', 'sl', 'slu', 'scp', 'sa', 'ag', 'ltd', 'the', 'und', 'von', 'der']);
const tokens = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !NOISE.has(token));

const nameOverlap = (left, right) => {
  const a = new Set(tokens(left));
  const b = tokens(right);
  if (a.size === 0 || b.length === 0) return 0;
  const hits = b.filter((token) => a.has(token)).length;
  return hits / Math.max(a.size, b.length);
};

/**
 * Score how likely `movement` is the cash counterpart of `doc`.
 * Amount is the backbone; date and name only refine. A movement already tied to
 * another document is disqualified rather than penalised — it is taken.
 */
const scoreCandidate = (doc, movement, anchorDate, ownIdField) => {
  const gross = num(doc.grossAmount ?? doc.amount);
  const moved = num(movement.amount);
  if (Math.abs(gross - moved) > AMOUNT_TOLERANCE) return null;

  const takenBy = movement[ownIdField];
  if (takenBy && takenBy !== doc.id) return null;

  const gap = Math.min(
    daysBetween(movement.postedDate, anchorDate),
    daysBetween(movement.postedDate, iso(doc.dueDate)),
  );
  if (gap > DATE_WINDOW_DAYS) return null;

  let score = 50; // exact amount
  if (gap <= 5) score += 30;
  else if (gap <= 15) score += 20;
  else if (gap <= 30) score += 10;

  const overlap = nameOverlap(label(doc), movement.counterpartyName);
  if (overlap >= 0.5) score += 20;
  else if (overlap > 0) score += 10;
  else if (nameOverlap(label(doc), movement.description) > 0) score += 5;

  if (!movement.reconciledAt) score += 5;

  return {
    id: movement.id,
    postedDate: movement.postedDate,
    amount: moved,
    counterparty: movement.counterpartyName || '',
    gapDays: gap,
    score,
    alreadyLinkedTo: takenBy || null,
  };
};

const classify = (candidates) => {
  const strong = candidates.filter((candidate) => candidate.score >= MIN_SCORE);
  if (strong.length === 0) return 'SIN RASTRO';
  const best = strong[0];
  const runnerUp = strong[1];
  if (best.score >= CONFIDENT_SCORE && (!runnerUp || best.score - runnerUp.score >= 15)) {
    return 'CONFIABLE';
  }
  return 'AMBIGUO';
};

async function run() {
  const [receivablesSnap, payablesSnap, movementsSnap] = await Promise.all([
    db.collection(`${BASE}/receivables`).get(),
    db.collection(`${BASE}/payables`).get(),
    db.collection(`${BASE}/bankMovements`).get(),
  ]);

  const movements = movementsSnap.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .filter((movement) => movement.status !== 'void');

  const outflows = movements.filter((movement) => movement.direction === 'out');
  const inflows = movements.filter((movement) => movement.direction === 'in');

  const collections = [
    {
      key: 'payables',
      title: 'CXP',
      docs: payablesSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
      pool: outflows,
      idField: 'payableId',
    },
    {
      key: 'receivables',
      title: 'CXC',
      docs: receivablesSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
      pool: inflows,
      idField: 'receivableId',
    },
  ];

  const results = [];

  for (const collection of collections) {
    const unlinked = collection.docs
      .filter((doc) => doc.status === 'settled' || doc.status === 'partial')
      .filter((doc) => {
        const payments = Array.isArray(doc.payments) ? doc.payments : [];
        return !payments.some((payment) => payment && payment.bankMovementId);
      })
      .map((doc) => ({ doc, anchorDate: iso(doc.updatedAt) || iso(doc.dueDate) }))
      .filter(({ anchorDate }) => (ALL ? true : anchorDate >= POLICY_START))
      .filter(() => (ALL ? true : collection.key === 'payables'));

    for (const { doc, anchorDate } of unlinked) {
      const candidates = collection.pool
        .map((movement) => scoreCandidate(doc, movement, anchorDate, collection.idField))
        .filter(Boolean)
        .sort((left, right) => right.score - left.score);

      results.push({
        collection: collection.key,
        title: collection.title,
        id: doc.id,
        name: label(doc),
        amount: num(doc.grossAmount ?? doc.amount),
        status: doc.status,
        settledOn: anchorDate,
        verdict: classify(candidates),
        candidates: candidates.slice(0, 3),
      });
    }
  }

  results.sort((left, right) => right.amount - left.amount);

  if (AS_JSON) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const scope = ALL ? 'TODOS los documentos sin vínculo' : `CXP posteriores a ${POLICY_START}`;
  console.log('FinControl — ¿La plata se movió de verdad? (solo lectura)');
  console.log('═'.repeat(76));
  console.log(`Alcance: ${scope}   ·   ${results.length} documentos   ·   ${money(results.reduce((total, row) => total + row.amount, 0))}`);

  for (const verdict of ['CONFIABLE', 'AMBIGUO', 'SIN RASTRO']) {
    const group = results.filter((row) => row.verdict === verdict);
    const total = group.reduce((sum, row) => sum + row.amount, 0);
    console.log(`\n${'─'.repeat(76)}`);
    console.log(`${verdict} — ${group.length} documentos · ${money(total)}`);
    console.log('─'.repeat(76));
    if (group.length === 0) {
      console.log('  (ninguno)');
      continue;
    }
    for (const row of group) {
      console.log(`\n  [${row.title}] ${row.name.slice(0, 46)}`);
      console.log(`        ${money(row.amount).padStart(12)}  liquidada ${row.settledOn}  (${row.id})`);
      if (row.candidates.length === 0) {
        console.log('        └─ ningún movimiento bancario con ese importe en ±45 días');
      }
      row.candidates.forEach((candidate, index) => {
        const mark = index === 0 ? '└─' : '  ';
        console.log(
          `        ${mark} score ${String(candidate.score).padStart(3)}  ${candidate.postedDate}  ${money(candidate.amount).padStart(11)}  Δ${candidate.gapDays}d  ${candidate.counterparty.slice(0, 34)}`,
        );
      });
    }
  }

  console.log(`\n${'═'.repeat(76)}`);
  console.log('CONFIABLE  → vincular automáticamente: el pago existió, faltaba el enlace.');
  console.log('AMBIGUO    → requiere que elijas cuál movimiento corresponde.');
  console.log('SIN RASTRO → no hay pago en el banco: la deuda sigue viva y hay que reabrirla.');
  console.log('\nSolo lectura. No se modificó nada.');
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
