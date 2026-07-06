// apply_cxp.cjs — crea CXP (payables) en fincontrol desde una cola JSON aprobada.
// Replica EXACTAMENTE el schema de src/hooks/usePayables.js -> createPayable.
//
// Modos:
//   node apply_cxp.cjs --file <queue.json> --dry-run    (default: muestra qué haría, NO escribe)
//   node apply_cxp.cjs --file <queue.json> --apply      (escribe a Firestore, con backup previo)
//
// La cola es un array de objetos: { vendor, invoiceNumber, amount, issueDate, dueDate,
//   description, projectId?, projectName?, notes?, driveFolder? }
// amount = BRUTO (gross). Dedup contra payables existentes por vendor+invoice+amount.

const admin = require('firebase-admin');
const fs = require('fs');

admin.initializeApp({ credential: admin.credential.cert(require('/Users/jarl/.credentials/umtelkomd-firebase.json')) });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const base = `artifacts/${APP_ID}/public/data`;
const payablesRef = db.collection(`${base}/payables`);

const MAIN_ACCOUNT_ID = 'main';
const DEFAULT_CURRENCY = 'EUR';
const CRON_BOT_EMAIL = 'hermes-cron@umtelkomd.com'; // marca de auditoría: alta automática aprobada

// ---- args ----
const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] || true) : d; };
const QUEUE = getArg('--file');
const APPLY = args.includes('--apply');
const DRY = !APPLY;

const clampMoney = v => Math.round((Number(v) || 0) * 100) / 100;
const norm = s => String(s || '').trim().toLowerCase();
const toISO = d => {
  if (!d) return '';
  const s = String(d).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return '';
};
const todayISO = () => new Date().toISOString().slice(0, 10);

if (!QUEUE || !fs.existsSync(QUEUE)) {
  console.error('ERROR: falta --file <queue.json> válido'); process.exit(1);
}

(async () => {
  const queue = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  if (!Array.isArray(queue) || !queue.length) {
    console.log('Cola vacía, nada que hacer.'); process.exit(0);
  }

  // existentes para dedup
  const pSnap = await payablesRef.get();
  const existing = [];
  pSnap.forEach(d => {
    const x = d.data();
    existing.push({ vendor: norm(x.vendor || x.counterpartyName), inv: norm(x.invoiceNumber || x.documentNumber), amt: clampMoney(x.grossAmount ?? x.amount) });
  });
  const isDup = item => existing.some(e =>
    (e.inv && e.inv === norm(item.invoiceNumber)) ||
    (e.vendor === norm(item.vendor) && Math.abs(e.amt - clampMoney(item.amount)) < 0.01)
  );

  const toCreate = [], skipped = [];
  for (const item of queue) {
    if (!item.vendor || !(item.amount > 0)) { skipped.push({ item, why: 'sin vendor o monto' }); continue; }
    if (isDup(item)) { skipped.push({ item, why: 'ya existe CXP equivalente' }); continue; }
    toCreate.push(item);
  }

  console.log('============================================================');
  console.log(`APPLY CXP — modo: ${DRY ? 'DRY-RUN (no escribe)' : 'APPLY (escribe a producción)'}`);
  console.log(`Cola: ${queue.length} | A crear: ${toCreate.length} | Saltados: ${skipped.length}`);
  console.log('============================================================');
  toCreate.forEach(i => console.log(`  + ${i.vendor} | ${i.invoiceNumber||'(s/nº)'} | €${clampMoney(i.amount).toFixed(2)} | vto ${toISO(i.dueDate)||'?'} | ${i.description||''}`));
  skipped.forEach(s => console.log(`  - SALTADO (${s.why}): ${s.item.vendor} ${s.item.invoiceNumber||''} €${s.item.amount}`));

  if (DRY) { console.log('\n(DRY-RUN: no se escribió nada. Usa --apply para crear.)'); process.exit(0); }
  if (!toCreate.length) { console.log('\nNada nuevo que crear.'); process.exit(0); }

  // backup de payables antes de escribir
  const backupDir = `${process.env.HOME}/.hermes/cron/cxp_pending/backups`;
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = [];
  pSnap.forEach(d => backup.push({ id: d.id, data: d.data() }));
  const bpath = `${backupDir}/payables_backup_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  fs.writeFileSync(bpath, JSON.stringify(backup, (k,v)=> v && v.toDate ? v.toDate().toISOString() : v, 2));
  console.log(`\nBackup payables -> ${bpath} (${backup.length} docs)`);

  const created = [];
  for (const item of toCreate) {
    const amount = clampMoney(item.amount);
    const issueDate = toISO(item.issueDate) || todayISO();
    const dueDate = toISO(item.dueDate) || issueDate;
    const payload = {
      accountId: MAIN_ACCOUNT_ID,
      currency: DEFAULT_CURRENCY,
      invoiceNumber: item.invoiceNumber || '',
      documentNumber: item.documentNumber || item.invoiceNumber || '',
      vendor: item.vendor,
      counterpartyName: item.vendor,
      projectId: item.projectId || '',
      projectName: item.projectName || '',
      employeeIds: Array.isArray(item.employeeIds) ? item.employeeIds : [],
      costCenterId: item.costCenterId || '',
      categoryName: item.categoryName || '',
      payrollPeriod: null, payrollPeriodId: null, payrollKind: null,
      source: 'cron-contratistas',
      sourceDocument: item.driveFolder ? { driveFolder: item.driveFolder } : null,
      description: item.description || '',
      grossAmount: amount,
      amount,
      openAmount: amount,
      pendingAmount: amount,
      paidAmount: 0,
      issueDate,
      dueDate,
      paymentTerms: item.paymentTerms || 'net30',
      status: 'issued',
      payments: [],
      notes: item.notes || 'Alta automática (cron facturas contratistas), aprobada por Jarl.',
      linkedTransactionId: null,
      legacyTransactionId: null,
      createdBy: CRON_BOT_EMAIL,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: CRON_BOT_EMAIL,
      updatedAt: FieldValue.serverTimestamp(),
      auditTrail: FieldValue.arrayUnion({
        action: 'create',
        user: CRON_BOT_EMAIL,
        timestamp: new Date().toISOString(),
        detail: 'Factura CXP creada (cron contratistas, aprobada por Jarl)',
      }),
    };
    const ref = await payablesRef.add(payload);
    created.push({ id: ref.id, vendor: item.vendor, inv: item.invoiceNumber, amount });
    console.log(`  ✅ creada ${ref.id} | ${item.vendor} €${amount.toFixed(2)}`);
  }

  console.log(`\nTOTAL creadas: ${created.length} | suma €${created.reduce((s,c)=>s+c.amount,0).toFixed(2)}`);
  // marca la cola como aplicada
  const donePath = QUEUE.replace(/\.json$/, '') + `.applied_${todayISO()}.json`;
  fs.renameSync(QUEUE, donePath);
  console.log(`Cola movida a: ${donePath}`);
  process.exit(0);
})().catch(e => { console.error('ERROR_CRITICO:', e.message, e.stack); process.exit(1); });
