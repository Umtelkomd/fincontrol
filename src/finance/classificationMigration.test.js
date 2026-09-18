/**
 * Pure planner behind scripts/migrate-classification-catalog.cjs — proves
 * the resolution/rename logic before it is ever pointed at real Firestore
 * data. The script itself stays an untested, thin I/O shell around this.
 */
import { describe, expect, it } from 'vitest';

import { COST_CENTER_CATALOG } from './costCenterCatalog.js';
import {
  planCostCenterMigration,
  planProjectCodeMigration,
  planProjectNameRefresh,
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
    const plan = planCostCenterMigration({
      costCenters: [doc('legacyDoc2', { code: 'CC-006', name: 'OPE' })],
      documentsByCollection: {},
    });
    expect(plan.retire).toEqual([]);
    expect(plan.unresolved).toContainEqual({ collection: 'costCenters', id: 'legacyDoc2', value: 'CC-006' });
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
  });

  it('never touches a project already on a structured v2 code', () => {
    const plan = planProjectCodeMigration({ projects: [doc('proj-1', { code: 'INS-RSD-BL1', name: 'Roßdorf' })] });
    expect(plan.renames).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips a medium-confidence mapping under the default high threshold, and includes it once the threshold is lowered', () => {
    const projects = [doc('proj-2', { code: 'NE4', name: 'Würzburg' })];
    const skippedPlan = planProjectCodeMigration({ projects });
    expect(skippedPlan.renames).toEqual([]);
    expect(skippedPlan.skipped).toEqual([{ id: 'proj-2', code: 'NE4', reason: 'below-min-confidence', confidence: 'medium' }]);

    const includedPlan = planProjectCodeMigration({ projects, minConfidence: 'medium' });
    expect(includedPlan.renames).toHaveLength(1);
    expect(includedPlan.renames[0]).toMatchObject({ to: 'INS-WRZ-N41', confidence: 'medium' });
  });

  it('reports a legacy code nobody has mapped, never guessing a target', () => {
    const plan = planProjectCodeMigration({ projects: [doc('proj-3', { code: 'QDU', name: 'QDU' })] });
    expect(plan.renames).toEqual([]);
    expect(plan.skipped).toEqual([{ id: 'proj-3', code: 'QDU', reason: 'unmapped', confidence: null }]);
  });

  it('never renames either side of a collision: two projects resolving to the same target', () => {
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
