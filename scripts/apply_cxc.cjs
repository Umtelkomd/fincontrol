// apply_cxc.cjs — crea CXC (receivables) en fincontrol desde una cola JSON aprobada.
// Replica el schema de src/hooks/useReceivables.js -> createReceivable.
//
// Modos:
//   node apply_cxc.cjs --file <queue.json> --dry-run    (default: muestra qué haría, NO escribe)
//   node apply_cxc.cjs --file <queue.json> --apply      (escribe a Firestore, con backup previo)
//
// La cola es un array de objetos: { client, invoiceNumber, amount, issueDate, dueDate,
//   paymentTerms?, projectId?, projectName?, description?, notes? }
// amount = importe a cobrar tal cual (aquí NETO, sin IVA, por indicación del usuario).
// Dedup contra receivables existentes por invoiceNumber (o client+amount).

const admin = require('firebase-admin');
const fs = require('fs');

admin.initializeApp({ credential: admin.credential.cert(require('/Users/jarl/.credentials/umtelkomd-firebase.json')) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const base = `artifacts/${APP_ID}/public/data`;
const receivablesRef = db.collection(`${base}/receivables`);

const MAIN_ACCOUNT_ID = 'main';
const DEFAULT_CURRENCY = 'EUR';
const BOT_EMAIL = 'hermes-cron@umtelkomd.com'; // marca de auditoría: alta asistida aprobada por Jarl

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
  const rSnap = await receivablesRef.get();
  const existing = [];
  rSnap.forEach(d => {
    const x = d.data();
    existing.push({ client: norm(x.client || x.counterpartyName), inv: norm(x.invoiceNumber || x.documentNumber), amt: clampMoney(x.grossAmount ?? x.amount) });
  });
  // Dedup por clave única real: si el item trae invoiceNumber, se compara SOLO por
  // número de factura (dos facturas distintas pueden compartir importe). El heurístico
  // client+importe queda como respaldo únicamente para items sin invoiceNumber.
  const isDup = item => {
    const inv = norm(item.invoiceNumber);
    if (inv) return existing.some(e => e.inv && e.inv === inv);
    return existing.some(e =>
      e.client === norm(item.client) && Math.abs(e.amt - clampMoney(item.amount)) < 0.01
    );
  };

  const toCreate = [], skipped = [];
  for (const item of queue) {
    if (!item.client || !(item.amount > 0)) { skipped.push({ item, why: 'sin client o monto' }); continue; }
    if (isDup(item)) { skipped.push({ item, why: 'ya existe CXC equivalente' }); continue; }
    toCreate.push(item);
  }

  console.log('============================================================');
  console.log(`APPLY CXC — modo: ${DRY ? 'DRY-RUN (no escribe)' : 'APPLY (escribe a producción)'}`);
  console.log(`Cola: ${queue.length} | A crear: ${toCreate.length} | Saltados: ${skipped.length}`);
  console.log('============================================================');
  toCreate.forEach(i => console.log(`  + ${i.client} | ${i.invoiceNumber||'(s/nº)'} | €${clampMoney(i.amount).toFixed(2)} | emis ${toISO(i.issueDate)||'?'} | vto ${toISO(i.dueDate)||'?'} | ${i.paymentTerms||'net30'} | ${i.description||''}`));
  skipped.forEach(s => console.log(`  - SALTADO (${s.why}): ${s.item.client} ${s.item.invoiceNumber||''} €${s.item.amount}`));
  const total = toCreate.reduce((s,i)=>s+clampMoney(i.amount),0);
  console.log(`\nSuma a crear: €${total.toFixed(2)}`);

  if (DRY) { console.log('\n(DRY-RUN: no se escribió nada. Usa --apply para crear.)'); process.exit(0); }
  if (!toCreate.length) { console.log('\nNada nuevo que crear.'); process.exit(0); }

  // backup de receivables antes de escribir
  const backupDir = `${process.env.HOME}/.hermes/cron/cxc_pending/backups`;
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = [];
  rSnap.forEach(d => backup.push({ id: d.id, data: d.data() }));
  const bpath = `${backupDir}/receivables_backup_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  fs.writeFileSync(bpath, JSON.stringify(backup, (k,v)=> v && v.toDate ? v.toDate().toISOString() : v, 2));
  console.log(`\nBackup receivables -> ${bpath} (${backup.length} docs)`);

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
      client: item.client,
      counterpartyName: item.client,
      projectId: item.projectId || '',
      projectName: item.projectName || '',
      costCenterId: item.costCenterId || '',
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
      notes: item.notes || 'Alta asistida CXC (facturas Insyte), aprobada por Jarl.',
      linkedTransactionId: null,
      legacyTransactionId: null,
      createdBy: BOT_EMAIL,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: BOT_EMAIL,
      updatedAt: FieldValue.serverTimestamp(),
      auditTrail: FieldValue.arrayUnion({
        action: 'create',
        user: BOT_EMAIL,
        timestamp: new Date().toISOString(),
        detail: 'Factura CXC creada (alta asistida facturas Insyte, aprobada por Jarl)',
      }),
    };
    const ref = await receivablesRef.add(payload);
    created.push({ id: ref.id, client: item.client, inv: item.invoiceNumber, amount });
    console.log(`  ✅ creada ${ref.id} | ${item.client} | ${item.invoiceNumber} €${amount.toFixed(2)}`);
  }

  console.log(`\nTOTAL creadas: ${created.length} | suma €${created.reduce((s,c)=>s+c.amount,0).toFixed(2)}`);
  const donePath = QUEUE.replace(/\.json$/, '') + `.applied_${todayISO()}.json`;
  fs.renameSync(QUEUE, donePath);
  console.log(`Cola movida a: ${donePath}`);
  process.exit(0);
})().catch(e => { console.error('ERROR_CRITICO:', e.message, e.stack); process.exit(1); });
