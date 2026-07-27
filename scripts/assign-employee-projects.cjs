#!/usr/bin/env node
/**
 * Assign employees to the obras they actually work on.
 *
 * Payroll cost reaches a project through employee.projectIds: payrollAllocation
 * splits each person's gesamtkosten evenly across the projects listed there.
 * With the list empty their labour reaches no obra at all, which is why project
 * margins were missing their biggest input.
 *
 * The split is EVEN, not by hours — two projects means 50/50. Assign only the
 * obras where someone really spends their time.
 *
 * Assignments dictated by the owner; ambiguities resolved by him directly.
 *
 *   node scripts/assign-employee-projects.cjs           # dry-run
 *   node scripts/assign-employee-projects.cjs --apply
 */
const path = require('node:path');
const os = require('node:os');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const KEY_PATH = path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;
const APPLY = process.argv.includes('--apply');
const line = (c = '─', w = 90) => c.repeat(w);

/** Project codes, resolved to ids at runtime so a renamed project still matches. */
const OVERHEAD = 'AMD-001';   // "backoffice" — company structure, not an obra
const ROSSDORF_1 = 'QFF-001';
const ROSSDORF_2 = 'QFF-002';
const NE4 = 'UGG-001';        // Vancom NE4 — Sebastián's site ("UGG NE4")
const WESCONNECT = 'WSC';     // Wesconnect — Felipe, Alexander and Juan jr work here

/** Reactivate these: staff are still being assigned to them. */
const REACTIVATE = [NE4, WESCONNECT];

const ASSIGNMENTS = [
  { name: 'Beatriz Penaranda', codes: [OVERHEAD], why: 'backoffice' },
  { name: 'Isabelle Horstmann', codes: [OVERHEAD], why: 'backoffice' },
  { name: 'Esneider Alejandro Herrera Romero', codes: [OVERHEAD], why: 'pasó al backoffice hace dos semanas (antes NE4)' },
  { name: 'Jeisson Andres Romero Lesmes', codes: [OVERHEAD], why: 'backoffice' },
  { name: 'Simon Andres Pizarro Calfual', codes: [ROSSDORF_1, ROSSDORF_2], why: 'Roßdorf' },
  { name: 'Pedro Luis Pizarro Zapata', codes: [ROSSDORF_1, ROSSDORF_2], why: 'Roßdorf' },
  { name: 'Felipe Santamaria', codes: [WESCONNECT], why: 'Wesconnect' },
  { name: 'Jorge Alexander Herrera Romero', codes: [WESCONNECT], why: 'Wesconnect, igual que Felipe' },
  { name: 'Juan De DIos Lesmes Correa', codes: [WESCONNECT], why: 'Wesconnect ("Juan jr"), igual que Felipe' },
  { name: 'Sebastian Agudelo Grajales', codes: [NE4], why: 'UGG NE4 — este sí es Vancom, no Wesconnect' },
  // "repartido en los proyectos y algo en el backoffice" — every obra with a
  // live crew, plus structure. Even split across five, so each carries 20% of
  // his cost; drop the ones he barely visits if that proves too generous.
  { name: 'Juan De Dios Lesmes Linares', codes: [ROSSDORF_1, ROSSDORF_2, WESCONNECT, NE4, OVERHEAD], why: 'repartido en todas las obras vivas + algo de backoffice' },
];

