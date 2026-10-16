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
import { CAPITAL_RECEIVABLE_KEY, type TaxReturn, type VatPeriodicity } from "../financial-statements/tax-obligations/types";

export interface Ledger {
  movements: Movement[];
  batches: BatchSummary[];
  balances: BankBalance[];
  bankLifecycles: BankAccountLifecycle[];
  taxReturns: TaxReturn[];
  vatPeriodicity: VatPeriodicity | null;
}

/**
 * Movimientos, obligaciones y terceros de una empresa, y los Estados Financieros al 31/12 del año: lo que comparten el 1008 y el 1009.
 * Solo lectura: Exógena nunca cambia movimientos, fechas, PUC, estados ni cierres.
 */
export function useExogenaLedger(companyId: number | null, year: number) {
  const toast = useToast();
  const data = useFsData();
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

  const tax = useMemo(() => (ledger ? { returns: ledger.taxReturns, puc: data.settingsMap, vatPeriodicity: ledger.vatPeriodicity } : null), [ledger, data.settingsMap]);

  // Los pasivos y deudores no dependen de la presentación (Banco / OTC): se usa cualquiera.
  const statements = useMemo(() => {
    if (!company || !ledger || !data.catalog || !tax) return null;
    return buildStatements({
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
      capitalReceivablePuc: data.settingsMap.get(CAPITAL_RECEIVABLE_KEY) ?? null,
    });
  }, [company, ledger, data.catalog, data.mappings, data.index, tax, year]);

  return { data, company, ledger, suppliers, tax, statements, loadLedger, loadSuppliers };
}
