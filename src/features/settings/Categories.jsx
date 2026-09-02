import React from 'react';
import { Loader2 } from 'lucide-react';
import { useCategories } from '../../hooks/useCategories';
import { TAXONOMY_VERSION } from '../../finance/taxonomy';

const TYPE_LABEL = { income: 'ingreso', expense: 'gasto', internal: 'interno' };
const TYPE_TONE = {
  income: 'text-[var(--color-ok)] border-[var(--color-ok)]',
  expense: 'text-[var(--color-fg-3)] border-[var(--color-line-s)]',
  internal: 'text-[var(--color-fg-4)] border-[var(--color-line-s)]',
};
const SCOPE_LABEL = { overhead: 'estructura', project: 'obra' };

/**
 * Configuración → Categorías: a read-only view of the versioned taxonomy.
 *
 * Free-form add/edit/delete is what produced the duplicates ("Cuotas
 * vehiculos" / "Alquiler vehiculo" / "Vehiculos"), so the catalogue is
 * versioned and lives in `src/finance/taxonomy.js`.
 */
const Categories = ({ user }) => {
  const { taxonomy, groups, loading } = useCategories(user);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-[var(--color-accent)] animate-spin" />
        <span className="ml-3 text-[var(--color-fg-3)]">Cargando categorías…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-6 py-5">
        <p className="label-mono text-[var(--color-fg-1)]">Configuración financiera</p>
        <h2 className="mt-2 font-display text-[24px] font-light tracking-[-0.03em] text-[var(--color-fg-1)]">Categorías</h2>
        <p className="mt-1 text-sm text-[var(--color-fg-3)]">
          Catálogo versionado (v{TAXONOMY_VERSION}): {taxonomy.length} categorías en {groups.length} grupos. Los cambios se hacen en la
          taxonomía, no aquí — la edición libre es la que generó los duplicados.
        </p>
      </div>

      {groups.map((group) => {
        const rows = taxonomy.filter((category) => category.group === group.id);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} className="rounded-md border border-[var(--color-line-s)] bg-[var(--color-bg-1)] p-6">
            <div className="mb-4 flex items-baseline justify-between">
              <h3 className="font-display text-base font-medium tracking-[-0.02em] text-[var(--color-fg-1)]">{group.label}</h3>
              <span className="label-mono text-[var(--color-fg-4)]">
                {rows.length} {rows.length === 1 ? 'categoría' : 'categorías'}
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {rows.map((category) => (
                <li
                  key={category.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-line-s)] bg-transparent px-3 py-3"
                >
                  <span className="text-sm font-medium text-[var(--color-fg-1)]">{category.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {category.defaultScope && (
                      <span className="label-mono text-[var(--color-fg-4)]" title="Destino por defecto del gasto">
                        {SCOPE_LABEL[category.defaultScope]}
                      </span>
                    )}
                    <span className={`rounded-sm border px-1.5 py-0.5 label-mono ${TYPE_TONE[category.type]}`}>
                      {TYPE_LABEL[category.type]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};

export default Categories;
