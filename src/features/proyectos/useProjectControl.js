import { useMemo, useState } from 'react';
import { useFinanceLedger } from '../../hooks/useFinanceLedger';
import { useEmployees } from '../../hooks/useEmployees';
import { useProjects } from '../../hooks/useProjects';
import { usePayrollPeriods } from '../nominas/usePayrollPeriods';
import { allocatePayrollCost } from '../nominas/lib/payrollAllocation';
import { useOverheadConfig } from './useOverheadConfig';
import {
  buildProjectActuals,
  buildOverheadPool,
  buildOverheadComposition,
  allocateOverhead,
  computeUnallocatedLabor,
  buildControlRows,
  computePortfolioSummary,
} from './lib/projectControl';

const yearOf = (iso) => (iso ? String(iso).slice(0, 4) : '');

/**
 * useProjectControl — composition hook for the "Control de Proyectos" view.
 *
 * Wires the finance ledger, payroll allocation and the project catalog into
 * the pure projectControl engine. The route is admin-gated (permission
 * 'budget'), so payroll is computed unconditionally — unlike Resumen, there is
 * no lower-privilege audience to degrade for.
 *
 * periodFilter: 'all' (default) or a year string ('2026'). A year filters
 * movements by posted date, receivables/payables by issue date and payroll
 * periods by their 'YYYY-MM' key.
 */
export const useProjectControl = (user) => {
  const ledger = useFinanceLedger(user);
  const { periods } = usePayrollPeriods(user);
  const { employees } = useEmployees(user);
  const { projects, updateProject } = useProjects(user);
  const { overheadBasis, setOverheadBasis, loading: configLoading } = useOverheadConfig(user);

  const [periodFilter, setPeriodFilter] = useState('all');

  const availableYears = useMemo(() => {
    const years = new Set();
    (ledger.postedMovements || []).forEach((entry) => {
      const year = yearOf(entry.postedDate);
      if (year) years.add(year);
    });
    (ledger.receivables || []).forEach((entry) => {
      const year = yearOf(entry.issueDate);
      if (year) years.add(year);
    });
    (ledger.payables || []).forEach((entry) => {
      const year = yearOf(entry.issueDate);
      if (year) years.add(year);
    });
    (periods || []).forEach((period) => {
      const year = yearOf(period.period);
      if (year) years.add(year);
    });
    return Array.from(years).sort((left, right) => right.localeCompare(left));
  }, [ledger.postedMovements, ledger.receivables, ledger.payables, periods]);

  const filtered = useMemo(() => {
    if (periodFilter === 'all') {
      return {
        movements: ledger.postedMovements || [],
        receivables: ledger.receivables || [],
        payables: ledger.payables || [],
        periods: periods || [],
      };
    }
    const year = String(periodFilter);
    return {
      movements: (ledger.postedMovements || []).filter((entry) => yearOf(entry.postedDate) === year),
      receivables: (ledger.receivables || []).filter((entry) => yearOf(entry.issueDate) === year),
      payables: (ledger.payables || []).filter((entry) => yearOf(entry.issueDate) === year),
      periods: (periods || []).filter((period) => String(period.period || '').startsWith(year)),
    };
  }, [ledger.postedMovements, ledger.receivables, ledger.payables, periods, periodFilter]);

  const employeesById = useMemo(() => {
    const map = {};
    employees.forEach((employee) => {
      map[employee.id] = employee;
    });
    return map;
  }, [employees]);

  const payroll = useMemo(() => {
    // Deliberately NO projectNamesById: with an empty name map the allocation
    // stays keyed by raw project ID. Name keys would collapse duplicate
    // project names onto one row; buildProjectActuals resolves ids first.
    return {
      byProject: allocatePayrollCost({ periods: filtered.periods, employeesById }).byProject,
      unallocated: computeUnallocatedLabor({ periods: filtered.periods, employeesById }),
    };
  }, [filtered.periods, employeesById]);

  const asOf = useMemo(() => new Date(), []);

  const control = useMemo(() => {
    const actuals = buildProjectActuals({
      movements: filtered.movements,
      receivables: filtered.receivables,
      payables: filtered.payables,
      projects,
      payrollByProject: payroll.byProject,
    });
    const pool = buildOverheadPool({ actuals, unallocatedLabor: payroll.unallocated });
    const allocation = allocateOverhead({
      pool: pool.total,
      rows: Array.from(actuals.values()),
      basis: overheadBasis,
    });
    // EVM is cumulative-to-date (PMP): a year-sliced AC against lifetime
    // percentComplete/schedule would fabricate CPI/EAC, so EVM only renders
    // on the full history.
    const rows = buildControlRows({
      actuals,
      projects,
      overhead: allocation,
      asOf,
      includeEvm: periodFilter === 'all',
    });
    const summary = computePortfolioSummary({ rows, overhead: { pool, allocation } });
    const composition = buildOverheadComposition({
      movements: filtered.movements,
      payables: filtered.payables,
      projects,
      unallocatedLabor: payroll.unallocated,
    });
    return { rows, summary, overheadDetail: { pool, allocation, composition, basis: overheadBasis } };
  }, [filtered, projects, payroll, overheadBasis, asOf, periodFilter]);

  return {
    rows: control.rows,
    summary: control.summary,
    overheadDetail: control.overheadDetail,
    loading: ledger.loading || configLoading,
    periodFilter,
    setPeriodFilter,
    availableYears,
    overheadBasis,
    setOverheadBasis,
    updateProject,
    // UNFILTERED slices for the per-project S-curve: the curve spans the
    // project's lifetime (startDate→endDate) regardless of the year filter,
    // so its cumulative cost must always see the full history. Built lazily
    // in the detail panel to avoid computing one curve per row up front.
    curveMovements: ledger.postedMovements || [],
    curvePayables: ledger.payables || [],
    projects,
    asOf,
  };
};

export default useProjectControl;
