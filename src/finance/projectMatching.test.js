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

/**
 * A merge group's aliases ("QFF-002", "Roßdorf 2") only belong to the project
 * renamed to the group's v2 code AFTER the merge actually happened. Before it,
 * the second Roßdorf project is still a separate live doc holding those very
 * values as its OWN code/name — handing them to the renamed sibling as tokens
 * makes one payable appear under both obras at once, which a single rename
 * click in the Proyectos screen is enough to reach.
 *
 * So `liveProjects` (the project list the caller already has) lets the builder
 * see that conflict. Omitting it keeps the pre-existing output, which is what
 * a caller without a list gets.
 */
describe('buildProjectTokens — an alias never captures a LIVE sibling own identity', () => {
  const survivor = { id: 'p-rsd-1', code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' };
  const sibling = (overrides = {}) => ({ id: 'p-rsd-2', code: 'QFF-002', name: 'Roßdorf 2', status: 'active', ...overrides });

  it('keeps the pre-existing output when no project list is supplied', () => {
    expect(buildProjectTokens(survivor)).toEqual(buildProjectTokens(survivor, {}));
    expect(buildProjectTokens(survivor)).toEqual(
      expect.arrayContaining(['qff', 'qff-001', 'qff-002', 'proy-001', 'rsd', 'roßdorf 1', 'roßdorf 2']),
    );
  });

  it('drops the aliases a live sibling answers to by its own code and name', () => {
    const tokens = buildProjectTokens(survivor, { liveProjects: [survivor, sibling()] });

    expect(tokens).not.toContain('qff-002');
    expect(tokens).not.toContain('roßdorf 2');
    // Everything that is NOT the sibling's own identity still belongs here —
    // a document stored as "QFF" or "Roßdorf 1" is this project's.
    expect(tokens).toEqual(expect.arrayContaining(['qff', 'qff-001', 'proy-001', 'rsd', 'roßdorf 1']));
  });

  it('never drops the project OWN code, name, displayName or legacyCode', () => {
    const tokens = buildProjectTokens(
      { ...survivor, displayName: 'INS-RSD-BL1 (Roßdorf)' },
      { liveProjects: [survivor, sibling()] },
    );

    expect(tokens).toEqual(
      expect.arrayContaining(['p-rsd-1', 'ins-rsd-bl1', 'roßdorf', 'ins-rsd-bl1 (roßdorf)', 'qff']),
    );
  });

  it('admits the aliases again once the sibling is inactive — the post-merge state', () => {
    const tokens = buildProjectTokens(survivor, {
      liveProjects: [survivor, sibling({ status: 'inactive', active: false })],
    });

    expect(tokens).toEqual(expect.arrayContaining(['qff-002', 'roßdorf 2']));
  });

  it('admits the aliases again once the sibling carries mergedInto, even if still flagged active', () => {
    const tokens = buildProjectTokens(survivor, {
      liveProjects: [survivor, sibling({ mergedInto: 'p-rsd-1', mergedIntoCode: 'INS-RSD-BL1' })],
    });

    expect(tokens).toEqual(expect.arrayContaining(['qff-002', 'roßdorf 2']));
  });

  it('treats active:false as not live even when status still says active', () => {
    const tokens = buildProjectTokens(survivor, { liveProjects: [survivor, sibling({ active: false })] });

    expect(tokens).toEqual(expect.arrayContaining(['qff-002', 'roßdorf 2']));
  });

  it('compares accent-insensitively, so an unaccented sibling name still claims its alias', () => {
    // "Höxter Nord" is an alias of INS-HXT-TB1; the live sibling holding that
    // site stores it without the umlaut.
    const hoexter = { id: 'p-hxt-1', code: 'INS-HXT-TB1', name: 'Höxter', legacyCode: 'FBX' };
    const tokens = buildProjectTokens(hoexter, {
      liveProjects: [hoexter, { id: 'p-hxt-2', code: 'HXT', name: 'Hoxter Nord', status: 'active' }],
    });

    expect(tokens).not.toContain('höxter nord');
    expect(tokens).not.toContain('hxt');
    expect(tokens).toEqual(expect.arrayContaining(['fbx', 'proy-003']));
  });

  it('claims an alias through a sibling displayName alone, for a doc that carries no code or name', () => {
    const tokens = buildProjectTokens(survivor, {
      liveProjects: [survivor, { id: 'p-rsd-2', displayName: 'Roßdorf 2', status: 'active' }],
    });

    expect(tokens).not.toContain('roßdorf 2');
    expect(tokens).toContain('qff-002');
  });

  it('claims an alias through a sibling legacyCode', () => {
    const tokens = buildProjectTokens(survivor, {
      liveProjects: [survivor, { id: 'p-rsd-2', code: 'ZZZ-OTRO', name: 'Otra obra', legacyCode: 'QFF-001', status: 'active' }],
    });

    expect(tokens).not.toContain('qff-001');
    expect(tokens).toContain('qff-002');
  });

  it('ignores the project own entry in the list, matched by identity or by id', () => {
    const byIdentity = buildProjectTokens(survivor, { liveProjects: [survivor] });
    const byId = buildProjectTokens(survivor, { liveProjects: [{ ...survivor }] });

    expect(byIdentity).toEqual(buildProjectTokens(survivor));
    expect(byId).toEqual(buildProjectTokens(survivor));
  });

  it('tolerates a list holding null/undefined entries', () => {
    const tokens = buildProjectTokens(survivor, { liveProjects: [null, undefined, sibling()] });

    expect(tokens).not.toContain('qff-002');
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
