/**
 * Pure planner behind scripts/migrate-classification-catalog.cjs — proves
 * the resolution/rename logic before it is ever pointed at real Firestore
 * data. The script itself stays an untested, thin I/O shell around this.
 */
import { describe, expect, it } from 'vitest';

import { COST_CENTER_CATALOG } from './costCenterCatalog.js';
import {
  buildWritePlan,
  parseMigrationArgs,
  planCostCenterMigration,
  planProjectCodeMigration,
  planProjectMerge,
  planProjectNameRefresh,
  sumBudgetLines,
} from './classificationMigration.js';

const doc = (id, fields = {}) => ({ id, ...fields });

describe('planCostCenterMigration — catalogue upserts', () => {
  it('proposes every catalogue entry when no live cost centers exist yet', () => {
    const plan = planCostCenterMigration({ costCenters: [], documentsByCollection: {} });
    expect(plan.catalogUpserts).toHaveLength(COST_CENTER_CATALOG.length);
    expect(plan.catalogUpserts).toContainEqual({
      code: 'CC-100',
      data: { code: 'CC-100', name: 'Obra civil (Tiefbau)', kind: 'direct', line: 'TB' },
    });
  });

  it('is idempotent: a live catalogue that already matches proposes nothing', () => {
    const costCenters = COST_CENTER_CATALOG.map((entry) => doc(entry.code, { code: entry.code, name: entry.name, kind: entry.kind, line: entry.line || '' }));
    const plan = planCostCenterMigration({ costCenters, documentsByCollection: {} });
    expect(plan.catalogUpserts).toEqual([]);
  });

  it('proposes only the entries whose live doc still disagrees', () => {
    const costCenters = COST_CENTER_CATALOG.map((entry) =>
      entry.code === 'CC-300'
        ? doc('CC-300', { code: 'CC-300', name: 'Nombre viejo', kind: entry.kind, line: entry.line || '' })
        : doc(entry.code, { code: entry.code, name: entry.name, kind: entry.kind, line: entry.line || '' }),
    );
    const plan = planCostCenterMigration({ costCenters, documentsByCollection: {} });
    expect(plan.catalogUpserts).toEqual([
      { code: 'CC-300', data: { code: 'CC-300', name: 'Administración y finanzas', kind: 'indirect', line: '' } },
    ]);
  });
});

describe('planCostCenterMigration — document remaps', () => {
  it('remaps a legacy code stored on a payable', () => {
    const plan = planCostCenterMigration({
      costCenters: [],
      documentsByCollection: { payables: [doc('pay-1', { costCenterId: 'CC-002' })] },
    });
    expect(plan.remaps).toEqual([{ collection: 'payables', id: 'pay-1', from: 'CC-002', to: 'CC-120' }]);
  });

  it('remaps a free-text legacy label stored on a receivable', () => {
    const plan = planCostCenterMigration({
      costCenters: [],
      documentsByCollection: { receivables: [doc('rec-1', { costCenterId: 'Seguros' })] },
    });
    expect(plan.remaps).toEqual([{ collection: 'receivables', id: 'rec-1', from: 'Seguros', to: 'CC-300' }]);
  });

  it('resolves a Firestore doc id through the live doc\'s own code/name before giving up', () => {
    const costCenters = [doc('legacyDoc123', { code: 'CC-004', name: 'Administrativo' })];
    const plan = planCostCenterMigration({
      costCenters,
      documentsByCollection: { bankMovements: [doc('mv-1', { costCenterId: 'legacyDoc123' })] },
    });
    expect(plan.remaps).toEqual([{ collection: 'bankMovements', id: 'mv-1', from: 'legacyDoc123', to: 'CC-300' }]);
  });

  it('reports a value nobody knows the meaning of, and never rewrites it', () => {
    const plan = planCostCenterMigration({
      costCenters: [],
      documentsByCollection: { payables: [doc('pay-2', { costCenterId: 'Contratistas' })] },
    });
    expect(plan.unresolved).toEqual([{ collection: 'payables', id: 'pay-2', value: 'Contratistas' }]);
    expect(plan.remaps).toEqual([]);
  });

  it('remaps "Sin asignar" to empty, but never touches an already-empty value', () => {
    const plan = planCostCenterMigration({
      costCenters: [],
      documentsByCollection: {
        payables: [doc('pay-3', { costCenterId: 'Sin asignar' }), doc('pay-4', { costCenterId: '' })],
      },
    });
    expect(plan.remaps).toEqual([{ collection: 'payables', id: 'pay-3', from: 'Sin asignar', to: '' }]);
  });

  it('is idempotent: an already-current v2 code produces no remap', () => {
    const plan = planCostCenterMigration({
      costCenters: [],
      documentsByCollection: { recurringCosts: [doc('rc-1', { costCenterId: 'CC-110' })] },
    });
    expect(plan.remaps).toEqual([]);
  });

  it('resolves the nested applyTo.costCenterId on a classification rule', () => {
    const plan = planCostCenterMigration({
      costCenters: [],
      documentsByCollection: { classificationRules: [doc('rule-1', { applyTo: { costCenterId: 'CC-005' } })] },
    });
    expect(plan.remaps).toEqual([{ collection: 'classificationRules', id: 'rule-1', from: 'CC-005', to: 'CC-110' }]);
  });

  it('never scans budgets: no document there stores a costCenterId', () => {
    const plan = planCostCenterMigration({
      costCenters: [],
      documentsByCollection: { budgets: [doc('budget-1', { costCenterId: 'CC-002' })] },
    });
    expect(plan.remaps).toEqual([]);
    expect(plan.unresolved).toEqual([]);
  });
});

describe('planCostCenterMigration — retiring superseded live docs', () => {
  it('flags a legacy live doc superseded by a v2 catalogue entry', () => {
    const plan = planCostCenterMigration({
      costCenters: [doc('legacyDoc1', { code: 'CC-002', name: 'Instalaciones y Reparaciones' })],
      documentsByCollection: {},
    });
    expect(plan.retire).toEqual([{ id: 'legacyDoc1', code: 'CC-002', name: 'Instalaciones y Reparaciones', resolvedTo: 'CC-120' }]);
  });

  it('never retires one of the 14 canonical catalogue docs', () => {
    const plan = planCostCenterMigration({
      costCenters: [doc('CC-100', { code: 'CC-100', name: 'Obra civil (Tiefbau)', kind: 'direct' })],
      documentsByCollection: {},
    });
    expect(plan.retire).toEqual([]);
  });

  it('reports an unresolvable live doc instead of guessing where it retires to', () => {
    // Neither the code nor the name is recorded anywhere — unlike, say, a doc
    // named "OPE", which the budget screen's own dictionary does map.
    const plan = planCostCenterMigration({
      costCenters: [doc('legacyDoc2', { code: 'CC-006', name: 'Contratistas' })],
      documentsByCollection: {},
    });
    expect(plan.retire).toEqual([]);
    expect(plan.unresolved).toContainEqual({ collection: 'costCenters', id: 'legacyDoc2', value: 'CC-006' });
  });

  it('retires a live doc whose NAME the recorded dictionary maps, such as OPE', () => {
    const plan = planCostCenterMigration({
      costCenters: [doc('legacyDoc3', { code: 'CC-006', name: 'OPE' })],
      documentsByCollection: {},
    });
    expect(plan.unresolved).toEqual([]);
    expect(plan.retire).toEqual([{ id: 'legacyDoc3', code: 'CC-006', name: 'OPE', resolvedTo: 'CC-110' }]);
  });
});

