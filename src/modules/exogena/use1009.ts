import { useCallback, useMemo } from "react";
import { build1009, check1009, FORMAT_1009, reconcile } from "./domain/form1009";
import { pendingChanges } from "./domain/pending";
import type { Problem } from "./domain/problems";
import { useCatalogs, useFormatRecords } from "./hooks";
import { useExogenaLedger } from "./useLedger";

/**
 * Todo lo que necesita el 1009 de una empresa y un año: los registros guardados, los movimientos y obligaciones de Estados
 * Financieros (solo lectura: Exógena nunca cambia movimientos, fechas, PUC, estados ni cierres), los terceros y la conciliación
 * con el total de pasivos del Estado de Situación Financiera al 31 de diciembre.
 */
export function use1009(companyId: number | null, year: number) {
  const { catalogs, index } = useCatalogs();
  const format = useFormatRecords(companyId, year, FORMAT_1009);
  const { data, company, ledger, suppliers, tax, statements, loadLedger, loadSuppliers } = useExogenaLedger(companyId, year);

  const ready = !!(company && ledger && suppliers && data.catalog && index && format.records);

  const model = useMemo(() => {
    if (!company || !ledger || !suppliers || !data.catalog || !index || !format.records || !tax || !statements) return null;
    const built = build1009({ year, company, suppliers, movements: ledger.movements, catalog: data.catalog, mappings: data.mappings, batches: ledger.batches, tax, statements });
    const changes = pendingChanges(format.records, built.proposals);
    const reconciliation = reconcile(built, format.records);
    const problems: Problem[] = check1009(format.records, built, reconciliation, index, changes);
    return { built, changes, reconciliation, problems };
  }, [company, ledger, suppliers, data.catalog, data.mappings, index, format.records, year, tax, statements]);

  const reloadAll = useCallback(async () => {
    await Promise.all([format.reload(), loadLedger(), loadSuppliers()]);
  }, [format, loadLedger, loadSuppliers]);

  return { companies: data.companies, company, catalogs, index, suppliers, ready, model, format, reloadAll, loadSuppliers };
}
