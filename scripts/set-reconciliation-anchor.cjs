#!/usr/bin/env node
/**
 * Set a reconciliation anchor — the verified cash truth at a point in time.
 *
 * Cash today = the newest anchor on or before today, plus every signed bank
 * movement after it. So the anchor is the only figure the whole app trusts
 * without deriving, and a stale one quietly widens the gap between the screen
 * and the bank.
 *
 * Run with no arguments to see what the app currently computes at each recent
 * month end. Compare a line against the real balance on that day (bank
 * statement or the DATEV SuSa 1200 account); when one matches, pin it.
 *
 *   node scripts/set-reconciliation-anchor.cjs
 *   node scripts/set-reconciliation-anchor.cjs --date 2026-06-30 --balance 18234.55 --apply
 *
 * Anchors are appended, never overwritten: history stays auditable and the app
 * always picks the newest one on or before the day it is asked about.
 */
const path = require('node:path');
const os = require('node:os');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const KEY_PATH = path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const APPLY = argv.includes('--apply');
const DATE = flag('date');
const BALANCE = flag('balance');
const NOTE = flag('note') || '';

const eur = (n) => (n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const line = (c = '─', w = 74) => c.repeat(w);

/** Same fallback the app uses: movements before May 2026 have no signedAmount. */
const signedAmountOf = (m) => {
  const raw = Number(m.signedAmount);
  if (Number.isFinite(raw) && raw !== 0) return raw;
  const gross = Math.abs(Number(m.amount) || 0);
  return m.direction === 'out' ? -gross : gross;
};

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const db = admin.firestore();

  const ref = db.doc(`${BASE}/settings/reconciliation`);
  const [snap, movSnap] = await Promise.all([ref.get(), db.collection(`${BASE}/bankMovements`).get()]);

  const anchors = Array.isArray(snap.data()?.anchors) ? [...snap.data().anchors] : [];
  anchors.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const movements = movSnap.docs
    .map((d) => d.data())
    .filter((m) => m.status !== 'void' && (m.accountId || 'main') === 'main')
    .sort((a, b) => String(a.postedDate).localeCompare(String(b.postedDate)));

  const latest = anchors[anchors.length - 1] || null;
  const lastMovement = movements.length ? movements[movements.length - 1].postedDate : null;

  /** Balance the app derives for a given cut-off date. */
  const balanceAt = (iso) => {
    const base = anchors.filter((a) => a.date <= iso).pop();
    if (!base) return null;
    const delta = movements
      .filter((m) => m.postedDate > base.date && m.postedDate <= iso)
      .reduce((sum, m) => sum + signedAmountOf(m), 0);
    return Math.round((base.balance + delta) * 100) / 100;
  };

  console.log(`\n${line('═')}`);
  console.log('ANCLA DE CONCILIACIÓN');
  console.log(line('═'));

  if (latest) {
    const age = Math.round((Date.parse(`${lastMovement}T00:00:00Z`) - Date.parse(`${latest.date}T00:00:00Z`)) / 86400000);
    console.log(`  Ancla vigente : ${latest.date}  →  ${eur(latest.balance)}`);
    console.log(`  Origen        : ${latest.source || '—'}`);
    console.log(`  Antigüedad    : ${age} días de movimientos sin conciliar por encima`);
  } else {
    console.log('  No hay ninguna ancla. La caja se está estimando.');
  }
  console.log(`  Movimientos   : ${movements.length} · último importado ${lastMovement || '—'}`);

  if (!DATE || !BALANCE) {
    // Offer month ends plus the last imported day as candidate cut-offs.
    const candidates = new Set();
    if (lastMovement) {
      candidates.add(lastMovement);
      const [y, m] = lastMovement.split('-').map(Number);
      for (let back = 0; back < 4; back++) {
        const d = new Date(Date.UTC(y, m - back, 0)); // day 0 = last day of previous month
        const iso = d.toISOString().slice(0, 10);
        if (latest && iso <= latest.date) continue;
        if (iso <= lastMovement) candidates.add(iso);
      }
    }
    const rows = [...candidates].sort();

    console.log(`\n${line()}`);
    console.log('SALDO QUE CALCULA LA APP EN CADA FECHA DE CORTE');
    console.log(line());
    console.log('  Compara una línea con el saldo real de tu extracto ese día.\n');
    for (const iso of rows) {
      const value = balanceAt(iso);
      const n = movements.filter((m) => m.postedDate > (latest?.date || '') && m.postedDate <= iso).length;
      console.log(`  ${iso}   ${eur(value).padStart(14)}   (${n} movimientos desde el ancla)`);
    }
    console.log(`\n${line()}`);
    console.log('  Cuando una coincida, fíjala:');
    console.log('    node scripts/set-reconciliation-anchor.cjs --date <FECHA> --balance <SALDO> --apply');
    console.log('  Si NINGUNA coincide, falta importar movimientos o hay un extracto sin cargar.');
    console.log(line('═'));
    process.exit(0);
  }

  // ── Pin a verified anchor ───────────────────────────────────────────────
  if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
    console.error(`\n✖ Fecha inválida: "${DATE}". Formato AAAA-MM-DD.`);
    process.exit(1);
  }
  const balance = Number(String(BALANCE).replace(',', '.'));
  if (!Number.isFinite(balance)) {
    console.error(`\n✖ Saldo inválido: "${BALANCE}".`);
    process.exit(1);
  }

  const computed = balanceAt(DATE);
  const diff = computed == null ? null : Math.round((balance - computed) * 100) / 100;

  console.log(`\n${line()}`);
  console.log('ANCLA A FIJAR');
  console.log(line());
  console.log(`  Fecha            : ${DATE}`);
  console.log(`  Saldo real       : ${eur(balance)}`);
  console.log(`  Calculado por app: ${computed == null ? '—' : eur(computed)}`);
  if (diff != null) {
    console.log(`  Diferencia       : ${eur(diff)}`);
    if (Math.abs(diff) < 0.01) console.log('  ✅ Cuadra — el ledger ya estaba correcto hasta esa fecha.');
    else console.log(`  ⚠️  NO cuadra. El ancla nueva corrige ${eur(diff)}; conviene saber de dónde sale antes de fijarla.`);
  }

  if (anchors.some((a) => a.date === DATE)) {
    console.log(`\n⚠️  Ya existe un ancla con fecha ${DATE}. Se añadiría una segunda; la más reciente gana.`);
  }

  if (!APPLY) {
    console.log(`\n${line('═')}`);
    console.log('🟢 DRY-RUN — no se escribió nada. Añade --apply para fijarla.');
    console.log(line('═'));
    process.exit(0);
  }

  const entry = {
    date: DATE,
    balance: Math.round(balance * 100) / 100,
    source: NOTE || 'Conciliación manual contra extracto bancario',
    note: diff != null && Math.abs(diff) >= 0.01 ? `Corrige ${eur(diff)} respecto al saldo derivado.` : 'Coincide con el saldo derivado.',
    confirmedBy: 'set-reconciliation-anchor',
    confirmedAt: new Date().toISOString(),
  };

  await ref.set(
    { anchors: [...anchors, entry], updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );

  console.log(`\n${line('═')}`);
  console.log(`✅ Ancla fijada: ${DATE} → ${eur(entry.balance)}`);
  console.log(`   La caja de hoy pasa a derivarse desde aquí.`);
  console.log(line('═'));
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
