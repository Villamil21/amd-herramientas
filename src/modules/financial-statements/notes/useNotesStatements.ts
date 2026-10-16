import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import type { BankAccountLifecycle, BankBalance, BatchSummary, Movement, Presentation } from "../../../types/fs";
import { buildStatements, eerrRows, esfRows } from "../generator/engine";
import { isIsoDate } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { taxService } from "../tax-obligations/services/taxService";
import { CAPITAL_RECEIVABLE_KEY, type TaxReturn, type VatPeriodicity } from "../tax-obligations/types";
import { buildNoteItems, withNoteNumbers } from "./model";

interface Ledger {
  movements: Movement[];
  batches: BatchSummary[];
  balances: BankBalance[];
  bankLifecycles: BankAccountLifecycle[];
  taxReturns: TaxReturn[];
  vatPeriodicity: VatPeriodicity | null;
}

/**
 * Los estados de una empresa y un período, calculados con el mismo motor del Generador (solo lectura): de ellos salen las partidas
 * que tienen nota y su numeración. Las notas nunca cambian movimientos, clasificación ni cálculos.
 */
export function useNotesStatements(companyId: number | null, start: string, end: string, presentation: Presentation) {
  const toast = useToast();
  const data = useFsData();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const company = data.companies?.find((c) => c.id === companyId) ?? null;
  const rangeOk = isIsoDate(start) && isIsoDate(end) && start <= end;

  const loadLedger = useCallback(async () => {
    if (companyId === null) return setLedger(null);
    try {
      const [movements, batches, balances, bankLifecycles, taxReturns, taxSettings] = await Promise.all([fsService.movements(companyId), fsService.batches(companyId), fsService.bankBalances(companyId), fsService.bankLifecycles(companyId), taxService.list(companyId), taxService.settings(companyId)]);
      setLedger({ movements, batches, balances, bankLifecycles, taxReturns, vatPeriodicity: taxSettings.vatPeriodicity });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);
  useEffect(() => {
    setLedger(null);
    void loadLedger();
  }, [loadLedger]);

  const model = useMemo(() => {
    if (!company || !ledger || !data.catalog || !rangeOk) return null;
    const statements = buildStatements({
      company,
      catalog: data.catalog,
      mappings: data.mappings,
      movements: ledger.movements,
      bankBalances: ledger.balances,
      bankLifecycles: ledger.bankLifecycles,
      pucConcepts: data.index.concepts,
      start,
      end,
      presentation,
      tax: { returns: ledger.taxReturns, puc: data.settingsMap, vatPeriodicity: ledger.vatPeriodicity },
      capitalReceivablePuc: data.settingsMap.get(CAPITAL_RECEIVABLE_KEY) ?? null,
    });
    const esf = esfRows(statements);
    const eerr = eerrRows(statements);
    return { statements, esf, eerr, numbered: withNoteNumbers(esf, eerr), items: buildNoteItems(esf, eerr) };
  }, [company, ledger, data.catalog, data.mappings, data.index, data.settingsMap, start, end, presentation, rangeOk]);

  return { companies: data.companies, company, model, rangeOk, loading: !!companyId && rangeOk && !model };
}
