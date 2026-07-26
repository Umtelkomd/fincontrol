import { describe, expect, it, vi } from 'vitest';

import { commitInChunks } from './chunkedCommit.js';

describe('commitInChunks', () => {
  it('commits every chunk and totals what landed', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);

    const result = await commitInChunks([['a', 'b'], ['c']], commit);

    expect(result).toEqual({ applied: 3, failed: 0, errors: [] });
    expect(commit).toHaveBeenCalledTimes(2);
  });

  /**
   * The reason this helper exists: a mid-run failure used to abort the whole
   * backfill, so the operator never learned how much had already landed.
   */
  it('keeps going after a failed chunk and reports both counts', async () => {
    const commit = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('deadline exceeded'))
      .mockResolvedValueOnce(undefined);

    const result = await commitInChunks([['a', 'b'], ['c', 'd'], ['e']], commit);

    expect(commit).toHaveBeenCalledTimes(3);
    expect(result.applied).toBe(3);
    expect(result.failed).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('deadline exceeded');
  });

  it('collects every error, in chunk order', async () => {
    const commit = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'));

    const result = await commitInChunks([['a'], ['b']], commit);

    expect(result).toMatchObject({ applied: 0, failed: 2 });
    expect(result.errors.map((error) => error.message)).toEqual(['first', 'second']);
  });

  it('reports progress per chunk so a long run stays observable', async () => {
    const progress = [];
    const commit = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));

    await commitInChunks([['a', 'b'], ['c']], commit, (entry) => progress.push(entry));

    expect(progress).toEqual([
      { index: 0, size: 2, applied: 2, failed: 0, ok: true, error: null },
      { index: 1, size: 1, applied: 2, failed: 1, ok: false, error: expect.any(Error) },
    ]);
  });

  it('passes the chunk and its index to the committer', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);

    await commitInChunks([['a'], ['b']], commit);

    expect(commit.mock.calls).toEqual([[['a'], 0], [['b'], 1]]);
  });

  it('tolerates an empty or missing chunk list', async () => {
    const commit = vi.fn();

    expect(await commitInChunks([], commit)).toEqual({ applied: 0, failed: 0, errors: [] });
    expect(await commitInChunks(null, commit)).toEqual({ applied: 0, failed: 0, errors: [] });
    expect(commit).not.toHaveBeenCalled();
  });
});
