#!/usr/bin/env node
/**
 * Merge two projects into one, moving every reference across.
 *
 * Roßdorf was split into QFF-001 and QFF-002, which meant payroll cost landed
 * 50/50 on two halves of the same site and neither half ever showed the real
 * margin. Merging them gives one obra with one set of numbers.
 *
 * Everything that can point at a project is migrated: bank movements, CXC and
 * CXP, employee assignments, budgets, work in progress and classification
 * rules — by id AND by the denormalised projectName, since older movements
 * carry only the name.
 *
 *   node scripts/merge-projects.cjs --from QFF-002 --into QFF-001 --name "Roßdorf"
 *   node scripts/merge-projects.cjs --from QFF-002 --into QFF-001 --name "Roßdorf" --apply
 *
 * The source project is deactivated, never deleted: its id may still appear in
 * an audit trail, and a dangling reference is worse than an inactive row.
 */
const path = require('node:path');
const os = require('node:os');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const KEY_PATH = path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const APPLY = argv.includes('--apply');
const FROM = flag('from');
const INTO = flag('into');
const NEW_NAME = flag('name');

const line = (c = '─', w = 82) => c.repeat(w);
const norm = (s) => String(s || '').trim().toLowerCase();

(async () => {
  if (!FROM || !INTO) {
    console.error('\nUso: --from <CODIGO> --into <CODIGO> [--name "Nombre final"] [--apply]');
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const db = admin.firestore();

  const projSnap = await db.collection(`${BASE}/projects`).get();
  const byCode = (code) => projSnap.docs.find((d) => norm(d.data().codigo || d.data().code) === norm(code));
  const from = byCode(FROM);
  const into = byCode(INTO);
  if (!from || !into) {
    console.error(`\n✖ No encuentro ${!from ? FROM : INTO}.`);
    process.exit(1);
  }
  if (from.id === into.id) { console.error('\n✖ Origen y destino son el mismo proyecto.'); process.exit(1); }

  const fromName = String(from.data().nombre || from.data().name || '');
  const intoName = String(into.data().nombre || into.data().name || '');
  const finalName = NEW_NAME || intoName;

  const [mv, rec, pay, emp, bud, wip, rul] = await Promise.all([
    db.collection(`${BASE}/bankMovements`).get(),
    db.collection(`${BASE}/receivables`).get(),
    db.collection(`${BASE}/payables`).get(),
    db.collection(`${BASE}/employees`).get(),
    db.collection(`${BASE}/budgets`).get(),
    db.collection(`${BASE}/workInProgress`).get(),
    db.collection(`${BASE}/classificationRules`).get(),
  ]);

  /** A doc points at the source when its id matches, or its stored name does. */
  const pointsAtFrom = (d) => d.projectId === from.id || norm(d.projectName) === norm(fromName);
  /** Any doc on either side needs its denormalised name refreshed. */
  const needsRename = (d) =>
    (d.projectId === into.id || norm(d.projectName) === norm(intoName)) && d.projectName !== finalName;

  const plan = { movements: [], receivables: [], payables: [], employees: [], budgets: [], wip: [], rules: [] };

  for (const [key, snap] of [['movements', mv], ['receivables', rec], ['payables', pay], ['wip', wip]]) {
    for (const d of snap.docs) {
      const data = d.data();
      if (pointsAtFrom(data)) plan[key].push({ ref: d.ref, move: true, label: data.documentNumber || d.id });
      else if (needsRename(data)) plan[key].push({ ref: d.ref, move: false, label: data.documentNumber || d.id });
    }
  }

  for (const d of bud.docs) {
    if (d.data().projectId === from.id) plan.budgets.push({ ref: d.ref, label: d.data().year || d.id });
  }

  for (const d of rul.docs) {
    const a = d.data().applyTo || {};
    if (a.projectId === from.id || norm(a.projectName) === norm(fromName)) {
      plan.rules.push({ ref: d.ref, label: d.data().name || d.id, applyTo: a });
    }
  }

  // Employees: replace the source id and drop the duplicate if they had both.
  for (const d of emp.docs) {
    const ids = Array.isArray(d.data().projectIds) ? d.data().projectIds : [];
    if (!ids.includes(from.id)) continue;
    const had = ids.includes(into.id);
    const next = [...new Set(ids.map((id) => (id === from.id ? into.id : id)))];
    plan.employees.push({ ref: d.ref, name: d.data().fullName, before: ids.length, after: next.length, had, next });
  }

  console.log(`\n${line('═')}`);
  console.log('FUSIÓN DE PROYECTOS');
  console.log(line('═'));
  console.log(`Modo:    ${APPLY ? '🔴 APLICAR' : '🟢 DRY-RUN (no escribe)'}`);
  console.log(`Origen:  ${FROM} "${fromName}"  →  se desactiva`);
  console.log(`Destino: ${INTO} "${intoName}"  →  se renombra a "${finalName}"\n`);

  console.log(line());
  console.log('QUÉ SE MUEVE');
  console.log(line());
  const moved = (k) => plan[k].filter((x) => x.move !== false).length;
  const renamed = (k) => plan[k].filter((x) => x.move === false).length;
  console.log(`  movimientos bancarios : ${String(moved('movements')).padStart(4)} se mueven · ${renamed('movements')} solo renombran`);
  console.log(`  facturas de cliente   : ${String(moved('receivables')).padStart(4)} se mueven · ${renamed('receivables')} solo renombran`);
  console.log(`  facturas de proveedor : ${String(moved('payables')).padStart(4)} se mueven · ${renamed('payables')} solo renombran`);
  console.log(`  obra ejecutada (WIP)  : ${String(moved('wip')).padStart(4)} se mueven · ${renamed('wip')} solo renombran`);
  console.log(`  presupuestos          : ${String(plan.budgets.length).padStart(4)}`);
  console.log(`  reglas de clasificación: ${String(plan.rules.length).padStart(3)}`);

  console.log(`\n${line()}`);
  console.log(`PERSONAL (${plan.employees.length})`);
  console.log(line());
  for (const e of plan.employees) {
    const nota = e.had
      ? `tenía las DOS obras: ${e.before} → ${e.after} proyectos, su coste pasa de ${(100 / e.before).toFixed(0)}% a ${(100 / e.after).toFixed(0)}% en cada uno`
      : `${e.before} → ${e.after} proyectos`;
    console.log(`  ${String(e.name).padEnd(34)} ${nota}`);
  }
  if (plan.employees.some((e) => e.had)) {
    console.log('\n  ⚠️  Quien tenía las dos mitades queda con una sola: su coste total NO cambia,');
    console.log('     pero si además trabaja en otras obras, el reparto entre ellas sí se recalcula.');
  }

  console.log(`\n${line('═')}`);
  if (!APPLY) {
    console.log('🟢 DRY-RUN — no se escribió nada.');
    console.log(`   Aplicar: node scripts/merge-projects.cjs --from ${FROM} --into ${INTO}${NEW_NAME ? ` --name "${NEW_NAME}"` : ''} --apply`);
    console.log(line('═'));
    process.exit(0);
  }

  const ts = admin.firestore.FieldValue.serverTimestamp();
  const stamp = { updatedAt: ts, updatedBy: 'merge-projects' };
  let ok = 0, fail = 0;

  const commit = async (items, build) => {
    for (let i = 0; i < items.length; i += 400) {
      const batch = db.batch();
      for (const item of items.slice(i, i + 400)) batch.update(item.ref, build(item));
      try { await batch.commit(); ok += Math.min(400, items.length - i); }
      catch (e) { console.error(`  ✖ lote: ${e.message}`); fail++; }
    }
  };

  for (const key of ['movements', 'receivables', 'payables', 'wip']) {
    await commit(plan[key], (item) =>
      item.move === false
        ? { projectName: finalName, ...stamp }
        : { projectId: into.id, projectName: finalName, ...stamp });
    if (plan[key].length) console.log(`  ✔ ${key}: ${plan[key].length}`);
  }
  await commit(plan.budgets, () => ({ projectId: into.id, ...stamp }));
  if (plan.budgets.length) console.log(`  ✔ presupuestos: ${plan.budgets.length}`);
  await commit(plan.rules, (item) => ({
    applyTo: { ...item.applyTo, projectId: into.id, projectName: finalName }, ...stamp,
  }));
  if (plan.rules.length) console.log(`  ✔ reglas: ${plan.rules.length}`);
  await commit(plan.employees, (item) => ({ projectIds: item.next, ...stamp }));
  if (plan.employees.length) console.log(`  ✔ personal: ${plan.employees.length}`);

  await into.ref.update({ nombre: finalName, name: finalName, status: 'active', ...stamp });
  await from.ref.update({
    status: 'inactive',
    notes: `Fusionado en ${INTO} "${finalName}" el ${new Date().toISOString().slice(0, 10)}. No usar.`,
    ...stamp,
  });
  console.log(`  ✔ "${intoName}" → "${finalName}" (activo)`);
  console.log(`  ✔ "${fromName}" desactivado`);

  console.log(line('═'));
  console.log(`✅ Fusión completada${fail ? ` con ${fail} lote(s) fallido(s)` : ''}.`);
  console.log(line('═'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
