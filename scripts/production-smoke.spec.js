import { expect, test } from '@playwright/test';

const baseUrl = 'https://umtelkomd-finance.web.app';
const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;

const requireText = async (page, text, timeout = 20000) => {
  await page.getByText(text, { exact: false }).waitFor({ state: 'visible', timeout });
};

test('production smoke qa', async ({ page }) => {
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

  await record('dashboard renders', async () => {
    await gotoAndExpect('/', 'Liquidez real, vencimientos y proyeccion semanal en una sola vista.');
    await requireText(page, 'Caja real', 10000);
  });

  await record('tesoreria renders', async () => {
    await gotoAndExpect('/cashflow', 'La caja vive aqui: movimientos, compromisos y conciliacion pendiente.');
    await requireText(page, 'Balance de caja semanal', 10000);
  });

  await record('cxc workspace renders', async () => {
    await gotoAndExpect('/cxc', 'Seguimiento de cartera, abonos y vencimientos.');
    await requireText(page, 'Cartera abierta', 10000);
  });

  await record('cxc partial payment modal opens and closes', async () => {
    await page.goto(`${baseUrl}/cxc`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const abonoButton = page.getByRole('button', { name: 'Abono' }).first();
    await abonoButton.waitFor({ state: 'visible', timeout: 10000 });
    await abonoButton.click();
    await page.locator('h3').filter({ hasText: 'Registrar Pago' }).waitFor({ state: 'visible', timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.locator('h3').filter({ hasText: 'Registrar Pago' }).waitFor({ state: 'hidden', timeout: 10000 });
  });

  await record('cxp workspace renders', async () => {
    await gotoAndExpect('/cxp', 'Control de deuda operativa, pagos y vencimientos.');
    await requireText(page, 'Deuda abierta', 10000);
  });

  await record('cxp partial payment modal opens and closes', async () => {
    await page.goto(`${baseUrl}/cxp`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const abonoButton = page.getByRole('button', { name: 'Abono' }).first();
    await abonoButton.waitFor({ state: 'visible', timeout: 10000 });
    await abonoButton.click();
    await page.locator('h3').filter({ hasText: 'Registrar Pago' }).waitFor({ state: 'visible', timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.locator('h3').filter({ hasText: 'Registrar Pago' }).waitFor({ state: 'hidden', timeout: 10000 });
  });

  await record('report tabs render', async () => {
    await gotoAndExpect('/reportes', 'Resumen Ejecutivo');
    await page.getByRole('button', { name: 'Estado de Resultados' }).click();
    await requireText(page, 'Estado de resultados operativo', 10000);
    await page.getByRole('button', { name: 'Ratios Financieros' }).click();
    await requireText(page, 'Ratios financieros', 10000);
    await page.getByRole('button', { name: 'Reporte CXC' }).click();
    await requireText(page, 'Reporte de Cuentas por Cobrar', 10000);
    await page.getByRole('button', { name: 'Reporte CXP' }).click();
    await requireText(page, 'Reporte de Cuentas por Pagar', 10000);
  });

  await record('report export button click is non-blocking', async () => {
    await page.goto(`${baseUrl}/reportes`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.getByRole('button', { name: 'Estado de Resultados' }).click();
    await requireText(page, 'Estado de resultados operativo', 10000);
    await page.getByRole('button', { name: 'Exportar PDF' }).click();
    await page.waitForTimeout(3000);
    await requireText(page, 'Estado de resultados operativo', 10000);
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
    await gotoAndExpect('/configuracion', 'Proyectos');
    await page.getByRole('button', { name: 'Cuenta Bancaria' }).click();
    await requireText(page, 'Cuenta Bancaria', 10000);
  });

  await record('action launcher opens and closes', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.getByRole('button', { name: 'Nuevo registro' }).click();
    await requireText(page, 'Registrar cobro', 10000);
    await requireText(page, 'Ajuste bancario', 10000);
    await page.keyboard.press('Escape');
    await page.getByText('Registrar cobro', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 });
  });

  console.log(JSON.stringify(results, null, 2));

  const failed = results.filter((entry) => entry.status === 'fail');
  expect(failed, `QA failures: ${JSON.stringify(failed, null, 2)}`).toEqual([]);
});
