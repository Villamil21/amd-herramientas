import type { RetentionPick } from "../../../../types/purchases";
import type { UvtValue, WithholdingRate } from "../../../../types/models";
import { impliedRateBp, minBaseCents, retentionCents, sameRetention } from "../../../taxes/withholding/services/money";

/**
 * Retención en la fuente de una factura, repartida por línea.
 *
 *  - La retención que trae la factura («Rete fuente») es la **practicada**: se conserva siempre tal cual.
 *  - Si la factura no la trae y la Tabla de retenciones la exige, es **asumida**.
 *  - Nunca se suma una asumida adicional a una practicada: si difieren, se alerta, se conserva el valor documentado y se sugiere
 *    el porcentaje que corresponde.
 *  - La cuantía mínima se evalúa con el UVT del año de la factura sobre la base de cada concepto (suma de sus líneas).
 *  - Las devoluciones usan los mismos importes (el signo lo aplica quien suma).
 */

export interface RetentionLineInput {
  index: number;
  baseCents: number;
  picks: readonly RetentionPick[];
}

export interface RateExpectation {
  rateId: number;
  name: string;
  rateBp: number;
  baseCents: number;
  minCents: number;
  belowMinimum: boolean;
  expectedCents: number;
}

export interface RetentionResult {
  /** Retención esperada por la Tabla de retenciones (suma de conceptos que superan su mínimo). */
  expectedCents: number;
  byRate: RateExpectation[];
  /** Conceptos elegidos que no existen ya en la Tabla de retenciones. */
  missingRates: number[];
  /** Falta el UVT del año de la factura (no se puede evaluar la cuantía mínima). */
  missingUvtYear?: number;
  /** Retención practicada por línea (índice de línea → centavos), sin signo. */
  practicedByLine: Map<number, number>;
  /** Retención asumida por línea. */
  assumedByLine: Map<number, number>;
  practicedCents: number;
  assumedCents: number;
  /** La informada difiere de la esperada (más allá del redondeo). */
  mismatch: boolean;
  /** Porcentaje (centésimas) que implica la retención informada sobre la base sujeta. */
  suggestedRateBp?: number;
}

/** Reparte `total` (≥ 0) en proporción a `weights` sin perder ni inventar centavos (mayor residuo; aritmética exacta con BigInt). */
export function allocate(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const w = weights.map((x) => BigInt(Math.max(Math.round(x), 0)));
  const sum = w.reduce((s, x) => s + x, 0n);
  // Sin pesos no hay criterio para repartir: todo a la primera.
  if (sum === 0n) return weights.map((_, i) => (i === 0 ? total : 0));
  const t = BigInt(total);
  const parts = w.map((x) => ({ floor: (t * x) / sum, rest: (t * x) % sum }));
  let left = Number(t - parts.reduce((s, p) => s + p.floor, 0n));
  const order = parts.map((p, i) => ({ rest: p.rest, i })).sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1));
  const out = parts.map((p) => Number(p.floor));
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
  return out;
}

export interface RetentionInput {
  lines: readonly RetentionLineInput[];
  /** «Rete fuente» de la factura (0 si no la trae). */
  informedCents: number;
  /** Régimen que no genera retención automática (O-15 / O-47). */
  exempt: boolean;
  /** Decisión del usuario ante una retención informada de un exento: se conserva o se elimina. */
  exemptDecision?: "keep" | "remove";
  issueYear: number | null;
  rates: readonly WithholdingRate[];
  uvts: readonly UvtValue[];
}

export function computeRetention(input: RetentionInput): RetentionResult {
  const byRate = new Map<number, { base: number; lines: RetentionLineInput[] }>();
  for (const line of input.lines) {
    for (const pick of line.picks) {
      const group = byRate.get(pick.rateId) ?? { base: 0, lines: [] };
      group.base += line.baseCents;
      group.lines.push(line);
      byRate.set(pick.rateId, group);
    }
  }
  const rateById = new Map(input.rates.map((r) => [r.id, r]));
  const uvt = input.issueYear === null ? undefined : input.uvts.find((u) => u.year === input.issueYear);
  const missingRates: number[] = [];
  const expectations: RateExpectation[] = [];
  const expectedByLine = new Map<number, number>();
  let missingUvtYear: number | undefined;

  for (const [rateId, group] of byRate) {
    const rate = rateById.get(rateId);
    if (!rate) {
      missingRates.push(rateId);
      continue;
    }
    if (!uvt) missingUvtYear = input.issueYear ?? undefined;
    const minCents = uvt ? minBaseCents(rate.baseUvtCenti, uvt.valuePesos) : 0;
    const belowMinimum = !uvt || group.base < minCents;
    const expectedCents = input.exempt || belowMinimum ? 0 : retentionCents(group.base, rate.rateBp);
    expectations.push({ rateId, name: rate.name, rateBp: rate.rateBp, baseCents: group.base, minCents, belowMinimum, expectedCents });
    if (expectedCents) {
      const shares = allocate(expectedCents, group.lines.map((l) => l.baseCents));
      group.lines.forEach((l, i) => expectedByLine.set(l.index, (expectedByLine.get(l.index) ?? 0) + shares[i]));
    }
  }

  const expectedCents = expectations.reduce((s, e) => s + e.expectedCents, 0);
  const informed = input.exempt && input.exemptDecision === "remove" ? 0 : input.informedCents;
  const practicedByLine = new Map<number, number>();
  const assumedByLine = new Map<number, number>();
  const lineIndexes = input.lines.map((l) => l.index);

  if (informed > 0) {
    // Se reparte en proporción a lo esperado por línea; sin esperado, a la base de las líneas con concepto; sin conceptos, a toda la base.
    const withRate = input.lines.filter((l) => l.picks.length > 0);
    const weights = expectedCents > 0 ? input.lines.map((l) => expectedByLine.get(l.index) ?? 0) : (withRate.length ? input.lines.map((l) => (l.picks.length ? l.baseCents : 0)) : input.lines.map((l) => l.baseCents));
    allocate(informed, weights).forEach((v, i) => v && practicedByLine.set(lineIndexes[i], v));
  } else if (expectedCents > 0) {
    for (const [index, v] of expectedByLine) assumedByLine.set(index, v);
  }

  const subject = expectations.filter((e) => !e.belowMinimum).reduce((s, e) => s + e.baseCents, 0);
  const comparable = !input.exempt && byRate.size > 0 && missingRates.length === 0 && !missingUvtYear;
  const mismatch = comparable && informed > 0 && !sameRetention(informed, expectedCents);
  const base = subject > 0 ? subject : input.lines.reduce((s, l) => s + l.baseCents, 0);
  return {
    expectedCents,
    byRate: expectations,
    missingRates,
    missingUvtYear,
    practicedByLine,
    assumedByLine,
    practicedCents: informed > 0 ? informed : 0,
    assumedCents: informed > 0 ? 0 : expectedCents,
    mismatch,
    suggestedRateBp: informed > 0 ? impliedRateBp(informed, base) : undefined,
  };
}

/** Conceptos de la Tabla de retenciones cuya tarifa coincide con la implícita (para sugerir el correcto). */
export function ratesNear(rates: readonly WithholdingRate[], rateBp: number | undefined): WithholdingRate[] {
  if (rateBp === undefined) return [];
  return rates.filter((r) => Math.abs(r.rateBp - rateBp) <= 5);
}
