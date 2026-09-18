/**
 * CategorizeModal — T6 cost-center catalogue integration.
 *
 * Covers: the destination (Obra/Estructura) filters the cost-center options
 * to direct/indirect only, a legacy stored cost-center value displays its
 * resolved v2 code, choosing a project or category defaults an empty cost
 * center the same way T5's intake wizard does, and validateCostCenterAssignment
 * blocks submit on top of the existing validateClassification.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { bankMovementFixture, projectFixture } from '@/test/fixtures';
import CategorizeModal from './CategorizeModal';

const CATEGORIES = [
  { name: 'Materiales', tipo: 'expense' },
  { name: 'Combustible', tipo: 'expense' },
  { name: 'Salarios', tipo: 'expense' },
];

const PROJECTS = [projectFixture({ id: 'proj-1', name: 'NE4 Rossdorf', code: 'INS-RSD-N41' })];

const setup = (overrides = {}) => {
  const onSubmit = vi.fn().mockResolvedValue({ success: true });
  const onClose = vi.fn();
  const movement = bankMovementFixture({ direction: 'out', ...overrides });
  render(
    <CategorizeModal
      isOpen
      onClose={onClose}
      onSubmit={onSubmit}
      movement={movement}
      categories={CATEGORIES}
      projects={PROJECTS}
    />,
  );
  return { onSubmit, onClose, movement };
};

describe('CategorizeModal — cost center destination filtering', () => {
  it('offers only direct (obra) centers once Obra is chosen', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Obra' }));

    const select = screen.getByLabelText('Centro de costo');
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('CC-120');
    expect(values).not.toContain('CC-300');
  });

  it('offers only indirect/clearing centers once Estructura is chosen', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Estructura' }));

    const select = screen.getByLabelText('Centro de costo');
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('CC-300');
    expect(values).toContain('CC-NOM');
    expect(values).not.toContain('CC-120');
  });

  it('disables the cost-center select until a destination is chosen', () => {
    setup();
    expect(screen.getByLabelText('Centro de costo')).toBeDisabled();
  });
});

describe('CategorizeModal — legacy cost-center resolution', () => {
  it('displays the resolved v2 code for a movement with a legacy costCenterId, without rewriting it', () => {
    setup({ costScope: 'project', costCenterId: 'CC-002', projectId: 'proj-1', projectName: 'NE4 Rossdorf' });

    // CC-002 resolves to CC-120 (NE4 instalación en vivienda) per costCenterCatalog.js.
    expect(screen.getByLabelText('Centro de costo')).toHaveValue('CC-120');
  });
});

describe('CategorizeModal — shared cost-center defaults (T5 parity)', () => {
  it('defaults the cost center from the project line when a project is picked and the center is empty', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Obra' }));
    fireEvent.change(screen.getByLabelText('Proyecto *'), { target: { value: 'proj-1' } });

    // INS-RSD-N41 is line N4 ⇒ CC-120.
    expect(screen.getByLabelText('Centro de costo')).toHaveValue('CC-120');
  });

  it('defaults the cost center from the category when Estructura is chosen and the center is empty', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Estructura' }));
    fireEvent.change(screen.getByLabelText('Categoría *'), { target: { value: 'Combustible' } });

    expect(screen.getByLabelText('Centro de costo')).toHaveValue('CC-200');
  });

  it('never overwrites a cost center the human already chose', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Obra' }));
    fireEvent.change(screen.getByLabelText('Proyecto *'), { target: { value: 'proj-1' } });
    expect(screen.getByLabelText('Centro de costo')).toHaveValue('CC-120');

    fireEvent.change(screen.getByLabelText('Centro de costo'), { target: { value: 'CC-190' } });
    fireEvent.change(screen.getByLabelText('Categoría *'), { target: { value: 'Materiales' } });

    expect(screen.getByLabelText('Centro de costo')).toHaveValue('CC-190');
  });
});

describe('CategorizeModal — statement-only hint', () => {
  it('shows the statement-only hint for a category that never carries an invoice', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Categoría *'), { target: { value: 'Salarios' } });

    expect(screen.getByText('Este tipo de gasto no lleva factura: basta con clasificarlo aquí.')).toBeInTheDocument();
  });

  it('shows no hint for an invoice-expected category', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Categoría *'), { target: { value: 'Materiales' } });

    expect(screen.queryByText(/no lleva factura/)).not.toBeInTheDocument();
  });
});

describe('CategorizeModal — validateCostCenterAssignment gate', () => {
  it('blocks submit when the resolved cost center is inconsistent with the stored destination', async () => {
    // CC-002 resolves to CC-120 (a DIRECT/obra center) but the movement is
    // stored as an Estructura expense with no project — an inconsistency
    // validateCostCenterAssignment must catch even though validateClassification
    // itself has nothing to say about it (Estructura needs no project).
    const { onSubmit } = setup({ costScope: 'overhead', costCenterId: 'CC-002', categoryName: 'Materiales' });

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Un centro de costo de obra requiere un proyecto')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the code-based costCenterId on a valid obra classification', async () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText('Categoría *'), { target: { value: 'Materiales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Obra' }));
    fireEvent.change(screen.getByLabelText('Proyecto *'), { target: { value: 'proj-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ costCenterId: 'CC-120', projectId: 'proj-1' });
  });
});
