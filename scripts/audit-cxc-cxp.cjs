/**
 * FinControl — CXC/CXP Forensic Audit (READ-ONLY)
 *
 * Complements diagnose-data.cjs. Where that one COUNTS problems, this one
 * NAMES them: it dumps the actual offending documents so a human can decide
 * which are legitimate legacy records and which are corrupt.
 *
 * Problem classes reported:
 *   A. settled/partial with no payment linked to a bankMovement
 *   B. arithmetic incoherence (grossAmount - paidAmount != openAmount)
 *   C. corrupt `source` field (objects rendered as "[object Object]")
 *   D. duplicate documents (same counterparty + document number)
 *   E. open documents with no project assigned
 *   F. open documents with no document number
 *   G. reconciliation anchor staleness
 *
 * DOES NOT WRITE OR DELETE ANYTHING.
 *
 * HOW TO RUN:
 *   node scripts/audit-cxc-cxp.cjs            # summary + top offenders
 *   node scripts/audit-cxc-cxp.cjs --full     # every offending document
 *   node scripts/audit-cxc-cxp.cjs --json     # machine-readable output
 *
 * Requires service account key at ~/.credentials/umtelkomd-firebase.json
 */

const admin = require('firebase-admin');
const path = require('path');
const os = require('os');

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;

const FULL = process.argv.includes('--full');
const AS_JSON = process.argv.includes('--json');
const TOP_N = FULL ? Number.MAX_SAFE_INTEGER : 10;

/** Policy cutoff: the "every payment links a bankMovement" rule shipped with
 *  the DATEV import identity work (PR #16, merged 2026-05-09). Documents
 *  settled before this date are legacy by construction, not by negligence. */
const POLICY_START = '2026-05-09';

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

const todayIso = () => new Date().toISOString().slice(0, 10);

const label = (doc) =>
  doc.counterpartyName || doc.vendor || doc.client || doc.description || doc.id;

const docNumber = (doc) => String(doc.documentNumber || doc.invoiceNumber || '').trim();

const isOpen = (doc) => doc.status !== 'settled' && doc.status !== 'cancelled';

const section = (title) => {
  if (AS_JSON) return;
  console.log(`\n${'─'.repeat(72)}`);
  console.log(title);
  console.log('─'.repeat(72));
};

const listOffenders = (rows, render) => {
  if (AS_JSON) return;
  rows.slice(0, TOP_N).forEach((row) => console.log(`    ${render(row)}`));
  if (rows.length > TOP_N) {
    console.log(`    … y ${rows.length - TOP_N} más (usá --full para verlos todos)`);
  }
};

/** A. Status says paid, but nothing ties it to a bank movement. */
const findUnlinkedSettlements = (docs) =>
  docs
    .filter((doc) => doc.status === 'settled' || doc.status === 'partial')
    .map((doc) => {
      const payments = Array.isArray(doc.payments) ? doc.payments : [];
      const linked = payments.filter((payment) => payment && payment.bankMovementId);
      return { doc, payments, linked };
    })
    .filter(({ linked }) => linked.length === 0)
    .map(({ doc, payments }) => ({
      id: doc.id,
      name: label(doc),
      amount: num(doc.grossAmount ?? doc.amount),
      status: doc.status,
      settledOn: iso(doc.updatedAt) || iso(doc.dueDate),
      paymentsRecorded: payments.length,
      origin: typeof doc.source === 'string' ? doc.source : '(untagged)',
      // No payments at all is a harder failure than payments missing the link:
      // the first means the settlement has no evidence whatsoever.
      severity: payments.length === 0 ? 'sin-evidencia' : 'sin-vinculo',
    }))
    .sort((left, right) => right.amount - left.amount);

/** B. The document's own arithmetic does not close. */
const findIncoherent = (docs) =>
  docs
    .filter((doc) => doc.status !== 'cancelled')
    .map((doc) => {
      const gross = num(doc.grossAmount ?? doc.amount);
      const paid = num(doc.paidAmount);
      const open = num(doc.openAmount ?? doc.pendingAmount);
      return { doc, gross, paid, open, delta: gross - paid - open };
    })
    .filter(({ delta, open }) => Math.abs(delta) > 0.01 || open < -0.01)
    .map(({ doc, gross, paid, open, delta }) => ({
      id: doc.id,
      name: label(doc),
      status: doc.status,
      gross,
      paid,
      open,
      delta,
    }))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

