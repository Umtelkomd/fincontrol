/**
 * ReportesUnified — the reports shell owns the page header now.
 *
 * The global banner used to supply the <h1> for every route; with it gone,
 * this screen renders "§ Reportes / Informes" above the tab strip and the
 * lazily loaded report below must not add a second h1.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { ledgerFixtures } from '@/test/fixtures';

installFirebaseMocks(ledgerFixtures());

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: ReportesUnified } = await import('./ReportesUnified.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

describe('ReportesUnified — header', () => {
  it('renders exactly one h1 once the executive tab has loaded', async () => {
    renderScreen(<ReportesUnified user={USER} />);

    expect(screen.getByText('§ Reportes')).toBeInTheDocument();
    // The lazy chunk resolves asynchronously; wait for its content.
    await screen.findByText('Posición neta');

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Informes');
    expect(screen.getByRole('tab', { name: /Resumen Ejecutivo/ })).toHaveAttribute('aria-selected', 'true');
  });
});
