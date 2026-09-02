/**
 * Sidebar — the desktop top bar, grouped by routine.
 *
 * Row 1 is the four group tabs (Operar / Ver / Maestros / Configuración),
 * row 2 the items of the group the current route belongs to. Clicking a group
 * tab navigates to that group's first permitted item, so the active group is
 * always derived from the route and never drifts from it.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installFirebaseMocks } from '@/test/firebaseMock';

installFirebaseMocks();

const { default: Sidebar } = await import('./Sidebar.jsx');

const ADMIN = () => true;
const USER = { uid: 'test-uid', email: 'jromero@umtelkomd.com', displayName: 'Jarl' };

const LocationProbe = () => <p data-testid="location">{useLocation().pathname}</p>;

const renderSidebar = ({ route = '/resumen', hasPermission = ADMIN } = {}) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar
        user={USER}
        userRole="admin"
        hasPermission={hasPermission}
        onNewTransaction={() => {}}
        bankBalanceData={{ currentBalance: 1214.2, creditLimit: 0, creditUsed: 0 }}
        bankAccount={{ name: 'Commerzbank' }}
      />
      <LocationProbe />
    </MemoryRouter>,
  );

const groupTabs = () => screen.getByRole('tablist', { name: 'Secciones' });
const itemRow = () => screen.getByRole('navigation', { name: 'Páginas de la sección' });

describe('Sidebar — group tabs', () => {
  it('renders the four group tabs for an admin', () => {
    renderSidebar();

    const tabs = within(groupTabs()).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Operar', 'Ver', 'Maestros', 'Configuración']);
  });

  it('derives the active group from the route, on path boundaries', () => {
    renderSidebar({ route: '/cxc/remesas' });

    expect(within(groupTabs()).getByRole('tab', { name: 'Operar' })).toHaveAttribute('aria-selected', 'true');
    expect(within(groupTabs()).getByRole('tab', { name: 'Ver' })).toHaveAttribute('aria-selected', 'false');
    // Row 2 shows only the operativo items.
    expect(within(itemRow()).getByRole('button', { name: /Bandeja/ })).toBeInTheDocument();
    expect(within(itemRow()).queryByRole('button', { name: /Presupuesto/ })).not.toBeInTheDocument();
    expect(within(itemRow()).getByRole('button', { name: /CXC/ })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the items of the report group when a report route is open', () => {
    renderSidebar({ route: '/reportes' });

    expect(within(groupTabs()).getByRole('tab', { name: 'Ver' })).toHaveAttribute('aria-selected', 'true');
    expect(within(itemRow()).getByRole('button', { name: /Reportes/ })).toBeInTheDocument();
    expect(within(itemRow()).queryByRole('button', { name: /Bandeja/ })).not.toBeInTheDocument();
  });

  it('navigates to the first permitted item of a group when its tab is clicked', () => {
    renderSidebar({ route: '/resumen' });

    fireEvent.click(within(groupTabs()).getByRole('tab', { name: 'Ver' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/flujo-caja-anual');
    expect(within(groupTabs()).getByRole('tab', { name: 'Ver' })).toHaveAttribute('aria-selected', 'true');
    expect(within(itemRow()).getByRole('button', { name: /Proyectos/ })).toBeInTheDocument();
  });

  it('hides the groups and items the role cannot open', () => {
    renderSidebar({ hasPermission: (section) => section === 'dashboard' });

    const tabs = within(groupTabs()).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Operar']);
    expect(within(itemRow()).getByRole('button', { name: /Resumen/ })).toBeInTheDocument();
    expect(within(itemRow()).queryByRole('button', { name: /Bandeja/ })).not.toBeInTheDocument();
  });

  it('keeps the shell wordmark as its only heading', () => {
    renderSidebar();

    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });
});
