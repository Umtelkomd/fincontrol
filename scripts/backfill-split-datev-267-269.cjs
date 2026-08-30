#!/usr/bin/env node
/**
 * Split the aggregate DATEV rows 2025-267 / 268 / 269 into their Insyte CxC.
 *
 * Those three receivables were created "one row per DATEV Rechnung" with the
 * PDF Endbetrag as amount. Business rule (Jeisson, 30.08.2026): a Rechnung
 * groups N Insyte presupuestos; the CxC is the presupuesto (PK pad10, amount
 * = Insyte NET) and the Rechnung is ATTACHED to it as `rechnungId`. So each
 * aggregate is replaced by stamping its Insyte rows and deleting the
 * aggregate. No amount is ever taken from the PDF.
 *
 *   node scripts/backfill-split-datev-267-269.cjs \
 *     --extract 2025-267=/path/extract_2025-267.txt \
 *     --extract 2025-268=/path/extract_2025-268.txt \
 *     --extract 2025-269=/path/extract_2025-269.txt \
 *     --pedidos scripts/data/pedidoscompraumtelkomd.csv \
 *     [--insyte /path/insyte_rows.json] [--apply]
 *
 * --pedidos is the Insyte purchase-order export (parsed with
 * parseInsytePedidosCsv). It resolves pedido → presupuesto (ranked after the
 * loaded receivables, before the seed map) AND supplies importePedido — the
 * Insyte net — for any row that has to be created. --insyte JSON remains an
 * optional override for the same purpose.
 *
 * Dry-run by default: prints the plan (attach / missing / conflicts / aggregate
 * to delete) and writes nothing. With --apply it performs ONLY:
 *   1. JSON backup of every touched document to ~/.hermes/cron/cxc_pending/backups
 *   2. stamp rechnungId + numeroPedido on existing Insyte rows (status → issued
 *      when missing/pending); amounts untouched
 *   3. create rows for `missing` pedidos ONLY from --pedidos CSV rows or --insyte
 *      JSON entries that carry importePedido/importePresupuesto (the Insyte
 *      net); never from the PDF
 *   4. delete the aggregate row
 * It refuses to touch any row settled/cancelled or any Rechnung 2025-210…266.
 *
 * --insyte JSON shape: [{ numeroPresupuesto, numeroPedido, importePedido?,
 *   importePresupuesto?, referenciaObra?, fechaPresupuesto?, fechaPedido?, kw?,
 *   tipoObra?, obraPueblo?, pep?, estadoInsyte? }]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const KEY_PATH = path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;
const BACKUP_DIR = path.join(os.homedir(), '.hermes', 'cron', 'cxc_pending', 'backups');
const BOT = 'backfill-split-datev-267-269';

/** The three aggregate rows, by Firestore id, and the Rechnung each stands for. */
const AGGREGATES = [
  { id: '24HAOKMZuyY6ceBKlxfn', rechnungId: '2025-267' },
  { id: '4N1iV8GhWNoKti0BFqWT', rechnungId: '2025-268' },
  { id: 'yYdfpx6pjugX9reVENyy', rechnungId: '2025-269' },
];
/** Anything in this range was settled the old way and is off limits. */
const FROZEN_RECHNUNG = /^2025-2(1\d|[2-5]\d|6[0-6])$/;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const readArgs = (flag) =>
  argv.flatMap((token, index) => (token === flag && argv[index + 1] ? [argv[index + 1]] : []));

const eur = (n) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const line = (c = '─', w = 86) => c.repeat(w);
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fail = (message) => {
  console.error(`\n✖ ${message}`);
  process.exit(1);
};

const parseExtractArgs = () => {
  const extracts = new Map();
  for (const raw of readArgs('--extract')) {
    const [rechnungId, file] = raw.split('=');
    if (!/^\d{4}-\d{3}$/.test(rechnungId || '') || !file) fail(`--extract inválido: "${raw}" (esperado 2025-NNN=/ruta.txt)`);
    if (!fs.existsSync(file)) fail(`No existe el extract ${file}`);
    extracts.set(rechnungId, fs.readFileSync(file, 'utf8'));
  }
  return extracts;
};

const parseInsyteArg = () => {
  const [file] = readArgs('--insyte');
  if (!file) return [];
  if (!fs.existsSync(file)) fail(`No existe el JSON Insyte ${file}`);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows)) fail('--insyte debe ser un array JSON');
  return rows;
};

const hasNumber = (value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));

