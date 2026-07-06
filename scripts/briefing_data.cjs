// FinControl financial briefing data engine — READ ONLY, one-shot getDocs (Spark quota safe).
// Emits raw financial metrics to stdout for the cron agent to interpret.
// NO writes. NO listeners. Reads: settings, bankMovements, receivables, payables, projects.
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('/Users/jarl/.credentials/umtelkomd-firebase.json')) });
const db = admin.firestore();
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const base = `artifacts/${APP_ID}/public/data`;

const CLOSED = new Set(['settled', 'cancelled', 'void', 'paid', 'storno']);
const fmt = n => (n < 0 ? '-' : '') + '€' + Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

function openAmt(x) {
  if (typeof x.openAmount === 'number') return x.openAmount;
  if (typeof x.pendingAmount === 'number') return x.pendingAmount;
  const amt = x.amount ?? x.grossAmount ?? 0;
  return amt - (x.paidAmount || 0);
}

(async () => {
  const [setSnap, bmSnap, rSnap, pSnap, projSnap] = await Promise.all([
    db.collection(`${base}/settings`).get(),
    db.collection(`${base}/bankMovements`).get(),
    db.collection(`${base}/receivables`).get(),
    db.collection(`${base}/payables`).get(),
    db.collection(`${base}/projects`).get(),
  ]);

  const proj = {};
  projSnap.forEach(d => { proj[d.id] = d.data().name || d.data().displayName || d.id; });

  let bankAccount = null;
  setSnap.forEach(d => { if (d.id === 'bankAccount') bankAccount = d.data(); });

  console.log('============================================================');
  console.log('BRIEFING FINANCIERO UMTELKOMD (FinControl) — DATOS CRUDOS');
  console.log(`Generado: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} | Hoy: ${today}`);
  console.log('============================================================');

  // ---- CAJA ----
  const balance = bankAccount?.balance ?? 0;
  const balanceDate = bankAccount?.balanceDate ?? '';
  const creditLimit = bankAccount?.creditLineLimit ?? 0;
  let inAfter = 0, outAfter = 0;
  let in30 = 0, out30 = 0;
  const date30 = addDays(today, -30);
  let lastMov = '';
  bmSnap.forEach(d => {
    const x = d.data();
    const pd = x.postedDate || x.valueDate || '';
    if (pd > lastMov) lastMov = pd;
    if (pd > balanceDate) {
      if (x.direction === 'in') inAfter += x.amount || 0; else outAfter += x.amount || 0;
    }
    if (pd >= date30) {
      if (x.direction === 'in') in30 += x.amount || 0; else out30 += x.amount || 0;
    }
  });
  const cashToday = balance + inAfter - outAfter;
  console.log('\n--- 💰 CAJA ---');
  console.log(`  Balance base (${balanceDate}): ${fmt(balance)}`);
  console.log(`  + Cobros desde entonces: ${fmt(inAfter)}`);
  console.log(`  - Pagos desde entonces:  ${fmt(outAfter)}`);
  console.log(`  = CAJA HOY (estimada): ${fmt(cashToday)}`);
  if (creditLimit) {
    const disponible = creditLimit + cashToday; // si cashToday negativo, usa línea
    console.log(`  Línea de crédito: ${fmt(creditLimit)} | Disponible aprox: ${fmt(disponible)}`);
  }
  console.log(`  Último movimiento bancario registrado: ${lastMov}`);
  console.log(`\n--- 📊 FLUJO NETO 30 DÍAS (${date30} → ${today}) ---`);
  console.log(`  Cobros: ${fmt(in30)} | Pagos: ${fmt(out30)} | Neto: ${fmt(in30 - out30)}`);

  // ---- CXC (receivables) ----
  const cxcOpen = [];
  rSnap.forEach(d => {
    const x = d.data();
    if (CLOSED.has((x.status || '').toLowerCase())) return;
    const o = openAmt(x);
    if (o <= 0.005) return;
    cxcOpen.push({ ...x, _open: o, _id: d.id });
  });
  const cxcTotal = cxcOpen.reduce((s, x) => s + x._open, 0);
  const cxcOverdue = cxcOpen.filter(x => x.dueDate && x.dueDate < today);
  const cxcOverdueTotal = cxcOverdue.reduce((s, x) => s + x._open, 0);
  console.log(`\n--- 📥 CXC — POR COBRAR (clientes) ---`);
  console.log(`  Abiertas: ${cxcOpen.length} docs | Total: ${fmt(cxcTotal)}`);
  console.log(`  🔴 VENCIDAS: ${cxcOverdue.length} | ${fmt(cxcOverdueTotal)}`);
  cxcOverdue.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  cxcOverdue.slice(0, 12).forEach(x => {
    const cli = x.client || x.counterpartyName || '—';
    const pr = proj[x.projectId] || '';
    console.log(`    • ${fmt(x._open)} — ${cli} | vto ${x.dueDate} | ${x.description || ''} ${pr ? '[' + pr + ']' : ''}`);
  });

  // ---- CXP (payables) ----
  const cxpOpen = [];
  pSnap.forEach(d => {
    const x = d.data();
    if (CLOSED.has((x.status || '').toLowerCase())) return;
    const o = openAmt(x);
    if (o <= 0.005) return;
    cxpOpen.push({ ...x, _open: o, _id: d.id });
  });
  const cxpTotal = cxpOpen.reduce((s, x) => s + x._open, 0);
  const cxpOverdue = cxpOpen.filter(x => x.dueDate && x.dueDate < today);
  const cxpOverdueTotal = cxpOverdue.reduce((s, x) => s + x._open, 0);
  console.log(`\n--- 📤 CXP — POR PAGAR (proveedores) ---`);
  console.log(`  Abiertas: ${cxpOpen.length} docs | Total: ${fmt(cxpTotal)}`);
  console.log(`  🔴 VENCIDAS: ${cxpOverdue.length} | ${fmt(cxpOverdueTotal)}`);
  cxpOverdue.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  cxpOverdue.slice(0, 12).forEach(x => {
    const ven = x.vendor || x.counterpartyName || '—';
    console.log(`    • ${fmt(x._open)} — ${ven} | vto ${x.dueDate} | ${x.description || ''}`);
  });

  // ---- PRÓXIMOS VENCIMIENTOS 14 DÍAS ----
  const horizon = addDays(today, 14);
  const cxcSoon = cxcOpen.filter(x => x.dueDate && x.dueDate >= today && x.dueDate <= horizon);
  const cxpSoon = cxpOpen.filter(x => x.dueDate && x.dueDate >= today && x.dueDate <= horizon);
  console.log(`\n--- 📅 PRÓXIMOS 14 DÍAS (${today} → ${horizon}) ---`);
  console.log(`  A COBRAR: ${cxcSoon.length} | ${fmt(cxcSoon.reduce((s, x) => s + x._open, 0))}`);
  cxcSoon.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8).forEach(x => {
    console.log(`    + ${fmt(x._open)} — ${x.client || x.counterpartyName || '—'} | ${x.dueDate}`);
  });
  console.log(`  A PAGAR: ${cxpSoon.length} | ${fmt(cxpSoon.reduce((s, x) => s + x._open, 0))}`);
  cxpSoon.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8).forEach(x => {
    console.log(`    - ${fmt(x._open)} — ${x.vendor || x.counterpartyName || '—'} | ${x.dueDate}`);
  });

  // ---- POSICIÓN NETA ----
  console.log(`\n--- ⚖️ POSICIÓN ---`);
  console.log(`  Caja ${fmt(cashToday)} + CXC ${fmt(cxcTotal)} - CXP ${fmt(cxpTotal)} = ${fmt(cashToday + cxcTotal - cxpTotal)} (posición teórica si todo se cobra/paga)`);

  console.log('\n============================================================');
  console.log('FIN DATOS CRUDOS');
  process.exit(0);
})().catch(e => { console.error('ERROR_CRITICO:', e.message); process.exit(1); });
