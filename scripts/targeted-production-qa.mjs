import { chromium } from 'playwright';

const baseUrl = 'https://umtelkomd-finance.web.app';
const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;

if (!email || !password) {
  console.error('Missing QA_EMAIL or QA_PASSWORD');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const page = await context.newPage();

const results = [];

const saveArtifacts = async (name) => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const path = '/Users/jarl/Dev/fincontrol/test-results/' + slug + '.png';
  await page.screenshot({ path, fullPage: true });
  return path;
};

const record = async (name, fn) => {
  try {
    console.log('START', name);
    await fn();
    results.push({ name, status: 'pass' });
    console.log('PASS', name);
  } catch (error) {
    const screenshot = await saveArtifacts(name).catch(() => null);
    results.push({
      name,
      status: 'fail',
      error: error?.message?.split('\n')[0] || String(error),
      screenshot,
      url: page.url(),
    });
    console.log('FAIL', name, error?.message?.split('\n')[0] || String(error));
  }
};

const login = async () => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emailInput.fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  }

  await page.getByText('Cómo va la', { exact: false }).waitFor({ state: 'visible', timeout: 30000 });
};

await login();

await record('resumen cockpit renders cash and reconciliation meta', async () => {
  await page.goto(baseUrl + '/resumen', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.getByText('Caja y runway', { exact: false }).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByText('Caja actual', { exact: false }).waitFor({ state: 'visible', timeout: 30000 });
  // Reconciliation meta line: either anchored ("Conciliado al …") or the
  // explicit unanchored fallback — both prove the anchors path is wired.
  const anchored = page.getByText('Conciliado al', { exact: false });
  const unanchored = page.getByText('Sin conciliar', { exact: false });
  await Promise.race([
    anchored.first().waitFor({ state: 'visible', timeout: 30000 }),
    unanchored.first().waitFor({ state: 'visible', timeout: 30000 }),
  ]);
});

await record('configuracion treasury tab manages anchors and vat estimates', async () => {
  await page.goto(baseUrl + '/configuracion', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.getByRole('button', { name: 'Tesorería' }).click();
  await page.getByText('Anclas de conciliación', { exact: false }).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByText('IVA estimado por mes', { exact: false }).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByText('Saldo derivado hoy', { exact: false }).waitFor({ state: 'visible', timeout: 30000 });
});

await record('movimientos ledger loads', async () => {
  await page.goto(baseUrl + '/movimientos', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.getByText('Movimientos', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
});

console.log(JSON.stringify(results, null, 2));
const failed = results.filter((entry) => entry.status === 'fail');
await browser.close();

if (failed.length > 0) {
  process.exitCode = 1;
}
