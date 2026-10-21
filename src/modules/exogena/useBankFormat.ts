import { useMemo } from "react";
import { useBankExo } from "../financial-statements/bank/exogena/load";
import type { BankExoFormat } from "../financial-statements/bank/exogena/model";
import { bankFormatState } from "./domain/bankFormat";
import { useCompanies, useFormatRecords } from "./hooks";

/** 1012 de una empresa y un año: los registros guardados en Exógena y lo que los extractos bancarios proponen hoy (solo lectura). */
export function useBankFormat(companyId: number | null, year: number, code: BankExoFormat) {
  const { companies } = useCompanies();
  const company = useMemo(() => companies?.find((c) => c.id === companyId) ?? null, [companies, companyId]);
  const format = useFormatRecords(companyId, year, code);
  const bank = useBankExo(companyId, year);
  const state = useMemo(() => (bank.contribution && format.records ? bankFormatState(code, bank.contribution, format.records) : null), [bank.contribution, format.records, code]);
  return { companies, company, format, bank, state, ready: !!(bank.contribution && state) };
}
