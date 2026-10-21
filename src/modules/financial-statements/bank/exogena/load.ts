import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../../../components/ui";
import { fsService } from "../../../../services/fsService";
import { errorMessage } from "../../../../services/tauri";
import { exogenaService } from "../../../../services/exogenaService";
import type { BankAccountLifecycle, BankExoReview, BankProfile, BatchSummary, GmfRule, InterestRule } from "../../../../types/fs";
import { BANK_EXO_FORMATS, buildBankExoContribution, type BankExoContribution, type BankExoFormat, type BankExoInput } from "./model";
import { pendingChanges } from "../../../exogena/domain/pending";
import { blocking } from "../../../exogena/domain/problems";

export interface BankExoData {
  batches: BatchSummary[];
  profiles: BankProfile[];
  gmfRules: GmfRule[];
  interestRules: InterestRule[];
  lifecycles: BankAccountLifecycle[];
  reviews: BankExoReview[];
}

/** Lee de SQLite todo lo que necesita el cálculo de los extractos para Exógena (fuera de pantalla: sincronizaciones y reaperturas). */
export async function loadBankExoData(companyId: number, year: number): Promise<BankExoData> {
  const [batches, profiles, gmfRules, interestRules, lifecycles, reviews] = await Promise.all([
    fsService.batches(companyId),
    fsService.bankProfiles(),
    fsService.gmfRules(),
    fsService.interestRules(),
    fsService.bankLifecycles(companyId),
    fsService.bankExoReviews(companyId, year),
  ]);
  return { batches, profiles, gmfRules, interestRules, lifecycles, reviews };
}

export const bankExoInput = (companyId: number, year: number, data: BankExoData): BankExoInput => ({ companyId, year, ...data });

export async function loadBankExoContribution(companyId: number, year: number): Promise<BankExoContribution> {
  return buildBankExoContribution(bankExoInput(companyId, year, await loadBankExoData(companyId, year)));
}

/**
 * Extractos bancarios de una empresa y un año para 1012, 1007 y 1011: lo guardado (lotes, fichas, reglas, ciclo de vida y
 * decisiones) y lo que de ahí se propone. Se recalcula siempre desde lo guardado; `reload` vuelve a leer tras cualquier cambio.
 */
export function useBankExo(companyId: number | null, year: number) {
  const toast = useToast();
  const [data, setData] = useState<BankExoData | null>(null);
  const reload = useCallback(async () => {
    if (companyId === null) return setData(null);
    try {
      setData(await loadBankExoData(companyId, year));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, year, toast]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  const contribution = useMemo(() => (data && companyId !== null ? buildBankExoContribution(bankExoInput(companyId, year, data)) : null), [data, companyId, year]);
  return { data, contribution, reload };
}

export type BankExo = ReturnType<typeof useBankExo>;

const BANK_PREFIX = "banco-";

/**
 * Los extractos, las fichas, las reglas o las decisiones cambiaron: cualquier 1012, 1007 o 1011 «Listo» del año que quede
 * bloqueado o desactualizado en su parte bancaria vuelve a «Requiere actualización». Nunca se reescribe un formato listo en silencio.
 */
export async function reopenReadyBankFormats(companyId: number, years: number[]): Promise<void> {
  for (const year of new Set(years)) {
    const [overview, contribution] = await Promise.all([exogenaService.overview(companyId, year), loadBankExoContribution(companyId, year)]);
    for (const format of BANK_EXO_FORMATS as BankExoFormat[]) {
      if (overview.statuses.find((s) => s.formatCode === format)?.status !== "listo") continue;
      const stored = (await exogenaService.records(companyId, year, format)).filter((r) => r.sourceKey.startsWith(`${BANK_PREFIX}${format}`));
      const stale = pendingChanges(stored, contribution.proposals[format]).length > 0;
      if (blocking(contribution.problems[format]).length > 0 || stale) await exogenaService.setStatus(companyId, year, format, "requiere_actualizacion");
    }
  }
}
