import { useMemo } from "react";
import { usePayrollOverview } from "../financial-statements/payroll/social/usePayrollOverview";
import { useBankExo } from "../financial-statements/bank/exogena/load";
import { payrollFormatState, type PayrollExoFormat } from "./domain/payrollFormat";
import { useCompanies, useFormatRecords } from "./hooks";

/** 1011 o 2276 de una empresa y un año: los registros guardados en Exógena y lo que Nómina propone hoy (solo lectura). */
export function usePayrollFormat(companyId: number | null, year: number, code: PayrollExoFormat) {
  const { companies } = useCompanies();
  const company = useMemo(() => companies?.find((c) => c.id === companyId) ?? null, [companies, companyId]);
  const format = useFormatRecords(companyId, year, code);
  const { overview, refresh } = usePayrollOverview(companyId, year);
  // El 1011 también suma el GMF de Extractos bancarios (concepto 8211).
  const bank = useBankExo(companyId, year);
  const state = useMemo(() => {
    if (!overview || !format.records || !bank.contribution) return null;
    const proposals = code === "1011" ? overview.f1011.proposals : overview.f2276.proposals;
    return payrollFormatState(code, proposals, overview.alerts, format.records, bank.contribution);
  }, [overview, format.records, code, bank.contribution]);
  return { companies, company, format, overview, state, refresh, bank, ready: !!(overview && state) };
}
