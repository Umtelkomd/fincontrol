import { describe, expect, it } from 'vitest';
import {
  WIP_AGE_CRITICAL_DAYS,
  WIP_AGE_WARN_DAYS,
  WIP_STAGE,
  WIP_STATUS,
  currentWipByProject,
  netPosition,
  summarizeWip,
  totalWip,
  wipAge,
} from './workInProgress';

// ─── Real production shapes ───────────────────────────────────────────────────
// workInProgress docs mirror the flat collections (receivables/payables): a
// denormalized projectName next to projectId, ISO date strings, plain numbers.
const entry = (overrides = {}) => ({
  id: 'wip-1',
  projectId: 'proj-ne4',
  projectName: 'NE4 Westconnect',
  amount: 40000,
  asOf: '2026-07-01',
  stage: WIP_STAGE.EXECUTED,
  status: WIP_STATUS.OPEN,
  note: '',
  createdBy: 'jromero@umtelkomd.com',
  createdAt: '2026-07-01T08:00:00.000Z',
  ...overrides,
});

const TODAY = '2026-07-28';

const amounts = (rows) => rows.map((row) => `${row.projectId}:${row.stage}:${row.amount}`);

describe('currentWipByProject — supersession', () => {
  it('returns the single open entry when a project has only one', () => {
    const current = currentWipByProject([entry()]);
    expect(amounts(current)).toEqual(['proj-ne4:executed:40000']);
  });

  it('keeps only the newest entry per project and stage, older ones are history', () => {
    const current = currentWipByProject([
      entry({ id: 'wip-old', amount: 40000, asOf: '2026-06-01' }),
      entry({ id: 'wip-new', amount: 55000, asOf: '2026-07-01' }),
    ]);
    expect(amounts(current)).toEqual(['proj-ne4:executed:55000']);
    expect(current[0].id).toBe('wip-new');
  });

  it('does NOT resurrect a superseded entry once the newest one is invoiced', () => {
    // The bug this guards: filtering to open entries FIRST and then taking the
    // latest would surface the June figure again after the July one was
    // invoiced — money already on a real invoice, counted twice.
    const current = currentWipByProject([
      entry({ id: 'wip-old', amount: 40000, asOf: '2026-06-01' }),
      entry({
        id: 'wip-new',
        amount: 55000,
        asOf: '2026-07-01',
        status: WIP_STATUS.INVOICED,
        receivableId: 'rcv-123',
      }),
    ]);
    expect(current).toEqual([]);
  });

  it('treats the two stages as independent backlogs of the same project', () => {
    const current = currentWipByProject([
      entry({ id: 'wip-e', amount: 30000, stage: WIP_STAGE.EXECUTED }),
      entry({ id: 'wip-c', amount: 12000, stage: WIP_STAGE.CERTIFIED }),
    ]);
    expect(amounts(current).sort()).toEqual([
      'proj-ne4:certified:12000',
      'proj-ne4:executed:30000',
    ]);
  });

  it('separates projects', () => {
    const current = currentWipByProject([
      entry({ id: 'a', projectId: 'p1', projectName: 'Uno', amount: 10000 }),
      entry({ id: 'b', projectId: 'p2', projectName: 'Dos', amount: 20000 }),
    ]);
    expect(amounts(current).sort()).toEqual(['p1:executed:10000', 'p2:executed:20000']);
  });

  it('breaks an asOf tie with createdAt so the result is deterministic', () => {
    const current = currentWipByProject([
      entry({ id: 'first', amount: 1000, createdAt: '2026-07-01T08:00:00.000Z' }),
      entry({ id: 'second', amount: 2000, createdAt: '2026-07-01T09:30:00.000Z' }),
    ]);
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe('second');
  });

  it('ignores entries with no project, no usable amount, or no date', () => {
    const current = currentWipByProject([
      entry({ id: 'no-project', projectId: '', projectName: '' }),
      entry({ id: 'no-amount', projectId: 'p9', amount: 0 }),
      entry({ id: 'nan-amount', projectId: 'p8', amount: 'abc' }),
      entry({ id: 'no-date', projectId: 'p7', asOf: '' }),
    ]);
    expect(current).toEqual([]);
  });

  it('survives junk input without throwing', () => {
    expect(currentWipByProject(null)).toEqual([]);
    expect(currentWipByProject(undefined)).toEqual([]);
    expect(currentWipByProject([null, undefined, 42, 'x'])).toEqual([]);
  });

  it('coerces numeric strings, because number inputs hand back strings', () => {
    const current = currentWipByProject([entry({ amount: '18500.55' })]);
    expect(current[0].amount).toBe(18500.55);
  });
});

