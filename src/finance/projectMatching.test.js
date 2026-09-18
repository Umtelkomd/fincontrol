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

  it('includes QFF-002 and "Roßdorf 2" now that Roßdorf 1/2 are ONE merged project (owner decision 2026-09-18, T11)', () => {
    // The old assertion here ("QFF-002 must NOT bleed into this project") is
    // inverted by the owner's merge decision: QFF-002 / "Roßdorf 2" are now
    // aliases of this SAME project, not a sibling's — see the merge group in
    // LEGACY_PROJECT_CODE_MAP (projectCode.js).
    const project = { id: 'proj-1', code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' };
    const tokens = buildProjectTokens(project);

    expect(tokens).toEqual(expect.arrayContaining(['qff-002', 'roßdorf 2']));
  });

  it('never bleeds an alias belonging to a genuinely different project (WSC-GEN-MD1 vs WSC-GEN-N41 — not a merge group)', () => {
    const project = { id: 'proj-mdu', code: 'WSC-GEN-MD1', name: 'MDU Oeste', legacyCode: 'WESTC_MDU' };
    const tokens = buildProjectTokens(project);

    // WSC / WEST-001 / Wesconnect / "NE4 West-connect" map to the sibling
    // WSC-GEN-N41, not to this MDU-line project.
    expect(tokens).not.toContain('wsc');
    expect(tokens).not.toContain('west-001');
    expect(tokens).not.toContain('wesconnect');
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

  it('matches QFF-002 now that Roßdorf 1/2 are ONE merged project (owner decision 2026-09-18, T11)', () => {
    // Inverted: this alias used to belong to a sibling project (the second
    // Roßdorf site's own former code), which no longer exists — QFF-002 is
    // this SAME project's own alias now.
    expect(matchesProject({ projectId: '', projectName: 'QFF-002' }, tokens, project.id)).toBe(true);
  });

  it('does not match a genuinely different project\'s legacy alias (WSC-GEN-MD1 vs WSC-GEN-N41 — not a merge group)', () => {
    const mduProject = { id: 'proj-mdu', code: 'WSC-GEN-MD1', name: 'MDU Oeste', legacyCode: 'WESTC_MDU' };
    const mduTokens = buildProjectTokens(mduProject);

    expect(matchesProject({ projectId: '', projectName: 'WSC' }, mduTokens, mduProject.id)).toBe(false);
    expect(matchesProject({ projectId: '', projectName: 'Wesconnect' }, mduTokens, mduProject.id)).toBe(false);
  });
});
