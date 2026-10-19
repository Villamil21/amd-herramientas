import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../../../../components/ui";
import { companyService } from "../../../../services/companyService";
import { exogenaService } from "../../../../services/exogenaService";
import { fsService } from "../../../../services/fsService";
import { minimumWageService } from "../../../../services/minimumWageService";
import { supplierService } from "../../../../services/supplierService";
import { errorMessage } from "../../../../services/tauri";
import type { ExoCatalogs } from "../../../../types/exogena";
import type { BatchSummary, Employee } from "../../../../types/fs";
import type { Company, MinimumWage, Supplier } from "../../../../types/models";
import { parafiscalNitsToCreate } from "./exo1001";
import { payrollOverview, type PayrollOverview } from "./overview";

interface Loaded {
  company: Company | null;
  batches: BatchSummary[];
  employees: Employee[];
  wages: MinimumWage[];
  suppliers: Supplier[];
  catalogs: ExoCatalogs | null;
}

/**
 * Nómina y seguridad social de una empresa y un año, calculada con los datos de hoy (solo lectura). `refresh` vuelve a leer
 * (tras importar, confirmar un nombre o completar un proveedor).
 */
export function usePayrollOverview(companyId: number | null, year: number, refreshKey?: unknown) {
  const toast = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (companyId === null) return setLoaded(null);
    let alive = true;
    Promise.all([companyService.list(), fsService.batches(companyId), fsService.employees(companyId), minimumWageService.list(), supplierService.list(), exogenaService.catalogs()]).then(
      ([companies, batches, employees, wages, suppliers, catalogs]) => alive && setLoaded({ company: companies.find((c) => c.id === companyId) ?? null, batches, employees, wages, suppliers, catalogs }),
      (e) => alive && toast(errorMessage(e), "error"),
    );
    return () => {
      alive = false;
    };
  }, [companyId, tick, refreshKey, toast]);

  const overview = useMemo<PayrollOverview | null>(() => (loaded ? payrollOverview({ year, ...loaded }) : null), [loaded, year]);
  // SENA / ICBF identificados por una planilla: la ficha mínima del proveedor se crea sola (sin razón social ni domicilio).
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded || !overview) return;
    const nits = parafiscalNitsToCreate(overview.f1001.groups, loaded.suppliers).filter((n) => !attempted.current.has(n));
    if (!nits.length) return;
    nits.forEach((n) => attempted.current.add(n));
    supplierService.ensurePayroll(nits).then(
      () => refresh(),
      (e) => toast(errorMessage(e), "error"),
    );
  }, [loaded, overview, refresh, toast]);

  return { loaded, overview, refresh };
}
