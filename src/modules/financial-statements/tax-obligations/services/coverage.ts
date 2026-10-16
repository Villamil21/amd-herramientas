import type { TaxEmptyPeriod, TaxPeriodicity, TaxReturn, TaxType } from "../types";
import { periodName, periodsPerYear } from "./effects";

export interface TaxPeriodCell {
  year: number;
  period: number | null;
  label: string;
  /** Declaraciones vigentes (no reemplazadas) del periodo. */
  returns: TaxReturn[];
  /** Registro vigente «sin obligación». */
  empty: TaxEmptyPeriod | null;
  state: "declared" | "empty" | "missing";
}

/** Periodicidad de un impuesto para la cobertura (IVA: la de la empresa; sin configurar, null). */
export function periodicityOf(taxType: TaxType, vatPeriodicity: TaxPeriodicity | null): TaxPeriodicity | null {
  return taxType === "withholding" ? "monthly" : taxType === "income" ? "annual" : vatPeriodicity;
}

/**
 * Cobertura de un impuesto: cada periodo del año (Retefuente 12, IVA 6 o 3) o
 * cada año (Renta) queda «declarado», «sin obligación» o «falta». Función pura.
 */
export function taxPeriodCoverage(taxType: TaxType, periodicity: TaxPeriodicity | null, years: number[], returns: TaxReturn[], empties: TaxEmptyPeriod[]): TaxPeriodCell[] {
  if (!periodicity) return [];
  const out: TaxPeriodCell[] = [];
  for (const year of years) {
    const count = periodicity === "annual" ? 1 : periodsPerYear(periodicity);
    for (let p = 1; p <= count; p++) {
      const period = periodicity === "annual" ? null : p;
      const own = returns.filter((r) => r.taxType === taxType && r.supersededBy === null && r.year === year && (r.period ?? null) === period && r.periodicity === periodicity);
      const empty = empties.find((e) => e.status === "active" && e.taxType === taxType && e.year === year && (e.period ?? null) === period && e.periodicity === periodicity) ?? null;
      out.push({ year, period, label: periodName({ taxType, year, period, periodicity }), returns: own, empty, state: own.length ? "declared" : empty ? "empty" : "missing" });
    }
  }
  return out;
}
