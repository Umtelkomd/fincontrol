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

  /**
   * Once the migration renames a project to its v2 code, the legacy code every
   * Lumen payload still sends is nowhere on the doc — an exact-code lookup
   * returns nothing and the document lands with no projectId at all. The obra
   * key links the two, and the `legacyCode` the rename stamps is the second
   * route in (a project whose obra the dictionary does not map).
   */
  it('finds a project renamed to its structured code when asked with the legacy code', () => {
    const projects = [{ id: 'p-rsd', code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' }];

    expect(resolveProjectIdByCode(projects, 'QFF')).toMatchObject({
      projectId: 'p-rsd',
      projectCode: 'INS-RSD-BL1',
    });
    expect(resolveProjectIdByCode(projects, 'QFF-002').projectId).toBe('p-rsd');
    expect(resolveProjectIdByCode(projects, 'PROY-001').projectId).toBe('p-rsd');
  });

  it('finds it through the stamped legacyCode for an obra the dictionary does not map', () => {
    const projects = [{ id: 'p-qdu', code: 'INS-QDU-TB1', name: 'Otra obra', legacyCode: 'QDU' }];

    expect(resolveProjectIdByCode(projects, 'QDU').projectId).toBe('p-qdu');
  });

  it('prefers an exact code/name match over an obra-key one, whatever the list order', () => {
    const projects = [
      { id: 'p-rsd-legacy', code: 'RSD', name: 'RSD' },
      { id: 'p-qff', code: 'QFF', name: 'QFF' },
    ];

    // Both are the Roßdorf obra, so the obra key alone would answer with the
    // first one; the exact code must still win.
    expect(resolveProjectIdByCode(projects, 'QFF').projectId).toBe('p-qff');
    expect(resolveProjectIdByCode(projects, 'RSD').projectId).toBe('p-rsd-legacy');
  });

  it('still answers with no project for an unknown code', () => {
    const projects = [{ id: 'p-rsd', code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' }];

    expect(resolveProjectIdByCode(projects, 'NE4')).toEqual({
      projectId: '',
      projectName: 'NE4',
      projectCode: 'NE4',
    });
    expect(resolveProjectIdByCode(projects, '')).toEqual({ projectId: '', projectName: '', projectCode: '' });
    expect(resolveProjectIdByCode(null, 'QFF')).toEqual({ projectId: '', projectName: '', projectCode: 'QFF' });
  });
});
