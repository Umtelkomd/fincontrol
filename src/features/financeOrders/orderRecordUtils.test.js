import { describe, expect, it } from 'vitest';

import { buildFinanceOrderRecord } from './orderRecordUtils.js';

describe('buildFinanceOrderRecord', () => {
  it('wraps a CXC order as an editable auditable record', () => {
    const order = {
      id: 'cxc-1',
      source: 'receivable',
      status: 'issued',
      grossAmount: 1500,
      paidAmount: 250,
      issueDate: '2026-05-01',
      dueDate: '2026-05-30',
      projectId: 'p-1',
      projectName: 'NE4',
      costCenterId: 'OPE',
      documentNumber: 'RE-1',
      counterpartyName: 'Cliente GmbH',
      updatedBy: 'bsandoval',
      updatedAt: '2026-05-20T10:00:00.000Z',
      auditTrail: [{ action: 'create', user: 'jromero' }],
    };

    expect(buildFinanceOrderRecord(order, 'receivable')).toMatchObject({
      id: 'receivable:cxc-1',
      entityId: 'cxc-1',
      rawRecord: order,
      recordFamily: 'receivable',
      recordFamilyLabel: 'CXC',
      type: 'income',
      status: 'pending',
      statusLabel: 'Emitida',
      amount: 1500,
      paidAmount: 250,
      project: 'NE4',
      projectId: 'p-1',
      costCenter: 'OPE',
      documentNumber: 'RE-1',
      counterpartyName: 'Cliente GmbH',
      canEdit: true,
      lastEditor: 'bsandoval',
      lastEditedAt: '2026-05-20T10:00:00.000Z',
    });
  });

  it('keeps cancelled CXP orders visible but not editable', () => {
    const order = {
      id: 'cxp-1',
      source: 'payable',
      status: 'cancelled',
      amount: 420,
      vendor: 'Proveedor GmbH',
      createdBy: 'jromero',
    };

    expect(buildFinanceOrderRecord(order, 'payable')).toMatchObject({
      id: 'payable:cxp-1',
      recordFamily: 'payable',
      recordFamilyLabel: 'CXP',
      type: 'expense',
      status: 'cancelled',
      statusLabel: 'Cancelada',
      amount: 420,
      counterpartyName: 'Proveedor GmbH',
      canEdit: false,
      lastEditor: 'jromero',
    });
  });
});
