import { Filter } from 'lucide-react';
import { PROJECTS } from '../../constants/projects';
import { CATEGORIES } from '../../constants/categories';

const FilterPanel = ({ filters, setFilters, onApply }) => (
 <div className="space-y-4 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-6 ">
 <div className="flex items-center justify-between">
 <h3 className="flex items-center gap-2 text-base font-medium tracking-[-0.02em] text-[var(--color-fg-1)]">
 <Filter size={18} /> Filtros
 </h3>
 <button
 onClick={() => {
 setFilters({
 dateFrom: '',
 dateTo: '',
 project: '',
 category: '',
 type: '',
 status: '',
 quickFilter: 'all'
 });
 onApply();
 }}
 className="text-sm font-medium text-[var(--color-fg-1)]"
 >
 Limpiar filtros
 </button>
 </div>

 {/* Quick Filters */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
 <button
 onClick={() => setFilters(prev => ({ ...prev, quickFilter: 'month' }))}
 className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
 filters.quickFilter === 'month'
 ? 'border-[var(--color-fg-1)] bg-transparent text-[var(--color-fg-1)]'
 : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:bg-transparent'
 }`}
 >
 Este mes
 </button>
 <button
 onClick={() => setFilters(prev => ({ ...prev, quickFilter: 'quarter' }))}
 className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
 filters.quickFilter === 'quarter'
 ? 'border-[var(--color-fg-1)] bg-transparent text-[var(--color-fg-1)]'
 : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:bg-transparent'
 }`}
 >
 Trimestre
 </button>
 <button
 onClick={() => setFilters(prev => ({ ...prev, quickFilter: 'year' }))}
 className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
 filters.quickFilter === 'year'
 ? 'border-[var(--color-fg-1)] bg-transparent text-[var(--color-fg-1)]'
 : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:bg-transparent'
 }`}
 >
 Este año
 </button>
 <button
 onClick={() => setFilters(prev => ({ ...prev, quickFilter: 'all' }))}
 className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
 filters.quickFilter === 'all'
 ? 'border-[var(--color-fg-1)] bg-transparent text-[var(--color-fg-1)]'
 : 'border-[var(--color-line)] text-[var(--color-fg-3)] hover:bg-transparent'
 }`}
 >
 Todo
 </button>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 <div>
 <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Desde</label>
 <input
 type="date"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)] "
 value={filters.dateFrom}
 onChange={e => setFilters({...filters, dateFrom: e.target.value})}
 />
 </div>
 <div>
 <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Hasta</label>
 <input
 type="date"
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)] "
 value={filters.dateTo}
 onChange={e => setFilters({...filters, dateTo: e.target.value})}
 />
 </div>
 <div>
 <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Proyecto</label>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)] "
 value={filters.project}
 onChange={e => setFilters({...filters, project: e.target.value})}
 >
 <option value="">Todos</option>
 {PROJECTS.map(p => <option key={p} value={p}>{p}</option>)}
 </select>
 </div>
 <div>
 <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Categoría</label>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)] "
 value={filters.category}
 onChange={e => setFilters({...filters, category: e.target.value})}
 >
 <option value="">Todas</option>
 {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
 </select>
 </div>
 <div>
 <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Tipo</label>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)] "
 value={filters.type}
 onChange={e => setFilters({...filters, type: e.target.value})}
 >
 <option value="">Todos</option>
 <option value="income">Ingresos</option>
 <option value="expense">Gastos</option>
 </select>
 </div>
 <div>
 <label className="mb-1 block label-mono text-[var(--color-fg-3)]">Estado</label>
 <select
 className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-fg-1)] outline-none focus:border-[var(--color-fg-1)] "
 value={filters.status}
 onChange={e => setFilters({...filters, status: e.target.value})}
 >
 <option value="">Todos</option>
 <option value="paid">Pagados</option>
 <option value="pending">Pendientes</option>
 </select>
 </div>
 </div>

 <button
 onClick={onApply}
 className="w-full rounded-full bg-[var(--color-fg-1)] py-2.5 font-mono text-[13px] uppercase tracking-[0.06em] text-[var(--color-bg-0)] transition hover:opacity-85"
 >
 Aplicar filtros
 </button>
</div>
);

export default FilterPanel;
