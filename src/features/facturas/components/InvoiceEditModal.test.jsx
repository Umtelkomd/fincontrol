import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import InvoiceEditModal from './InvoiceEditModal';

const document = (overrides = {}) => ({
  id: 'a'.repeat(64),
  direction: 'incoming',
  family: 'payable',
  sourceSystem: 'ordinary',
  counterpartyName: 'Kabel Service GmbH',
  counterpartyId: 'Kabel Service GmbH',
  invoiceNumber: 'RE-2026-050',
  issueDate: '2026-06-01',
  currency: 'EUR',
  netAmount: 1000,
  taxAmount: 190,
  grossAmount: 1190,
  identity: JSON.stringify(['invoice-v2', 'incoming', 'Kabel Service GmbH', 'RE-2026-050']),
  linkMode: 'create-ordinary',
  links: [{ family: 'payable', recordId: 'cxp-1' }],
  ...overrides,
});

const payable = (overrides = {}) => ({
  id: 'cxp-1',
  kind: 'payable',
  paidAmount: 0,
  payments: [],
  status: 'issued',
  counterpartyName: 'Kabel Service GmbH',
  documentNumber: 'RE-2026-050',
  issueDate: '2026-06-01',
  dueDate: '2026-07-01',
  projectId: 'proj-1',
  projectName: 'NE4 Rossdorf',
  costCenterId: 'CC-120',
  categoryName: 'Materiales',
  grossAmount: 1190,
  ...overrides,
});

const PROJECTS = [{ id: 'proj-1', name: 'NE4 Rossdorf', displayName: 'NE4 Rossdorf', status: 'active' }];

describe('InvoiceEditModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <InvoiceEditModal isOpen={false} onClose={vi.fn()} document={document()} obligations={[payable()]} projects={PROJECTS} onSubmit={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('prefills the header and classification from the archive doc and its owned obligation', () => {
    render(
      <InvoiceEditModal isOpen onClose={vi.fn()} document={document()} obligations={[payable()]} projects={PROJECTS} onSubmit={vi.fn()} />,
    );

    expect(screen.getByLabelText('Contraparte')).toHaveValue('Kabel Service GmbH');
    expect(screen.getByLabelText('Nº de factura')).toHaveValue('RE-2026-050');
    expect(screen.getByLabelText('Categoría')).toHaveValue('Materiales');
    expect(screen.getByLabelText('Proyecto')).toHaveValue('proj-1');
    expect(screen.getByLabelText('Centro de costo')).toHaveValue('CC-120');
  });

  it('requires a reason and blocks submit until one is provided', async () => {
    const onSubmit = vi.fn();
    render(
      <InvoiceEditModal isOpen onClose={vi.fn()} document={document()} obligations={[payable()]} projects={PROJECTS} onSubmit={onSubmit} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Motivo de la corrección'), { target: { value: 'Proyecto incorrecto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Proyecto incorrecto' }));
  });

  it('disables the amount fields and shows the lock hint when the owned obligation is LOCKED', () => {
    render(
      <InvoiceEditModal
        isOpen
        onClose={vi.fn()}
        document={document()}
        obligations={[payable({ paidAmount: 500, status: 'partial' })]}
        projects={PROJECTS}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Neto')).toBeDisabled();
    expect(screen.getByLabelText('IVA')).toBeDisabled();
    expect(screen.getByLabelText('Bruto')).toBeDisabled();
    expect(screen.getByText(/importe bloqueado/i)).toBeInTheDocument();
  });

  it('shows a note instead of the classification block when there is no owned obligation (foreign link)', () => {
    render(
      <InvoiceEditModal
        isOpen
        onClose={vi.fn()}
        document={document({ linkMode: 'attach-existing' })}
        obligations={[payable()]}
        projects={PROJECTS}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Categoría')).not.toBeInTheDocument();
    expect(screen.getByText(/no creó ninguna obligación propia/i)).toBeInTheDocument();
  });

  it('lists a movement that would be skipped because it is linked to several obligations', () => {
    render(
      <InvoiceEditModal
        isOpen
        onClose={vi.fn()}
        document={document()}
        obligations={[payable()]}
        bankMovements={[{ id: 'mov-1', status: 'posted', payableIds: ['cxp-1', 'cxp-2'] }]}
        projects={PROJECTS}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Motivo de la corrección'), { target: { value: 'Reclasificación' } });
    fireEvent.change(screen.getByLabelText('Centro de costo'), { target: { value: 'CC-210' } });
    fireEvent.change(screen.getByLabelText('Proyecto'), { target: { value: '' } });

    expect(screen.getByText(/no se tocan: 1 movimiento bancario ligado a varias facturas/i)).toBeInTheDocument();
  });

  it('calls onClose when Cerrar is clicked', () => {
    const onClose = vi.fn();
    render(<InvoiceEditModal isOpen onClose={onClose} document={document()} obligations={[payable()]} projects={PROJECTS} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
