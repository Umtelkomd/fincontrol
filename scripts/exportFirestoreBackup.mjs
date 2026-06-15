import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';

const DEFAULT_APP_ID = process.env.FIREBASE_APP_ID || '1:597712756560:web:ad12cd9794f11992641655';
const DEFAULT_KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const DEFAULT_COLLECTIONS = [
  'transactions',
  'receivables',
  'payables',
  'bankMovements',
  'bankReconciliation',
  'budgets',
];

const expandHome = (value) => (value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);
const args = process.argv.slice(2);
const appIdArg = args.find((entry) => entry.startsWith('--app-id='))?.split('=')[1];
const keyPathArg = args.find((entry) => entry.startsWith('--service-account='))?.split('=')[1];

const appId = process.env.FINCONTROL_APP_ID || appIdArg || DEFAULT_APP_ID;
const serviceAccountPath = expandHome(
  process.env.GOOGLE_APPLICATION_CREDENTIALS || keyPathArg || DEFAULT_KEY_PATH,
);

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`Service account not found: ${serviceAccountPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const exportStamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(process.cwd(), 'backups');
const outputPath = path.join(backupDir, `firestore-backup-${exportStamp}.json`);

fs.mkdirSync(backupDir, { recursive: true });

const serialize = (value) => {
  if (value == null) return value;
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString();
  if (value instanceof admin.firestore.GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
  if (value instanceof admin.firestore.DocumentReference) return value.path;
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, serialize(inner)]));
  }
  return value;
};

const basePath = ['artifacts', appId, 'public', 'data'];
const payload = {
  metadata: {
    exportDate: new Date().toISOString(),
    appId,
    collections: [],
  },
  data: {},
};

for (const name of DEFAULT_COLLECTIONS) {
  const snapshot = await db.collection([...basePath, name].join('/')).get();
  const rows = snapshot.docs.map((entry) => ({
    id: entry.id,
    ...serialize(entry.data()),
  }));
  payload.data[name] = rows;
  payload.metadata.collections.push({ name, count: rows.length });
}

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

const totalDocs = payload.metadata.collections.reduce((sum, entry) => sum + entry.count, 0);
console.log(`Backup written: ${outputPath}`);
console.log(`Collections: ${payload.metadata.collections.length}`);
console.log(`Documents: ${totalDocs}`);
