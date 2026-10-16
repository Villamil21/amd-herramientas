import type { TaxEmptyPeriod, TaxPeriodicity, TaxReturn, TaxType } from "../types";
import { periodName, periodRange, periodsPerYear } from "./effects";

export interface TaxPeriodCell {
  year: number;
  period: number | null;
  label: string;
  /** Declaraciones vigentes (no reemplazadas) del periodo. */
  returns: TaxReturn[];
  /** Versiones reemplazadas por una corrección: el historial de la declaración vigente. */
  history: TaxReturn[];
  /** Registro vigente «sin obligación». */
  empty: TaxEmptyPeriod | null;
  /** «upcoming»: el periodo aún no termina a la fecha de hoy. */
  state: "declared" | "empty" | "missing" | "upcoming";
}

/** Periodicidad de un impuesto para la cobertura (IVA: la de la empresa; sin configurar, null). */
export function periodicityOf(taxType: TaxType, vatPeriodicity: TaxPeriodicity | null): TaxPeriodicity | null {
  return taxType === "withholding" ? "monthly" : taxType === "income" ? "annual" : vatPeriodicity;
}

/** Año de la fecha de constitución (AAAA-MM-DD) o null si Empresas no la tiene: nunca se infiere. */
export function constitutionYear(constitutionDate: string | null | undefined): number | null {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(constitutionDate ?? "");
  return m ? Number(m[1]) : null;
}

/** Años de cobertura: del año de constitución al año actual, ambos incluidos. Sin constitución no hay rango. */
export function coverageYears(constitutionDate: string | null | undefined, currentYear: number): number[] {
  const from = constitutionYear(constitutionDate);
  if (from === null || from > currentYear) return [];
  return Array.from({ length: currentYear - from + 1 }, (_, i) => from + i);
}

/**
 * Cobertura de un impuesto: cada periodo del año (Retefuente 12, IVA 6 o 3) o
 * cada año (Renta) queda «declarado», «sin obligación» o «falta». Función pura.
 * Con `constitutionDate` no aparecen periodos que terminaron antes de la constitución
 * y con `today` los periodos que aún no terminan quedan «upcoming» (no «falta»).
 */
export function taxPeriodCoverage(
  taxType: TaxType,
  periodicity: TaxPeriodicity | null,
  years: number[],
  returns: TaxReturn[],
  empties: TaxEmptyPeriod[],
  options: { constitutionDate?: string | null; today?: string } = {},
): TaxPeriodCell[] {
  if (!periodicity) return [];
  const out: TaxPeriodCell[] = [];
  const created = /^\d{4}-\d{2}-\d{2}$/.test(options.constitutionDate ?? "") ? options.constitutionDate! : null;
  for (const year of years) {
    const count = periodicity === "annual" ? 1 : periodsPerYear(periodicity);
    for (let p = 1; p <= count; p++) {
      const period = periodicity === "annual" ? null : p;
      const range = periodRange(periodicity, year, period);
      if (created && range.end < created) continue;
      const mine = returns.filter((r) => r.taxType === taxType && r.year === year && (r.period ?? null) === period && r.periodicity === periodicity);
      const own = mine.filter((r) => r.supersededBy === null);
      const history = mine.filter((r) => r.supersededBy !== null);
      const empty = empties.find((e) => e.status === "active" && e.taxType === taxType && e.year === year && (e.period ?? null) === period && e.periodicity === periodicity) ?? null;
      const state: TaxPeriodCell["state"] = own.length ? "declared" : empty ? "empty" : options.today && range.end >= options.today ? "upcoming" : "missing";
      out.push({ year, period, label: periodName({ taxType, year, period, periodicity }), returns: own, history, empty, state });
    }
  }
  return out;
}
