#!/usr/bin/env node
/**
 * Register the invoices posted to Slack #facturas that are missing from CXC.
 *
 * Source of truth is the PDF attached in Slack, read invoice by invoice. Each
 * entry below carries the figures exactly as printed: net, VAT and gross.
 *
 * Unlike the older receivables — which stored the net amount in `grossAmount`
 * and noted the gross in free text — these carry `taxRate`, `netAmount` and
 * `taxAmount` explicitly, so the VAT model derives both figures instead of
 * guessing. That is the shape every new invoice should use.
 *
 *   node scripts/add-cxc-from-slack.cjs           # dry-run
 *   node scripts/add-cxc-from-slack.cjs --apply
 */
const path = require('node:path');
const os = require('node:os');
const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));

const KEY_PATH = path.join(os.homedir(), '.credentials', 'umtelkomd-firebase.json');
const APP_ID = '1:597712756560:web:ad12cd9794f11992641655';
const BASE = `artifacts/${APP_ID}/public/data`;
const APPLY = process.argv.includes('--apply');

const eur = (n) => (n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const line = (c = '─', w = 86) => c.repeat(w);
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Read off the PDFs in Slack #facturas on 2026-07-23.
 * Payment terms follow the existing pattern: net30 for Insyte, ~10 days B2C.
 */
const INVOICES = [
  {
    documentNumber: '2025-256',
    client: 'Insyte Deutschland GmbH',
    issueDate: '2026-07-23',
    dueDate: '2026-08-22',
    paymentTerms: 'net30',
    serviceDate: '2026-07-17',
    netAmount: 3542.0,
    taxAmount: 672.98,
    grossAmount: 4214.98,
    description: 'QFF Roßdorf KW29 — Fusión, activación y perforaciones DGF',
    note: 'Slack #facturas 23.07.2026. 18 posiciones DGF_ACT.',
  },
  {
    documentNumber: '2025-257',
    client: 'Markus Weicker',
    issueDate: '2026-07-23',
    dueDate: '2026-08-02',
    paymentTerms: 'net10',
    serviceDate: '2026-07-22',
    netAmount: 67.22,
    taxAmount: 12.77,
    grossAmount: 79.99,
    description: 'Servicepaket Leitungsweg — Im Mummler 15, 64380 Roßdorf',
    note: 'Slack #facturas 23.07.2026. B2C: una perforación y tendido de fibra.',
  },
  {
    documentNumber: '2025-258',
    client: 'Liebke Becker',
    issueDate: '2026-07-23',
    dueDate: '2026-08-02',
    paymentTerms: 'net10',
    serviceDate: '2026-07-22',
    netAmount: 134.44,
    taxAmount: 25.54,
    grossAmount: 159.98,
    description: 'Servicepaket Leitungsweg — Auf der Schmelz 63, 64380 Roßdorf',
    note: 'Slack #facturas 23.07.2026. B2C: dos perforaciones y tendido de fibra.',
  },
];

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const db = admin.firestore();

  const snap = await db.collection(`${BASE}/receivables`).get();
  const existing = new Set(
    snap.docs.flatMap((d) => [d.data().documentNumber, d.data().invoiceNumber])
      .filter(Boolean)
      .map((n) => String(n).trim().toLowerCase()),
  );

  const fresh = INVOICES.filter((i) => !existing.has(i.documentNumber.toLowerCase()));
  const skipped = INVOICES.filter((i) => existing.has(i.documentNumber.toLowerCase()));

  console.log(`\n${line('═')}`);
  console.log('FACTURAS DE SLACK QUE FALTAN EN CXC');
  console.log(line('═'));
  console.log(`Modo: ${APPLY ? '🔴 APLICAR' : '🟢 DRY-RUN (no escribe)'}`);
  console.log(`CXC existentes: ${snap.size} · a crear: ${fresh.length}${skipped.length ? ` · ya registradas: ${skipped.length}` : ''}\n`);

  console.log(line());
  let net = 0, gross = 0;
  for (const i of fresh) {
    net += i.netAmount;
    gross += i.grossAmount;
    console.log(`  ${i.documentNumber}   ${i.client}`);
    console.log(`     ${i.description}`);
    console.log(`     emitida ${i.issueDate} · vence ${i.dueDate} (${i.paymentTerms}) · servicio ${i.serviceDate}`);
    console.log(`     neto ${eur(i.netAmount)} + IVA 19% ${eur(i.taxAmount)} = ${eur(i.grossAmount)}\n`);
  }
  for (const i of skipped) console.log(`  ${i.documentNumber} ya estaba registrada — se omite`);
  console.log(line());
  console.log(`  TOTAL   neto ${eur(net)} · bruto ${eur(gross)}\n`);

  console.log('  ⚠️  Sin obra asignada: "QFF Roßdorf" no distingue Roßdorf 1 de Roßdorf 2,');
  console.log('     y no se adivina. Asígnala desde CXC cuando la crees.\n');

  if (!APPLY) {
    console.log(line('═'));
    console.log('🟢 DRY-RUN — no se escribió nada.');
    console.log('   Para aplicar: node scripts/add-cxc-from-slack.cjs --apply');
    console.log(line('═'));
    process.exit(0);
  }

  const ts = admin.firestore.FieldValue.serverTimestamp();
  let ok = 0, fail = 0;
  for (const i of fresh) {
    try {
      await db.collection(`${BASE}/receivables`).add({
        accountId: 'main',
        currency: 'EUR',
        invoiceNumber: i.documentNumber,
        documentNumber: i.documentNumber,
        client: i.client,
        counterpartyName: i.client,
        description: i.description,
        // Gross is what the client owes; net and rate are explicit so the VAT
        // model never has to infer them.
        grossAmount: round(i.grossAmount),
        amount: round(i.grossAmount),
        openAmount: round(i.grossAmount),
        pendingAmount: round(i.grossAmount),
        paidAmount: 0,
        netAmount: round(i.netAmount),
        taxAmount: round(i.taxAmount),
        taxRate: 0.19,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        paymentTerms: i.paymentTerms,
        status: 'issued',
        projectId: '',
        projectName: '',
        costCenterId: '',
        payments: [],
        notes: `${i.note} Leistungsdatum ${i.serviceDate}.`,
        createdBy: 'add-cxc-from-slack',
        createdAt: ts,
        updatedAt: ts,
        updatedBy: 'add-cxc-from-slack',
      });
      console.log(`  ✔ ${i.documentNumber}  ${eur(i.grossAmount)}`);
      ok++;
    } catch (error) {
      console.error(`  ✖ ${i.documentNumber}: ${error.message}`);
      fail++;
    }
  }

  console.log(line('═'));
  console.log(`✅ ${ok} factura(s) creadas por ${eur(gross)} brutos${fail ? `, ${fail} fallo(s)` : ''}.`);
  console.log('   Pendiente: asignarles obra desde CXC.');
  console.log(line('═'));
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error('ERROR:', error); process.exit(1); });
