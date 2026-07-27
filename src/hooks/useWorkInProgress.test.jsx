/**
 * useWorkInProgress — the `workInProgress` collection behind the WIP backlog.
 *
 * Two behaviours matter beyond plumbing: an entry is SUPERSEDED rather than
 * edited (recording a new figure adds a document and leaves the previous one as
 * history), and a figure that cannot carry money — no project, no amount, no
 * date — is refused at the write boundary instead of stored and filtered out
 * forever afterwards.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';

const store = installFirebaseMocks({ collections: { workInProgress: [] } });

const firestore = await import('firebase/firestore');
const { useWorkInProgress } = await import('./useWorkInProgress.js');
const { WIP_STAGE, WIP_STATUS } = await import('../finance/workInProgress.js');

// A successful write touches TWO collections: the entry itself and the audit
// log (writeAuditLogEntry uses addDoc too). Select by path so the audit entry
// can never be mistaken for the document under test.
const wipAddDocCalls = () =>
  firestore.addDoc.mock.calls.filter(([ref]) => String(ref?.path ?? '').endsWith('/workInProgress'));

const lastAddDocPayload = () => wipAddDocCalls().at(-1)?.[1];

const lastUpdateDocPayload = () => {
  const calls = firestore.updateDoc.mock.calls;
  return calls[calls.length - 1]?.[1];
};

const doc = (overrides = {}) => ({
  id: 'wip-1',
  projectId: 'proj-ne4',
  projectName: 'NE4 Westconnect',
  amount: 40000,
  asOf: '2026-07-01',
  stage: WIP_STAGE.EXECUTED,
  status: WIP_STATUS.OPEN,
  note: '',
  receivableId: null,
  createdBy: 'jromero@umtelkomd.com',
  createdAt: '2026-07-01T08:00:00.000Z',
  ...overrides,
});

const TODAY = '2026-07-28';

const renderReady = async (docs = []) => {
  store.collections.workInProgress = docs;
  const { result } = renderHook(() => useWorkInProgress(TEST_USER, { today: TODAY }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

beforeEach(() => {
  store.collections.workInProgress = [];
  store.errors = {};
  firestore.addDoc.mockClear();
  firestore.updateDoc.mockClear();
});

describe('useWorkInProgress — reading', () => {
  it('exposes the full history AND the derived current backlog', async () => {
    const result = await renderReady([
      doc({ id: 'old', amount: 40000, asOf: '2026-06-01' }),
      doc({ id: 'new', amount: 55000, asOf: '2026-07-01' }),
    ]);

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.current).toHaveLength(1);
    expect(result.current.current[0].id).toBe('new');
    expect(result.current.total).toBe(55000);
  });

  it('summarizes against the injected today so the age is deterministic', async () => {
    const result = await renderReady([doc({ asOf: '2026-04-10' })]);

    expect(result.current.summary.oldestDays).toBe(109);
    expect(result.current.summary.tone).toBe('critical');
    expect(result.current.summary.stale).toBe(true);
  });

  it('converts Firestore Timestamps so nothing non-serializable reaches React', async () => {
    const result = await renderReady([
      doc({ createdAt: { toDate: () => new Date('2026-07-01T08:00:00.000Z') } }),
    ]);

    expect(result.current.entries[0].createdAt).toBe('2026-07-01T08:00:00.000Z');
  });

  it('surfaces a listener failure instead of rendering 0 as if it were true', async () => {
    store.errors = { workInProgress: new Error('permission-denied') };
    const { result } = renderHook(() => useWorkInProgress(TEST_USER, { today: TODAY }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.total).toBe(0);
  });

  it('stays idle without a user', () => {
    const { result } = renderHook(() => useWorkInProgress(null, { today: TODAY }));

    expect(result.current.entries).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(firestore.addDoc).not.toHaveBeenCalled();
  });
});

describe('useWorkInProgress — recordWip supersedes, never edits', () => {
  it('adds a NEW document and leaves the previous one untouched', async () => {
    const result = await renderReady([doc({ id: 'old', amount: 40000 })]);

    let outcome;
    await act(async () => {
      outcome = await result.current.recordWip({
        projectId: 'proj-ne4',
        projectName: 'NE4 Westconnect',
        amount: 55000,
        asOf: '2026-07-20',
        stage: WIP_STAGE.EXECUTED,
        note: 'KW29-KW30 pendiente de Aufmaß',
      });
    });

    expect(outcome.success).toBe(true);
    expect(wipAddDocCalls()).toHaveLength(1);
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(lastAddDocPayload()).toMatchObject({
      projectId: 'proj-ne4',
      projectName: 'NE4 Westconnect',
      amount: 55000,
      asOf: '2026-07-20',
      stage: WIP_STAGE.EXECUTED,
      status: WIP_STATUS.OPEN,
      note: 'KW29-KW30 pendiente de Aufmaß',
      receivableId: null,
      createdBy: TEST_USER.email,
    });
  });

  it('never writes undefined — the sanitizer contract of this codebase', async () => {
    const result = await renderReady();

    await act(async () => {
      await result.current.recordWip({
        projectId: 'proj-ne4',
        projectName: 'NE4',
        amount: 1000,
        asOf: '2026-07-20',
      });
    });

    const payload = lastAddDocPayload();
    expect(Object.values(payload).some((value) => value === undefined)).toBe(false);
    expect(payload.note).toBe('');
    expect(payload.receivableId).toBeNull();
  });

  it('accepts a numeric string from the amount input', async () => {
    const result = await renderReady();

    await act(async () => {
      await result.current.recordWip({
        projectId: 'p1',
        projectName: 'Uno',
        amount: '18500.556',
        asOf: '2026-07-20',
      });
    });

    expect(lastAddDocPayload().amount).toBe(18500.56);
  });

  it('defaults an unspecified stage to "ejecutado sin certificar"', async () => {
    const result = await renderReady();

    await act(async () => {
      await result.current.recordWip({
        projectId: 'p1',
        projectName: 'Uno',
        amount: 100,
        asOf: '2026-07-20',
      });
    });

    expect(lastAddDocPayload().stage).toBe(WIP_STAGE.EXECUTED);
  });

  it.each([
    ['a missing project', { projectId: '', projectName: '', amount: 100, asOf: '2026-07-20' }, 'invalid-project'],
    ['a zero amount', { projectId: 'p1', amount: 0, asOf: '2026-07-20' }, 'invalid-amount'],
    ['a negative amount', { projectId: 'p1', amount: -5, asOf: '2026-07-20' }, 'invalid-amount'],
    ['a blank amount', { projectId: 'p1', amount: '', asOf: '2026-07-20' }, 'invalid-amount'],
    ['a non-numeric amount', { projectId: 'p1', amount: 'mucho', asOf: '2026-07-20' }, 'invalid-amount'],
    ['a missing date', { projectId: 'p1', amount: 100, asOf: '' }, 'invalid-date'],
    ['a malformed date', { projectId: 'p1', amount: 100, asOf: '20/07/2026' }, 'invalid-date'],
    ['an unknown stage', { projectId: 'p1', amount: 100, asOf: '2026-07-20', stage: 'facturado' }, 'invalid-stage'],
  ])('refuses %s', async (_label, payload, error) => {
    const result = await renderReady();

    let outcome;
    await act(async () => {
      outcome = await result.current.recordWip(payload);
    });

    expect(outcome).toEqual({ success: false, error });
    expect(firestore.addDoc).not.toHaveBeenCalled();
  });

  it('refuses to write without a user', async () => {
    const { result } = renderHook(() => useWorkInProgress(null, { today: TODAY }));

    let outcome;
    await act(async () => {
      outcome = await result.current.recordWip({ projectId: 'p1', amount: 100, asOf: '2026-07-20' });
    });

    expect(outcome.success).toBe(false);
    expect(firestore.addDoc).not.toHaveBeenCalled();
  });
});

describe('useWorkInProgress — markInvoiced closes, never deletes', () => {
  it('flips the entry to invoiced and links the receivable', async () => {
    const result = await renderReady([doc({ id: 'wip-1' })]);

    let outcome;
    await act(async () => {
      outcome = await result.current.markInvoiced('wip-1', { receivableId: 'rcv-9' });
    });

    expect(outcome.success).toBe(true);
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
    expect(lastUpdateDocPayload()).toMatchObject({
      status: WIP_STATUS.INVOICED,
      receivableId: 'rcv-9',
      updatedBy: TEST_USER.email,
    });
    expect(lastUpdateDocPayload().invoicedAt).toEqual(expect.any(String));
  });

  it('closes without a receivable id when the invoice is not in the app yet', async () => {
    const result = await renderReady([doc({ id: 'wip-1' })]);

    await act(async () => {
      await result.current.markInvoiced('wip-1');
    });

    expect(lastUpdateDocPayload().receivableId).toBeNull();
  });

  it('refuses an unknown entry rather than writing a ghost document', async () => {
    const result = await renderReady([doc({ id: 'wip-1' })]);

    let outcome;
    await act(async () => {
      outcome = await result.current.markInvoiced('nope');
    });

    expect(outcome).toEqual({ success: false, error: 'not-found' });
    expect(firestore.updateDoc).not.toHaveBeenCalled();
  });
});
