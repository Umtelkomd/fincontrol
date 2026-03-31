const admin = require('firebase-admin');
const cred = require('./firebase-admin-key.json');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(cred), projectId: 'umtelkomd-finance' });
}
const db = admin.firestore();
db.collection('artifacts/umtelkomd-finance/public/data/bankMovements').limit(30).get().then(snap => {
  const cats = new Set();
  const samples = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.status === 'posted') {
      cats.add(JSON.stringify({ cat: data.categoryName, dir: data.direction, type: data.type }));
      if (samples.length < 5) samples.push({ id: d.id, cat: data.categoryName, dir: data.direction, amount: data.amount, net: data.netAmount });
    }
  });
  console.log('=== POSTED BANK MOVEMENTS ===');
  console.log('Unique category+direction combos:');
  Array.from(cats).forEach(c => console.log(' ', JSON.parse(c)));
  console.log('\nSample posted movements:');
  samples.forEach(s => console.log(' ', s));
  console.log('total docs in query:', snap.size);

  return db.collection('artifacts/umtelkomd-finance/public/data/transactions').limit(10).get();
}).then(snap => {
  console.log('\n=== LEGACY TRANSACTIONS (sample) ===');
  snap.forEach(d => {
    const data = d.data();
    console.log({ id: d.id.slice(0,8), type: data.type, cat: data.categoryName, gross: data.amount, net: data.netAmount });
  });
}).catch(e => console.error('ERROR:', e.message));