/** C. `source` was written as an object and stringified into garbage. */
const findCorruptSource = (docs) =>
  docs
    .filter((doc) => {
      if (doc.source == null) return false;
      if (typeof doc.source === 'object') return true;
      return String(doc.source).includes('[object Object]');
    })
    .map((doc) => ({
      id: doc.id,
      name: label(doc),
      amount: num(doc.grossAmount ?? doc.amount),
      rawSource: JSON.stringify(doc.source).slice(0, 120),
      hasSourceDocument: Boolean(doc.sourceDocument),
    }));

/** D. Same counterparty + same document number recorded more than once. */
const findDuplicates = (docs) => {
  const groups = new Map();
  docs.forEach((doc) => {
    const number = docNumber(doc);
    if (!number) return; // handled by class F instead
    const key = `${label(doc).toLowerCase()}|${number.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  });

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      count: group.length,
      members: group.map((doc) => ({
        id: doc.id,
        amount: num(doc.grossAmount ?? doc.amount),
        status: doc.status,
        issueDate: iso(doc.issueDate),
        origin: typeof doc.source === 'string' ? doc.source : '(untagged)',
      })),
    }));
};

/** E/F. Open money that cannot be attributed or identified. */
const findUnattributed = (docs, field) =>
  docs
    .filter(isOpen)
    .filter((doc) =>
      field === 'project'
        ? !String(doc.projectId || '').trim() && !String(doc.projectName || '').trim()
        : !docNumber(doc),
    )
    .map((doc) => ({
      id: doc.id,
      name: label(doc),
      amount: num(doc.openAmount ?? doc.grossAmount ?? doc.amount),
      dueDate: iso(doc.dueDate),
      status: doc.status,
    }))
    .sort((left, right) => right.amount - left.amount);

const sum = (rows, key = 'amount') => rows.reduce((total, row) => total + num(row[key]), 0);

async function auditCollection(collection, title) {
  const snapshot = await db.collection(`${BASE}/${collection}`).get();
  const docs = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

  const unlinked = findUnlinkedSettlements(docs);
  const legacy = unlinked.filter((row) => !row.settledOn || row.settledOn < POLICY_START);
  const postPolicy = unlinked.filter((row) => row.settledOn && row.settledOn >= POLICY_START);
  const incoherent = findIncoherent(docs);
  const corrupt = findCorruptSource(docs);
  const duplicates = findDuplicates(docs);
  const noProject = findUnattributed(docs, 'project');
  const noNumber = findUnattributed(docs, 'number');

  const report = {
    collection,
    total: docs.length,
    unlinkedSettlements: {
      total: unlinked.length,
      amount: sum(unlinked),
      legacy: legacy.length,
      postPolicy: postPolicy.length,
      postPolicyAmount: sum(postPolicy),
      noEvidence: unlinked.filter((row) => row.severity === 'sin-evidencia').length,
      rows: unlinked,
    },
    incoherent: { total: incoherent.length, rows: incoherent },
    corruptSource: { total: corrupt.length, rows: corrupt },
    duplicates: { total: duplicates.length, groups: duplicates },
    openWithoutProject: { total: noProject.length, amount: sum(noProject), rows: noProject },
    openWithoutNumber: { total: noNumber.length, amount: sum(noNumber), rows: noNumber },
  };

  if (AS_JSON) return report;

  section(`${title} — ${docs.length} documentos`);

  console.log(`\n  A. Liquidadas/parciales SIN movimiento bancario: ${unlinked.length} · ${money(sum(unlinked))}`);
  console.log(`     ├─ anteriores a la política (${POLICY_START}): ${legacy.length}  → legado, se marcan y se cierran`);
  console.log(`     ├─ POSTERIORES a la política: ${postPolicy.length} · ${money(sum(postPolicy))}  → ESTAS son el problema real`);
  console.log(`     └─ sin ningún pago registrado: ${unlinked.filter((r) => r.severity === 'sin-evidencia').length}`);
  if (postPolicy.length) {
    console.log('\n     Posteriores a la política (mayor importe primero):');
    listOffenders(postPolicy, (row) =>
      `${row.settledOn || '????-??-??'}  ${money(row.amount).padStart(12)}  ${row.severity.padEnd(14)} ${row.name.slice(0, 40)}`,
    );
  }

  console.log(`\n  B. Aritmética incoherente (bruto - pagado != abierto): ${incoherent.length}`);
  listOffenders(incoherent, (row) =>
    `${row.id}  bruto ${money(row.gross)} - pagado ${money(row.paid)} != abierto ${money(row.open)}  (desvío ${money(row.delta)})  ${row.name.slice(0, 30)}`,
  );

  console.log(`\n  C. Campo 'source' corrupto: ${corrupt.length}`);
  listOffenders(corrupt, (row) => `${row.id}  ${money(row.amount)}  ${row.rawSource}  ${row.name.slice(0, 30)}`);

  console.log(`\n  D. Duplicados (mismo tercero + mismo nº documento): ${duplicates.length} grupos`);
  duplicates.slice(0, TOP_N).forEach((group) => {
    console.log(`    ${group.key}  ×${group.count}`);
    group.members.forEach((member) =>
      console.log(`       └─ ${member.id}  ${money(member.amount)}  ${member.status}  ${member.issueDate}  [${member.origin}]`),
    );
  });

  console.log(`\n  E. ABIERTAS sin proyecto: ${noProject.length} · ${money(sum(noProject))}`);
  listOffenders(noProject, (row) => `${row.dueDate}  ${money(row.amount).padStart(12)}  ${row.status.padEnd(8)} ${row.name.slice(0, 40)}`);

  console.log(`\n  F. ABIERTAS sin nº de documento: ${noNumber.length} · ${money(sum(noNumber))}`);
  listOffenders(noNumber, (row) => `${row.dueDate}  ${money(row.amount).padStart(12)}  ${row.status.padEnd(8)} ${row.name.slice(0, 40)}`);

  return report;
}

async function auditAnchors() {
  const snapshot = await db.collection(`${BASE}/settings`).doc('reconciliation').get();
  const anchors = snapshot.exists ? snapshot.data().anchors || [] : [];
  const sorted = [...anchors].sort((left, right) => String(right.date).localeCompare(String(left.date)));
  const newest = sorted[0] || null;
  const staleDays = newest
    ? Math.round((new Date(todayIso()) - new Date(newest.date)) / 86400000)
    : null;

  const report = { count: anchors.length, newest, staleDays };
  if (AS_JSON) return report;

  section('G. Anclas de conciliación (settings/reconciliation)');
  if (!newest) {
    console.log('\n  ⚠ NO HAY ANCLAS. La caja cae al cálculo legado y no es confiable.');
    return report;
  }
  console.log(`\n  anclas registradas: ${anchors.length}`);
  console.log(`  más reciente: ${newest.date} → ${money(newest.balance)}  (${newest.source || 'sin fuente'})`);
  console.log(`  antigüedad: ${staleDays} días`);
  if (staleDays > 45) {
    console.log('  ⚠ El ancla tiene más de 45 días. Cada día que pasa, la caja de hoy depende');
    console.log('    de más movimientos sin verificar contra la contabilidad.');
  }
  return report;
}

(async () => {
  if (!AS_JSON) {
    console.log('FinControl — AUDITORÍA FORENSE CXC/CXP (solo lectura)');
    console.log('═'.repeat(72));
    console.log(`Fecha: ${todayIso()}   ·   Corte de política de conciliación: ${POLICY_START}`);
  }

  const receivables = await auditCollection('receivables', 'CXC (receivables)');
  const payables = await auditCollection('payables', 'CXP (payables)');
  const anchors = await auditAnchors();

  if (AS_JSON) {
    console.log(JSON.stringify({ receivables, payables, anchors }, null, 2));
  } else {
    console.log(`\n${'═'.repeat(72)}`);
    console.log('Solo lectura. No se modificó nada.');
  }
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
