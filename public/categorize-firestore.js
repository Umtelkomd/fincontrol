/**
 * categorize-firestore.js
 * Script de categorización masiva para movimientos 2026 en Firebase.
 * Usage: Cargar este archivo desde el navegador cuando estés logueado en la app.
 * Se auto-ejecuta y muestra el progreso en console.log.
 */
(async function() {
  const PROJECT_ID = 'umtelkomd-finance';
  const API_KEY = 'AIzaSyD7gIWJU6G2n7ZGM2jq8tE0JyE_jGgMVmI';

  // ── Auth: get Firebase ID token from the current session ──────
  let idToken;
  try {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('No user logged in');
    idToken = await user.getIdToken();
    console.log('[Categorize] Logged in as:', user.email);
  } catch(e) {
    console.error('[Categorize] Auth error. Make sure you are logged into the app:', e.message);
    return;
  }

  const authHeader = `Bearer ${idToken}`;
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  // ── Category inference rules ───────────────────────────────────
  const rules = [
    { kw: ['combus','gasolina','tank','tanke','shell','aral','esso','total','ut a'], cat: 'Combustible' },
    { kw: ['vehiculo','trafic','dacia','opel','leasing','financiacion','renting','cuota'], cat: 'Cuotas vehiculos' },
    { kw: ['arrend','vivienda','fewo','alquiler','apartamento','wohnung','viviend'], cat: 'Vivienda' },
    { kw: ['seguro','krankenkasse','barmer','aok','nurnberger','tui','zoll','bkk'], cat: 'Seguros' },
    { kw: ['nomina','sueldo','juan lesmes','juan corri','jeisson','beatriz','felipe','simon','pedro','alejandro','alexander','cesar','andres','jaime','raul','lozartico','lozartic','jorge','jhon','dieg','fa stralsund','fa-st','brutto'], cat: 'Salarios' },
    { kw: ['subcontrat','trabajo','trabajos','soplado','montaje','lbkom','fractalkom','mqh','ldl','insyte'], cat: 'Subcontratos' },
    { kw: ['material','broca','sonda','madera','lubricante','cable','tierra'], cat: 'Materiales' },
    { kw: ['equipo','herramienta','fusionadora','otdr','compresor','sopladora','handelshof','interval','maquin'], cat: 'Equipos' },
    { kw: ['telefon','internet','o2','vodaf','telekom','1und1','rundfunk','ARD','ZDF'], cat: 'Administrativo' },
    { kw: ['iva','impuesto','finanzamt','confirming','interes','kinder','gestoria','datev'], cat: 'Impuestos' },
    { kw: ['europcar','google','slack','aws','servicio'], cat: 'Otros' },
  ];

  const inferCat = (desc) => {
    const d = (desc || '').toLowerCase();
    for (const r of rules) {
      if (r.kw.some(k => d.includes(k))) return r.cat;
    }
    return null;
  };

  // ── Step 1: collect all docs ──────────────────────────────────
  let allDocs = [];
  let nextPage = null;

  console.log('[Categorize] Fetching bankMovements...');

  do {
    let url = `${baseUrl}/artifacts/${PROJECT_ID}/public/data/bankMovements?pageSize=300`;
    if (nextPage) url += `&pageToken=${encodeURIComponent(nextPage)}`;

    const resp = await fetch(url, { headers: { 'Authorization': authHeader } });
    const data = await resp.json();

    if (data.error) {
      console.error('[Categorize] Firestore error:', data.error);
      return;
    }

    const docs = (data.documents || [])
      .map(d => {
        const f = d.fields || {};
        return {
          id: d.name.split('/').pop(),
          date: f.postedDate?.stringValue || '',
          cat: f.categoryName?.stringValue || '',
          desc: f.description?.stringValue || '',
          amount: f.amount?.doubleValue || 0,
          direction: f.direction?.stringValue || 'out',
        };
      })
      .filter(x => x.date.startsWith('2026') && !x.cat);

    allDocs.push(...docs);
    nextPage = data.nextPageToken || null;
    console.log(`[Categorize] Page fetched. Total candidates so far: ${allDocs.length}`);
  } while (nextPage);

  console.log(`[Categorize] Found ${allDocs.length} movements from 2026 without category.`);

  if (allDocs.length === 0) {
    console.log('[Categorize] Nothing to categorize. Done!');
    return;
  }

  // ── Step 2: update in batches ─────────────────────────────────
  const BATCH = 10;
  let updated = 0, skipped = 0;
  const counts = {};

  for (let i = 0; i < allDocs.length; i += BATCH) {
    const batch = allDocs.slice(i, i + BATCH);
    const patches = batch.map(d => {
      const cat = inferCat(d.desc);
      if (!cat) { skipped++; return null; }
      counts[cat] = (counts[cat] || 0) + 1;
      return { docId: d.id, cat };
    }).filter(Boolean);

    // Execute batch concurrently
    await Promise.all(patches.map(({ docId, cat }) =>
      fetch(`${baseUrl}/artifacts/${PROJECT_ID}/public/data/bankMovements/${docId}`, {
        method: 'PATCH',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { categoryName: { stringValue: cat }, category: { stringValue: cat } }
        })
      }).then(r => r.ok ? updated++ : null)
    ));

    console.log(`[Categorize] Progress: ${Math.min(i+BATCH, allDocs.length)}/${allDocs.length} processed. Updated: ${updated}`);
  }

  console.log(`\n[Categorize] DONE!`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (no match): ${skipped}`);
  console.log('  By category:');
  Object.entries(counts).forEach(([cat, n]) => console.log(`    ${cat}: ${n}`));
  console.log('\nRefresh the Presupuesto page to see the actuals populate.');
})();
