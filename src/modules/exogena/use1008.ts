import { useCallback, useEffect, useMemo, useState } from "react";
import { paths } from "../../app/router";
import { useToast } from "../../components/ui";
import { exogenaService } from "../../services/exogenaService";
import { errorMessage } from "../../services/tauri";
import type { FormatConcept } from "../../types/exogena";
import { buildProposals1008, check1008, FORMAT_1008, reconcile1008, SYSTEM_CONCEPTS_1008 } from "./domain/form1008";
import { pendingChanges } from "./domain/pending";
import type { Problem } from "./domain/problems";
import { useCatalogs, useCompanies, useFormatRecords } from "./hooks";

/** Conceptos de un formato (los de fábrica y los que crea el usuario), exclusivos de ese formato. */
export function useFormatConcepts(formatCode: string) {
  const toast = useToast();
  const [concepts, setConcepts] = useState<FormatConcept[] | null>(null);
  const reload = useCallback(() => exogenaService.formatConcepts(formatCode).then(setConcepts, (e) => toast(errorMessage(e), "error")), [formatCode, toast]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { concepts, reload };
}

/** Lo que necesita el 1008 de una empresa y un año: CxC a socios de Empresas, registros, conceptos, conciliación y pendientes. */
export function use1008(companyId: number | null, year: number) {
  const { companies, reload: reloadCompanies } = useCompanies();
  const { catalogs, index } = useCatalogs();
  const { concepts, reload: reloadConcepts } = useFormatConcepts(FORMAT_1008);
  const company = companies?.find((c) => c.id === companyId) ?? null;
  const format = useFormatRecords(companyId, year, FORMAT_1008);

  const model = useMemo(() => {
    if (!company || !index || !format.records) return null;
    const proposals = buildProposals1008(company);
    const changes = pendingChanges(format.records, proposals);
    // Si aún no cargan los conceptos se usan los de fábrica para no dar falsos pendientes.
    const options = (concepts ?? SYSTEM_CONCEPTS_1008.map((c) => ({ ...c, formatCode: FORMAT_1008, isSystem: true, isActive: true }))).map((c) => ({ code: c.code, description: c.description, isActive: c.isActive }));
    const reconciliation = reconcile1008(format.records, company);
    const problems: Problem[] = check1008(format.records, company, index, options).map((p) => (p.recordKey ? { ...p, action: { label: p.field === "concept" ? "Conceptos" : "Empresas", path: p.field === "concept" ? paths.submodule("informacion-exogena", FORMAT_1008) : paths.companies } } : p));
    if (changes.length) problems.push({ level: "blocking", message: `Empresas cambió desde la última sincronización (${changes.length} ${changes.length === 1 ? "registro" : "registros"}): usa «Actualizar desde Empresas».` });
    return { proposals, changes, problems, reconciliation };
  }, [company, index, format.records, concepts]);

  return { companies, reloadCompanies, company, catalogs, index, format, model, concepts, reloadConcepts };
}