describe('planProjectCodeMigration', () => {
  it('renames a high-confidence legacy code and preserves it as legacyCode', () => {
    const plan = planProjectCodeMigration({
      projects: [doc('proj-1', { code: 'QFF', name: 'Roßdorf' })],
    });
    expect(plan.renames).toEqual([{
      id: 'proj-1',
      from: 'QFF',
      to: 'INS-RSD-BL1',
      confidence: 'high',
      name: 'Roßdorf',
      fields: {
        code: 'INS-RSD-BL1',
        codeClient: 'INS',
        site: 'RSD',
        line: 'BL',
        lot: 1,
        displayName: 'INS-RSD-BL1 (Roßdorf)',
        legacyCode: 'QFF',
      },
    }]);
    // A single project resolving to a merge-flagged code is a plain rename —
    // a merge only happens when TWO OR MORE live projects collide there.
    expect(plan.merges).toEqual([]);
  });

  it('never touches a project already on a structured v2 code', () => {
    const plan = planProjectCodeMigration({ projects: [doc('proj-1', { code: 'INS-RSD-BL1', name: 'Roßdorf' })] });
    expect(plan.renames).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips a mapped entry below minConfidence, and includes it once the threshold is lowered', () => {
    // Every entry shipped in the default LEGACY_PROJECT_CODE_MAP is now
    // confidence 'high' (owner-validated 2026-09-18, T11) — a caller-supplied
    // 'medium' entry is what exercises the threshold itself here.
    const mediumMapping = [{ match: ['NE4'], code: 'INS-WRZ-N41', confidence: 'medium' }];
    const projects = [doc('proj-2', { code: 'NE4', name: 'Würzburg' })];
    const skippedPlan = planProjectCodeMigration({ projects, mapping: mediumMapping });
    expect(skippedPlan.renames).toEqual([]);
    expect(skippedPlan.skipped).toEqual([{ id: 'proj-2', code: 'NE4', reason: 'below-min-confidence', confidence: 'medium' }]);

    const includedPlan = planProjectCodeMigration({ projects, mapping: mediumMapping, minConfidence: 'medium' });
    expect(includedPlan.renames).toHaveLength(1);
    expect(includedPlan.renames[0]).toMatchObject({ to: 'INS-WRZ-N41', confidence: 'medium' });
  });

  it('reports a legacy code nobody has mapped, never guessing a target', () => {
    const plan = planProjectCodeMigration({ projects: [doc('proj-3', { code: 'QDU', name: 'QDU' })] });
    expect(plan.renames).toEqual([]);
    expect(plan.skipped).toEqual([{ id: 'proj-3', code: 'QDU', reason: 'unmapped', confidence: null }]);
  });

  it('never renames either side of a collision: two projects resolving to the same target WITHOUT a merge group', () => {
    const projects = [
      doc('proj-amd', { code: 'AMD-001', name: 'Administración' }),
      doc('proj-overhead', { code: 'Overhead', name: 'Overhead' }),
    ];
    const plan = planProjectCodeMigration({ projects });
    expect(plan.renames).toEqual([]);
    expect(plan.collisions).toEqual([{
      code: 'UMT-ADM-OH1',
      projects: [
        { id: 'proj-amd', from: 'AMD-001', confidence: 'high' },
        { id: 'proj-overhead', from: 'Overhead', confidence: 'high' },
      ],
    }]);
    // UMT-ADM-OH1 carries no `merge: true` in LEGACY_PROJECT_CODE_MAP — a
    // genuine collision, never silently turned into a merge.
    expect(plan.merges).toEqual([]);
  });

  it('keeps the project doc id unchanged — only code and its parts move', () => {
    const plan = planProjectCodeMigration({ projects: [doc('stable-id', { code: 'QFF', name: 'Roßdorf' })] });
    expect(plan.renames[0].id).toBe('stable-id');
  });

  it('uses a caller-supplied mapping instead of the shipped default, for an owner-corrected target', () => {
    const correctedMapping = [{ match: ['QFF'], code: 'INS-RSD-TB1', confidence: 'high' }];
    const plan = planProjectCodeMigration({
      projects: [doc('proj-1', { code: 'QFF', name: 'Roßdorf' })],
      mapping: correctedMapping,
    });
    expect(plan.renames[0].to).toBe('INS-RSD-TB1');
  });
});