(async () => {
  const [{ parseDatevFooterPedidos, parseDatevRechnungHeader }, { planDatevAttach }, insyte, { parseInsytePedidosCsv }] =
    await Promise.all([
      import('../src/finance/datevRechnungFooter.js'),
      import('../src/finance/datevAttach.js'),
      import('../src/finance/insyteContract.js'),
      import('../src/finance/insytePedidosCsv.js'),
    ]);
  const { INSYTE_PEDIDO_PRESUPUESTO_MAP, insyteSourceKey, padPedido, padPresupuesto, parseKw } = insyte;

  const extracts = parseExtractArgs();
  const missingExtract = AGGREGATES.filter((entry) => !extracts.has(entry.rechnungId));
  if (missingExtract.length) {
    fail(`Falta --extract para ${missingExtract.map((entry) => entry.rechnungId).join(', ')}`);
  }
  for (const aggregate of AGGREGATES) {
    const header = parseDatevRechnungHeader(extracts.get(aggregate.rechnungId));
    if (header.rechnungId && header.rechnungId !== aggregate.rechnungId) {
      fail(`El extract pasado como ${aggregate.rechnungId} es la Rechnung ${header.rechnungId}`);
    }
  }
  const [pedidosPath] = readArgs('--pedidos');
  if (pedidosPath && !fs.existsSync(pedidosPath)) fail(`No existe el CSV de pedidos ${pedidosPath}`);
  const pedidoRows = pedidosPath ? parseInsytePedidosCsv(fs.readFileSync(pedidosPath, 'utf8')) : [];
  // Explicit JSON overrides the CSV for the same presupuesto.
  const insyteRows = [...pedidoRows, ...parseInsyteArg()];

  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const db = admin.firestore();
  const col = db.collection(`${BASE}/receivables`);

  const snap = await col.get();
  const receivables = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byId = new Map(receivables.map((row) => [row.id, row]));

  console.log(`\n${line('═')}`);
  console.log('DIVIDIR AGREGADOS DATEV 2025-267 / 268 / 269 EN SUS CXC INSYTE');
  console.log(line('═'));
  console.log(`Modo: ${APPLY ? '🔴 APLICAR' : '🟢 DRY-RUN (no escribe)'}`);
  console.log(`CXC cargadas: ${receivables.length} · pedidos Insyte (CSV): ${pedidoRows.length} · filas --insyte: ${insyteRows.length - pedidoRows.length}\n`);

  // ── Assertions before anything else ──────────────────────────────────────
  for (const aggregate of AGGREGATES) {
    const row = byId.get(aggregate.id);
    if (!row) fail(`No existe el agregado ${aggregate.id} (${aggregate.rechnungId})`);
    const number = row.invoiceNumber || row.documentNumber;
    if (number !== aggregate.rechnungId) fail(`${aggregate.id} es ${number}, no ${aggregate.rechnungId}`);
    if (row.status !== 'issued') fail(`${aggregate.rechnungId} está ${row.status}; solo se divide un agregado "issued"`);
    if (String(row.sourceKey || '').startsWith('insyte:')) fail(`${aggregate.id} es una fila Insyte, no un agregado`);
  }

  /** Last match wins: --insyte JSON entries come after the CSV rows. */
  const sourceFor = (numeroPresupuesto) =>
    [...insyteRows].reverse().find((row) => padPresupuesto(row.numeroPresupuesto) === numeroPresupuesto) || null;
  const importeOf = (source) =>
    source && (hasNumber(source.importePedido) ? Number(source.importePedido) : hasNumber(source.importePresupuesto) ? Number(source.importePresupuesto) : null);

  // ── Plan per Rechnung ────────────────────────────────────────────────────
  const plans = [];
  for (const aggregate of AGGREGATES) {
    const pedidos = parseDatevFooterPedidos(extracts.get(aggregate.rechnungId));
    const plan = planDatevAttach({
      rechnungId: aggregate.rechnungId,
      pedidos,
      receivables,
      map: INSYTE_PEDIDO_PRESUPUESTO_MAP,
      pedidoRows,
    });
    if (plan.error) fail(`${aggregate.rechnungId}: ${plan.error}`);
    if (!plan.aggregateRowsToDelete.includes(aggregate.id)) {
      fail(`${aggregate.rechnungId}: el plan no reconoce ${aggregate.id} como agregado`);
    }
    const foreign = plan.aggregateRowsToDelete.filter((id) => id !== aggregate.id);
    if (foreign.length) fail(`${aggregate.rechnungId}: más de un agregado (${foreign.join(', ')}); revisar a mano`);

    for (const target of plan.attach) {
      const row = byId.get(target.receivableId);
      if (['settled', 'cancelled'].includes(row.status)) fail(`${row.id} está ${row.status}; no se toca`);
      if (FROZEN_RECHNUNG.test(String(row.rechnungId || ''))) fail(`${row.id} pertenece a ${row.rechnungId} (congelada)`);
    }

    const creatable = plan.missing.filter((entry) => {
      if (entry.reason !== 'no-row') return false;
      const source = sourceFor(entry.numeroPresupuesto);
      return source && (hasNumber(source.importePedido) || hasNumber(source.importePresupuesto));
    });
    plans.push({ aggregate, pedidos, plan, creatable, header: parseDatevRechnungHeader(extracts.get(aggregate.rechnungId)) });
  }

  // ── Print ────────────────────────────────────────────────────────────────
  const pad = (value, width) => String(value ?? '').padEnd(width);
  for (const { aggregate, pedidos, plan, creatable, header } of plans) {
    const row = byId.get(aggregate.id);
    console.log(line());
    console.log(`  ${aggregate.rechnungId}   agregado ${aggregate.id}   Endbetrag registrado ${eur(row.grossAmount)} (se descarta)`);
    console.log(`     PDF: Summe ${header.summe === null ? '?' : eur(header.summe)} · Endbetrag ${header.endbetrag === null ? '?' : eur(header.endbetrag)}`);
    console.log(`     pedidos en el pie: ${pedidos.length ? pedidos.join(', ') : '— ninguno —'}`);
    console.log(`     ${pad('pedido', 9)}${pad('presupuesto', 13)}${'importePedido'.padStart(15)}   CxC`);
    let insyteSum = 0;
    for (const target of plan.attach) {
      const r = byId.get(target.receivableId);
      const importe = importeOf(sourceFor(target.numeroPresupuesto));
      insyteSum += importe ?? 0;
      console.log(`     ${pad(target.numeroPedido, 9)}${pad(target.numeroPresupuesto, 13)}${(importe === null ? '?' : eur(importe)).padStart(15)}   ✔ ${r.id}  (fila ${eur(r.grossAmount)} neto)`);
    }
    for (const entry of plan.conflicts) {
      console.log(`     ${pad(entry.numeroPedido, 9)}${pad(entry.numeroPresupuesto, 13)}${''.padStart(15)}   ⚠ conflicto: ${entry.receivableId} ya lleva ${entry.rechnungId}`);
    }
    for (const entry of plan.missing) {
      const willCreate = creatable.includes(entry);
      const importe = importeOf(sourceFor(entry.numeroPresupuesto));
      if (willCreate) insyteSum += importe ?? 0;
      console.log(`     ${pad(entry.numeroPedido, 9)}${pad(entry.numeroPresupuesto || '?', 13)}${(importe === null ? '?' : eur(importe)).padStart(15)}   ${willCreate ? 'CREAR' : `✖ ${entry.reason}${entry.reason === 'no-row' ? ' (sin importe Insyte: pasá --pedidos/--insyte)' : ''}`}`);
    }
    if (header.summe !== null && plan.conflicts.length === 0) {
      const ok = Math.abs(round(insyteSum) - header.summe) < 0.005;
      console.log(`     suma importes Insyte ${eur(insyteSum)} vs Summe PDF ${eur(header.summe)} → ${ok ? 'cuadra' : '⚠ NO cuadra (revisar antes de aplicar)'}`);
    }
    console.log(`     🗑 borrar agregado ${aggregate.id}`);
  }
  console.log(line());

  const conflicts = plans.flatMap((entry) => entry.plan.conflicts);
  const unresolved = plans.flatMap(({ plan, creatable }) => plan.missing.filter((entry) => !creatable.includes(entry)));
  if (conflicts.length) fail(`${conflicts.length} conflicto(s): una fila ya lleva otra Rechnung. No se aplica nada.`);
  if (unresolved.length) {
    console.log(`\n  ⚠️  ${unresolved.length} pedido(s) sin fila ni datos Insyte con importe. Pasá --insyte <json> con importePedido/importePresupuesto.`);
  }

  if (!APPLY) {
    console.log(`\n${line('═')}`);
    console.log('🟢 DRY-RUN — no se escribió nada.');
    console.log('   Para aplicar: añadí --apply al mismo comando (con --pedidos para las filas a crear).');
    console.log(line('═'));
    process.exit(0);
  }
  if (unresolved.length) fail('Con pedidos sin resolver no se aplica: el agregado se quedaría sin sus CxC.');

  // ── Backup ───────────────────────────────────────────────────────────────
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const touchedIds = new Set(plans.flatMap(({ aggregate, plan }) => [aggregate.id, ...plan.attach.map((t) => t.receivableId)]));
  const backup = {
    script: BOT,
    at: new Date().toISOString(),
    documents: [...touchedIds].map((id) => ({ id, data: byId.get(id) })),
    plans: plans.map(({ aggregate, pedidos, plan }) => ({ aggregate, pedidos, plan })),
  };
  const backupPath = path.join(BACKUP_DIR, `split_datev_267_269_${backup.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(backup, (_key, value) => (value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value), 2),
  );
  console.log(`\n  backup → ${backupPath}`);

  // ── Apply ────────────────────────────────────────────────────────────────
  const ts = admin.firestore.FieldValue.serverTimestamp();
  const nowIso = new Date().toISOString();
  const batch = db.batch();
  let stamped = 0;
  let created = 0;

  for (const { aggregate, plan, creatable } of plans) {
    for (const target of plan.attach) {
      const row = byId.get(target.receivableId);
      const update = {
        rechnungId: aggregate.rechnungId,
        numeroPedido: target.numeroPedido,
        updatedBy: BOT,
        updatedAt: ts,
        auditTrail: admin.firestore.FieldValue.arrayUnion({
          action: 'attach-datev',
          user: BOT,
          timestamp: nowIso,
          detail: `Rechnung DATEV ${aggregate.rechnungId} adjunta (pedido ${target.numeroPedido}). Importe Insyte sin cambio.`,
        }),
      };
      if (!row.status || row.status === 'pending') update.status = 'issued';
      batch.update(col.doc(target.receivableId), update);
      stamped += 1;
    }

    for (const entry of creatable) {
      const source = sourceFor(entry.numeroPresupuesto);
      const amount = round(hasNumber(source.importePedido) ? source.importePedido : source.importePresupuesto);
      const kw = source.kw || parseKw(source.referenciaObra || '');
      const issueDate = source.fechaPresupuesto || source.fechaPedido || nowIso.slice(0, 10);
      batch.set(col.doc(), {
        accountId: 'main',
        currency: 'EUR',
        // The row IS the presupuesto — never the Rechnung number.
        invoiceNumber: entry.numeroPresupuesto,
        documentNumber: entry.numeroPresupuesto,
        client: 'INSYTE',
        counterpartyName: 'INSYTE',
        description: source.referenciaObra || '',
        grossAmount: amount,
        amount,
        openAmount: amount,
        pendingAmount: amount,
        paidAmount: 0,
        issueDate,
        dueDate: source.dueDate || issueDate,
        paymentTerms: 'net30',
        status: 'issued',
        payments: [],
        notes: `Creada al dividir el agregado DATEV ${aggregate.rechnungId}. Importe = neto Insyte.`,
        source: 'insyte',
        sourceSystem: 'insyte',
        sourceKey: insyteSourceKey(entry.numeroPresupuesto),
        numeroPresupuesto: entry.numeroPresupuesto,
        numeroPedido: padPedido(entry.numeroPedido),
        fechaPresupuesto: source.fechaPresupuesto || '',
        fechaPedido: source.fechaPedido || '',
        referenciaObra: source.referenciaObra || '',
        kw,
        productionWeekRef: kw,
        tipoObra: source.tipoObra || '',
        obraPueblo: source.obraPueblo || '',
        pep: source.pep || '',
        estadoInsyte: source.estadoInsyte || '',
        importePedido: hasNumber(source.importePedido) ? round(source.importePedido) : null,
        importePresupuesto: hasNumber(source.importePresupuesto) ? round(source.importePresupuesto) : null,
        rechnungId: aggregate.rechnungId,
        projectId: '',
        projectName: source.obraPueblo || source.tipoObra || '',
        costCenterId: '',
        createdBy: BOT,
        createdAt: ts,
        updatedBy: BOT,
        updatedAt: ts,
        auditTrail: [{ action: 'create', user: BOT, timestamp: nowIso, detail: `Alta Insyte desde división de ${aggregate.rechnungId}` }],
      });
      created += 1;
    }

    batch.delete(col.doc(aggregate.id));
  }

  await batch.commit();
  console.log(`\n${line('═')}`);
  console.log(`✅ ${stamped} CXC Insyte con Rechnung adjunta · ${created} creadas desde Insyte · ${AGGREGATES.length} agregados borrados.`);
  console.log(line('═'));
  process.exit(0);
})().catch((error) => {
  console.error('ERROR:', error.message || error);
  process.exit(1);
});
