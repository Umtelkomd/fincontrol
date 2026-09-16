// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateDeployReadiness, formatDeployReadinessReport } from './deployReadiness.js';

const MAIN_SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const OTHER_SHA = 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5';

const clean = {
  branch: 'main',
  statusPorcelain: '',
  head: MAIN_SHA,
  originMain: MAIN_SHA,
};

describe('evaluateDeployReadiness', () => {
  it('is ok when main is clean and matches origin/main', () => {
    const result = evaluateDeployReadiness(clean);
    expect(result).toEqual({ ok: true, overridden: false, problems: [] });
  });

  it('flags a feature branch by name', () => {
    const result = evaluateDeployReadiness({ ...clean, branch: 'feat/foo' });
    expect(result.ok).toBe(false);
    expect(result.overridden).toBe(false);
    expect(result.problems).toEqual([
      expect.stringContaining('feat/foo'),
    ]);
  });

  it.each(['HEAD', '', undefined])('flags a detached HEAD (branch=%s)', (branch) => {
    const result = evaluateDeployReadiness({ ...clean, branch });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      expect.stringContaining('detached HEAD'),
    ]);
  });

  it('lists dirty tracked and untracked entries', () => {
    const statusPorcelain = ' M src/App.jsx\n?? scratch.txt';
    const result = evaluateDeployReadiness({ ...clean, statusPorcelain });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('src/App.jsx');
    expect(result.problems[0]).toContain('scratch.txt');
  });

  it('keeps the leading status column of the first porcelain line', () => {
    const result = evaluateDeployReadiness({ ...clean, statusPorcelain: ' M src/App.jsx\n' });
    expect(result.problems[0]).toContain('\n   M src/App.jsx');
  });

  it('treats whitespace-only porcelain output as clean', () => {
    expect(evaluateDeployReadiness({ ...clean, statusPorcelain: '\n  \n' }).ok).toBe(true);
  });

  it('caps the dirty listing at ~10 lines and reports the remainder', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `?? scratch-${i}.txt`);
    const result = evaluateDeployReadiness({ ...clean, statusPorcelain: lines.join('\n') });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    const [problem] = result.problems;
    expect(problem).toContain('scratch-0.txt');
    expect(problem).toContain('scratch-9.txt');
    expect(problem).not.toContain('scratch-10.txt');
    expect(problem).toContain('5 more');
  });

  it('flags HEAD behind/ahead of origin/main with short SHAs', () => {
    const result = evaluateDeployReadiness({ ...clean, head: OTHER_SHA });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain(OTHER_SHA.slice(0, 7));
    expect(result.problems[0]).toContain(MAIN_SHA.slice(0, 7));
    expect(result.problems[0]).toMatch(/pull|push|PR/i);
  });

  it('flags a missing origin/main', () => {
    const result = evaluateDeployReadiness({ ...clean, originMain: undefined });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      expect.stringContaining('origin/main'),
    ]);
  });

  it('fails closed on a fetch error', () => {
    const result = evaluateDeployReadiness({ ...clean, fetchError: new Error('network unreachable') });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      expect.stringContaining('network unreachable'),
    ]);
  });

  it('turns failures into ok+overridden while keeping the problems as warnings', () => {
    const result = evaluateDeployReadiness({ ...clean, branch: 'feat/foo', override: true });
    expect(result.ok).toBe(true);
    expect(result.overridden).toBe(true);
    expect(result.problems).toEqual([
      expect.stringContaining('feat/foo'),
    ]);
  });

  it('does not report an override when there was nothing to override', () => {
    const result = evaluateDeployReadiness({ ...clean, override: true });
    expect(result).toEqual({ ok: true, overridden: false, problems: [] });
  });
});

describe('formatDeployReadinessReport', () => {
  it('renders each problem as a bulleted line', () => {
    expect(formatDeployReadinessReport(['a', 'b'])).toBe('- a\n- b');
  });
});