describe('totalWip', () => {
  it('sums only the current open entries, never the superseded history', () => {
    const entries = [
      entry({ id: 'old', amount: 40000, asOf: '2026-06-01' }),
      entry({ id: 'new', amount: 55000, asOf: '2026-07-01' }),
      entry({ id: 'other', projectId: 'p2', projectName: 'Dos', amount: 12000 }),
    ];
    expect(totalWip(entries)).toBe(67000);
  });

  it('adds both stages of the same project', () => {
    expect(
      totalWip([
        entry({ id: 'e', amount: 30000, stage: WIP_STAGE.EXECUTED }),
        entry({ id: 'c', amount: 12000, stage: WIP_STAGE.CERTIFIED }),
      ]),
    ).toBe(42000);
  });

  it('excludes invoiced entries — that money is a receivable now, not WIP', () => {
    expect(
      totalWip([entry({ status: WIP_STATUS.INVOICED, receivableId: 'rcv-1' })]),
    ).toBe(0);
  });

  it('is 0 for empty and junk input', () => {
    expect(totalWip([])).toBe(0);
    expect(totalWip(null)).toBe(0);
  });

  it('rounds to cents so floating point never leaks into the position', () => {
    expect(
      totalWip([
        entry({ id: 'a', projectId: 'p1', amount: 0.1 }),
        entry({ id: 'b', projectId: 'p2', amount: 0.2 }),
      ]),
    ).toBe(0.3);
  });
});

describe('wipAge — thresholds tied to the monthly certification cycle', () => {
  it('counts whole days since asOf', () => {
    expect(wipAge(entry({ asOf: '2026-07-01' }), TODAY).days).toBe(27);
  });

  it('is ok inside one certification cycle', () => {
    expect(wipAge(entry({ asOf: '2026-07-28' }), TODAY).tone).toBe('ok');
    expect(wipAge(entry({ asOf: '2026-06-28' }), TODAY).tone).toBe('ok'); // exactly 30
  });

  it('warns once a full cycle has been missed', () => {
    expect(wipAge(entry({ asOf: '2026-06-27' }), TODAY).tone).toBe('warn'); // 31
    expect(wipAge(entry({ asOf: '2026-05-29' }), TODAY).tone).toBe('warn'); // exactly 60
  });

  it('is critical past two cycles — more than a payroll frozen by paperwork', () => {
    expect(wipAge(entry({ asOf: '2026-05-28' }), TODAY).tone).toBe('critical'); // 61
    expect(wipAge(entry({ asOf: '2026-01-15' }), TODAY).tone).toBe('critical');
  });

  it('exposes its thresholds so the UI cannot invent its own', () => {
    expect(WIP_AGE_WARN_DAYS).toBe(30);
    expect(WIP_AGE_CRITICAL_DAYS).toBe(60);
  });

  it('treats a future asOf as ok rather than as negative-aged panic', () => {
    const age = wipAge(entry({ asOf: '2026-08-10' }), TODAY);
    expect(age.days).toBe(-13);
    expect(age.tone).toBe('ok');
  });

  it('returns a null age for an unusable entry instead of NaN', () => {
    expect(wipAge(entry({ asOf: '' }), TODAY)).toEqual({ days: null, tone: 'ok' });
    expect(wipAge(null, TODAY)).toEqual({ days: null, tone: 'ok' });
  });

  it('accepts a Date for today', () => {
    expect(wipAge(entry({ asOf: '2026-07-01' }), new Date('2026-07-28T10:00:00')).days).toBe(27);
  });
});

