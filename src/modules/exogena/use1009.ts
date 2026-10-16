import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../components/ui";
import { fsService } from "../../services/fsService";
import { supplierService } from "../../services/supplierService";
import { errorMessage } from "../../services/tauri";
import type { BankAccountLifecycle, BankBalance, BatchSummary, Movement } from "../../types/fs";
import type { Supplier } from "../../types/models";
import { buildStatements } from "../financial-statements/generator/engine";
import { useFsData } from "../financial-statements/shared/useFsData";
import { taxService } from "../financial-statements/tax-obligations/services/taxService";
import type { TaxReturn, VatPeriodicity } from "../financial-statements/tax-obligations/types";
import { build1009, check1009, FORMAT_1009, reconcile } from "./domain/form1009";
import { pendingChanges } from "./domain/pending";
import type { Problem } from "./domain/problems";
import { useCatalogs, useFormatRecords } from "./hooks";

interface Ledger {
  movements: Movement[];
  batches: BatchSummary[];
  balances: BankBalance[];
  bankLifecycles: BankAccountLifecycle[];
  taxReturns: TaxReturn[];
  vatPeriodicity: VatPeriodicity | null;
}

/**
 * Todo lo que necesita el 1009 de una empresa y un año: los registros guardados, los movimientos y obligaciones de Estados
 * Financieros (solo lectura: Exógena nunca cambia movimientos, fechas, PUC, estados ni cierres), los terceros y la conciliación
 * con el total de pasivos del Estado de Situación Financiera al 31 de diciembre.
 */
export function use1009(companyId: number | null, year: number) {
  const toast = useToast();
  const data = useFsData();
  const { catalogs, index } = useCatalogs();
  const format = useFormatRecords(companyId, year, FORMAT_1009);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const company = data.companies?.find((c) => c.id === companyId) ?? null;

  const loadSuppliers = useCallback(() => supplierService.list().then(setSuppliers, (e) => toast(errorMessage(e), "error")), [toast]);
  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const loadLedger = useCallback(async () => {
    if (companyId === null) return setLedger(null);
    try {
      const [movements, batches, balances, bankLifecycles, taxReturns, taxSettings] = await Promise.all([
        fsService.movements(companyId),
        fsService.batches(companyId),
        fsService.bankBalances(companyId),
        fsService.bankLifecycles(companyId),
        taxService.list(companyId),
        taxService.settings(companyId),
      ]);
      setLedger({ movements, batches, balances, bankLifecycles, taxReturns, vatPeriodicity: taxSettings.vatPeriodicity });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);
  useEffect(() => {
    setLedger(null);
    void loadLedger();
  }, [loadLedger]);

  const ready = !!(company && ledger && suppliers && data.catalog && index && format.records);

  const model = useMemo(() => {
    if (!company || !ledger || !suppliers || !data.catalog || !index || !format.records) return null;
    const tax = { returns: ledger.taxReturns, puc: data.settingsMap, vatPeriodicity: ledger.vatPeriodicity };
    // Los pasivos no dependen de la presentación (Banco / OTC): se usa cualquiera.
    const statements = buildStatements({
      company,
      catalog: data.catalog,
      mappings: data.mappings,
      movements: ledger.movements,
      bankBalances: ledger.balances,
      bankLifecycles: ledger.bankLifecycles,
      pucConcepts: data.index.concepts,
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      presentation: "bank",
      tax,
    });
    const built = build1009({ year, company, suppliers, movements: ledger.movements, catalog: data.catalog, mappings: data.mappings, batches: ledger.batches, tax, statements });
    const changes = pendingChanges(format.records, built.proposals);
    const reconciliation = reconcile(built, format.records);
    const problems: Problem[] = check1009(format.records, built, reconciliation, index, changes);
    return { built, changes, reconciliation, problems };
  }, [company, ledger, suppliers, data.catalog, data.mappings, data.settingsMap, data.index, index, format.records, year]);

  const reloadAll = useCallback(async () => {
    await Promise.all([format.reload(), loadLedger(), loadSuppliers()]);
  }, [format, loadLedger, loadSuppliers]);

  return { companies: data.companies, company, catalogs, index, suppliers, ready, model, format, reloadAll, loadSuppliers };
}