describe('planProjectCodeMigration — merge groups (T11: owner decision 2026-09-18)', () => {
  it('merges ≥2 live projects resolving to a merge-flagged code: renames only the survivor, never the losers', () => {
    const projects = [
      doc('proj-inactive', { code: 'QFF-002', name: 'Roßdorf 2', status: 'inactive' }),
      doc('proj-active', { code: 'QFF', name: 'Roßdorf', status: 'active' }),
    ];
    const plan = planProjectCodeMigration({ projects });

    expect(plan.renames).toEqual([{
      id: 'proj-active',
      from: 'QFF',
      to: 'INS-RSD-BL1',
      confidence: 'high',
      name: 'Roßdorf',
      fields: {
        code: 'INS-RSD-BL1',
        codeClient: 'INS',
        site: 'RSD',
        line: 'BL',
        lot: 1,
        displayName: 'INS-RSD-BL1 (Roßdorf)',
        legacyCode: 'QFF',
      },
    }]);
    expect(plan.collisions).toEqual([]);
    expect(plan.merges).toEqual([{
      code: 'INS-RSD-BL1',
      survivor: { id: 'proj-active', from: 'QFF', name: 'Roßdorf' },
      losers: [{ id: 'proj-inactive', from: 'QFF-002', name: 'Roßdorf 2' }],
      mergeBudgets: 'sum', // T12: owner decision 2026-09-18 — only the Roßdorf entry opts in
      fields: {
        code: 'INS-RSD-BL1',
        codeClient: 'INS',
        site: 'RSD',
        line: 'BL',
        lot: 1,
        displayName: 'INS-RSD-BL1 (Roßdorf)',
        legacyCode: 'QFF',
      },
    }]);
    expect(plan.summary.merges).toBe(1);
  });

  it('survivor tie-break, step 1: prefers an active project over an inactive one', () => {
    const projects = [
      doc('proj-a', { code: 'QFF', name: 'Roßdorf A', status: 'inactive' }),
      doc('proj-b', { code: 'RSD', name: 'Roßdorf B', status: 'active' }),
    ];
    const plan = planProjectCodeMigration({ projects });
    expect(plan.merges[0].survivor.id).toBe('proj-b');
  });

  it('survivor tie-break, step 2: prefers the bare legacy code (QFF) over a suffixed one (QFF-001) once activity ties', () => {
    const projects = [
      doc('proj-suffixed', { code: 'QFF-001', name: 'Roßdorf viejo' }),
      doc('proj-bare', { code: 'QFF', name: 'Roßdorf' }),
    ];
    const plan = planProjectCodeMigration({ projects });
    expect(plan.merges[0].survivor.id).toBe('proj-bare');
  });

  it('survivor tie-break, step 3: prefers the OLDEST createdAt once activity and bare-code both tie (accepts ISO strings and {seconds})', () => {
    const projects = [
      doc('proj-newer', { code: 'QFF', name: 'Roßdorf B', createdAt: '2026-05-01T00:00:00.000Z' }),
      doc('proj-older', { code: 'RSD', name: 'Roßdorf A', createdAt: { seconds: 1700000000 } }),
    ];
    const plan = planProjectCodeMigration({ projects });
    expect(plan.merges[0].survivor.id).toBe('proj-older');
  });

  it('survivor tie-break, step 4: falls back to the smallest doc id once everything else ties', () => {
    const projects = [
      doc('proj-b', { code: 'QFF', name: 'Roßdorf B' }),
      doc('proj-a', { code: 'RSD', name: 'Roßdorf A' }),
    ];
    const plan = planProjectCodeMigration({ projects });
    expect(plan.merges[0].survivor.id).toBe('proj-a');
  });

  it('propagates mergeBudgets from the mapping entry onto the merges[] item (owner decision 2026-09-18)', () => {
    const projects = [
      doc('proj-active', { code: 'QFF', name: 'Roßdorf', status: 'active' }),
      doc('proj-inactive', { code: 'QFF-002', name: 'Roßdorf 2', status: 'inactive' }),
    ];
    const plan = planProjectCodeMigration({ projects });
    expect(plan.merges[0].mergeBudgets).toBe('sum');
  });

  it('mergeBudgets is null for a merge-flagged mapping entry that does not opt in', () => {
    const noSumMapping = [{ match: ['QFF', 'QFF-002'], code: 'INS-RSD-BL1', confidence: 'high', merge: true }];
    const projects = [
      doc('proj-active', { code: 'QFF', name: 'Roßdorf', status: 'active' }),
      doc('proj-inactive', { code: 'QFF-002', name: 'Roßdorf 2', status: 'inactive' }),
    ];
    const plan = planProjectCodeMigration({ projects, mapping: noSumMapping });
    expect(plan.merges[0].mergeBudgets).toBeNull();
  });

  it('orders losers deterministically by the SAME survivor-rule tie-break, for a 3+-project merge (T12)', () => {
    // Input order is deliberately scrambled — the fold order must not depend
    // on Firestore read/array order.
    const projects = [
      doc('proj-suffixed', { code: 'QFF-001', name: 'Roßdorf viejo', status: 'inactive', createdAt: '2026-01-01T00:00:00.000Z' }),
      doc('proj-active', { code: 'QFF', name: 'Roßdorf', status: 'active' }),
      doc('proj-bare-inactive', { code: 'RSD', name: 'Roßdorf otro', status: 'inactive', createdAt: '2025-01-01T00:00:00.000Z' }),
    ];
    const plan = planProjectCodeMigration({ projects });

    expect(plan.merges[0].survivor.id).toBe('proj-active'); // active wins over both inactive
    // Among the two inactive losers, the bare code ('RSD') outranks the
    // suffixed one ('QFF-001') — same rule that would have broken an
    // active-tie, continued to order the runners-up.
    expect(plan.merges[0].losers.map((l) => l.id)).toEqual(['proj-bare-inactive', 'proj-suffixed']);
  });

  it('is idempotent: a survivor already renamed and a loser already mergedInto produce zero renames/merges', () => {
    const projects = [
      doc('proj-active', { code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' }),
      doc('proj-inactive', {
        code: 'QFF-002',
        name: 'Roßdorf 2',
        status: 'inactive',
        active: false,
        mergedInto: 'proj-active',
        mergedIntoCode: 'INS-RSD-BL1',
      }),
    ];
    const plan = planProjectCodeMigration({ projects });
    expect(plan.renames).toEqual([]);
    expect(plan.merges).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.collisions).toEqual([]);
  });
});

describe('planProjectMerge', () => {
  const merges = [{
    code: 'INS-RSD-BL1',
    survivor: { id: 'proj-active', from: 'QFF', name: 'Roßdorf' },
    losers: [{ id: 'proj-inactive', from: 'QFF-002', name: 'Roßdorf 2' }],
    fields: {
      code: 'INS-RSD-BL1',
      codeClient: 'INS',
      site: 'RSD',
      line: 'BL',
      lot: 1,
      displayName: 'INS-RSD-BL1 (Roßdorf)',
      legacyCode: 'QFF',
    },
  }];

  it('repoints projectId + projectName on every document pointing at a loser', () => {
    const plan = planProjectMerge({
      merges,
      documentsByCollection: {
        payables: [doc('pay-1', { projectId: 'proj-inactive', projectName: 'QFF-002' })],
        receivables: [doc('rec-1', { projectId: 'proj-inactive', projectName: 'Roßdorf 2' })],
        bankMovements: [doc('mv-1', { projectId: 'proj-inactive', projectName: '' })],
        workInProgress: [doc('wip-1', { projectId: 'proj-inactive', projectName: 'QFF-002' })],
      },
    });

    expect(plan.updates).toEqual(expect.arrayContaining([
      { collection: 'payables', id: 'pay-1', field: 'projectId', from: 'proj-inactive', to: 'proj-active' },
      { collection: 'payables', id: 'pay-1', field: 'projectName', from: 'QFF-002', to: 'Roßdorf' },
      { collection: 'receivables', id: 'rec-1', field: 'projectId', from: 'proj-inactive', to: 'proj-active' },
      { collection: 'receivables', id: 'rec-1', field: 'projectName', from: 'Roßdorf 2', to: 'Roßdorf' },
      { collection: 'bankMovements', id: 'mv-1', field: 'projectId', from: 'proj-inactive', to: 'proj-active' },
      { collection: 'bankMovements', id: 'mv-1', field: 'projectName', from: '', to: 'Roßdorf' },
      { collection: 'workInProgress', id: 'wip-1', field: 'projectId', from: 'proj-inactive', to: 'proj-active' },
      { collection: 'workInProgress', id: 'wip-1', field: 'projectName', from: 'QFF-002', to: 'Roßdorf' },
    ]));
    expect(plan.updates).toHaveLength(8);
  });

  it('never touches a document that already points at the survivor', () => {
    const plan = planProjectMerge({
      merges,
      documentsByCollection: { payables: [doc('pay-2', { projectId: 'proj-active', projectName: 'Roßdorf' })] },
    });
    expect(plan.updates).toEqual([]);
  });

  it('repoints applyTo.projectId/applyTo.projectName on a classification rule', () => {
    const plan = planProjectMerge({
      merges,
      documentsByCollection: { classificationRules: [doc('rule-1', { applyTo: { projectId: 'proj-inactive', projectName: 'QFF-002' } })] },
    });
    expect(plan.updates).toEqual([
      { collection: 'classificationRules', id: 'rule-1', field: 'applyTo.projectId', from: 'proj-inactive', to: 'proj-active' },
      { collection: 'classificationRules', id: 'rule-1', field: 'applyTo.projectName', from: 'QFF-002', to: 'Roßdorf' },
    ]);
  });

  it('repoints budgets.projectId only — never sums or merges the budget lines themselves', () => {
    const plan = planProjectMerge({
      merges,
      documentsByCollection: { budgets: [doc('budget-loser', { projectId: 'proj-inactive', year: 2026, total: 5000 })] },
    });
    expect(plan.updates).toEqual([{ collection: 'budgets', id: 'budget-loser', field: 'projectId', from: 'proj-inactive', to: 'proj-active' }]);
    expect(plan.budgetConflicts).toEqual([]);
  });

  it('reports a budgetConflicts entry when the survivor AND a loser both hold a budget for the same year, but still repoints the loser', () => {
    const plan = planProjectMerge({
      merges,
      documentsByCollection: {
        budgets: [
          doc('budget-survivor', { projectId: 'proj-active', year: 2026, total: 10000 }),
          doc('budget-loser', { projectId: 'proj-inactive', year: 2026, total: 5000 }),
        ],
      },
    });
    expect(plan.updates).toContainEqual({ collection: 'budgets', id: 'budget-loser', field: 'projectId', from: 'proj-inactive', to: 'proj-active' });
    expect(plan.budgetConflicts).toEqual([{
      year: 2026,
      survivorProjectId: 'proj-active',
      survivorBudgetId: 'budget-survivor',
      loserProjectId: 'proj-inactive',
      loserBudgetId: 'budget-loser',
    }]);
  });

  it('replaces the loser id in employees.projectIds and DE-DUPLICATES when the employee already had the survivor too', () => {
    const plan = planProjectMerge({
      merges,
      documentsByCollection: {
        employees: [
          doc('emp-both', { projectIds: ['proj-active', 'proj-inactive'] }),
          doc('emp-loser-only', { projectIds: ['proj-inactive', 'other-proj'] }),
        ],
      },
    });
    expect(plan.updates).toEqual(expect.arrayContaining([
      { collection: 'employees', id: 'emp-both', field: 'projectIds', from: ['proj-active', 'proj-inactive'], to: ['proj-active'] },
      { collection: 'employees', id: 'emp-loser-only', field: 'projectIds', from: ['proj-inactive', 'other-proj'], to: ['proj-active', 'other-proj'] },
    ]));
  });

  it('never touches an employee with no loser project id', () => {
    const plan = planProjectMerge({
      merges,
      documentsByCollection: { employees: [doc('emp-1', { projectIds: ['other-proj'] })] },
    });
    expect(plan.updates).toEqual([]);
  });

  it('proposes the loser project doc update: inactive, deactivated, mergedInto the survivor, never deleted', () => {
    const plan = planProjectMerge({
      merges,
      documentsByCollection: { projects: [doc('proj-inactive', { code: 'QFF-002', name: 'Roßdorf 2', status: 'active', active: true })] },
    });
    expect(plan.loserUpdates).toEqual([{
      collection: 'projects',
      id: 'proj-inactive',
      fields: {
        status: { from: 'active', to: 'inactive' },
        active: { from: true, to: false },
        mergedInto: { to: 'proj-active' },
        mergedIntoCode: { to: 'INS-RSD-BL1' },
      },
    }]);
  });

  it('omits the "from" of status/active when the live loser doc is not supplied — never invents a prior value', () => {
    const plan = planProjectMerge({ merges, documentsByCollection: {} });
    expect(plan.loserUpdates).toEqual([{
      collection: 'projects',
      id: 'proj-inactive',
      fields: {
        status: { to: 'inactive' },
        active: { to: false },
        mergedInto: { to: 'proj-active' },
        mergedIntoCode: { to: 'INS-RSD-BL1' },
      },
    }]);
  });

  it('returns empty plans for no merges', () => {
    const plan = planProjectMerge({ merges: [], documentsByCollection: {} });
    expect(plan).toEqual({
      updates: [],
      loserUpdates: [],
      budgetConflicts: [],
      budgetMerges: [],
      summary: { updates: 0, loserUpdates: 0, budgetConflicts: 0, budgetMerges: 0 },
    });
  });
});

describe('planProjectMerge — budget summing (owner decision 2026-09-18)', () => {
  const sumMerges = [{
    code: 'INS-RSD-BL1',
    survivor: { id: 'proj-active', from: 'QFF', name: 'Roßdorf' },
    losers: [{ id: 'proj-inactive', from: 'QFF-002', name: 'Roßdorf 2' }],
    fields: {
      code: 'INS-RSD-BL1', codeClient: 'INS', site: 'RSD', line: 'BL', lot: 1,
      displayName: 'INS-RSD-BL1 (Roßdorf)', legacyCode: 'QFF',
    },
    mergeBudgets: 'sum',
  }];

  it('sums same-year survivor+loser budget lines instead of reporting a conflict, and reports zero conflicts', () => {
    const plan = planProjectMerge({
      merges: sumMerges,
      documentsByCollection: {
        budgets: [
          doc('budget-survivor', {
            projectId: 'proj-active', year: 2026,
            lines: [{ id: 'line-a', categoryId: 'materiales', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1000) }],
          }),
          doc('budget-loser', {
            projectId: 'proj-inactive', year: 2026,
            lines: [{ id: 'line-b', categoryId: 'materiales', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(500) }],
          }),
        ],
      },
    });

    expect(plan.budgetConflicts).toEqual([]);
    expect(plan.budgetMerges).toEqual([{
      year: 2026,
      survivorBudgetId: 'budget-survivor',
      loserBudgetId: 'budget-loser',
      mergedLines: [{ id: 'line-a', categoryId: 'materiales', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1500) }],
      loserTotal: 6000,
      survivorTotalBefore: 12000,
      survivorTotalAfter: 18000,
      matchedLines: 1,
      appendedLines: 0,
    }]);
    // The survivor budget's `lines` field is what actually gets written.
    expect(plan.updates).toContainEqual({
      collection: 'budgets', id: 'budget-survivor', field: 'lines',
      from: [{ id: 'line-a', categoryId: 'materiales', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1000) }],
      to: [{ id: 'line-a', categoryId: 'materiales', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1500) }],
    });
    // The loser budget's projectId is NEVER repointed — doing so would make it
    // count a second time wherever budgets are matched by project.
    expect(plan.updates.some((u) => u.collection === 'budgets' && u.id === 'budget-loser')).toBe(false);
  });

  it('stamps the loser budget mergedInto/mergedIntoProjectId instead, never deleting it', () => {
    const plan = planProjectMerge({
      merges: sumMerges,
      documentsByCollection: {
        budgets: [
          doc('budget-survivor', { projectId: 'proj-active', year: 2026, lines: [] }),
          doc('budget-loser', { projectId: 'proj-inactive', year: 2026, lines: [] }),
        ],
      },
    });

    expect(plan.loserUpdates).toContainEqual({
      collection: 'budgets',
      id: 'budget-loser',
      fields: { mergedInto: { to: 'budget-survivor' }, mergedIntoProjectId: { to: 'proj-active' } },
    });
  });

  it('a loser budget for a year the survivor has none is simply repointed — nothing to sum', () => {
    const plan = planProjectMerge({
      merges: sumMerges,
      documentsByCollection: {
        budgets: [doc('budget-loser-2025', { projectId: 'proj-inactive', year: 2025, lines: [] })],
      },
    });

    expect(plan.updates).toEqual([{ collection: 'budgets', id: 'budget-loser-2025', field: 'projectId', from: 'proj-inactive', to: 'proj-active' }]);
    expect(plan.budgetMerges).toEqual([]);
    expect(plan.budgetConflicts).toEqual([]);
  });

  it('idempotency: a loser budget already stamped mergedInto is never summed again on a re-run', () => {
    const plan = planProjectMerge({
      merges: sumMerges,
      documentsByCollection: {
        budgets: [
          doc('budget-survivor', { projectId: 'proj-active', year: 2026, lines: [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1500) }] }),
          doc('budget-loser', { projectId: 'proj-inactive', year: 2026, lines: [{ id: 'l2', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(500) }], mergedInto: 'budget-survivor', mergedIntoProjectId: 'proj-active' }),
        ],
      },
    });

    expect(plan.budgetMerges).toEqual([]);
    expect(plan.updates).toEqual([]);
    // The unrelated project-level loserUpdate entry (T11, always produced
    // once per merge) is not what this guard is about — only that no SECOND
    // `budgets` loserUpdate entry is produced for the already-settled budget.
    expect(plan.loserUpdates.filter((u) => u.collection === 'budgets')).toEqual([]);
  });

  it('three-project merge: budgets accumulate deterministically, folded in the survivor-rule order of `merge.losers`', () => {
    const threeWayMerge = [{
      code: 'INS-RSD-BL1',
      survivor: { id: 'proj-active', from: 'QFF', name: 'Roßdorf' },
      // Deliberately NOT alphabetical/insertion order — planProjectCodeMigration
      // is responsible for handing losers over in the deterministic fold order.
      losers: [
        { id: 'proj-loser-1', from: 'QFF-001', name: 'Roßdorf viejo' },
        { id: 'proj-loser-2', from: 'QFF-002', name: 'Roßdorf 2' },
      ],
      fields: {}, mergeBudgets: 'sum',
    }];

    const plan = planProjectMerge({
      merges: threeWayMerge,
      documentsByCollection: {
        budgets: [
          doc('budget-survivor', { projectId: 'proj-active', year: 2026, lines: [{ id: 'l0', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(100) }] }),
          doc('budget-loser-1', { projectId: 'proj-loser-1', year: 2026, lines: [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(10) }] }),
          doc('budget-loser-2', { projectId: 'proj-loser-2', year: 2026, lines: [{ id: 'l2', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1) }] }),
        ],
      },
    });

    // Folded in order: survivor(100) + loser-1(10) = 110, then 110 + loser-2(1) = 111 — per month.
    expect(plan.budgetMerges).toHaveLength(2);
    expect(plan.budgetMerges[0]).toMatchObject({ loserBudgetId: 'budget-loser-1', survivorTotalBefore: 1200, survivorTotalAfter: 1320 });
    expect(plan.budgetMerges[1]).toMatchObject({ loserBudgetId: 'budget-loser-2', survivorTotalBefore: 1320, survivorTotalAfter: 1332 });
    const finalLinesUpdate = plan.updates.find((u) => u.collection === 'budgets' && u.id === 'budget-survivor' && u.field === 'lines');
    expect(finalLinesUpdate.to[0].monthlyBudget).toEqual(Array(12).fill(111));
  });
});

