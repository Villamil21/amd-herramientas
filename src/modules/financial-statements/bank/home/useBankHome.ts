import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import type { BankConceptMapping, BankEditLogEntry, BankInterestLogEntry, BankMonthNa, BankPendingEdit, BatchSummary, GmfRule, InterestRule, Movement, MovementEdit, Period } from "../../../../types/fs";
import { bankExoInput, reopenReadyBankFormats, useBankExo } from "../exogena/load";
import { buildImportedStatements, type ImportedStatement } from "../imported/model";
import { buildBankHome, todayIso } from "./model";

interface Stored {
  batches: BatchSummary[];
  movements: Movement[];
  edits: MovementEdit[];
  mappings: BankConceptMapping[];
  gmfRules: GmfRule[];
  interestRules: InterestRule[];
  periods: Period[];
  pending: BankPendingEdit[];
  log: BankEditLogEntry[];
  interestLog: BankInterestLogEntry[];
  monthNa: BankMonthNa[];
}

/**
 * Todo lo persistido que necesita la pantalla de un banco (extractos, movimientos enviados, cambios pendientes, bitácora, meses
 * «No aplica») y lo que de ahí se calcula. `refresh` vuelve a leer y reabre los formatos de Exógena que queden desactualizados.
 */
export function useBankHome(bank: string, companyId: number | null, year: number) {
  const toast = useToast();
  const exo = useBankExo(companyId, year);
  const [stored, setStored] = useState<Stored | null>(null);

  const load = useCallback(async () => {
    if (companyId === null) return setStored(null);
    try {
      const [batches, movements, edits, mappings, gmfRules, interestRules, periods, pending, log, interestLog, monthNa] = await Promise.all([
        fsService.batches(companyId),
        fsService.movements(companyId),
        fsService.movementEdits(companyId),
        fsService.bankConceptMappings(),
        fsService.gmfRules(),
        fsService.interestRules(),
        fsService.periods(companyId),
        fsService.bankPendingEdits(companyId),
        fsService.bankEditLog(companyId),
        fsService.bankInterestLog(companyId),
        fsService.bankMonthNa(companyId),
      ]);
      setStored({ batches, movements, edits, mappings, gmfRules, interestRules, periods, pending, log, interestLog, monthNa });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);
  useEffect(() => {
    setStored(null);
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await Promise.all([load(), exo.reload()]);
    if (companyId !== null) void reopenReadyBankFormats(companyId, [year]).catch(() => undefined);
  }, [load, exo, companyId, year]);

  const statements = useMemo<ImportedStatement[]>(() => {
    if (!stored || companyId === null) return [];
    return buildImportedStatements({ companyId, ...stored, alerts: exo.contribution?.result.alerts ?? [] }).filter((s) => s.bank.trim().toUpperCase() === bank.trim().toUpperCase());
  }, [stored, exo.contribution, companyId, bank]);

  const home = useMemo(() => {
    if (!stored || !exo.contribution) return null;
    return buildBankHome({ bank, year, result: exo.contribution.result, statements, pending: stored.pending, monthNa: stored.monthNa, today: todayIso() });
  }, [stored, exo.contribution, statements, bank, year]);

  const exoInput = useMemo(() => (exo.data && companyId !== null ? bankExoInput(companyId, year, exo.data) : null), [exo.data, companyId, year]);

  return { stored, statements, home, exo, exoInput, refresh, ready: Boolean(stored && exo.data && exo.contribution) };
}