describe('netPosition — the real circulating position', () => {
  it('returns every component next to the total so the UI can show the arithmetic', () => {
    expect(
      netPosition({ cash: -16395, wip: 70000, payablesOpen: 101564, receivablesOpen: 0 }),
    ).toEqual({
      cash: -16395,
      wip: 70000,
      receivablesOpen: 0,
      payablesOpen: 101564,
      net: -47959,
    });
  });

  it('reproduces the pessimistic figure when WIP is not captured', () => {
    // What the owner sees today: cash minus payables, and concludes bankruptcy.
    expect(
      netPosition({ cash: -16395, wip: 0, payablesOpen: 101564, receivablesOpen: 0 }).net,
    ).toBe(-117959);
  });

  it('adds receivables — invoiced work is still money owed to the company', () => {
    expect(
      netPosition({ cash: 1000, wip: 2000, payablesOpen: 500, receivablesOpen: 4000 }).net,
    ).toBe(6500);
  });

  it('defaults every missing component to 0 instead of producing NaN', () => {
    expect(netPosition({}).net).toBe(0);
    expect(netPosition().net).toBe(0);
    expect(netPosition({ cash: 'x', wip: null }).net).toBe(0);
  });

  it('rounds to cents', () => {
    expect(netPosition({ cash: 0.1, wip: 0.2 }).net).toBe(0.3);
  });
});

describe('summarizeWip — the one shape both screens read', () => {
  const entries = [
    entry({ id: 'old', amount: 40000, asOf: '2026-06-01' }),
    entry({ id: 'new', amount: 55000, asOf: '2026-07-20', stage: WIP_STAGE.EXECUTED }),
    entry({ id: 'cert', amount: 12000, asOf: '2026-04-10', stage: WIP_STAGE.CERTIFIED }),
    entry({ id: 'p2', projectId: 'p2', projectName: 'Dos', amount: 8000, asOf: '2026-07-25' }),
  ];

  it('totals the current entries and splits them by stage', () => {
    const summary = summarizeWip(entries, TODAY);
    expect(summary.total).toBe(75000);
    expect(summary.byStage.executed).toBe(63000);
    expect(summary.byStage.certified).toBe(12000);
  });

  it('reports the oldest current entry, because that is the frozen money', () => {
    const summary = summarizeWip(entries, TODAY);
    expect(summary.oldestDays).toBe(109); // 2026-04-10 → 2026-07-28
    expect(summary.tone).toBe('critical');
    expect(summary.stale).toBe(true);
  });

  it('is not stale while everything sits inside one cycle', () => {
    const summary = summarizeWip([entry({ asOf: '2026-07-20' })], TODAY);
    expect(summary.stale).toBe(false);
    expect(summary.tone).toBe('ok');
    expect(summary.oldestDays).toBe(8);
  });

  it('groups the current entries per project, newest backlog first', () => {
    const summary = summarizeWip(entries, TODAY);
    expect(summary.byProject.map((p) => `${p.projectId}:${p.total}`)).toEqual([
      'proj-ne4:67000',
      'p2:8000',
    ]);
    expect(summary.byProject[0].entries).toHaveLength(2);
  });

  it('gives every current entry its age so a row can be coloured', () => {
    const summary = summarizeWip(entries, TODAY);
    const cert = summary.entries.find((e) => e.id === 'cert');
    expect(cert.ageDays).toBe(109);
    expect(cert.ageTone).toBe('critical');
  });

  it('returns an empty, non-throwing summary when nothing is captured', () => {
    const summary = summarizeWip([], TODAY);
    expect(summary.total).toBe(0);
    expect(summary.entries).toEqual([]);
    expect(summary.byProject).toEqual([]);
    expect(summary.oldestDays).toBeNull();
    expect(summary.stale).toBe(false);
    expect(summary.tone).toBe('ok');
    expect(summary.byStage).toEqual({ executed: 0, certified: 0 });
  });

  it('survives junk input', () => {
    expect(summarizeWip(null, TODAY).total).toBe(0);
    expect(summarizeWip(undefined).total).toBe(0);
  });
});
