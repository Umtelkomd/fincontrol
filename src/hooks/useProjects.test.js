/**
 * useProjects.createProject — duplicate detection. One obra may be spelled
 * several ways (`QFF`, `QFF-002`, `RSD`, `INS-RSD-BL1`), so comparing the
 * canonical STORAGE code caught only identical spellings: creating `RSD` next
 * to a live `QFF` produced a second project for the same Roßdorf obra, and
 * every document then had two places to belong to. The obra key is what
 * decides, and the message names the project already holding it.
 *
 * Needs the Firestore module double (installFirebaseMocks), like the other
 * hook tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';
import { projectFixture } from '@/test/fixtures';

const store = installFirebaseMocks({ collections: { projects: [] } });

const firestore = await import('firebase/firestore');
const { useProjects } = await import('./useProjects.js');

const mount = async () => {
  const { result } = renderHook(() => useProjects(TEST_USER));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

beforeEach(() => {
  store.collections.projects = [];
  firestore.addDoc.mockClear();
});

describe('createProject — one project per obra', () => {
  it('creates a project whose obra no live project holds yet', async () => {
    store.collections.projects = [projectFixture({ id: 'p-qdu', code: 'QDU', name: 'Otra obra' })];
    const result = await mount();

    const response = await result.current.createProject({ code: 'QFF', name: 'Roßdorf 1' });

    expect(response).toEqual({ success: true });
    expect(firestore.addDoc).toHaveBeenCalledTimes(1);
  });

  it('rejects a different spelling of an obra a live project already holds, naming that project', async () => {
    store.collections.projects = [projectFixture({ id: 'p-qff', code: 'QFF', name: 'Roßdorf 1' })];
    const result = await mount();

    const response = await result.current.createProject({ code: 'RSD', name: 'Roßdorf otra vez' });

    expect(response.success).toBe(false);
    expect(response.error.message).toBe('Ya existe un proyecto para esa obra: QFF');
    expect(firestore.addDoc).not.toHaveBeenCalled();
  });

  it('rejects the structured code of an obra a live LEGACY project already holds', async () => {
    store.collections.projects = [projectFixture({ id: 'p-qff', code: 'QFF', name: 'Roßdorf 1' })];
    const result = await mount();

    const response = await result.current.createProject({ code: 'INS-RSD-BL1', name: 'Roßdorf' });

    expect(response.success).toBe(false);
    expect(response.error.message).toBe('Ya existe un proyecto para esa obra: QFF');
  });

  it('rejects the legacy code of an obra a live RENAMED project already holds', async () => {
    store.collections.projects = [projectFixture({ id: 'p-rsd', code: 'INS-RSD-BL1', name: 'Roßdorf' })];
    const result = await mount();

    const response = await result.current.createProject({ code: 'QFF-002', name: 'Roßdorf 2' });

    expect(response.success).toBe(false);
    expect(response.error.message).toBe('Ya existe un proyecto para esa obra: INS-RSD-BL1');
  });

  it.each([
    ['inactive', { status: 'inactive' }],
    ['deactivated by the active flag', { active: false }],
    ['already merged into another project', { mergedInto: 'p-survivor' }],
  ])('allows the obra again once the existing project is %s', async (_label, overrides) => {
    store.collections.projects = [projectFixture({ id: 'p-qff', code: 'QFF', name: 'Roßdorf 1', ...overrides })];
    const result = await mount();

    const response = await result.current.createProject({ code: 'INS-RSD-BL1', name: 'Roßdorf' });

    expect(response).toEqual({ success: true });
    expect(firestore.addDoc).toHaveBeenCalledTimes(1);
  });

  it('still refuses a payload with no canonical code at all', async () => {
    const result = await mount();

    const response = await result.current.createProject({ code: '', name: '' });

    expect(response.success).toBe(false);
    expect(response.error.message).toMatch(/code canónico requerido/);
    expect(firestore.addDoc).not.toHaveBeenCalled();
  });
});
