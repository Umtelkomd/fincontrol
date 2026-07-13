import { expect, test } from '@playwright/test';

const baseUrl = 'https://umtelkomd-finance.web.app';
const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;

const requireText = async (page, text, timeout = 20000) => {
  await page.getByText(text, { exact: false }).waitFor({ state: 'visible', timeout });
};

test('production tail qa', async ({ page }) => {
  const results = [];

  const record = async (name, callback) => {
    try {
      await callback();
      results.push({ name, status: 'pass' });
    } catch (error) {
      results.push({
        name,
        status: 'fail',
        error: error?.message?.split('\n')[0] || String(error),
      });
    }
  };

  const gotoAndExpect = async (path, expectedText, timeout = 20000) => {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
    await requireText(page, expectedText, timeout);
  };

  await record('login admin production', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailInput.fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
    }

    await requireText(page, 'Inicio operativo', 30000);
  });

  await record('balance general renders', async () => {
    await gotoAndExpect('/balance', 'Posición financiera operativa a partir de caja, CXC, CXP y saldos de apertura.');
    await requireText(page, 'Detalle del balance', 10000);
  });

  await record('proyeccion renders', async () => {
    await gotoAndExpect('/proyeccion', 'Horizonte de 13 semanas usando CXC, CXP y caja real.');
    await requireText(page, 'Saldo proyectado por semana', 10000);
  });

  await record('conciliacion renders', async () => {
    await gotoAndExpect('/conciliacion', 'Banco declarado versus ledger operativo.');
    await requireText(page, 'Nuevo cierre mensual', 10000);
  });

  await record('configuracion renders', async () => {
    await page.goto(`${baseUrl}/configuracion`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.getByRole('button', { name: 'Proyectos' }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: 'Cuenta Bancaria' }).click();
    await page.getByRole('button', { name: 'Cuenta Bancaria' }).waitFor({ state: 'visible', timeout: 10000 });
  });

  await record('action launcher opens and closes', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.getByRole('button', { name: 'Nuevo registro' }).click();
    await page.getByRole('button', { name: 'Registrar cobro' }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: 'Ajuste bancario' }).waitFor({ state: 'visible', timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Registrar cobro' }).waitFor({ state: 'hidden', timeout: 10000 });
  });

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((entry) => entry.status === 'fail');
  expect(failed, `QA failures: ${JSON.stringify(failed, null, 2)}`).toEqual([]);
});
