/**
 * projectMatching — extracted from ProyectoDashboard.jsx so the "which
 * documents belong to this obra" logic is provable without React, and so
 * the legacy-alias fix (below) has a regression test that does not depend
 * on rendering a screen.
 */
import { describe, expect, it } from 'vitest';

import { buildProjectTokens, matchesProject } from './projectMatching.js';

describe('buildProjectTokens', () => {
  it('preserves current behaviour: id, code, name, displayName and the "code (name)" form', () => {
    const project = { id: 'proj-1', code: 'NE4', name: 'Würzburg', displayName: 'NE4 (Würzburg)' };
    const tokens = buildProjectTokens(project);

    expect(tokens).toEqual(
      expect.arrayContaining(['proj-1', 'ne4', 'würzburg', 'ne4 (würzburg)']),
    );
  });

  it('never adds legacy aliases for a project still on its legacy code', () => {
    // `NE4` is itself a legacy alias (→ INS-WRZ-N41) — until the project doc
    // is actually renamed, its own `code` field is not a v2 code, so no
    // LEGACY_PROJECT_CODE_MAP entry's target equals it.
    const project = { id: 'proj-1', code: 'NE4', name: 'Würzburg' };
    const tokens = buildProjectTokens(project);

    expect(tokens).not.toContain('würzwurg');
    expect(tokens).not.toContain('wrz');
    expect(tokens).not.toContain('proy-004');
  });

  it('adds legacyCode and the "legacyCode (name)" form once a project has been renamed', () => {
    const project = { id: 'proj-1', code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' };
    const tokens = buildProjectTokens(project);

    expect(tokens).toEqual(expect.arrayContaining(['qff', 'qff (roßdorf)']));
  });

  it('adds every legacy alias whose target code equals the project current code (the BLOCKER fix)', () => {
    const project = { id: 'proj-1', code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' };
    const tokens = buildProjectTokens(project);

    // All aliases mapped to INS-RSD-BL1 in LEGACY_PROJECT_CODE_MAP.
    expect(tokens).toEqual(expect.arrayContaining(['qff', 'qff-001', 'proy-001', 'rsd', 'roßdorf 1']));
  });

  it('never bleeds an alias belonging to a DIFFERENT project sharing the same legacy prefix', () => {
    // QFF-002 / "Roßdorf 2" map to INS-RSD-BL2 — a sibling project, not this one.
    const project = { id: 'proj-1', code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' };
    const tokens = buildProjectTokens(project);

    expect(tokens).not.toContain('qff-002');
    expect(tokens).not.toContain('roßdorf 2');
  });

  it('handles a null/undefined project without throwing', () => {
    expect(buildProjectTokens(null)).toEqual([]);
    expect(buildProjectTokens(undefined)).toEqual([]);
  });
});

describe('matchesProject', () => {
  const project = { id: 'proj-1', code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' };
  const tokens = buildProjectTokens(project);

  it('matches by direct projectId', () => {
    expect(matchesProject({ projectId: 'proj-1' }, tokens, project.id)).toBe(true);
  });

  it('matches a document still carrying the pre-rename free-text projectName (the BLOCKER fix)', () => {
    expect(matchesProject({ projectId: '', projectName: 'QFF' }, tokens, project.id)).toBe(true);
  });

  it('matches nested raw/rawRecord projectName fields, same as before', () => {
    expect(matchesProject({ raw: { projectName: 'Roßdorf' } }, tokens, project.id)).toBe(true);
    expect(matchesProject({ rawRecord: { project: 'INS-RSD-BL1' } }, tokens, project.id)).toBe(true);
  });

  it('does not match an unrelated project', () => {
    expect(matchesProject({ projectId: '', projectName: 'Otra obra' }, tokens, project.id)).toBe(false);
  });

  it('does not match a sibling project\'s legacy alias', () => {
    expect(matchesProject({ projectId: '', projectName: 'QFF-002' }, tokens, project.id)).toBe(false);
  });
});
