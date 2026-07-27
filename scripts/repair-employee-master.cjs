#!/usr/bin/env node
/**
 * Repair the employee master against DATEV, the authoritative payroll source.
 *
 * Three faults found in production:
 *
 *  1. persNr is empty on all 15 employees. DATEV's personnel number is the
 *     only stable identity; without it every payroll line falls back to fuzzy
 *     name matching.
 *  2. That fallback collided: persNr 00022 ("Pizarro Zapata, P.") and 00023
 *     ("Pizarro Calfual, S.") are two different people, and BOTH payroll lines
 *     link to Pedro's document. Simón's wages have been charged to Pedro in
 *     every imported period.
 *  3. Two names are wrong in the master. DATEV says Pedro is "Pizarro Zapata"
 *     (the master says "Caufal") and Simón is "Pizarro Calfual".
 *
 * Also registers people the bank pays who are missing from the roster, with
 * the type the owner confirmed.
 *
 *   node scripts/repair-employee-master.cjs           # dry-run
 *   node scripts/repair-employee-master.cjs --apply
 */
const path = require('node:path');
const os = require('node:os');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const KEY_PATH = path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;
const APPLY = process.argv.includes('--apply');

const line = (c = '─', w = 88) => c.repeat(w);

/** Corrections confirmed against DATEV payroll lines and by the owner. */
const NAME_FIXES = [
  { match: 'Pedro Pizarro Caufal', fullName: 'Pedro Luis Pizarro Zapata', persNr: '00022',
    reason: 'DATEV 00022 "Pizarro Zapata, P." — el maestro tenía el segundo apellido de Simón' },
  { match: 'Simon Pizarro Caufal', fullName: 'Simon Andres Pizarro Calfual', persNr: '00023',
    reason: 'DATEV 00023 "Pizarro Calfual, S."' },
];

/** persNr → the master fullName it belongs to, read off DATEV payroll lines. */
const PERS_NR_MAP = {
  '00001': 'Juan De Dios Lesmes Linares',
  '00008': 'Juan De DIos Lesmes Correa',
  '00009': 'Beatriz Penaranda',
  '00010': 'Jeisson Andres Romero Lesmes',
  '00017': 'Felipe Santamaria',
  '00021': 'Esneider Alejandro Herrera Romero',
  '00022': 'Pedro Luis Pizarro Zapata',
  '00023': 'Simon Andres Pizarro Calfual',
  '00025': 'Isabelle Horstmann',
  '00027': 'Jorge Alexander Herrera Romero',
};

/** People the bank pays who are not on the roster. Types confirmed by the owner. */
const NEW_PEOPLE = [
  { fullName: 'Jhon Jairo Rivera Parra', type: 'external', aliases: ['JHON JAIRO RIVERA PARRA'] },
  { fullName: 'Erick Angel Otiniano Flores', type: 'external', aliases: ['ERICK ANGEL OTINIANO FLORES'] },
  { fullName: 'Jaime Rafael Guzman Vivanco', type: 'external', aliases: [] },
  { fullName: 'Raul Garcia Vasquez', type: 'external', aliases: [] },
];

