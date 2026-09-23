import { describe, expect, it } from 'vitest';

import { wipControlRows } from './wipControl.js';

const TODAY = '2026-09-23';
const projects = [
  { id: 'p-qff', code: 'QFF', name: 'Roßdorf', status: 'active' },
  { id: 'p-wsc', code: 'WSC', name: 'Wesconnect', status: 'active' },
  { id: 'p-hox', code: 'FBX', name: 'Höxter Nord', status: 'active' },
  { id: 'p-old', code: 'LANG', name: 'Langenau', status: 'inactive' },
];
const entry = (over) => ({ stage: 'executed', status: 'open', ...over });

describe('wipControlRows', () => {
  it('lists every active obra, including never-measured ones, and skips inactive ones', () => {
    const { rows, neverMeasured } = wipControlRows({ entries: [], projects, today: TODAY });
    expect(rows.map((row) => row.projectId)).toEqual(['p-hox', 'p-qff', 'p-wsc']);
    expect(neverMeasured).toBe(3);
  });

  it('uses the newest figure per stage and reports the change against the previous one', () => {
    const { rows } = wipControlRows({
      projects,
      today: TODAY,
      entries: [
        entry({ id: 'a', projectId: 'p-qff', amount: 18000, asOf: '2026-08-01' }),
        entry({ id: 'b', projectId: 'p-qff', amount: 22000, asOf: '2026-08-13' }),
        entry({ id: 'c', projectId: 'p-qff', amount: 8500, asOf: '2026-09-01', stage: 'certified' }),
      ],
    });
    const qff = rows[0];
    expect(qff.projectId).toBe('p-qff');
    expect(qff.executed).toMatchObject({ amount: 22000, previous: 18000, delta: 4000, asOf: '2026-08-13', ageDays: 41, tone: 'warn', entryId: 'b' });
    expect(qff.certified).toMatchObject({ amount: 8500, previous: null, delta: null, tone: 'ok' });
    expect(qff.total).toBe(30500);
    expect(qff.tone).toBe('warn');
    expect(qff.ageDays).toBe(41);
  });

  it('treats an invoiced newest entry as a zero backlog without an age warning', () => {
    const { rows, total } = wipControlRows({
      projects,
      today: TODAY,
      entries: [
        entry({ id: 'a', projectId: 'p-wsc', amount: 12300, asOf: '2026-06-01' }),
        entry({ id: 'b', projectId: 'p-wsc', amount: 12300, asOf: '2026-06-10', status: 'invoiced' }),
      ],
    });
    const wsc = rows.find((row) => row.projectId === 'p-wsc');
    expect(wsc.executed).toMatchObject({ amount: 0, delta: -12300, tone: 'ok', entryId: null });
    expect(wsc.ageDays).toBe(105);
    expect(total).toBe(0);
  });

  it('matches entries typed against the obra name instead of its id', () => {
    const { rows } = wipControlRows({
      projects,
      today: TODAY,
      entries: [entry({ id: 'a', projectName: 'Wesconnect', amount: 5000, asOf: '2026-09-20' })],
    });
    expect(rows[0]).toMatchObject({ projectId: 'p-wsc', total: 5000 });
  });

  it('sums totals and reports the oldest open figure', () => {
    const result = wipControlRows({
      projects,
      today: TODAY,
      entries: [
        entry({ id: 'a', projectId: 'p-qff', amount: 20000, asOf: '2026-07-15' }),
        entry({ id: 'b', projectId: 'p-wsc', amount: 3000, asOf: '2026-09-15', stage: 'certified' }),
      ],
    });
    expect(result).toMatchObject({ total: 23000, executed: 20000, certified: 3000, oldestDays: 70, neverMeasured: 1 });
    expect(result.rows[0].tone).toBe('critical');
  });

  it('ignores entries that cannot carry money', () => {
    const { total } = wipControlRows({
      projects,
      today: TODAY,
      entries: [entry({ id: 'x', projectId: 'p-qff', amount: 0, asOf: '2026-09-01' }), entry({ id: 'y', projectId: 'p-qff', amount: 10, asOf: 'nope' })],
    });
    expect(total).toBe(0);
  });
});