describe('sumBudgetLines (owner decision 2026-09-18)', () => {
  it('sums monthlyBudget element-wise for matched lines (type + normalized categoryName)', () => {
    const survivor = [{ id: 'sv-1', categoryId: 'materiales', categoryName: 'Materiales', type: 'expense', monthlyBudget: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], notes: 'nota sobreviviente' }];
    const loser = [{ id: 'ls-1', categoryId: 'Materiales', categoryName: 'materiales', type: 'expense', monthlyBudget: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], notes: 'presupuesto perdedor' }];

    const merged = sumBudgetLines(survivor, loser);

    expect(merged).toEqual([{ id: 'sv-1', categoryId: 'materiales', categoryName: 'Materiales', type: 'expense', monthlyBudget: Array(12).fill(150), notes: 'nota sobreviviente' }]);
    // survivor's id and non-empty fields win; loser's inputs are never mutated.
    expect(loser[0].monthlyBudget).toEqual(Array(12).fill(50));
  });

  it('appends unmatched loser lines, preserving survivor line order first', () => {
    const survivor = [{ id: 'sv-1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(100) }];
    const loser = [{ id: 'ls-1', categoryName: 'equipos', type: 'expense', monthlyBudget: Array(12).fill(20) }];

    const merged = sumBudgetLines(survivor, loser);

    expect(merged).toEqual([
      { id: 'sv-1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(100) },
      { id: 'ls-1', categoryName: 'equipos', type: 'expense', monthlyBudget: Array(12).fill(20) },
    ]);
  });

  it('treats missing/NaN/non-numeric monthly values as 0 and never produces NaN or floating-point noise', () => {
    const survivor = [{ id: 'sv-1', categoryName: 'materiales', type: 'expense', monthlyBudget: [0.1, undefined, NaN, 'x', 100, 100, 100, 100, 100, 100, 100, 100] }];
    const loser = [{ id: 'ls-1', categoryName: 'materiales', type: 'expense', monthlyBudget: [0.2, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5] }];

    const merged = sumBudgetLines(survivor, loser);

    expect(merged[0].monthlyBudget[0]).toBe(0.3); // 0.1 + 0.2, rounded to cents — never 0.30000000000000004
    expect(merged[0].monthlyBudget[1]).toBe(5); // undefined -> 0
    expect(merged[0].monthlyBudget[2]).toBe(5); // NaN -> 0
    expect(merged[0].monthlyBudget[3]).toBe(5); // 'x' -> 0
    expect(merged[0].monthlyBudget.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('keeps any other per-line field from the survivor, falling back to the loser only when the survivor value is empty', () => {
    const survivor = [{ id: 'sv-1', categoryId: 'materiales', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(10), notes: '' }];
    const loser = [{ id: 'ls-1', categoryId: 'materiales', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(5), notes: 'nota del perdedor' }];

    const merged = sumBudgetLines(survivor, loser);

    expect(merged[0].notes).toBe('nota del perdedor'); // survivor's notes was '', empty -> loser's kept
    expect(merged[0].id).toBe('sv-1'); // survivor's id always wins when present — never a generated one
  });

  it('is pure: never mutates either input array or its line objects', () => {
    const survivor = [{ id: 'sv-1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(10) }];
    const loser = [{ id: 'ls-1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(5) }];
    const survivorSnapshot = JSON.parse(JSON.stringify(survivor));
    const loserSnapshot = JSON.parse(JSON.stringify(loser));

    sumBudgetLines(survivor, loser);

    expect(survivor).toEqual(survivorSnapshot);
    expect(loser).toEqual(loserSnapshot);
  });

  it('handles empty/missing inputs without throwing', () => {
    expect(sumBudgetLines([], [])).toEqual([]);
    expect(sumBudgetLines(undefined, undefined)).toEqual([]);
    expect(sumBudgetLines([{ id: 'sv-1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(10) }], [])).toEqual([
      { id: 'sv-1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(10) },
    ]);
  });
});

describe('planProjectNameRefresh', () => {
  const renames = [{ id: 'proj-1', from: 'QFF', to: 'INS-RSD-BL1', confidence: 'high', name: 'Roßdorf', fields: {} }];

  it('refreshes a stale denormalised projectName on payables/receivables/bankMovements/workInProgress', () => {
    const plan = planProjectNameRefresh({
      renames,
      documentsByCollection: {
        payables: [doc('pay-1', { projectId: 'proj-1', projectName: 'QFF' })],
        receivables: [doc('rec-1', { projectId: 'proj-1', projectName: 'QFF' })],
        bankMovements: [doc('mv-1', { projectId: 'proj-1', projectName: '' })],
        workInProgress: [doc('wip-1', { projectId: 'proj-1', projectName: 'QFF' })],
      },
    });
    expect(plan.updates).toEqual(
      expect.arrayContaining([
        { collection: 'payables', id: 'pay-1', field: 'projectName', from: 'QFF', to: 'Roßdorf' },
        { collection: 'receivables', id: 'rec-1', field: 'projectName', from: 'QFF', to: 'Roßdorf' },
        { collection: 'bankMovements', id: 'mv-1', field: 'projectName', from: '', to: 'Roßdorf' },
        { collection: 'workInProgress', id: 'wip-1', field: 'projectName', from: 'QFF', to: 'Roßdorf' },
      ]),
    );
    expect(plan.updates).toHaveLength(4);
  });

  it('refreshes the nested applyTo.projectName on a classification rule', () => {
    const plan = planProjectNameRefresh({
      renames,
      documentsByCollection: { classificationRules: [doc('rule-1', { applyTo: { projectId: 'proj-1', projectName: 'QFF' } })] },
    });
    expect(plan.updates).toEqual([{ collection: 'classificationRules', id: 'rule-1', field: 'applyTo.projectName', from: 'QFF', to: 'Roßdorf' }]);
  });

  it('is idempotent: a projectName already matching the renamed project needs no update', () => {
    const plan = planProjectNameRefresh({
      renames,
      documentsByCollection: { payables: [doc('pay-2', { projectId: 'proj-1', projectName: 'Roßdorf' })] },
    });
    expect(plan.updates).toEqual([]);
  });

  it('never touches employees.projectIds: it holds ids only, with no parallel name field to refresh', () => {
    const plan = planProjectNameRefresh({
      renames,
      documentsByCollection: { employees: [doc('emp-1', { projectIds: ['proj-1'] })] },
    });
    expect(plan.updates).toEqual([]);
  });

  it('never touches budgets: projectId alone with no denormalised projectName to refresh', () => {
    const plan = planProjectNameRefresh({
      renames,
      documentsByCollection: { budgets: [doc('budget-1', { projectId: 'proj-1' })] },
    });
    expect(plan.updates).toEqual([]);
  });
});

describe('buildWritePlan — merging every planner into one write per document', () => {
  it('BLOCKER regression: a document needing both a cost-center remap and a projectName refresh gets ONE write with both previous values', () => {
    const plan = buildWritePlan({
      costCenterPlan: { remaps: [{ collection: 'payables', id: 'pay-1', from: 'CC-002', to: 'CC-120' }] },
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [{ collection: 'payables', id: 'pay-1', field: 'projectName', from: 'QFF', to: 'Roßdorf' }] },
      existingDocsByCollection: {},
    });

    expect(plan).toEqual([{
      kind: 'update',
      collection: 'payables',
      id: 'pay-1',
      data: {
        costCenterId: 'CC-120',
        'migration.classificationCatalogV2.previous.costCenterId': 'CC-002',
        projectName: 'Roßdorf',
        'migration.classificationCatalogV2.previous.projectName': 'QFF',
      },
      label: 'payables/pay-1',
    }]);
  });

  it('is idempotent: a second run over fully migrated data plans zero writes', () => {
    const plan = buildWritePlan({
      costCenterPlan: { catalogUpserts: [], remaps: [] },
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [] },
      existingDocsByCollection: {},
    });
    expect(plan).toEqual([]);
  });

  it('re-run safety: a previous key already recorded on the live doc is never overwritten, even when this run recomputes the same field', () => {
    const plan = buildWritePlan({
      costCenterPlan: { remaps: [{ collection: 'payables', id: 'pay-1', from: 'CC-XYZ', to: 'CC-100' }] },
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [{ collection: 'payables', id: 'pay-1', field: 'projectName', from: 'QFF', to: 'Roßdorf' }] },
      existingDocsByCollection: {
        payables: [{ id: 'pay-1', migration: { classificationCatalogV2: { previous: { costCenterId: 'CC-002' } } } }],
      },
    });

    // costCenterId is still updated to its newly resolved value, but the
    // already-recorded previous.costCenterId ('CC-002', the TRUE first-ever
    // original) is preserved — never clobbered with this run's 'CC-XYZ'.
    expect(plan).toEqual([{
      kind: 'update',
      collection: 'payables',
      id: 'pay-1',
      data: {
        costCenterId: 'CC-100',
        projectName: 'Roßdorf',
        'migration.classificationCatalogV2.previous.projectName': 'QFF',
      },
      label: 'payables/pay-1',
    }]);
  });

  it('classificationRules nested paths: applyTo.costCenterId and applyTo.projectName roll back independently on the same rule', () => {
    const plan = buildWritePlan({
      costCenterPlan: { remaps: [{ collection: 'classificationRules', id: 'rule-1', from: 'CC-005', to: 'CC-110' }] },
      projectPlan: { renames: [] },
      nameRefreshPlan: {
        updates: [{ collection: 'classificationRules', id: 'rule-1', field: 'applyTo.projectName', from: 'QFF', to: 'Roßdorf' }],
      },
      existingDocsByCollection: {},
    });

    expect(plan).toEqual([{
      kind: 'update',
      collection: 'classificationRules',
      id: 'rule-1',
      data: {
        'applyTo.costCenterId': 'CC-110',
        'migration.classificationCatalogV2.previous.applyTo.costCenterId': 'CC-005',
        'applyTo.projectName': 'Roßdorf',
        'migration.classificationCatalogV2.previous.applyTo.projectName': 'QFF',
      },
      label: 'classificationRules/rule-1',
    }]);
  });

  it('re-run safety also resolves a NESTED existing previous path (applyTo.costCenterId), not just a top-level one', () => {
    const plan = buildWritePlan({
      costCenterPlan: { remaps: [{ collection: 'classificationRules', id: 'rule-1', from: 'CC-999', to: 'CC-110' }] },
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [] },
      existingDocsByCollection: {
        classificationRules: [{
          id: 'rule-1',
          migration: { classificationCatalogV2: { previous: { applyTo: { costCenterId: 'CC-005' } } } },
        }],
      },
    });

    expect(plan).toEqual([{
      kind: 'update',
      collection: 'classificationRules',
      id: 'rule-1',
      data: { 'applyTo.costCenterId': 'CC-110' }, // no previous write: CC-005 already recorded as the true original
      label: 'classificationRules/rule-1',
    }]);
  });

  it('a catalogue upsert becomes a merge-set write, independent of any document remap', () => {
    const plan = buildWritePlan({
      costCenterPlan: { catalogUpserts: [{ code: 'CC-100', data: { code: 'CC-100', name: 'Obra civil (Tiefbau)', kind: 'direct', line: 'TB' } }], remaps: [] },
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [] },
      existingDocsByCollection: {},
    });

    expect(plan).toEqual([{
      kind: 'set',
      collection: 'costCenters',
      id: 'CC-100',
      data: { code: 'CC-100', name: 'Obra civil (Tiefbau)', kind: 'direct', line: 'TB' },
      merge: true,
      label: 'costCenters/CC-100',
    }]);
  });

  it('a project rename rolls back through previous.code', () => {
    const plan = buildWritePlan({
      costCenterPlan: { remaps: [] },
      projectPlan: {
        renames: [{
          id: 'proj-1',
          from: 'QFF',
          to: 'INS-RSD-BL1',
          confidence: 'high',
          name: 'Roßdorf',
          fields: { code: 'INS-RSD-BL1', codeClient: 'INS', site: 'RSD', line: 'BL', lot: 1, displayName: 'INS-RSD-BL1 (Roßdorf)', legacyCode: 'QFF' },
        }],
      },
      nameRefreshPlan: { updates: [] },
      existingDocsByCollection: {},
    });

    expect(plan).toEqual([{
      kind: 'update',
      collection: 'projects',
      id: 'proj-1',
      data: {
        code: 'INS-RSD-BL1',
        codeClient: 'INS',
        site: 'RSD',
        line: 'BL',
        lot: 1,
        displayName: 'INS-RSD-BL1 (Roßdorf)',
        legacyCode: 'QFF',
        'migration.classificationCatalogV2.previous.code': 'QFF',
      },
      label: 'projects/proj-1',
    }]);
  });
});

describe('buildWritePlan — project merges (T11)', () => {
  it('a cost-center remap + a merge repoint + a name refresh on ONE document is still ONE write with all three previous values', () => {
    const plan = buildWritePlan({
      costCenterPlan: { remaps: [{ collection: 'payables', id: 'pay-1', from: 'CC-002', to: 'CC-120' }] },
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [] },
      mergePlan: {
        updates: [
          { collection: 'payables', id: 'pay-1', field: 'projectId', from: 'proj-inactive', to: 'proj-active' },
          { collection: 'payables', id: 'pay-1', field: 'projectName', from: 'QFF-002', to: 'Roßdorf' },
        ],
      },
      existingDocsByCollection: {},
    });

    expect(plan).toEqual([{
      kind: 'update',
      collection: 'payables',
      id: 'pay-1',
      data: {
        costCenterId: 'CC-120',
        'migration.classificationCatalogV2.previous.costCenterId': 'CC-002',
        projectId: 'proj-active',
        'migration.classificationCatalogV2.previous.projectId': 'proj-inactive',
        projectName: 'Roßdorf',
        'migration.classificationCatalogV2.previous.projectName': 'QFF-002',
      },
      label: 'payables/pay-1',
    }]);
  });

  it('a loser project doc gets ONE write holding status/active/mergedInto/mergedIntoCode, with previous only for status/active', () => {
    const plan = buildWritePlan({
      costCenterPlan: {},
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [] },
      mergePlan: {
        loserUpdates: [{
          collection: 'projects',
          id: 'proj-inactive',
          fields: {
            status: { from: 'active', to: 'inactive' },
            active: { from: true, to: false },
            mergedInto: { to: 'proj-active' },
            mergedIntoCode: { to: 'INS-RSD-BL1' },
          },
        }],
      },
      existingDocsByCollection: {},
    });

    expect(plan).toEqual([{
      kind: 'update',
      collection: 'projects',
      id: 'proj-inactive',
      data: {
        status: 'inactive',
        'migration.classificationCatalogV2.previous.status': 'active',
        active: false,
        'migration.classificationCatalogV2.previous.active': true,
        mergedInto: 'proj-active',
        mergedIntoCode: 'INS-RSD-BL1',
      },
      label: 'projects/proj-inactive',
    }]);
  });

  it('re-run safety: a previously recorded previous.projectId is never overwritten by a second merge-repoint run', () => {
    const plan = buildWritePlan({
      costCenterPlan: {},
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [] },
      mergePlan: {
        updates: [{ collection: 'payables', id: 'pay-1', field: 'projectId', from: 'proj-inactive', to: 'proj-active' }],
      },
      existingDocsByCollection: {
        payables: [{ id: 'pay-1', migration: { classificationCatalogV2: { previous: { projectId: 'proj-original' } } } }],
      },
    });

    expect(plan).toEqual([{
      kind: 'update',
      collection: 'payables',
      id: 'pay-1',
      data: { projectId: 'proj-active' }, // no previous write — 'proj-original' stays the true original
      label: 'payables/pay-1',
    }]);
  });

  it('T12: the survivor budget write carries previous.lines, reversible, and the loser budget gets ONE write with mergedInto/mergedIntoProjectId', () => {
    const plan = buildWritePlan({
      costCenterPlan: {},
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [] },
      mergePlan: {
        updates: [{
          collection: 'budgets', id: 'budget-survivor', field: 'lines',
          from: [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1000) }],
          to: [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1500) }],
        }],
        loserUpdates: [{
          collection: 'budgets',
          id: 'budget-loser',
          fields: { mergedInto: { to: 'budget-survivor' }, mergedIntoProjectId: { to: 'proj-active' } },
        }],
      },
      existingDocsByCollection: {},
    });

    expect(plan).toEqual(expect.arrayContaining([
      {
        kind: 'update',
        collection: 'budgets',
        id: 'budget-survivor',
        data: {
          lines: [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1500) }],
          'migration.classificationCatalogV2.previous.lines': [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1000) }],
        },
        label: 'budgets/budget-survivor',
      },
      {
        kind: 'update',
        collection: 'budgets',
        id: 'budget-loser',
        data: { mergedInto: 'budget-survivor', mergedIntoProjectId: 'proj-active' },
        label: 'budgets/budget-loser',
      },
    ]));
    expect(plan).toHaveLength(2);
  });

  it('T12 re-run safety: an existing previous.lines is never overwritten by a second sum run', () => {
    const plan = buildWritePlan({
      costCenterPlan: {},
      projectPlan: { renames: [] },
      nameRefreshPlan: { updates: [] },
      mergePlan: {
        updates: [{
          collection: 'budgets', id: 'budget-survivor', field: 'lines',
          from: [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1500) }],
          to: [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1600) }],
        }],
      },
      existingDocsByCollection: {
        budgets: [{
          id: 'budget-survivor',
          migration: {
            classificationCatalogV2: {
              previous: { lines: [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1000) }] },
            },
          },
        }],
      },
    });

    expect(plan).toEqual([{
      kind: 'update',
      collection: 'budgets',
      id: 'budget-survivor',
      data: { lines: [{ id: 'l1', categoryName: 'materiales', type: 'expense', monthlyBudget: Array(12).fill(1600) }] }, // no previous write — the TRUE original (1000) stays recorded
      label: 'budgets/budget-survivor',
    }]);
  });

  it('the survivor rename and a loser project update are independent writes (different doc ids)', () => {
    const plan = buildWritePlan({
      costCenterPlan: {},
      projectPlan: {
        renames: [{
          id: 'proj-active',
          from: 'QFF',
          to: 'INS-RSD-BL1',
          confidence: 'high',
          name: 'Roßdorf',
          fields: {
            code: 'INS-RSD-BL1',
            codeClient: 'INS',
            site: 'RSD',
            line: 'BL',
            lot: 1,
            displayName: 'INS-RSD-BL1 (Roßdorf)',
            legacyCode: 'QFF',
          },
        }],
      },
      nameRefreshPlan: { updates: [] },
      mergePlan: {
        loserUpdates: [{
          collection: 'projects',
          id: 'proj-inactive',
          fields: { status: { to: 'inactive' }, active: { to: false }, mergedInto: { to: 'proj-active' }, mergedIntoCode: { to: 'INS-RSD-BL1' } },
        }],
      },
      existingDocsByCollection: {},
    });

    expect(plan.map((entry) => entry.id)).toEqual(['proj-active', 'proj-inactive']);
  });
});