const norm = (s) => String(s || '').trim().toLowerCase();

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const db = admin.firestore();

  const [empSnap, periodSnap] = await Promise.all([
    db.collection(`${BASE}/employees`).get(),
    db.collection(`${BASE}/payrollPeriods`).get(),
  ]);

  const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byName = new Map(employees.map((e) => [norm(e.fullName), e]));

  console.log(`\n${line('═')}`);
  console.log('REPARACIÓN DEL MAESTRO DE EMPLEADOS');
  console.log(line('═'));
  console.log(`Modo: ${APPLY ? '🔴 APLICAR' : '🟢 DRY-RUN (no escribe)'}\n`);

  // ── 1. Name + persNr corrections ────────────────────────────────────────
  const nameOps = [];
  for (const fix of NAME_FIXES) {
    const emp = byName.get(norm(fix.match));
    if (!emp) { console.log(`  ⚠️  no encontrado: ${fix.match}`); continue; }
    const aliases = Array.isArray(emp.aliases) ? [...emp.aliases] : [];
    // Keep the old spelling as an alias so historic matches still resolve.
    if (!aliases.some((a) => norm(a) === norm(emp.fullName))) aliases.push(emp.fullName);
    nameOps.push({ emp, fullName: fix.fullName, persNr: fix.persNr, aliases, reason: fix.reason });
  }

  console.log(line());
  console.log('1) NOMBRES CORREGIDOS SEGÚN DATEV');
  console.log(line());
  for (const op of nameOps) {
    console.log(`  "${op.emp.fullName}"  →  "${op.fullName}"   persNr ${op.persNr}`);
    console.log(`     ${op.reason}`);
    console.log(`     alias conservado: ${JSON.stringify(op.aliases)}`);
  }

  // ── 2. persNr for everyone else ─────────────────────────────────────────
  const persOps = [];
  for (const [persNr, fullName] of Object.entries(PERS_NR_MAP)) {
    if (nameOps.some((o) => o.persNr === persNr)) continue; // handled above
    const emp = byName.get(norm(fullName));
    if (!emp) { console.log(`  ⚠️  persNr ${persNr}: no existe ficha "${fullName}"`); continue; }
    if (norm(emp.persNr) === norm(persNr)) continue;
    persOps.push({ emp, persNr });
  }

  console.log(`\n${line()}`);
  console.log(`2) persNr POBLADO (${persOps.length})`);
  console.log(line());
  for (const op of persOps) console.log(`  ${op.emp.fullName.padEnd(38)} ← ${op.persNr}`);

  // ── 3. Payroll lines pointing at the wrong employee ─────────────────────
  const idByPersNr = new Map();
  for (const op of nameOps) idByPersNr.set(op.persNr, op.emp.id);
  for (const op of persOps) idByPersNr.set(op.persNr, op.emp.id);

  const lineOps = [];
  for (const d of periodSnap.docs) {
    const period = d.data();
    const lines = Array.isArray(period.lines) ? period.lines : [];
    let changed = false;
    const fixed = lines.map((l) => {
      const want = idByPersNr.get(String(l.persNr || ''));
      if (want && l.employeeId !== want) {
        changed = true;
        lineOps.push({ period: period.period, persNr: l.persNr, name: l.name, from: l.employeeId || '(vacío)', to: want });
        return { ...l, employeeId: want };
      }
      return l;
    });
    if (changed) d._fixedLines = fixed;
  }

  console.log(`\n${line()}`);
  console.log(`3) LÍNEAS DE NÓMINA RE-VINCULADAS (${lineOps.length})`);
  console.log(line());
  const nameOf = (id) => employees.find((e) => e.id === id)?.fullName || id;
  for (const op of lineOps) {
    console.log(`  ${op.period}  ${op.persNr} "${op.name}"`);
    console.log(`     ${op.from === '(vacío)' ? '(sin vincular)' : nameOf(op.from)}  →  ${nameOf(op.to)}`);
  }

  // ── 4. New people ───────────────────────────────────────────────────────
  const toCreate = NEW_PEOPLE.filter((p) => !byName.has(norm(p.fullName)));
  console.log(`\n${line()}`);
  console.log(`4) PERSONAS NUEVAS (${toCreate.length})`);
  console.log(line());
  for (const p of toCreate) {
    console.log(`  ${p.fullName.padEnd(34)} type=${p.type}${p.aliases.length ? `  alias=${JSON.stringify(p.aliases)}` : ''}`);
  }

  console.log(`\n${line('═')}`);
  if (!APPLY) {
    console.log('🟢 DRY-RUN — no se escribió nada.');
    console.log('   Para aplicar: node scripts/repair-employee-master.cjs --apply');
    console.log(line('═'));
    process.exit(0);
  }

  let ok = 0, fail = 0;
  const stamp = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: 'repair-employee-master' };

  for (const op of nameOps) {
    try {
      await db.doc(`${BASE}/employees/${op.emp.id}`).update({ fullName: op.fullName, persNr: op.persNr, aliases: op.aliases, ...stamp });
      console.log(`  ✔ ${op.fullName} (persNr ${op.persNr})`); ok++;
    } catch (e) { console.error(`  ✖ ${op.fullName}: ${e.message}`); fail++; }
  }
  for (const op of persOps) {
    try {
      await db.doc(`${BASE}/employees/${op.emp.id}`).update({ persNr: op.persNr, ...stamp });
      console.log(`  ✔ ${op.emp.fullName} persNr ${op.persNr}`); ok++;
    } catch (e) { console.error(`  ✖ ${op.emp.fullName}: ${e.message}`); fail++; }
  }
  for (const d of periodSnap.docs) {
    if (!d._fixedLines) continue;
    try {
      await db.doc(`${BASE}/payrollPeriods/${d.id}`).update({ lines: d._fixedLines, ...stamp });
      console.log(`  ✔ período ${d.data().period}: líneas re-vinculadas`); ok++;
    } catch (e) { console.error(`  ✖ período ${d.id}: ${e.message}`); fail++; }
  }
  for (const p of toCreate) {
    try {
      await db.collection(`${BASE}/employees`).add({
        fullName: p.fullName, firstName: '', lastName: '', persNr: '', aliases: p.aliases,
        type: p.type, status: 'active', projectIds: [], role: '', defaultCostCenter: '',
        email: '', phone: '', startDate: '', endDate: '', iban: '', bic: '', taxClass: '', krankenkasse: '',
        bruttoMonthly: 0, nettoMonthly: 0, lstKistMonthly: 0, svAnMonthly: 0, svAgMonthly: 0, gesamtkostenMonthly: 0,
        notes: 'Alta automática: cobra del banco y faltaba en la plantilla.',
        createdBy: 'repair-employee-master', createdAt: admin.firestore.FieldValue.serverTimestamp(), ...stamp,
      });
      console.log(`  ✔ alta ${p.fullName} [${p.type}]`); ok++;
    } catch (e) { console.error(`  ✖ ${p.fullName}: ${e.message}`); fail++; }
  }

  console.log(line('═'));
  console.log(`✅ ${ok} operación(es) aplicadas${fail ? `, ${fail} fallo(s)` : ''}.`);
  console.log(line('═'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
