/**
 * Reports — "Margen realizado por proyecto".
 *
 * This panel used to build its own ranking inline with
 * `entry.projectName || 'Sin proyecto'`, so the unassigned bucket became a row
 * — and since unclassified cash is normally the largest single pile, it TOPPED
 * the table. "Top proyectos" then reported, as the company's best obra,
 * everything nobody had classified yet.
 *
 * The same mistake had already been found and fixed twice elsewhere
 * (`buildProjectMargins` in useTreasuryMetrics, `computeProjectMargins` in
 * managementReport). These tests pin the third view onto the same helper: real
 * obras rank, the unassigned money is shown as its own row so it is never
 * silently dropped, and it is never presented as a project.
 */
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { installFirebaseMocks } from '@/test/firebaseMock';
import { bankMovementFixture, isoThisMonth, ledgerFixtures } from '@/test/fixtures';
import { formatCurrency } from '@/utils/formatters';

/**
 * The unassigned bucket outweighs the only real project on purpose: +85.000 €
 * unclassified against +7.000 € on NE4 Rossdorf. Ranked as a project it wins
 * the table outright, which is exactly the regression under test.
 */
const MOVEMENTS = [
  bankMovementFixture({
    direction: 'in',
    amount: 10000,
    description: 'Cobro Insyte',
    counterpartyName: 'Insyte Deutschland',
    projectId: 'proj-1',
    projectName: 'NE4 Rossdorf',
    postedDate: isoThisMonth(5),
  }),
  bankMovementFixture({
    direction: 'out',
    amount: 3000,
    description: 'Material fibra',
    projectId: 'proj-1',
    projectName: 'NE4 Rossdorf',
    postedDate: isoThisMonth(6),
  }),
  bankMovementFixture({
    direction: 'in',
    amount: 90000,
    description: 'Transferencia sin clasificar',
    counterpartyName: 'Cliente desconocido',
    projectName: 'Sin proyecto',
    postedDate: isoThisMonth(7),
  }),
  bankMovementFixture({
    direction: 'out',
    amount: 5000,
    description: 'Alquiler oficina',
    projectName: 'Sin proyecto',
    postedDate: isoThisMonth(8),
  }),
];

installFirebaseMocks(ledgerFixtures({ collections: { bankMovements: MOVEMENTS } }));

const { renderScreen } = await import('@/test/renderScreen.jsx');
const { default: Reports } = await import('./Reports.jsx');

const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com' };

const marginPanel = () => screen.getByText('Margen realizado por proyecto').closest('section');
const rankedProjects = () => within(marginPanel()).queryAllByTestId('report-project-margin');

describe('Reports — project margin ranking', () => {
  it('ranks only real projects', () => {
    renderScreen(<Reports user={USER} />);

    expect(rankedProjects().map((row) => within(row).getByTestId('report-project-name').textContent))
      .toEqual(['NE4 Rossdorf']);
  });

  it('never lets the unassigned bucket take the top slot', () => {
    renderScreen(<Reports user={USER} />);

    const panel = marginPanel();
    expect(within(panel).queryByText('Sin proyecto')).not.toBeInTheDocument();
    expect(within(panel).queryByText(formatCurrency(85000))).not.toBeInTheDocument();
  });

  it('still shows the unassigned money, as its own row and not as a project', () => {
    renderScreen(<Reports user={USER} />);

    const unassigned = within(marginPanel()).getByTestId('report-unassigned-margin');
    expect(unassigned).toHaveTextContent('Sin asignar');
    expect(unassigned).toHaveTextContent(formatCurrency(85000));
    expect(rankedProjects()).not.toContain(unassigned);
  });

  it('keeps the real project figures intact', () => {
    renderScreen(<Reports user={USER} />);

    const [rossdorf] = rankedProjects();
    expect(rossdorf).toHaveTextContent(formatCurrency(10000));
    expect(rossdorf).toHaveTextContent(formatCurrency(3000));
    expect(rossdorf).toHaveTextContent(formatCurrency(7000));
  });
});
