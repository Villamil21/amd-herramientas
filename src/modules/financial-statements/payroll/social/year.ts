import type { BatchSummary } from "../../../../types/fs";
import { isEmptyPeriodBatch } from "../../../../types/fs";
import type { MinimumWage } from "../../../../types/models";
import { computeMonth, wagesFor, type MonthCalc } from "../calc";
import { personKey, readPlanilla, storedPlanillas, type StoredPlanilla } from "./store";
import type { NormalizedEmployee, NormalizedPlanilla } from "./types";

/** Una persona en un periodo, con el cálculo mensual de Estados Financieros. Base común de 1011 y 2276. */
export interface MonthLine {
  batchId: number;
  fileName: string;
  operatorLabel: string;
  planillaNumber?: string;
  period: string;
  key: string;
  person: NormalizedEmployee;
  calc: MonthCalc;
}

export type MonthState = "planilla" | "empty" | "legacy" | "missing";

export interface MonthCoverage {
  /** AAAA-MM del periodo de PENSIÓN. */
  month: string;
  state: MonthState;
  batchIds: number[];
}

/** Cubierto = planilla válida con detalle o «Periodo sin nómina» registrado. Un lote anterior sin detalle NO cubre 1011 ni 2276. */
export const isCovered = (state: MonthState) => state === "planilla" || state === "empty";

export interface Duplicate {
  key: string;
  name: string;
  period: string;
  batchIds: number[];
}

export interface YearData {
  year: number;
  planillas: { batch: BatchSummary; planilla: NormalizedPlanilla }[];
  /** Un registro por persona y periodo (la primera planilla manda); los repetidos se informan en `duplicates` y no suman. */
  lines: MonthLine[];
  duplicates: Duplicate[];
  coverage: MonthCoverage[];
  /** No hay SMMLV o auxilio de transporte del año: el salario y las prestaciones no se pueden calcular. */
  wagesMissing: boolean;
}

/** Periodo de pensión de un lote de nómina. */
export const batchPeriod = (b: Pick<BatchSummary, "metadata" | "periodStart">): string => (typeof b.metadata?.period === "string" ? b.metadata.period : (b.periodStart ?? "").slice(0, 7));

export const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

/** Cobertura mensual del año por periodo de pensión. */
export function monthlyCoverage(year: number, batches: BatchSummary[]): MonthCoverage[] {
  return monthsOf(year).map((month) => {
    const here = batches.filter((b) => b.source === "payroll" && b.status === "active" && batchPeriod(b) === month);
    const data = here.filter((b) => !isEmptyPeriodBatch(b));
    const state: MonthState = data.length === 0 ? (here.length > 0 ? "empty" : "missing") : data.every((b) => readPlanilla(b)) ? "planilla" : "legacy";
    return { month, state, batchIds: here.map((b) => b.id) };
  });
}

export function buildYearData(year: number, batches: BatchSummary[], wages: MinimumWage[]): YearData {
  const planillas = storedPlanillas(batches)
    .filter((s): s is StoredPlanilla & { planilla: NormalizedPlanilla } => !!s.planilla && s.planilla.period.startsWith(`${year}-`))
    .sort((a, b) => a.batch.id - b.batch.id);
  const w = wagesFor(`${year}-01`, wages);
  const lines: MonthLine[] = [];
  const seen = new Map<string, MonthLine>();
  const duplicates = new Map<string, Duplicate>();
  for (const { batch, planilla } of planillas) {
    for (const person of planilla.employees) {
      const key = personKey(person.docType, person.docNumber);
      const id = `${key}|${planilla.period}`;
      const first = seen.get(id);
      if (first) {
        const d = duplicates.get(id) ?? { key, name: person.name, period: planilla.period, batchIds: [first.batchId] };
        d.batchIds.push(batch.id);
        duplicates.set(id, d);
        continue;
      }
      const line: MonthLine = {
        batchId: batch.id,
        fileName: batch.fileName,
        operatorLabel: planilla.operatorLabel,
        planillaNumber: planilla.planillaNumber,
        period: planilla.period,
        key,
        person,
        calc: computeMonth(person.pension.ibc ?? 0, person.pension.days ?? 0, w?.smmlv ?? 0, w?.transport ?? 0),
      };
      seen.set(id, line);
      lines.push(line);
    }
  }
  lines.sort((a, b) => a.period.localeCompare(b.period) || a.key.localeCompare(b.key));
  return { year, planillas, lines, duplicates: [...duplicates.values()], coverage: monthlyCoverage(year, batches), wagesMissing: !w };
}

