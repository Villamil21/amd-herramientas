import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import type { BankAccountLifecycle, BankBalance, BatchSummary, Movement, Presentation } from "../../../types/fs";
import { liveMovements } from "../crypto/eeffBatch";
import { useCryptoData } from "../crypto/useCryptoData";
import { useEeffAutoSync } from "../crypto/useEeffAutoSync";
import { buildStatements, eerrRows, esfRows } from "../generator/engine";
import { engineView, isAccountingPresentation, type AccountingPresentation } from "../shared/accountingPresentation";
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
 * Los estados de una empresa y un período, calculados con el mismo motor del Generador (solo lectura): de ellos salen los grupos
 * que tienen nota y su numeración. La presentación NO es propia de las notas: es la misma configuración compartida por empresa y año
 * que usa el Generador (la de Transacciones Cripto), que aquí se lee y se cambia por el mismo camino. Las notas nunca cambian
 * movimientos, clasificación ni cálculos.
 */
export function useNotesStatements(companyId: number | null, start: string, end: string) {
  const toast = useToast();
  const data = useFsData();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const company = data.companies?.find((c) => c.id === companyId) ?? null;
  const rangeOk = isIsoDate(start) && isIsoDate(end) && start <= end;

  const year = rangeOk ? Number(end.slice(0, 4)) : NaN;
  const yearOk = year >= 2000 && year <= 2100;
  const crypto = useCryptoData(companyId !== null && rangeOk && yearOk ? companyId : null, yearOk ? year : new Date().getFullYear());
  const cryptoSync = useEeffAutoSync(companyId !== null && rangeOk && yearOk ? companyId : null, crypto.model);
  const accounting: AccountingPresentation | null = crypto.model && crypto.model.year === year ? crypto.model.settings.presentation : null;
  const presentation: Presentation | "" = accounting ? engineView(accounting) : "";
  const changeAccounting = useCallback(
    (value: string) => {
      if (isAccountingPresentation(value)) void crypto.decide("setting", "presentation", value);
    },
    [crypto],
  );

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

  // Cuando Transacciones Cripto reemplaza, retira o marca su lote, se releen los movimientos (igual que en el Generador).
  const syncMark = `${cryptoSync.batch?.id ?? ""}|${cryptoSync.batch?.status ?? ""}|${JSON.stringify(cryptoSync.batch?.metadata ?? null)}`;
  useEffect(() => {
    if (companyId !== null) void loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncMark]);

  const model = useMemo(() => {
    if (!company || !ledger || !data.catalog || !rangeOk || !presentation) return null;
    const statements = buildStatements({
      company,
      catalog: data.catalog,
      mappings: data.mappings,
      movements: liveMovements(ledger.movements, ledger.batches),
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
    const items = buildNoteItems(esf, eerr, { catalog: data.catalog, statements, pucConcepts: data.index.concepts, company });
    return { statements, esf, eerr, numbered: withNoteNumbers(esf, eerr, data.catalog), items };
  }, [company, ledger, data.catalog, data.mappings, data.index, data.settingsMap, start, end, presentation, rangeOk]);

  return { companies: data.companies, company, model, rangeOk, accounting, changeAccounting, loading: !!companyId && rangeOk && !model };
}