describe('parseMigrationArgs', () => {
  it('accepts no flags: dry-run, no scope restriction, default confidence', () => {
    expect(parseMigrationArgs([])).toEqual({ ok: true, apply: false, confirm: '', only: '', minConfidence: 'high' });
  });

  it('accepts a valid --apply + --confirm combination', () => {
    expect(parseMigrationArgs(['--apply', '--confirm=umtelkomd-finance'])).toEqual({
      ok: true, apply: true, confirm: 'umtelkomd-finance', only: '', minConfidence: 'high',
    });
  });

  it('accepts valid --only and --min-confidence combinations', () => {
    expect(parseMigrationArgs(['--only=cost-centers', '--min-confidence=medium'])).toEqual({
      ok: true, apply: false, confirm: '', only: 'cost-centers', minConfidence: 'medium',
    });
  });

  it('rejects a misspelled flag instead of silently ignoring it', () => {
    const result = parseMigrationArgs(['--aply']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--aply/);
  });

  it('rejects --apply=true: --apply is a bare flag, not a key=value one', () => {
    const result = parseMigrationArgs(['--apply=true']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--apply=true/);
  });

  it('rejects the space form "--confirm x" instead of silently treating confirm as empty', () => {
    const result = parseMigrationArgs(['--confirm', 'x']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--confirm/);
  });

  it('BLOCKER-adjacent (d): --only= with an empty value fails closed instead of degrading to a full run', () => {
    const result = parseMigrationArgs(['--only=']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--only/);
  });

  it('rejects --only=bogus (not in the closed value set)', () => {
    const result = parseMigrationArgs(['--only=bogus']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--only/);
  });

  it('(d): --min-confidence= with an empty value fails closed instead of silently defaulting to high', () => {
    const result = parseMigrationArgs(['--min-confidence=']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--min-confidence/);
  });

  it('rejects --min-confidence=bogus (not in the closed value set)', () => {
    const result = parseMigrationArgs(['--min-confidence=bogus']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--min-confidence/);
  });
});
