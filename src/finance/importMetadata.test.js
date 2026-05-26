import { describe, expect, it } from 'vitest';

import { getImportFileLabel } from './importMetadata.js';

describe('import metadata helpers', () => {
  it('formats DATEV import file metadata as a render-safe label', () => {
    expect(getImportFileLabel({ name: 'datev.csv', size: 1200, lastModified: 1778306400000 }))
      .toBe('datev.csv');
    expect(getImportFileLabel('legacy.csv')).toBe('legacy.csv');
    expect(getImportFileLabel(null)).toBe('');
  });
});
