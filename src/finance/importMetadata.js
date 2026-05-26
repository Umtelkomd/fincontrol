export const getImportFileLabel = (importFile) => {
  if (!importFile) return '';
  if (typeof importFile === 'string') return importFile;
  if (typeof importFile === 'object') {
    return importFile.name || '';
  }
  return String(importFile);
};
