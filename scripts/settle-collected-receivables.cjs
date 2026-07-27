#!/usr/bin/env node
/**
 * Close receivables that were collected but never reconciled.
 *
 * Insyte pays through confirming, in batches: one transfer settles several
 * invoices at once, so no bank movement ever matches a single document. Nobody
 * could reconcile them one by one, and the ledger drifted into showing 225,166
 * EUR of open receivables that had in fact been paid — inflating the aging, the
 * inbound forecast and the net position all at once.
 *
 * The owner confirmed the money is in: cash already reflects those collections.
 * This closes the documents so the books say the same thing the bank does.
 *
 * Each closure records a payment line marked as a bulk reconciliation, so the
 * origin stays auditable and a later per-batch reconciliation can supersede it.
 *
 *   node scripts/settle-collected-receivables.cjs                    # dry-run
 *   node scripts/settle-collected-receivables.cjs --apply
 *   node scripts/settle-collected-receivables.cjs --until 2026-07-27 --apply
 */
const path = require('node:path');
const os = require('node:os');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const KEY_PATH = path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const untilIdx = argv.indexOf('--until');
const UNTIL = untilIdx >= 0 ? argv[untilIdx + 1] : null;
/** Stamped on every payment line so a later reconciliation can find and replace them. */
const SETTLE_DATE = '2026-07-27';

const eur = (n) => (n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const line = (c = '─', w = 86) => c.repeat(w);
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  if (UNTIL && !/^\d{4}-\d{2}-\d{2}$/.test(UNTIL)) {
    console.error(`✖ --until inválido: "${UNTIL}". Formato AAAA-MM-DD.`);
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const db = admin.firestore();

  const snap = await db.collection(`${BASE}/receivables`).get();
  const open = snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((r) => !['settled', 'cancelled'].includes(r.status))
    .filter((r) => (Number(r.openAmount ?? r.grossAmount ?? r.amount) || 0) > 0.005)
    .filter((r) => !UNTIL || String(r.dueDate || r.date || '') <= UNTIL)
    .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));

  console.log(`\n${line('═')}`);
  console.log('CIERRE DE FACTURAS YA COBRADAS');
  console.log(line('═'));
  console.log(`Modo:  ${APPLY ? '🔴 APLICAR' : '🟢 DRY-RUN (no escribe)'}`);
  console.log(`Filtro: ${UNTIL ? `vencimiento hasta ${UNTIL}` : 'todas las abiertas'}`);
  console.log(`Facturas a cerrar: ${open.length}\n`);

  console.log(line());
  let total = 0;
  for (const r of open) {
    const pending = round(r.openAmount ?? r.grossAmount ?? r.amount);
    total += pending;
    const label = r.documentNumber || r.invoiceNumber || r.id;
    const who = String(r.counterpartyName || r.client || '').slice(0, 26);
    console.log(`  ${String(r.dueDate || '-').padEnd(12)}${String(label).padEnd(12)}${who.padEnd(27)}${eur(pending).padStart(13)}`);
  }
  console.log(line());
  console.log(`  ${'TOTAL'.padEnd(51)}${eur(total).padStart(13)}\n`);

  if (!APPLY) {
    console.log(line('═'));
    console.log('🟢 DRY-RUN — no se escribió nada.');
    console.log('   Aplicar todo:      node scripts/settle-collected-receivables.cjs --apply');
    console.log('   Solo hasta fecha:  node scripts/settle-collected-receivables.cjs --until 2026-07-27 --apply');
    console.log(line('═'));
    process.exit(0);
  }

  let ok = 0, fail = 0;
  for (const r of open) {
    const pending = round(r.openAmount ?? r.grossAmount ?? r.amount);
    const gross = round(r.grossAmount ?? r.amount ?? pending);
    const payments = Array.isArray(r.payments) ? [...r.payments] : [];
    payments.push({
      id: `bulk-settle-${SETTLE_DATE}`,
      amount: pending,
      date: SETTLE_DATE,
      method: 'Confirming',
      note: 'Cierre masivo: cobrada vía confirming de Insyte en remesa agrupada. Pendiente de conciliar contra el movimiento bancario concreto.',
      user: 'settle-collected-receivables',
      timestamp: SETTLE_DATE,
    });
    try {
      await r.ref.update({
        status: 'settled',
        openAmount: 0,
        paidAmount: gross,
        payments,
        settledAt: SETTLE_DATE,
        reconciliationPending: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'settle-collected-receivables',
      });
      ok++;
    } catch (error) {
      console.error(`  ✖ ${r.documentNumber || r.id}: ${error.message}`);
      fail++;
    }
  }

  console.log(line('═'));
  console.log(`✅ ${ok} factura(s) cerradas por ${eur(total)}${fail ? `, ${fail} fallo(s)` : ''}.`);
  console.log('   Marcadas con reconciliationPending: quedan por casar contra su remesa bancaria.');
  console.log(line('═'));
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error('ERROR:', error); process.exit(1); });
