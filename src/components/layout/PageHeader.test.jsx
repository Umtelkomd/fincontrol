/**
 * PageHeader — the one page header skeleton.
 *
 * The shell used to render a banner `<h1>` for every route and each screen
 * then added a second heading of its own. This component is the single
 * mandatory header (see .claude/agents/nexus-design.md): one eyebrow, ONE h1,
 * an optional subtitle and a right rail for the primary action.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PageHeader from './PageHeader.jsx';

describe('PageHeader', () => {
  it('renders exactly one h1 carrying the title', () => {
    render(<PageHeader section="Resumen" title="Cómo va la empresa" />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Cómo va la empresa');
  });

  it('prefixes the section eyebrow with the § mark', () => {
    render(<PageHeader section="Bandeja" title="Clasificar movimientos" />);

    expect(screen.getByText('§ Bandeja')).toBeInTheDocument();
  });

  it('renders the accent fragment inside the same h1', () => {
    render(<PageHeader section="Resumen" title="Cómo va la" accent="empresa" />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Cómo va la empresa');
    const em = heading.querySelector('em');
    expect(em).not.toBeNull();
    expect(em).toHaveTextContent('empresa');
    expect(em.className).toContain('not-italic');
  });

  it('renders the subtitle and the actions slot', () => {
    render(
      <PageHeader
        section="Bandeja"
        title="Clasificar"
        subtitle="2026 · 12 pendientes"
        actions={<button type="button">Aplicar reglas</button>}
      />,
    );

    expect(screen.getByText('2026 · 12 pendientes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar reglas' })).toBeInTheDocument();
  });

  it('renders extra children under the subtitle', () => {
    render(
      <PageHeader section="DATEV" title="Importar">
        <p>3 reglas activas</p>
      </PageHeader>,
    );

    expect(screen.getByText('3 reglas activas')).toBeInTheDocument();
  });
});
