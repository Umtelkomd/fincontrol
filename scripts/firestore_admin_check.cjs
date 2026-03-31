// Firebase Admin SDK - check actual Firestore collections
const admin = require('firebase-admin');
const cred = require('./firebase-admin-key.json');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(cred), projectId: 'umtelkomd-finance' });
}
const db = admin.firestore();

async function main() {
  const appId = '1:597712756560:web:ad12cd9794f11992641655';

  // Try artifacts path
  const basePath = `artifacts/${appId}/public/data`;

  // transactions
  try {
    const snap = await db.collection(`${basePath}/transactions`).limit(5).get();
    console.log(`transactions: ${snap.size} docs`);
    snap.forEach(d => {
      const f = d.data();
      console.log(`  ${d.id.slice(0,10)} cat="${f.category||''}" type="${f.type}" status="${f.status}" amount=${f.amount} date=${f.date||f.paidDate||'?'} categoryName="${f.categoryName||''}"`);
    });
  } catch (e) { console.log(`transactions ERROR: ${e.message}`); }

  // bankMovements
  try {
    const snap = await db.collection(`${basePath}/bankMovements`).limit(5).get();
    console.log(`\nbankMovements: ${snap.size} docs`);
    snap.forEach(d => {
      const f = d.data();
      console.log(`  ${d.id.slice(0,10)} cat="${f.categoryName||''}" dir="${f.direction}" status="${f.status}" amount=${f.amount} postedDate=${f.postedDate}`);
    });
  } catch (e) { console.log(`bankMovements ERROR: ${e.message}`); }

  // budgets
  try {
    const snap = await db.collection(`${basePath}/budgets`).limit(5).get();
    console.log(`\nbudgets: ${snap.size} docs`);
    snap.forEach(d => {
      const f = d.data();
      console.log(`  ${d.id} year=${f.year} project=${f.projectName || 'all'} lines=${f.lines?.length||0}`);
      if (f.lines) {
        f.lines.forEach(l => console.log(`    "${l.categoryName}" ${l.type} ${l.monthlyBudget?.reduce((s,v)=>s+v,0).toFixed(0)}`));
      }
    });
  } catch (e) { console.log(`budgets ERROR: ${e.message}`); }
}

main().catch(console.error);
