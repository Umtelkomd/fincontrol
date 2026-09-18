import { describe, expect, it } from 'vitest';
import { defaultCostCenterFor } from './classificationDefaults.js';

describe('defaultCostCenterFor', () => {
  it('defaults to the project line center when a project is given', () => {
    expect(defaultCostCenterFor({ projectId: 'proj-1', project: { id: 'proj-1', code: 'INS-RSD-BL1' } })).toBe('CC-110');
  });

  it('resolves the project line default from a bare projectId when no project doc is given', () => {
    // No `project` passed — defaultCostCenterForProject falls back to { id: projectId },
    // which carries no code/name, so this resolves to '' (never a guess).
    expect(defaultCostCenterFor({ projectId: 'proj-1' })).toBe('');
  });

  it('defaults to the category indirect center when there is no project', () => {
    expect(defaultCostCenterFor({ categoryName: 'Combustible' })).toBe('CC-200');
  });

  it('a project takes precedence over a category when both are given', () => {
    expect(
      defaultCostCenterFor({ projectId: 'proj-1', project: { id: 'proj-1', code: 'INS-RSD-BL1' }, categoryName: 'Combustible' }),
    ).toBe('CC-110');
  });

  it('returns "" when neither a project nor a resolvable category is given', () => {
    expect(defaultCostCenterFor({})).toBe('');
    expect(defaultCostCenterFor()).toBe('');
  });

  it('returns "" for a category with no indirect default (materiales always requires a project)', () => {
    expect(defaultCostCenterFor({ categoryName: 'Materiales' })).toBe('');
  });
});
