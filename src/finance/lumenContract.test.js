import { describe, expect, it } from 'vitest';
import {
  cxcSourceKey,
  cxpSourceKey,
  normalizeProjectCode,
  resolveProjectIdByCode,
  sourceKeyFromOpsRow,
} from './lumenContract.js';

describe('source keys', () => {
  it('builds stable keys', () => {
    expect(cxcSourceKey('abc-123')).toBe('lumen:cxc:wo-abc-123');
    expect(cxpSourceKey('cycle-9')).toBe('lumen:cxp:cycle-9');
    expect(cxpSourceKey('9')).toBe('lumen:cxp:cycle-9');
  });

  it('derives from ops row', () => {
    expect(
      sourceKeyFromOpsRow({ kind: 'cxc', lumen_work_order_id: 'wo1' }),
    ).toBe('lumen:cxc:wo-wo1');
    expect(
      sourceKeyFromOpsRow({ kind: 'clear', lumen_cycle_id: 'cy1' }),
    ).toBe('lumen:cxp:cycle-cy1');
    expect(sourceKeyFromOpsRow({ kind: 'cxc', source_key: 'custom' })).toBe('custom');
  });
});

describe('project resolve', () => {
  it('matches by canonical code', () => {
    const projects = [
      { id: 'p1', code: 'PROY-004', name: 'NE4 work' },
      { id: 'p2', code: 'QFF', name: 'QFF' },
    ];
    expect(resolveProjectIdByCode(projects, 'NE4').projectId).toBe('p1');
    expect(resolveProjectIdByCode(projects, 'qff').projectId).toBe('p2');
    expect(normalizeProjectCode('PROY-001')).toBe('QFF');
  });
});
