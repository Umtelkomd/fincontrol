// Firebase Admin SDK - get all unique categories from transactions + bankMovements
const admin = require('firebase-admin');
const cred = require('./firebase-admin-key.json');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(cred), projectId: 'umtelkomd-finance' });
}
const db = admin.firestore();

async function main() {
  const appId = '1:597712756560:web:ad12cd9794f11992641655';
  const base = `artifacts/${appId}/public/data`;

  // Get unique categories from transactions
  const txSnap = await db.collection(`${base}/transactions`).get();
  const cats = {};
  const months = {};
  txSnap.forEach(d => {
    const f = d.data();
    const cat = f.category || '(vacío)';
    const type = f.type || 'expense';
    const status = f.status || 'unknown';
    const year = f.date ? f.date.slice(0,4) : '?';
    if (!cats[cat]) cats[cat] = { income: 0, expense: 0, count: 0 };
    if (type === 'income' || type === 'ingreso') cats[cat].income += (f.amount || 0);
    else cats[cat].expense += (f.amount || 0);
    cats[cat].count++;
    if (!months[cat]) months[cat] = new Set();
    months[cat].add(year);
  });

  console.log('=== TRANSACTION CATEGORIES ===');
  console.log('(sorted by total absolute amount)');
  const sorted = Object.entries(cats).sort((a,b) => Math.abs(b[1].income+b[1].expense) - Math.abs(a[1].income+a[1].expense));
  for (const [cat, v] of sorted) {
    const net = v.income - v.expense;
    console.log(`  "${cat}": inc=${v.income.toFixed(2)} exp=${v.expense.toFixed(2)} net=${net.toFixed(2)} count=${v.count} years=${[...months[cat]].join(',')}`);
  }

  // Get bankMovements categories
  const bmSnap = await db.collection(`${base}/bankMovements`).get();
  const bmCats = {};
  bmSnap.forEach(d => {
    const f = d.data();
    const cat = f.categoryName || f.category || '(vacío)';
    if (!bmCats[cat]) bmCats[cat] = { income: 0, expense: 0, count: 0 };
    const amt = Math.abs(f.netAmount ?? f.amount ?? 0);
    if (f.direction === 'in') bmCats[cat].income += amt;
    else bmCats[cat].expense += amt;
    bmCats[cat].count++;
  });

  console.log('\n=== BANK MOVEMENT CATEGORIES ===');
  const bmSorted = Object.entries(bmCats).sort((a,b) => Math.abs(b[1].income+b[1].expense) - Math.abs(a[1].income+a[1].expense));
  for (const [cat, v] of bmSorted) {
    const net = v.income - v.expense;
    console.log(`  "${cat}": inc=${v.income.toFixed(2)} exp=${v.expense.toFixed(2)} net=${net.toFixed(2)} count=${v.count}`);
  }

  // Check budget categories
  const budSnap = await db.collection(`${base}/budgets`).get();
  console.log('\n=== BUDGET CATEGORIES ===');
  budSnap.forEach(d => {
    const f = d.data();
    console.log(`Budget ${f.year}: ${f.lines?.length || 0} lines`);
    f.lines?.forEach(l => {
      const total = (l.monthlyBudget || []).reduce((s,v)=>s+v,0);
      console.log(`  "${l.categoryName}" [${l.type}] total=${total.toFixed(2)}`);
    });
  });
}

main().catch(console.error);
