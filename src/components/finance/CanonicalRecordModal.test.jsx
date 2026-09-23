import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import CanonicalRecordModal from './CanonicalRecordModal';

const payableRecord = {
  recordFamily: 'payable',
  amount: 4000,
  paidAmount: 0,
  rawRecord: { status: 'settled', direction: 'out', issueDate: '2026-06-05' },
};

const renderModal = (props = {}) =>
  render(
    <CanonicalRecordModal
      isOpen
      onClose={() => {}}
      onSubmit={vi.fn()}
      record={payableRecord}
      userRole="admin"
      {...props}
    />,
  );

describe('CanonicalRecordModal — status correction', () => {
  it('offers only cancel and reopen, never settling by hand', () => {
    renderModal();

    const options = screen
      .getAllByRole('option')
      .map((option) => option.getAttribute('value'))
      .filter((value) => ['', 'cancelled', 'reopened', 'settled', 'issued', 'partial'].includes(value));

    expect(options).toEqual(expect.arrayContaining(['', 'cancelled', 'reopened']));
    expect(options).not.toContain('settled');
    expect(options).not.toContain('issued');
    expect(options).not.toContain('partial');
  });

  it('keeps submit disabled until the reason is long enough', () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    const select = screen.getByDisplayValue('Sin corrección (calculado por importe y pagos)');
    fireEvent.change(select, { target: { value: 'cancelled' } });

    const reason = screen.getByPlaceholderText(/por qué se corrige el estado/);
    fireEvent.change(reason, { target: { value: 'dup' } });
    fireEvent.submit(reason.closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: 'Factura duplicada' } });
    fireEvent.submit(reason.closest('form'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ correctionTarget: 'cancelled', correctionReason: 'Factura duplicada' }),
    );
  });

  it('hides the correction block from non-admins', () => {
    renderModal({ userRole: 'manager' });

    expect(screen.queryByText(/Corrección de estado/)).toBeNull();
  });
});
