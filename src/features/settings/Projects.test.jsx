/**
 * Projects — T7 settings screen additions: the structured project code
 * builder (CLI-SIT-LLn, src/finance/projectCode.js), the "Código heredado"
 * suggestion for a legacy-coded project, and the line/default-cost-center
 * label on the list.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFirebaseMocks, TEST_USER } from '@/test/firebaseMock';
import { projectFixture } from '@/test/fixtures';

const store = installFirebaseMocks({ collections: { projects: [] } });

const firestore = await import('firebase/firestore');
const { default: Projects } = await import('./Projects.jsx');

beforeEach(() => {
  store.collections.projects = [];
  firestore.addDoc.mockClear();
  firestore.updateDoc.mockClear();
});

const openNewProjectModal = () => {
  render(<Projects user={TEST_USER} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nuevo proyecto' }));
};

const fillBuilder = ({ client, site, line, lot }) => {
  if (client !== undefined) fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: client } });
  if (site !== undefined) fireEvent.change(screen.getByLabelText('Sitio'), { target: { value: site } });
  if (line !== undefined) fireEvent.change(screen.getByLabelText('Línea'), { target: { value: line } });
  if (lot !== undefined) fireEvent.change(screen.getByLabelText('Lote'), { target: { value: lot } });
};

describe('Projects — structured code builder (T7)', () => {
  it('shows a live preview once Cliente/Sitio/Línea/Lote are all valid', () => {
    openNewProjectModal();
    fillBuilder({ client: 'INS', site: 'RSD', line: 'BL', lot: '1' });

    expect(screen.getByText('INS-RSD-BL1')).toBeInTheDocument();
  });

  it('shows field errors once the builder has been touched but is incomplete', () => {
    openNewProjectModal();
    fillBuilder({ client: 'IN' }); // only 2 letters — invalid

    expect(screen.getByText('El cliente debe tener exactamente 3 letras (ej. INS)')).toBeInTheDocument();
  });

  it('shows no errors on a freshly opened, untouched builder', () => {
    openNewProjectModal();
    expect(screen.queryByText(/El cliente debe tener/)).not.toBeInTheDocument();
  });

  it('"Usar este código" copies the preview into the raw Código field, and does nothing when the preview is invalid', () => {
    openNewProjectModal();
    const codeInput = screen.getByPlaceholderText('PROY-001');
    expect(screen.getByRole('button', { name: 'Usar este código' })).toBeDisabled();

    fillBuilder({ client: 'INS', site: 'RSD', line: 'BL', lot: '1' });
    fireEvent.click(screen.getByRole('button', { name: 'Usar este código' }));

    expect(codeInput).toHaveValue('INS-RSD-BL1');
  });

  it('prefills Lote via nextLot once Cliente/Sitio/Línea are all set', () => {
    store.collections.projects = [projectFixture({ id: 'p1', code: 'INS-RSD-BL1', name: 'Roßdorf 1' })];
    openNewProjectModal();

    fillBuilder({ client: 'INS', site: 'RSD', line: 'BL' });

    expect(screen.getByLabelText('Lote')).toHaveValue(2);
  });

  it('never overrides a Lote the human already typed', () => {
    openNewProjectModal();
    fillBuilder({ lot: '7' });
    fillBuilder({ client: 'INS', site: 'RSD', line: 'BL' });

    expect(screen.getByLabelText('Lote')).toHaveValue(7);
  });

  it('persists codeClient/site/line/lot alongside code when the project is created', () => {
    openNewProjectModal();
    fireEvent.change(screen.getByPlaceholderText('PROY-001'), { target: { value: 'INS-RSD-BL1' } });
    fireEvent.change(screen.getByPlaceholderText('Nombre del proyecto'), { target: { value: 'Roßdorf 1' } });
    fillBuilder({ client: 'INS', site: 'RSD', line: 'BL', lot: '1' });

    fireEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));

    expect(firestore.addDoc).toHaveBeenCalledTimes(1);
    const [, payload] = firestore.addDoc.mock.calls[0];
    expect(payload).toMatchObject({ code: 'INS-RSD-BL1', codeClient: 'INS', site: 'RSD', line: 'BL', lot: 1 });
  });
});

describe('Projects — legacy code suggestion (T7)', () => {
  const legacyProject = projectFixture({ id: 'p-legacy', code: 'QFF', name: 'Roßdorf legacy' });

  it('shows a "Código heredado" badge and a mapped v2 suggestion for a legacy code', () => {
    store.collections.projects = [legacyProject];
    render(<Projects user={TEST_USER} />);
    fireEvent.click(screen.getByTitle('Editar'));

    expect(screen.getByText('Código heredado')).toBeInTheDocument();
    // QFF resolves to INS-RSD-BL1 per projectCode.js's LEGACY_PROJECT_CODE_MAP.
    expect(screen.getByText('INS-RSD-BL1')).toBeInTheDocument();
  });

  it('"Usar sugerencia" copies the suggestion into the builder without touching the raw Código field or saving', () => {
    store.collections.projects = [legacyProject];
    render(<Projects user={TEST_USER} />);
    fireEvent.click(screen.getByTitle('Editar'));
    const codeInput = screen.getByPlaceholderText('PROY-001');

    fireEvent.click(screen.getByRole('button', { name: 'Usar sugerencia' }));

    expect(screen.getByLabelText('Cliente')).toHaveValue('INS');
    expect(screen.getByLabelText('Sitio')).toHaveValue('RSD');
    expect(screen.getByLabelText('Línea')).toHaveValue('BL');
    expect(codeInput).toHaveValue('QFF'); // raw code untouched — suggestion only
    expect(firestore.updateDoc).not.toHaveBeenCalled();
  });

  it('keeps the raw code editable for a legacy project', () => {
    store.collections.projects = [legacyProject];
    render(<Projects user={TEST_USER} />);
    fireEvent.click(screen.getByTitle('Editar'));

    expect(screen.getByPlaceholderText('PROY-001')).not.toBeDisabled();
  });

  it('shows no legacy badge for a project whose code is already structured', () => {
    store.collections.projects = [projectFixture({ id: 'p-v2', code: 'INS-RSD-BL1', name: 'Roßdorf 1' })];
    render(<Projects user={TEST_USER} />);
    fireEvent.click(screen.getByTitle('Editar'));

    expect(screen.queryByText('Código heredado')).not.toBeInTheDocument();
  });
});

describe('Projects — list shows line and default cost center (T7)', () => {
  it('shows the line label and default cost center for a structured project', () => {
    store.collections.projects = [projectFixture({ id: 'p1', code: 'INS-RSD-BL1', name: 'Roßdorf 1' })];
    render(<Projects user={TEST_USER} />);

    // BL ⇒ "Soplado y fusiones" line, default center CC-110.
    expect(screen.getByText('Soplado y fusiones · CC CC-110')).toBeInTheDocument();
  });

  it('shows nothing extra for a project whose code resolves to no known line', () => {
    store.collections.projects = [projectFixture({ id: 'p1', code: 'ZZZ-UNKNOWN', name: 'Unmapped' })];
    render(<Projects user={TEST_USER} />);

    expect(screen.queryByText(/· CC /)).not.toBeInTheDocument();
  });
});

/**
 * A rename is the only place the OLD code can still be captured: every
 * document written before it keeps that code as free text, and
 * `buildProjectTokens` (src/finance/projectMatching.js) reads `legacyCode` to
 * keep matching them. Without the stamp a hand rename silently orphans them.
 */
