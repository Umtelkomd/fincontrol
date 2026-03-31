// Run with: node scripts/debug_cats.mjs
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const cred = JSON.parse(readFileSync('./scripts/firebase-admin-key.json', 'utf8'));
initializeApp({ credential: cert(cred), projectId: 'umtelkomd-finance' });
const db = getFirestore();

async function main() {
  // Check transactions
  const txSnap = await db.collection('artifacts/umtelkomd-finance/public/data/transactions').limit(10).get();
  console.log('=== TRANSACTIONS (first 10) ===');
  const cats = new Map();
  txSnap.forEach(d => {
    const data = d.data();
    const key = `${data.category}|${data.type}`;
    if (!cats.has(key)) cats.set(key, { cat: data.category, type: data.type, count: 0, total: 0 });
    cats.get(key).count++;
    cats.get(key).total += data.amount || 0;
    if (cats.size <= 5) {
      console.log(`  id=${d.id.slice(0,8)} cat="${data.category}" type=${data.type} amount=${data.amount} status=${data.status} paidDate=${data.paidDate} date=${data.date}`);
    }
  });
  console.log('\n=== UNIQUE CATEGORIES IN TRANSACTIONS ===');
  for (const [k, v] of [...cats.entries()].sort()) {
    console.log(`  [${v.type}] "${v.cat}": ${v.count} txns, total=${v.total.toFixed(2)}`);
  }

  // Check bankMovements
  const bmSnap = await db.collection('artifacts/umtelkomd-finance/public/data/bankMovements').limit(10).get();
  console.log('\n=== BANK MOVEMENTS (first 10) ===');
  bmSnap.forEach(d => {
    const data = d.data();
    console.log(`  id=${d.id.slice(0,8)} cat="${data.categoryName || data.category || 'MISSING'}" dir=${data.direction} amount=${data.amount} status=${data.status}`);
  });

  // Check budgets
  const budSnap = await db.collection('artifacts/umtelkomd-finance/public/data/budgets').limit(5).get();
  console.log('\n=== BUDGETS ===');
  budSnap.forEach(d => {
    const data = d.data();
    console.log(`  id=${d.id} year=${data.year} project=${data.projectName} lines=${data.lines?.length || 0}`);
    if (data.lines) {
      data.lines.forEach(l => {
        console.log(`    line: cat="${l.categoryName}" type=${l.type} monthly=${JSON.stringify(l.monthlyBudget?.slice(0,3))}...`);
      });
    }
  });
}

main().catch(e => console.error('ERROR:', e.message));
