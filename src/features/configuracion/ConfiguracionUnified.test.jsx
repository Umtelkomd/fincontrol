/**
 * Configuración — tab wiring.
 *
 * Each tab is a lazy branch of one switch: a panel that is never reached from
 * the tab strip is dead code the user cannot find, and a tab pointing at an
 * unimported component blanks the app. This walks the strip and proves each tab
 * mounts its panel.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { ledgerFixtures } from '@/test/fixtures';

installFirebaseMocks(ledgerFixtures());

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: ConfiguracionUnified } = await import('./ConfiguracionUnified.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

describe('ConfiguracionUnified', () => {
  it('offers an IVA tab alongside the existing settings tabs', () => {
    renderScreen(<ConfiguracionUnified user={USER} />);

    ['Tesorería', 'Proyectos', 'Categorías', 'Centros de Costo', 'Cuenta Bancaria', 'IVA'].forEach(
      (label) => expect(screen.getByRole('button', { name: label })).toBeInTheDocument(),
    );
  });

  it('mounts the VAT rates panel when its tab is selected', async () => {
    renderScreen(<ConfiguracionUnified user={USER} />);

    fireEvent.click(screen.getByRole('button', { name: 'IVA' }));

    expect(await screen.findByRole('heading', { name: 'IVA por categoría' })).toBeInTheDocument();
  });
});
