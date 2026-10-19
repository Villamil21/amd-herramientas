import { useMemo } from "react";
import { usePayrollOverview } from "../financial-statements/payroll/social/usePayrollOverview";
import { payrollFormatState, type PayrollExoFormat } from "./domain/payrollFormat";
import { useCompanies, useFormatRecords } from "./hooks";

/** 1011 o 2276 de una empresa y un año: los registros guardados en Exógena y lo que Nómina propone hoy (solo lectura). */
export function usePayrollFormat(companyId: number | null, year: number, code: PayrollExoFormat) {
  const { companies } = useCompanies();
  const company = useMemo(() => companies?.find((c) => c.id === companyId) ?? null, [companies, companyId]);
  const format = useFormatRecords(companyId, year, code);
  const { overview, refresh } = usePayrollOverview(companyId, year);
  const state = useMemo(() => {
    if (!overview || !format.records) return null;
    const proposals = code === "1011" ? overview.f1011.proposals : overview.f2276.proposals;
    return payrollFormatState(code, proposals, overview.alerts, format.records);
  }, [overview, format.records, code]);
  return { companies, company, format, overview, state, refresh, ready: !!(overview && state) };
}
