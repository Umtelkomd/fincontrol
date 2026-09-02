/**
 * NEXUS.OS — Table
 *
 * Schema-driven table with Nexus styling baked in.
 *
 * columns: [{ key, label, align?, mono?, width?, render? }]
 *   - render(row, value) → node, optional custom cell
 *   - mono: true → applies font-mono + tabular-nums
 *   - align: 'left' | 'right' | 'center'
 *
 * rows: any[] (each must have a stable .id)
 *
 * Use <Panel> as the wrapper for a titled table.
 */
import { rowButtonProps } from '../../../utils/a11y';

const ALIGN = {
  left:   'text-left',
  right:  'text-right',
  center: 'text-center',
};

const Table = ({
  columns,
  rows,
  empty = null,
  loading = false,
  rowKey = 'id',
  onRowClick,
  className = '',
}) => {
  if (loading) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="label-mono text-[var(--color-fg-3)]">Cargando…</p>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return empty || (
      <div className="px-4 py-12 text-center">
        <p className="label-mono text-[var(--color-fg-3)]">Sin registros</p>
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="nx-table w-full">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={ALIGN[c.align] || ALIGN.left}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              {...(onRowClick ? rowButtonProps(() => onRowClick(row)) : {})}
            >
              {columns.map((c) => {
                const value = row[c.key];
                const content = c.render ? c.render(row, value) : value;
                return (
                  <td
                    key={c.key}
                    className={`${ALIGN[c.align] || ALIGN.left} ${c.mono ? 'mono num' : ''}`}
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Table;
