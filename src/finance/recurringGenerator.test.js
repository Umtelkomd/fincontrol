import { describe, expect, it } from 'vitest';

import {
  amountForPeriod,
  computeInstancesForPeriod,
  dueDateForPeriod,
  instanceToPayablePayload,
  periodKey,
  periodLabel,
  ruleAppliesToPeriod,
  summarizeInstances,
} from './recurringGenerator.js';

const recurringRule = (overrides = {}) => ({
  id: 'recurring-rent',
  active: true,
  frequency: 'monthly',
  amount: 1200,
  dayOfMonth: 15,
  startDate: '2026-01-01',
  endDate: '',
  ownerType: 'costCenter',
  ownerId: 'cc-ops',
  ownerName: 'Operations',
  concept: 'Office rent',
  counterpartyName: 'Landlord GmbH',
  costCenterId: 'cc-ops',
  projectId: 'project-north',
  notes: 'Paid from recurring generator',
  ...overrides,
});

describe('recurring generator period labels and due dates', () => {
  it('formats recurring period keys and Spanish month labels', () => {
    expect(periodKey(2026, 5)).toBe('2026-05');
    expect(periodKey(2026, 12)).toBe('2026-12');
    expect(periodLabel(2026, 5)).toBe('Mayo 2026');
    expect(periodLabel(2026, 12)).toBe('Diciembre 2026');
  });

  it('clamps due days to valid month boundaries', () => {
    expect(dueDateForPeriod(recurringRule({ dayOfMonth: 31 }), 2026, 4)).toBe('2026-04-30');
    expect(dueDateForPeriod(recurringRule({ dayOfMonth: 31 }), 2028, 2)).toBe('2028-02-29');
    expect(dueDateForPeriod(recurringRule({ dayOfMonth: 0 }), 2026, 5)).toBe('2026-05-01');
  });
});

describe('recurring generator frequency gates', () => {
  it('requires active rules within configured start and end periods', () => {
    expect(ruleAppliesToPeriod(recurringRule({ active: false }), 2026, 5)).toBe(false);
    expect(ruleAppliesToPeriod(recurringRule({ startDate: '2026-06-01' }), 2026, 5)).toBe(false);
    expect(ruleAppliesToPeriod(recurringRule({ endDate: '2026-04-30' }), 2026, 5)).toBe(false);
    expect(ruleAppliesToPeriod(recurringRule({ startDate: '2026-05-31', endDate: '2026-05-31' }), 2026, 5)).toBe(true);
  });

  it('applies monthly, weekly, and biweekly rules as one generated monthly instance', () => {
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'monthly' }), 2026, 5)).toBe(true);
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'weekly' }), 2026, 5)).toBe(true);
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'biweekly' }), 2026, 5)).toBe(true);
    expect(amountForPeriod(recurringRule({ frequency: 'weekly', amount: 100 }))).toBe(433.33);
    expect(amountForPeriod(recurringRule({ frequency: 'biweekly', amount: 100 }))).toBe(216.66);
  });

  it('applies quarterly and yearly rules on their configured cadence', () => {
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'quarterly', startDate: '2026-02-01' }), 2026, 2)).toBe(true);
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'quarterly', startDate: '2026-02-01' }), 2026, 3)).toBe(false);
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'quarterly', startDate: '2026-02-01' }), 2026, 5)).toBe(true);
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'quarterly', startDate: '2025-11-01' }), 2026, 2)).toBe(true);
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'quarterly', startDate: '' }), 2026, 4)).toBe(true);
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'yearly', startDate: '2026-05-01' }), 2027, 5)).toBe(true);
    expect(ruleAppliesToPeriod(recurringRule({ frequency: 'unknown' }), 2026, 5)).toBe(false);
  });
});

describe('recurring generator instance preview', () => {
  it('builds payable previews and marks existing non-void instances as already created', () => {
    const instances = computeInstancesForPeriod({
      year: 2026,
      month: 5,
      rules: [
        recurringRule(),
        recurringRule({ id: 'recurring-cleaning', concept: 'Cleaning', amount: 300, ownerName: 'Facility' }),
        recurringRule({ id: 'future', startDate: '2026-06-01' }),
      ],
      existingPayables: [
        { recurringCostId: 'recurring-rent', recurringPeriod: '2026-05', status: 'issued' },
        { recurringCostId: 'recurring-cleaning', recurringPeriod: '2026-05', status: 'void' },
      ],
    });

    expect(instances).toEqual([
      expect.objectContaining({
        recurringCostId: 'recurring-rent',
        recurringPeriod: '2026-05',
        concept: 'Office rent',
        counterpartyName: 'Landlord GmbH',
        amount: 1200,
        dueDate: '2026-05-15',
        issueDate: '2026-05-15',
        costCenterId: 'cc-ops',
        projectId: 'project-north',
        description: 'Office rent — Operations — Mayo 2026',
        notes: 'Paid from recurring generator',
        existing: true,
      }),
      expect.objectContaining({
        recurringCostId: 'recurring-cleaning',
        recurringPeriod: '2026-05',
        amount: 300,
        description: 'Cleaning — Facility — Mayo 2026',
        existing: false,
      }),
    ]);
  });

  it('defaults optional cost/project/notes fields and falls back vendor names for payloads', () => {
    const [instance] = computeInstancesForPeriod({
      year: 2026,
      month: 4,
      rules: [recurringRule({
        counterpartyName: '',
        ownerName: 'Backup Owner',
        costCenterId: '',
        projectId: undefined,
        notes: undefined,
      })],
      existingPayables: [],
    });

    expect(instance).toMatchObject({
      costCenterId: '',
      projectId: '',
      notes: '',
      existing: false,
    });
    expect(instanceToPayablePayload(instance)).toEqual({
      vendor: 'Backup Owner',
      description: 'Office rent — Backup Owner — Abril 2026',
      amount: 1200,
      issueDate: '2026-04-15',
      dueDate: '2026-04-15',
      costCenterId: '',
      projectId: '',
      notes: '',
      recurringCostId: 'recurring-rent',
      recurringPeriod: '2026-04',
      source: 'recurring',
    });
    expect(instanceToPayablePayload({ ...instance, counterpartyName: '', ownerName: '', concept: 'Fallback Concept' }).vendor)
      .toBe('Fallback Concept');
  });

  it('summarizes new and existing generated amounts separately', () => {
    expect(summarizeInstances([
      { amount: 1200.1, existing: false },
      { amount: '300.20', existing: false },
      { amount: 450, existing: true },
      { amount: 'invalid', existing: true },
    ])).toEqual({
      newCount: 2,
      existingCount: 2,
      totalNew: 1500.3,
      totalExisting: 450,
      grandTotal: 1950.3,
    });
  });
});