const norm = (s) => String(s || '').trim().toLowerCase();

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const db = admin.firestore();

  const [projSnap, empSnap] = await Promise.all([
    db.collection(`${BASE}/projects`).get(),
    db.collection(`${BASE}/employees`).get(),
  ]);

  const projects = projSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byCode = new Map(projects.map((p) => [norm(p.codigo || p.code), p]));
  const projLabel = (id) => {
    const p = projects.find((x) => x.id === id);
    return p ? `${p.codigo || p.code} ${p.nombre || p.name}` : `(huérfano ${id})`;
  };
  const validIds = new Set(projects.map((p) => p.id));

  const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byName = new Map(employees.map((e) => [norm(e.fullName), e]));

  console.log(`\n${line('═')}`);
  console.log('ASIGNACIÓN DE OBRAS AL PERSONAL');
  console.log(line('═'));
  console.log(`Modo: ${APPLY ? '🔴 APLICAR' : '🟢 DRY-RUN (no escribe)'}\n`);

  // ── Reactivations ───────────────────────────────────────────────────────
  const reactivations = [];
  for (const code of REACTIVATE) {
    const p = byCode.get(norm(code));
    if (!p) { console.log(`  ⚠️  proyecto ${code} no existe`); continue; }
    if (p.status === 'active') continue;
    reactivations.push(p);
  }
  if (reactivations.length) {
    console.log(line());
    console.log('PROYECTOS REACTIVADOS');
    console.log(line());
    for (const p of reactivations) console.log(`  ${p.codigo || p.code} ${p.nombre || p.name}  (${p.status} → active)`);
    console.log('');
  }

  // ── Assignments ─────────────────────────────────────────────────────────
  const ops = [];
  console.log(line());
  console.log('ASIGNACIONES');
  console.log(line());
  for (const a of ASSIGNMENTS) {
    const emp = byName.get(norm(a.name));
    if (!emp) { console.log(`  ⚠️  no existe la ficha "${a.name}"`); continue; }
    const ids = [];
    for (const code of a.codes) {
      const p = byCode.get(norm(code));
      if (!p) { console.log(`  ⚠️  ${a.name}: proyecto ${code} no existe`); continue; }
      ids.push(p.id);
    }
    if (!ids.length) continue;
    const current = Array.isArray(emp.projectIds) ? emp.projectIds : [];
    const same = current.length === ids.length && ids.every((i) => current.includes(i));
    const share = (100 / ids.length).toFixed(0);
    console.log(`  ${a.name}`);
    console.log(`     ${ids.map(projLabel).join('  +  ')}`);
    console.log(`     ${ids.length === 1 ? '100% a esa obra' : `${share}% a cada una`} · ${a.why}${same ? '  (ya estaba)' : ''}`);
    if (!same) ops.push({ emp, ids });
  }

  // ── Orphan project references ───────────────────────────────────────────
  const orphans = [];
  for (const emp of employees) {
    const current = Array.isArray(emp.projectIds) ? emp.projectIds : [];
    const bad = current.filter((id) => !validIds.has(id));
    if (bad.length) orphans.push({ emp, bad, keep: current.filter((id) => validIds.has(id)) });
  }
  if (orphans.length) {
    console.log(`\n${line()}`);
    console.log('REFERENCIAS A PROYECTOS QUE YA NO EXISTEN');
    console.log(line());
    for (const o of orphans) {
      console.log(`  ${o.emp.fullName}: quita ${o.bad.join(', ')} · conserva ${o.keep.length} obra(s)`);
    }
  }

  console.log(`\n${line('═')}`);
  if (!APPLY) {
    console.log(`🟢 DRY-RUN — ${ops.length} asignación(es), ${reactivations.length} reactivación(es), ${orphans.length} limpieza(s).`);
    console.log('   Para aplicar: node scripts/assign-employee-projects.cjs --apply');
    console.log(line('═'));
    process.exit(0);
  }

  const ts = admin.firestore.FieldValue.serverTimestamp();
  let ok = 0, fail = 0;

  for (const p of reactivations) {
    try {
      await db.doc(`${BASE}/projects/${p.id}`).update({ status: 'active', updatedAt: ts, updatedBy: 'assign-employee-projects' });
      console.log(`  ✔ reactivado ${p.codigo || p.code} ${p.nombre || p.name}`); ok++;
    } catch (e) { console.error(`  ✖ ${p.codigo || p.code}: ${e.message}`); fail++; }
  }
  for (const op of ops) {
    try {
      await db.doc(`${BASE}/employees/${op.emp.id}`).update({ projectIds: op.ids, updatedAt: ts, updatedBy: 'assign-employee-projects' });
      console.log(`  ✔ ${op.emp.fullName} → ${op.ids.length} obra(s)`); ok++;
    } catch (e) { console.error(`  ✖ ${op.emp.fullName}: ${e.message}`); fail++; }
  }
  for (const o of orphans) {
    // An assignment above may already have rewritten this person's list.
    if (ops.some((x) => x.emp.id === o.emp.id)) continue;
    try {
      await db.doc(`${BASE}/employees/${o.emp.id}`).update({ projectIds: o.keep, updatedAt: ts, updatedBy: 'assign-employee-projects' });
      console.log(`  ✔ ${o.emp.fullName}: referencia huérfana eliminada`); ok++;
    } catch (e) { console.error(`  ✖ ${o.emp.fullName}: ${e.message}`); fail++; }
  }

  console.log(line('═'));
  console.log(`✅ ${ok} operación(es)${fail ? `, ${fail} fallo(s)` : ''}.`);
  console.log(line('═'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