describe('Projects — a rename records the previous code as legacyCode', () => {
  const openEditFor = (project) => {
    store.collections.projects = [project];
    render(<Projects user={TEST_USER} />);
    fireEvent.click(screen.getByTitle('Editar'));
  };

  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

  const savedPayload = () => firestore.updateDoc.mock.calls.at(-1)[1];

  it('stamps the previous code when the code changes', () => {
    openEditFor(projectFixture({ id: 'p-legacy', code: 'QFF', name: 'Roßdorf' }));

    fireEvent.change(screen.getByPlaceholderText('PROY-001'), { target: { value: 'INS-RSD-BL1' } });
    save();

    expect(savedPayload()).toMatchObject({ code: 'INS-RSD-BL1', legacyCode: 'QFF' });
  });

  it('never overwrites a legacyCode already on the doc — the first original is the one documents carry', () => {
    openEditFor(projectFixture({ id: 'p-renamed', code: 'INS-RSD-BL1', name: 'Roßdorf', legacyCode: 'QFF' }));

    fireEvent.change(screen.getByPlaceholderText('PROY-001'), { target: { value: 'INS-RSD-BL2' } });
    save();

    expect(savedPayload().code).toBe('INS-RSD-BL2');
    expect(savedPayload().legacyCode).toBeUndefined();
  });

  it('stamps nothing when the code is untouched', () => {
    openEditFor(projectFixture({ id: 'p-legacy', code: 'QFF', name: 'Roßdorf' }));

    fireEvent.change(screen.getByPlaceholderText('Nombre del proyecto'), { target: { value: 'Roßdorf 1' } });
    save();

    expect(savedPayload().legacyCode).toBeUndefined();
  });

  it('stamps nothing on a newly created project — it has no previous code', () => {
    openNewProjectModal();
    fireEvent.change(screen.getByPlaceholderText('PROY-001'), { target: { value: 'INS-RSD-BL1' } });
    fireEvent.change(screen.getByPlaceholderText('Nombre del proyecto'), { target: { value: 'Roßdorf' } });

    fireEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));

    expect(firestore.addDoc.mock.calls.at(-1)[1].legacyCode).toBeUndefined();
  });
});

/**
 * Renaming ONE project of a merge group by hand, while its siblings are still
 * live, is what splits an obra's old documents between two projects — the
 * migration exists to merge them first. The form says so; it does not block,
 * because the owner may well be renaming the survivor on purpose.
 */
