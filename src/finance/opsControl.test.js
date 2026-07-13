import { describe, expect, it } from 'vitest';
import {
  assetsMissingProjectAssignment,
  isAssignmentActive,
  lacksProject,
  partnerComplianceStatus,
} from './opsControl';

describe('partnerComplianceStatus', () => {
  it('marks client partners as N/A', () => {
    const result = partnerComplianceStatus({ type: 'client', name: 'Insyte' }, '2026-07-13');
    expect(result.status).toBe('ok');
    expect(result.label).toContain('cliente');
  });

  it('flags missing critical docs on vendors', () => {
    const result = partnerComplianceStatus({ type: 'vendor', name: 'MQH' }, '2026-07-13');
    expect(result.status).toBe('missing');
  });

  it('flags expired freistellung', () => {
    const result = partnerComplianceStatus(
      {
        type: 'vendor',
        freistellungExpiresAt: '2026-01-01',
        mindestlohnExpiresAt: '2027-01-01',
      },
      '2026-07-13',
    );
    expect(result.status).toBe('expired');
  });

  it('warns within 30 days', () => {
    const result = partnerComplianceStatus(
      {
        type: 'both',
        freistellungExpiresAt: '2026-07-20',
        mindestlohnExpiresAt: '2027-01-01',
      },
      '2026-07-13',
    );
    expect(result.status).toBe('warn');
  });
});

describe('assignment helpers', () => {
  it('detects active open-ended assignment', () => {
    expect(
      isAssignmentActive({ projectId: 'p1', from: '2026-07-01' }, '2026-07-13'),
    ).toBe(true);
  });

  it('lists rented vehicles without project', () => {
    const missing = assetsMissingProjectAssignment(
      [
        { id: '1', type: 'rented', status: 'active', projectIds: [] },
        { id: '2', type: 'owned', status: 'active', projectIds: [] },
        {
          id: '3',
          type: 'rented',
          status: 'active',
          currentAssignment: { projectId: 'p1', from: '2026-07-01' },
        },
      ],
      { todayIso: '2026-07-13' },
    );
    expect(missing.map((a) => a.id)).toEqual(['1']);
  });
});

describe('lacksProject', () => {
  it('true when no project fields', () => {
    expect(lacksProject({ amount: 10 })).toBe(true);
  });
  it('false when projectId set', () => {
    expect(lacksProject({ projectId: 'abc' })).toBe(false);
  });
});
