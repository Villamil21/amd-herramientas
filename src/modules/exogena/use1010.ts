import { useMemo } from "react";
import { paths } from "../../app/router";
import { buildProposals1010, check1010, FORMAT_1010 } from "./domain/form1010";
import { pendingChanges } from "./domain/pending";
import type { Problem } from "./domain/problems";
import { useCatalogs, useCompanies, useFormatRecords } from "./hooks";

/** Lo que necesita el 1010 de una empresa y un año: socios de Empresas, registros guardados, cambios y pendientes. */
export function use1010(companyId: number | null, year: number) {
  const { companies, reload: reloadCompanies } = useCompanies();
  const { catalogs, index } = useCatalogs();
  const company = companies?.find((c) => c.id === companyId) ?? null;
  const format = useFormatRecords(companyId, year, FORMAT_1010);

  const model = useMemo(() => {
    if (!company || !index || !format.records) return null;
    const proposals = buildProposals1010(company);
    const changes = pendingChanges(format.records, proposals);
    const problems: Problem[] = check1010(format.records, company, index).map((p) => (p.recordKey ? { ...p, action: { label: "Empresas", path: paths.companies } } : p));
    if (changes.length) {
      problems.push({ level: "blocking", message: `Empresas cambió desde la última sincronización (${changes.length} ${changes.length === 1 ? "registro" : "registros"}): usa «Actualizar desde Empresas».` });
    }
    return { proposals, changes, problems };
  }, [company, index, format.records]);

  return { companies, reloadCompanies, company, catalogs, index, format, model };
}
