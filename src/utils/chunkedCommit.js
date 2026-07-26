/**
 * Chunked commits — write many documents without an all-or-nothing run.
 *
 *   commitInChunks(groups, commitGroup, onResult)
 *     → { applied, failed, errors }
 *
 * A batch commit that rejects mid-run used to take the whole operation down
 * with it: the caller never learned how many documents had already landed, and
 * the closing report was never printed. So a failing chunk is recorded and the
 * remaining chunks still run — the same discipline `bulkClassify` applies in
 * `src/hooks/useBankMovements.js`.
 *
 * `commitGroup(group, index)` performs one commit and may reject.
 * `onResult` is optional and is called once per chunk, success or failure, with
 * the running totals so a long job stays observable.
 *
 * Pure orchestration: no Firebase imports, so both the app and the CJS backfill
 * script can load it.
 */
export const commitInChunks = async (groups, commitGroup, onResult) => {
  const list = Array.isArray(groups) ? groups : [];
  const errors = [];
  let applied = 0;
  let failed = 0;

  for (let index = 0; index < list.length; index += 1) {
    const group = list[index];
    const size = Array.isArray(group) ? group.length : 0;

    try {
      await commitGroup(group, index);
      applied += size;
      onResult?.({ index, size, applied, failed, ok: true, error: null });
    } catch (error) {
      failed += size;
      errors.push(error);
      onResult?.({ index, size, applied, failed, ok: false, error });
    }
  }

  return { applied, failed, errors };
};

export default commitInChunks;
