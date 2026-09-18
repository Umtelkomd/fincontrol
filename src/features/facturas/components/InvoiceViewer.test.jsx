import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '../../../contexts/ToastContext';
import InvoiceViewer from './InvoiceViewer';

vi.mock('../hooks/useInvoicePdfBlob', () => ({
  useInvoicePdfBlob: () => ({ url: null, loading: false, error: null, retry: vi.fn() }),
}));

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

const renderViewer = (props = {}) =>
  render(
    <ToastProvider>
      <InvoiceViewer document={document()} user={{ email: 'jromero@umtelkomd.com' }} payables={[payable()]} receivables={[]} {...props} />
    </ToastProvider>,
  );

describe('InvoiceViewer — role gating', () => {
  it('hides Editar/Reemplazar/Eliminar for an editor', () => {
    renderViewer({ userRole: 'editor' });
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reemplazar PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
  });

  it.each(['admin', 'manager'])('shows the three actions for %s', (userRole) => {
    renderViewer({ userRole });
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reemplazar PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
  });
});

describe('InvoiceViewer — edit', () => {
  it('opens InvoiceEditModal and calls onEditInvoice with the document and form on submit', async () => {
    const onEditInvoice = vi.fn().mockResolvedValue({ success: true });
    renderViewer({ userRole: 'admin', onEditInvoice });

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Motivo de la corrección'), { target: { value: 'Corrección de prueba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onEditInvoice).toHaveBeenCalledWith(document(), expect.objectContaining({ reason: 'Corrección de prueba' })));
  });
});

describe('InvoiceViewer — delete', () => {
  it('offers the cancellation checkbox for an owned, unlocked obligation and calls onDeleteInvoice on confirm', async () => {
    const onDeleteInvoice = vi.fn().mockResolvedValue({ success: true });
    renderViewer({ userRole: 'admin', onDeleteInvoice });

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    const checkbox = screen.getByRole('checkbox', { name: /anular también la cxp\/cxc/i });
    expect(checkbox).not.toBeDisabled();
    fireEvent.click(checkbox);

    fireEvent.change(screen.getByPlaceholderText('Ej. factura duplicada, PDF equivocado…'), { target: { value: 'Duplicada' } });
    fireEvent.change(screen.getByPlaceholderText('RE-2026-050'), { target: { value: 'RE-2026-050' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));

    await waitFor(() =>
      expect(onDeleteInvoice).toHaveBeenCalledWith(
        document(),
        expect.objectContaining({ reason: 'Duplicada', cancelObligations: [{ family: 'payable', recordId: 'cxp-1' }] }),
      ),
    );
  });

  it('disables the cancellation checkbox with a reason when the owned obligation is LOCKED', () => {
    renderViewer({ userRole: 'admin', payables: [payable({ paidAmount: 500, status: 'partial' })] });

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    const checkbox = screen.getByRole('checkbox', { name: /anular también la cxp\/cxc/i });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/pagos registrados/i)).toBeInTheDocument();
  });

  it('disables the cancellation checkbox for a foreign (attach-existing) link', () => {
    renderViewer({ userRole: 'admin', document: document({ linkMode: 'attach-existing' }) });

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    const checkbox = screen.getByRole('checkbox', { name: /anular también la cxp\/cxc/i });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/no creó ninguna obligación propia/i)).toBeInTheDocument();
  });
});
