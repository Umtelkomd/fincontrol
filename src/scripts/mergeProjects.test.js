import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { executeMerge } = require('../../scripts/merge-projects.cjs');

const item = (id) => ({ ref: { path: `documents/${id}` }, move: true });

const planWith = (overrides = {}) => ({
  movements: [],
  receivables: [],
  payables: [],
  employees: [],
  budgets: [],
  wip: [],
  rules: [],
  ...overrides,
});

const setup = ({ failCommitAt = -1 } = {}) => {
  const batches = [];
  const db = {
    batch: vi.fn(() => {
      const index = batches.length;
      const batch = {
        update: vi.fn(),
        commit: index === failCommitAt
          ? vi.fn().mockRejectedValue(new Error('simulated batch failure'))
          : vi.fn().mockResolvedValue(undefined),
      };
      batches.push(batch);
      return batch;
    }),
  };
  return {
    db,
    batches,
    fromRef: { update: vi.fn().mockResolvedValue(undefined) },
    intoRef: { update: vi.fn().mockResolvedValue(undefined) },
  };
};

const execute = (state, overrides = {}) =>
  executeMerge({
    apply: true,
    db: state.db,
    plan: planWith(),
    fromRef: state.fromRef,
    intoRef: state.intoRef,
    intoId: 'project-into',
    intoCode: 'QFF-001',
    fromName: 'Rossdorf 2',
    intoName: 'Rossdorf 1',
    finalName: 'Rossdorf',
    stamp: { updatedAt: 'SERVER_TIMESTAMP', updatedBy: 'merge-projects' },
    today: '2026-07-28',
    logger: { log: vi.fn(), error: vi.fn() },
    ...overrides,
  });

describe('merge-projects execution', () => {
  it('commits every batch before finalizing both projects', async () => {
    const state = setup();
    const movements = Array.from({ length: 401 }, (_, index) => item(`movement-${index}`));

    const result = await execute(state, { plan: planWith({ movements }) });

    expect(result).toMatchObject({ exitCode: 0, failedBatches: 0, finalized: true });
    expect(state.batches).toHaveLength(2);
    expect(state.batches.every((batch) => batch.commit.mock.calls.length === 1)).toBe(true);
    expect(state.intoRef.update).toHaveBeenCalledTimes(1);
    expect(state.fromRef.update).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a batch fails and never finalizes the projects', async () => {
    const state = setup({ failCommitAt: 1 });
    const movements = Array.from({ length: 401 }, (_, index) => item(`movement-${index}`));

    const result = await execute(state, { plan: planWith({ movements }) });

    expect(result).toMatchObject({ exitCode: 1, failedBatches: 1, finalized: false });
    expect(state.batches).toHaveLength(2);
    expect(state.intoRef.update).not.toHaveBeenCalled();
    expect(state.fromRef.update).not.toHaveBeenCalled();
  });

  it('never creates a batch or updates a project in dry-run mode', async () => {
    const state = setup();

    const result = await execute(state, {
      apply: false,
      plan: planWith({ movements: [item('movement-1')] }),
    });

    expect(result).toMatchObject({ exitCode: 0, dryRun: true, finalized: false });
    expect(state.db.batch).not.toHaveBeenCalled();
    expect(state.intoRef.update).not.toHaveBeenCalled();
    expect(state.fromRef.update).not.toHaveBeenCalled();
  });
});
