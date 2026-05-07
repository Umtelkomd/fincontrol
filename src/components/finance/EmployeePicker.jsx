import { useState, useRef, useEffect, useMemo } from 'react';
import { X, HardHat, Loader2 } from 'lucide-react';
import { useEmployees } from '../../hooks/useEmployees';

/**
 * EmployeePicker — reusable multi-select typeahead for employees.
 *
 * Controlled component:
 *   value:    string[]   array of employee doc ids currently selected
 *   onChange: (ids[])    called whenever the selection changes
 *
 * Behavior:
 *   - Shows selected employees as removable chips above the input
 *   - Typing filters active employees by fullName / firstName / lastName / aliases
 *   - Click suggestion or Enter to add; Backspace on empty input removes the last chip
 *   - Filters out already-selected employees from the suggestions
 *   - Shows a graceful empty-state when no active employees exist
 *
 * Used by FinanceActionLauncher (CXP, payment, bank-adjustment forms) and
 * could be reused by any future form that needs to tag employees on a record.
 */
const EmployeePicker = ({ value = [], onChange, user, label = 'Técnicos / Empleados', helpText = '(opcional — uno o varios)' }) => {
  const { employees, loading } = useEmployees(user);
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);

  const activeEmployees = useMemo(() => employees.filter((e) => e.status === 'active'), [employees]);

  const employeeById = useMemo(() => {
    const map = new Map();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q || q.length < 1) return [];
    return activeEmployees
      .filter((e) => !value.includes(e.id))
      .filter((e) => {
        if (e.fullName?.toLowerCase().includes(q)) return true;
        if (e.firstName?.toLowerCase().includes(q)) return true;
        if (e.lastName?.toLowerCase().includes(q)) return true;
        return (e.aliases || []).some((a) => a.toLowerCase().includes(q));
      })
      .slice(0, 8);
  }, [input, activeEmployees, value]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addEmployee = (employee) => {
    if (value.includes(employee.id)) return;
    onChange([...value, employee.id]);
    setInput('');
    setShowSuggestions(false);
    setActiveIndex(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const removeEmployee = (employeeId) => {
    onChange(value.filter((id) => id !== employeeId));
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) {
      // Backspace on empty input → remove last selected chip
      if (e.key === 'Backspace' && !input && value.length > 0) {
        removeEmployee(value[value.length - 1]);
      }
      return;
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      addEmployee(suggestions[activeIndex]);
    }
  };

  return (
    <div className="relative">
      <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-fg-4)]">
        <HardHat size={14} className="text-[var(--color-fg-3)]" />
        {label}
        {helpText && <span className="text-xs font-normal text-[var(--color-fg-3)]">{helpText}</span>}
      </label>

      {/* Selected chips */}
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((id) => {
            const emp = employeeById.get(id);
            const label = emp?.fullName || `(empleado ${id.slice(0, 6)} eliminado)`;
            const isOrphan = !emp;
            return (
              <span
                key={id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                  isOrphan
                    ? 'border-[var(--color-warn)] text-[var(--color-warn)]'
                    : 'border-[var(--color-line-s)] bg-[var(--color-bg-2)] text-[var(--color-fg-1)]'
                }`}
              >
                {!isOrphan && <HardHat size={11} />}
                {label}
                {emp?.role && <span className="text-[var(--color-fg-3)]">· {emp.role}</span>}
                <button
                  type="button"
                  onClick={() => removeEmployee(id)}
                  className="ml-0.5 rounded-full p-0.5 text-[var(--color-fg-3)] transition hover:text-[var(--color-accent)]"
                  aria-label={`Quitar ${label}`}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-3)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando empleados...
        </div>
      ) : activeEmployees.length === 0 ? (
        <div className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-xs text-[var(--color-fg-3)]">
          Aún no hay empleados activos. Crea uno en /empleados para poder asociarlo.
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          placeholder="Buscar técnico por nombre o alias..."
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-sm text-[var(--color-fg-1)] outline-none transition focus:border-[var(--color-fg-1)]"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(e.target.value.trim().length >= 1);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => input.trim().length >= 1 && setShowSuggestions(true)}
          autoComplete="off"
        />
      )}

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute left-0 right-0 z-[300] mt-1 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)]"
          style={{ boxShadow: 'none' }}
        >
          {suggestions.map((emp, idx) => (
            <button
              key={emp.id}
              type="button"
              onClick={() => addEmployee(emp)}
              className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                idx === activeIndex ? 'bg-transparent' : 'hover:bg-[var(--color-bg-1)]'
              } ${idx > 0 ? 'border-t border-[var(--color-bg-1)]' : ''}`}
            >
              <div className="flex items-center gap-2">
                <HardHat size={12} className="text-[var(--color-fg-3)]" />
                <span className="font-medium text-[var(--color-fg-1)]">{emp.fullName}</span>
                <span className="text-[10px] uppercase tracking-wide text-[var(--color-fg-3)]">
                  {emp.type === 'external' ? 'Externo' : 'Interno'}
                </span>
                {emp.role && <span className="text-xs text-[var(--color-fg-3)]">· {emp.role}</span>}
              </div>
              {emp.aliases && emp.aliases.length > 0 && (
                <p className="ml-5 text-[10px] text-[var(--color-fg-3)]">
                  alias: {emp.aliases.slice(0, 3).join(', ')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EmployeePicker;
