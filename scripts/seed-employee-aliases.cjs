#!/usr/bin/env node
/**
 * Seed employee aliases from the counterparty names the bank actually uses.
 *
 * The employee master stores tidy names ("Beatriz Penaranda") while the
 * Volksbank statement carries the full legal one ("Beatriz Mercedes Sandoval
 * Penaranda"). Until an alias bridges the two, every payment to that person
 * stays unrecognised, which means the ledger cannot tell payroll from a
 * subcontractor and the obra risks being charged twice.
 *
 * Dry-run by default. Writing requires --apply, and only ever appends to
 * employees[].aliases — an existing alias is never removed or rewritten.
 *
 *   node scripts/seed-employee-aliases.cjs                            # propose
 *   node scripts/seed-employee-aliases.cjs --apply                    # ALTA only
 *   node scripts/seed-employee-aliases.cjs --apply --include-medium   # + MEDIA
 *   node scripts/seed-employee-aliases.cjs --apply --include-low      # + BAJA
 *
 * Only ALTA writes by default: a wrong alias binds one person's money to
 * another, and the weaker tiers are exactly the cases where two relatives
 * share a surname.
 */
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const KEY_PATH = path.join(require('node:os').homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;

const APPLY = process.argv.includes('--apply');
const INCLUDE_LOW = process.argv.includes('--include-low');
const INCLUDE_MEDIUM = INCLUDE_LOW || process.argv.includes('--include-medium');

const eur = (n) => (n || 0).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €';
const line = (c = '─', w = 92) => c.repeat(w);

/** Strip accents/punctuation, uppercase, collapse spaces. */
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

const tokensOf = (s) => norm(s).split(' ').filter((t) => t.length > 2);

/** Levenshtein, used only to forgive a one-or-two character typo in a surname. */
const lev = (a, b) => {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
};

/** A token counts as shared when it is equal, or a near-typo of length >= 5. */
const sharesToken = (t, set) => {
  if (set.has(t)) return true;
  if (t.length < 5) return false;
  for (const other of set) {
    if (other.length >= 5 && lev(t, other) <= 2) return true;
  }
  return false;
};

const score = (bankName, employeeName) => {
  const bank = tokensOf(bankName);
  const emp = tokensOf(employeeName);
  if (!bank.length || !emp.length) return { ratio: 0, shared: 0, empTotal: emp.length };
  const bankSet = new Set(bank);
  let shared = 0;
  for (const t of emp) if (sharesToken(t, bankSet)) shared++;
  return { ratio: shared / emp.length, shared, empTotal: emp.length };
};

const confidenceOf = ({ ratio, empTotal, shared }) => {
  // Every master token present in the bank name, on a name with real substance.
  if (ratio === 1 && empTotal >= 2) return 'ALTA';
  // All but one, and at least two tokens agreed.
  if (shared >= 2 && shared === empTotal - 1) return 'MEDIA';
  if (shared >= 2) return 'BAJA';
  return null;
};

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const db = admin.firestore();

  const [empSnap, movSnap] = await Promise.all([
    db.collection(`${BASE}/employees`).get(),
    db.collection(`${BASE}/bankMovements`).get(),
  ]);

  const employees = empSnap.docs.map((d) => {
    const e = d.data();
    return {
      id: d.id,
      fullName: e.fullName || [e.firstName, e.lastName].filter(Boolean).join(' ') || '',
      type: e.type || '',
      status: e.status || '',
      aliases: Array.isArray(e.aliases) ? e.aliases : [],
    };
  }).filter((e) => e.fullName);

  const signed = (m) => {
    const r = Number(m.signedAmount);
    if (Number.isFinite(r) && r !== 0) return r;
    const a = Math.abs(Number(m.amount) || 0);
    return m.direction === 'out' ? -a : a;
  };

  // Aggregate the ledger by exact counterparty string.
  const byCp = new Map();
  for (const d of movSnap.docs) {
    const m = d.data();
    if (m.status === 'void') continue;
    const cp = (m.counterpartyName || '').trim();
    if (!cp) continue;
    if (!byCp.has(cp)) byCp.set(cp, { n: 0, out: 0, in: 0 });
    const agg = byCp.get(cp);
    agg.n++;
    const s = signed(m);
    if (s < 0) agg.out += Math.abs(s); else agg.in += s;
  }

  // Propose: for each counterparty, the best-scoring employee.
  const proposals = [];
  for (const [cp, agg] of byCp) {
    let best = null;
    for (const emp of employees) {
      const s = score(cp, emp.fullName);
      const conf = confidenceOf(s);
      if (!conf) continue;
      if (!best || s.ratio > best.s.ratio || (s.ratio === best.s.ratio && s.shared > best.s.shared)) {
        best = { emp, s, conf };
      }
    }
    if (!best) continue;
    if (norm(cp) === norm(best.emp.fullName)) continue;            // already identical
    if (best.emp.aliases.some((a) => norm(a) === norm(cp))) continue; // already aliased
    proposals.push({ cp, ...agg, emp: best.emp, conf: best.conf, s: best.s });
  }

  proposals.sort((a, b) => {
    const rank = { ALTA: 0, MEDIA: 1, BAJA: 2 };
    return rank[a.conf] - rank[b.conf] || b.out - a.out;
  });

  console.log(`\n${line('═')}`);
  console.log('ALIAS DE EMPLEADOS — nombre del banco → ficha del maestro');
  console.log(line('═'));
  console.log(`Modo:      ${APPLY ? '🔴 APLICAR (escribe en producción)' : '🟢 DRY-RUN (no escribe nada)'}`);
  console.log(`Incluye:   ALTA${INCLUDE_LOW ? ' + MEDIA + BAJA' : ' + MEDIA'}`);
  console.log(`Empleados: ${employees.length}   ·   contrapartes distintas: ${byCp.size}`);

  const groups = { ALTA: [], MEDIA: [], BAJA: [] };
  proposals.forEach((p) => groups[p.conf].push(p));

  for (const conf of ['ALTA', 'MEDIA', 'BAJA']) {
    const rows = groups[conf];
    if (!rows.length) continue;
    console.log(`\n${line()}`);
    console.log(`CONFIANZA ${conf}  (${rows.length})`);
    console.log(line());
    for (const p of rows) {
      console.log(`  banco    : ${p.cp}`);
      console.log(`  ficha    : ${p.emp.fullName}  [${p.emp.type || 'sin tipo'}]`);
      console.log(`  evidencia: ${p.s.shared}/${p.s.empTotal} apellidos/nombres coinciden · ${p.n} movs · salidas ${eur(p.out)}`);
      console.log('');
    }
  }

  const selected = [
    ...groups.ALTA,
    ...(INCLUDE_MEDIUM ? groups.MEDIA : []),
    ...(INCLUDE_LOW ? groups.BAJA : []),
  ];

  const held = [
    ...(INCLUDE_MEDIUM ? [] : groups.MEDIA.map((p) => ({ ...p, flag: '--include-medium' }))),
    ...(INCLUDE_LOW ? [] : groups.BAJA.map((p) => ({ ...p, flag: '--include-low' }))),
  ];

  if (held.length) {
    console.log(line());
    console.log(`⚠️  ${held.length} propuesta(s) NO se aplican — necesitan tu confirmación.`);
    console.log('   Un alias equivocado ata el dinero de una persona a la ficha de otra.');
    for (const p of held) {
      console.log(`   · ${p.cp}  →  ${p.emp.fullName}   (${eur(p.out)}, ${p.conf})  ${p.flag}`);
    }
  }

  console.log(`\n${line('═')}`);
  if (!APPLY) {
    console.log(`🟢 DRY-RUN — no se escribió nada. Se aplicarían ${selected.length} alias.`);
    console.log('   Para aplicar: node scripts/seed-employee-aliases.cjs --apply');
    console.log(line('═'));
    process.exit(0);
  }

  // Group by employee so one document write carries all of that person's aliases.
  const byEmployee = new Map();
  for (const p of selected) {
    if (!byEmployee.has(p.emp.id)) byEmployee.set(p.emp.id, { emp: p.emp, add: [] });
    byEmployee.get(p.emp.id).add.push(p.cp);
  }

  let written = 0, failed = 0;
  for (const { emp, add } of byEmployee.values()) {
    const merged = [...emp.aliases];
    for (const a of add) if (!merged.some((x) => norm(x) === norm(a))) merged.push(a);
    try {
      await db.doc(`${BASE}/employees/${emp.id}`).update({
        aliases: merged,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'seed-employee-aliases',
      });
      console.log(`  ✔ ${emp.fullName}: +${add.length} alias`);
      written += add.length;
    } catch (error) {
      console.error(`  ✖ ${emp.fullName}: ${error.message}`);
      failed++;
    }
  }

  console.log(line('═'));
  console.log(`✅ APLICADO — ${written} alias añadidos en ${byEmployee.size} empleado(s)${failed ? `, ${failed} fallo(s)` : ''}.`);
  console.log(line('═'));
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error('ERROR:', error);
  process.exit(1);
});