describe('Projects — merge-group rename warning', () => {
  const MERGE_WARNING = /Otro proyecto activo \(QFF-002\) corresponde al mismo código/;

  const renderWith = (projects) => {
    store.collections.projects = projects;
    render(<Projects user={TEST_USER} />);
  };

  const rossdorf1 = (overrides = {}) => projectFixture({ id: 'p-1', code: 'QFF', name: 'Roßdorf 1', ...overrides });
  const rossdorf2 = (overrides = {}) => projectFixture({ id: 'p-2', code: 'QFF-002', name: 'Roßdorf 2', ...overrides });

  it('warns when the structured code being saved is a merge target another live project resolves to', () => {
    renderWith([rossdorf1(), rossdorf2()]);
    fireEvent.click(screen.getAllByTitle('Editar')[0]);

    fireEvent.change(screen.getByPlaceholderText('PROY-001'), { target: { value: 'INS-RSD-BL1' } });

    expect(screen.getByText(MERGE_WARNING)).toBeInTheDocument();
    expect(screen.getByText(/Fusiona los proyectos con la migración antes de renombrar/)).toBeInTheDocument();
  });

  it('warns without blocking — the save still goes through', () => {
    renderWith([rossdorf1(), rossdorf2()]);
    fireEvent.click(screen.getAllByTitle('Editar')[0]);

    fireEvent.change(screen.getByPlaceholderText('PROY-001'), { target: { value: 'INS-RSD-BL1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(firestore.updateDoc).toHaveBeenCalled();
    expect(firestore.updateDoc.mock.calls.at(-1)[1]).toMatchObject({ code: 'INS-RSD-BL1' });
  });

  it('stays quiet once the sibling is inactive or already merged — the post-migration state', () => {
    renderWith([rossdorf1(), rossdorf2({ status: 'inactive', active: false, mergedInto: 'p-1' })]);
    fireEvent.click(screen.getAllByTitle('Editar')[0]);

    fireEvent.change(screen.getByPlaceholderText('PROY-001'), { target: { value: 'INS-RSD-BL1' } });

    expect(screen.queryByText(/corresponde al mismo código/)).not.toBeInTheDocument();
  });

  it('stays quiet for a code no other live project resolves to', () => {
    renderWith([projectFixture({ id: 'p-1', code: 'QDU', name: 'Otra obra' })]);
    fireEvent.click(screen.getByTitle('Editar'));

    fireEvent.change(screen.getByPlaceholderText('PROY-001'), { target: { value: 'INS-MSD-TB1' } });

    expect(screen.queryByText(/corresponde al mismo código/)).not.toBeInTheDocument();
  });

  it('stays quiet for a structured code outside any merge group', () => {
    // WSC-GEN-N41 and WSC-GEN-MD1 are different obras, so their entries carry
    // no `merge` flag — two live projects there are a real collision, not this
    // warning's case.
    renderWith([
      projectFixture({ id: 'p-1', code: 'WSC', name: 'Wesconnect' }),
      projectFixture({ id: 'p-2', code: 'WESTC_MDU', name: 'MDU Oeste' }),
    ]);
    fireEvent.click(screen.getAllByTitle('Editar')[1]);

    fireEvent.change(screen.getByPlaceholderText('PROY-001'), { target: { value: 'WSC-GEN-MD1' } });

    expect(screen.queryByText(/corresponde al mismo código/)).not.toBeInTheDocument();
  });
});

describe('Projects — merged-loser note (T11: owner decision 2026-09-18)', () => {
  it('shows a muted "Fusionado en <code>" note for a project carrying mergedInto', () => {
    store.collections.projects = [
      projectFixture({ id: 'p-survivor', code: 'INS-RSD-BL1', name: 'Roßdorf', status: 'active' }),
      projectFixture({
        id: 'p-loser',
        code: 'QFF-002',
        name: 'Roßdorf 2',
        status: 'inactive',
        active: false,
        mergedInto: 'p-survivor',
        mergedIntoCode: 'INS-RSD-BL1',
      }),
    ];
    render(<Projects user={TEST_USER} />);

    expect(screen.getByText('Fusionado en INS-RSD-BL1')).toBeInTheDocument();
  });

  it('shows no merged note for an ordinary inactive project (never merged)', () => {
    store.collections.projects = [projectFixture({ id: 'p1', code: 'QDU', name: 'Otro', status: 'inactive' })];
    render(<Projects user={TEST_USER} />);

    expect(screen.queryByText(/Fusionado en/)).not.toBeInTheDocument();
  });

  it('a merged loser stays out of the "Activos" list — it already renders under "Inactivo" (status !== \'active\')', () => {
    store.collections.projects = [
      projectFixture({ id: 'p-survivor', code: 'INS-RSD-BL1', name: 'Roßdorf', status: 'active' }),
      projectFixture({
        id: 'p-loser',
        code: 'QFF-002',
        name: 'Roßdorf 2',
        status: 'inactive',
        active: false,
        mergedInto: 'p-survivor',
        mergedIntoCode: 'INS-RSD-BL1',
      }),
    ];
    render(<Projects user={TEST_USER} />);

    const loserRow = screen.getByText('QFF-002').closest('tr');
    expect(loserRow).toHaveTextContent('Inactivo');
    expect(loserRow).toHaveTextContent('Fusionado en INS-RSD-BL1');
  });
});
