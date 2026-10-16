import { useCallback, useEffect, useMemo, useState } from "react";
import { paths } from "../../app/router";
import { normalizeKey } from "../../utils/text";
import { useToast } from "../../components/ui";
import { exogenaService } from "../../services/exogenaService";
import { errorMessage } from "../../services/tauri";
import type { FormatConcept } from "../../types/exogena";
import { taxEffects } from "../financial-statements/tax-obligations/services/effects";
import { deudoresCents, reconcileDeudores } from "./domain/deudores";
import { buildProposals1008, buildTaxProposals1008, check1008, manualBalanceProblems, sourceKeyDian1008, FORMAT_1008, reconcile1008, receivableFromSocios, SYSTEM_CONCEPTS_1008 } from "./domain/form1008";
import { pendingChanges } from "./domain/pending";
import type { Problem } from "./domain/problems";
import { useCatalogs, useCompanies, useFormatRecords } from "./hooks";
import { useExogenaLedger } from "./useLedger";

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
  // Los saldos a favor de IVA y Renta y los Deudores del ESF salen de Estados Financieros (solo lectura).
  const { data, suppliers, tax, statements, loadLedger, loadSuppliers } = useExogenaLedger(companyId, year);

  const model = useMemo(() => {
    if (!company || !index || !format.records) return null;
    const taxProposals = tax && suppliers ? buildTaxProposals1008({ tax, year, suppliers, keepManualDian: format.records.some((r) => r.sourceKey === sourceKeyDian1008 && r.manualFields.includes("balance")) }) : { proposals: [], issues: [] };
    const proposals = [...buildProposals1008(company), ...taxProposals.proposals];
    const changes = pendingChanges(format.records, proposals);
    // Si aún no cargan los conceptos se usan los de fábrica para no dar falsos pendientes.
    const options = (concepts ?? SYSTEM_CONCEPTS_1008.map((c) => ({ ...c, formatCode: FORMAT_1008, isSystem: true, isActive: true }))).map((c) => ({ code: c.code, description: c.description, isActive: c.isActive }));
    const reconciliation = reconcile1008(format.records, company);
    const problems: Problem[] = check1008(format.records, company, index, options).map((p) => (p.recordKey ? { ...p, action: { label: p.field === "concept" ? "Conceptos" : "Empresas", path: p.field === "concept" ? paths.submodule("informacion-exogena", FORMAT_1008) : paths.companies } } : p));
    problems.push(...taxProposals.issues);
    // Deudores corrientes + no corrientes del ESF frente al total del 1008, explicados por fuente.
    const deudores = statements && tax ? reconcileDeudores({ eeffDeudoresCents: deudoresCents(statements), sociosReceivableCents: Math.max(0, receivableFromSocios(company) ?? 0) * 100, taxEffects: taxEffects(tax, `${year}-12-31`).effects, records: format.records }) : null;
    // Los saldos a favor de IVA y Renta deben estar mapeados a una línea llamada «Deudores» (corriente o no corriente).
    if (tax && data.catalog) {
      const lines = new Map(data.catalog.lines.map((l) => [l.id, l]));
      for (const e of taxEffects(tax, `${year}-12-31`).effects) {
        if ((e.kind !== "vat_favor" && e.kind !== "income_favor") || !e.pucCode) continue;
        const line = lines.get(data.mappingMap.get(e.pucCode)?.lineId ?? -1);
        if (!line || normalizeKey(line.name) !== "deudores" || !["asset_current", "asset_noncurrent"].includes(line.section))
          problems.push({ level: "blocking", message: `La cuenta PUC ${e.pucCode} (${e.label}) no está mapeada a una línea «Deudores» del activo: el 1008 no puede conciliar con el ESF.`, action: { label: "Catálogo PUC → Estados Financieros", path: paths.submodule("estados-financieros", "generador") } });
      }
    }
    // Un valor editado a mano no se sobrescribe: si difiere de las fuentes se conserva y se pide revisarlo.
    problems.push(...manualBalanceProblems(format.records, proposals));
    if (deudores && deudores.differenceCents !== 0) problems.push({ level: "blocking", message: "El total del 1008 no coincide con los Deudores (corrientes y no corrientes) del Estado de Situación Financiera al 31/12.", action: { label: "Control y exportación", path: paths.submodule("informacion-exogena", "control") } });
    if (changes.length) problems.push({ level: "blocking", message: `Empresas cambió desde la última sincronización (${changes.length} ${changes.length === 1 ? "registro" : "registros"}): usa «Actualizar desde Empresas».` });
    return { proposals, changes, problems, reconciliation, deudores };
  }, [company, index, format.records, concepts, tax, suppliers, statements, year, data.catalog, data.mappingMap]);

  const reloadLedger = useCallback(async () => {
    await Promise.all([loadLedger(), loadSuppliers()]);
  }, [loadLedger, loadSuppliers]);
  return { companies, reloadCompanies, company, catalogs, index, format, model, concepts, reloadConcepts, reloadLedger };
}
