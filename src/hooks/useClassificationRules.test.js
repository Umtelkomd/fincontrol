import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  addDoc: vi.fn(),
  arrayUnion: vi.fn((...items) => items),
  collection: vi.fn(() => ({ path: 'classificationRules' })),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
  increment: vi.fn((n) => ({ increment: n })),
  onSnapshot: vi.fn(() => () => {}),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  updateDoc: vi.fn(),
}));

const reactState = vi.hoisted(() => ({ setters: [] }));

vi.mock('react', () => ({
  useState: (initial) => {
    const setter = vi.fn();
    reactState.setters.push(setter);
    return [typeof initial === 'function' ? initial() : initial, setter];
  },
  useMemo: (factory) => factory(),
  useEffect: (effect) => effect(),
  useCallback: (fn) => fn,
}));

vi.mock('firebase/firestore', () => firestoreMocks);

vi.mock('../services/firebase', () => ({
  db: { mocked: true },
  appId: 'test-app',
}));

vi.mock('../utils/auditLog', () => ({
  writeAuditLogEntry: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logError: vi.fn(),
}));

const { useClassificationRules } = await import('./useClassificationRules.js');
const { COST_SCOPE } = await import('../finance/costScope.js');

const USER = { email: 'jarl@example.com' };

const overheadRuleForm = (overrides = {}) => ({
  name: 'Finanzkasse Stralsund — Impuestos',
  field: 'counterpartyName',
  matchType: 'contains',
  pattern: 'FINANZKASSE STRALSUND',
  direction: 'out',
  amountMin: null,
  amountMax: null,
  applyTo: {
    categoryName: 'Impuestos',
    costCenterId: '',
    projectId: '',
    projectName: '',
    costScope: COST_SCOPE.OVERHEAD,
  },
  active: true,
  priority: 50,
  notes: '',
  ...overrides,
});

/** Replays the onSnapshot mapper over raw documents and returns the mapped rules. */
const readBackRules = (rawDocs) => {
  // setters[0] is setRules — the hook declares rules, loading, error in that order.
  const setRules = reactState.setters[0];
  const onNext = firestoreMocks.onSnapshot.mock.calls[0][1];
  onNext({ docs: rawDocs.map((raw) => ({ id: raw.id, data: () => raw })) });
  return setRules.mock.calls[0][0];
};

describe('useClassificationRules — costScope round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reactState.setters.length = 0;
    firestoreMocks.addDoc.mockResolvedValue({ id: 'rule-1' });
    firestoreMocks.updateDoc.mockResolvedValue(undefined);
  });

  it('persists applyTo.costScope when a rule is created', async () => {
    const { createRule } = useClassificationRules(USER);

    expect(await createRule(overheadRuleForm())).toEqual({ success: true, id: 'rule-1' });

    const payload = firestoreMocks.addDoc.mock.calls[0][1];
    expect(payload.applyTo.costScope).toBe(COST_SCOPE.OVERHEAD);
  });

  it('persists applyTo.costScope when a rule is updated', async () => {
    const { updateRule } = useClassificationRules(USER);

    await updateRule('rule-1', overheadRuleForm({
      applyTo: { categoryName: 'Material', projectId: 'proj-1', projectName: 'NE4', costScope: COST_SCOPE.PROJECT },
    }));

    const payload = firestoreMocks.updateDoc.mock.calls[0][1];
    expect(payload.applyTo).toEqual({
      categoryName: 'Material',
      costCenterId: '',
      projectId: 'proj-1',
      projectName: 'NE4',
      costScope: COST_SCOPE.PROJECT,
    });
  });

  it('refuses to store an arbitrary costScope string', async () => {
    const { createRule } = useClassificationRules(USER);

    await createRule(overheadRuleForm({
      applyTo: { categoryName: 'Impuestos', costScope: 'structural' },
    }));

    expect(firestoreMocks.addDoc.mock.calls[0][1].applyTo.costScope).toBe('');
  });

  it('reads applyTo.costScope back out of a snapshot', () => {
    useClassificationRules(USER);

    const [rule] = readBackRules([{
      id: 'rule-1',
      name: 'Finanzkasse',
      field: 'counterpartyName',
      matchType: 'contains',
      pattern: 'FINANZKASSE',
      direction: 'out',
      applyTo: { categoryName: 'Impuestos', costScope: COST_SCOPE.OVERHEAD },
      priority: 50,
    }]);

    expect(rule.applyTo).toEqual({
      categoryName: 'Impuestos',
      costCenterId: '',
      projectId: '',
      projectName: '',
      costScope: COST_SCOPE.OVERHEAD,
    });
  });

  it('reads a legacy rule with no costScope back as an empty scope', () => {
    useClassificationRules(USER);

    const [rule] = readBackRules([{
      id: 'rule-legacy',
      name: 'Regla vieja',
      pattern: 'AMAZON',
      applyTo: { categoryName: 'Miscelaneos Oficina' },
    }]);

    expect(rule.applyTo.costScope).toBe('');
  });

  it('sanitizes a corrupted costScope stored by an older client', () => {
    useClassificationRules(USER);

    const [rule] = readBackRules([{
      id: 'rule-bad',
      pattern: 'ADYEN',
      applyTo: { categoryName: 'Administrativo', costScope: 'obra' },
    }]);

    expect(rule.applyTo.costScope).toBe('');
  });
});
