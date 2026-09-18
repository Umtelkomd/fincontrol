/**
 * CostCenters — T7 settings screen additions: "Cargar predefinidos" seeds
 * the cost center catalogue v2 idempotently (via useCostCenters.seedCatalog),
 * the kind (Obra/Estructura/Compensación) shows per row, and a doc whose code
 * is not a v2 catalogue code is flagged "Heredado" with its resolved target
 * — read-only, never rewritten from this screen.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';
import { COST_CENTER_CATALOG } from '@/finance/costCenterCatalog';

const store = installFirebaseMocks({ collections: { costCenters: [] } });

const firestore = await import('firebase/firestore');
const { default: CostCenters } = await import('./CostCenters.jsx');

beforeEach(() => {
  store.collections.costCenters = [];
  firestore.setDoc.mockClear();
});

describe('CostCenters — Cargar predefinidos (T7)', () => {
  it('seeds the full v2 catalogue and reports how many were created', async () => {
    render(<CostCenters user={TEST_USER} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cargar predefinidos' }));

    await screen.findByText(new RegExp(`${COST_CENTER_CATALOG.length} creado\\(s\\)`));
    expect(firestore.setDoc).toHaveBeenCalledTimes(COST_CENTER_CATALOG.length);
  });

  it('is idempotent: re-running reports 0 created once every code already exists', async () => {
    store.collections.costCenters = COST_CENTER_CATALOG.map((entry) => ({
      id: entry.code,
      code: entry.code,
      name: entry.name,
      type: 'Costos',
      kind: entry.kind,
      budget: 1000,
      responsible: 'Jarl',
    }));

    render(<CostCenters user={TEST_USER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cargar predefinidos' }));

    await screen.findByText(new RegExp(`0 creado\\(s\\), ${COST_CENTER_CATALOG.length} actualizado`));
  });
});

describe('CostCenters — kind badge and legacy flag (T7)', () => {
  it('shows the Spanish kind label for a v2 catalogue code', () => {
    store.collections.costCenters = [
      { id: 'CC-110', code: 'CC-110', name: 'Soplado y fusiones', type: 'Costos', budget: 0, responsible: '' },
      { id: 'CC-300', code: 'CC-300', name: 'Administración y finanzas', type: 'Costos', budget: 0, responsible: '' },
    ];

    render(<CostCenters user={TEST_USER} />);

    expect(screen.getByText('Obra')).toBeInTheDocument();
    expect(screen.getByText('Estructura')).toBeInTheDocument();
  });

  it('flags a doc whose code is not in the v2 catalogue as Heredado, with its resolved target', () => {
    store.collections.costCenters = [
      { id: 'legacy-doc-1', code: 'CC-002', name: 'Instalaciones', type: 'Costos', budget: 0, responsible: '' },
    ];

    render(<CostCenters user={TEST_USER} />);

    // CC-002 resolves to CC-120 per costCenterCatalog.js.
    expect(screen.getByText('Heredado → CC-120')).toBeInTheDocument();
  });

  it('never rewrites a legacy doc from this screen — only setDoc(seedCatalog) or explicit edits write', () => {
    store.collections.costCenters = [
      { id: 'legacy-doc-1', code: 'CC-002', name: 'Instalaciones', type: 'Costos', budget: 0, responsible: '' },
    ];

    render(<CostCenters user={TEST_USER} />);

    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.updateDoc).not.toHaveBeenCalled();
  });
});
