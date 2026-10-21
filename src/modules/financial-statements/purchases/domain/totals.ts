import type { TotalDecision } from "../../../../types/purchases";

/** Hasta $10 COP (inclusive) de diferencia entre la suma de las líneas y el Total Bruto Factura es redondeo: no bloquea. */
export const ROUNDING_TOLERANCE_CENTS = 1000;

/**
 * - `none`: la factura no trae Total Bruto Factura legible; no se valida (nunca se usa el Subtotal).
 * - `ok`: las líneas coinciden exactamente con el Total Bruto Factura.
 * - `rounding`: diferencia dentro de la tolerancia; prevalece el Total Bruto Factura (ajuste auditable).
 * - `rounding-legacy`: igual, pero la factura ya estaba confirmada antes de esta regla: no se ajusta sola, solo con acción explícita.
 * - `mismatch`: diferencia mayor; hay que resolverla.
 * - `stale`: había una decisión, pero la factura cambió desde entonces; se vuelve a preguntar.
 * - `resolved`: el usuario decidió (usar Total Bruto, usar la suma de líneas o excluir).
 */
export type TotalStatus = "none" | "ok" | "rounding" | "rounding-legacy" | "mismatch" | "stale" | "resolved";

export interface TotalCheck {
  status: TotalStatus;
  /** Suma de las bases de las líneas (valor absoluto, tal como las leyó el parser o las corrigió el usuario). */
  linesCents: number;
  grossCents?: number;
  /** Total Bruto Factura − suma de líneas (valor absoluto, antes del signo de la nota crédito). */
  differenceCents: number;
  /** Lo que se suma a la base de la factura (siempre en valor absoluto; el signo lo pone el tipo de documento). */
  adjustmentCents: number;
  decision?: TotalDecision;
  /** La factura tenía líneas confirmadas antes de que rigiera la regla del Total Bruto Factura. */
  legacy: boolean;
}

export interface TotalCheckInput {
  linesCents: number;
  /** `grossTotalCents` del PDF: «Total Bruto Factura». */
  grossCents: number | undefined;
  decision?: TotalDecision;
  legacy?: boolean;
}

/** Compara la suma de líneas con el Total Bruto Factura (nunca con el Subtotal) y define el ajuste. */
export function totalCheck({ linesCents, grossCents, decision, legacy = false }: TotalCheckInput): TotalCheck {
  const base = { linesCents, grossCents, differenceCents: 0, adjustmentCents: 0, legacy };
  if (grossCents === undefined) return { ...base, status: "none" };
  const gross = Math.abs(grossCents);
  const lines = Math.abs(linesCents);
  const diff = gross - lines;
  const withDiff = { ...base, linesCents: lines, grossCents: gross, differenceCents: diff };
  const valid = decision && decision.linesCents === lines && decision.grossCents === gross ? decision : undefined;
  if (valid && valid.choice !== "exclude") {
    return { ...withDiff, status: "resolved", decision: valid, adjustmentCents: valid.choice === "gross" ? diff : 0 };
  }
  if (diff === 0) return { ...withDiff, status: "ok" };
  if (Math.abs(diff) <= ROUNDING_TOLERANCE_CENTS) {
    return legacy ? { ...withDiff, status: "rounding-legacy" } : { ...withDiff, status: "rounding", adjustmentCents: diff };
  }
  if (decision && decision.choice !== "exclude") return { ...withDiff, status: "stale", decision };
  return { ...withDiff, status: "mismatch" };
}

/** ¿Hay que resolver la diferencia antes de usar la factura? */
export const needsResolution = (s: TotalStatus) => s === "mismatch" || s === "stale";

/** «22.175,67» o «22175,67» o «22175.67» → centavos; undefined si no es un importe válido. */
export function parseCentsInput(text: string): number | undefined {
  const t = text.trim().replace(/\s|\$/g, "");
  if (!/^-?[\d.,]+$/.test(t) || !/\d/.test(t)) return undefined;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  const sep = Math.max(lastComma, lastDot);
  // El último separador es decimal solo si lo siguen 1–2 dígitos (en Colombia el punto separa miles).
  const decimal = sep >= 0 && t.length - sep - 1 <= 2 && (lastComma >= 0 ? sep === lastComma : t.indexOf(".") === lastDot) ? sep : -1;
  const intPart = (decimal >= 0 ? t.slice(0, decimal) : t).replace(/[.,]/g, "");
  const frac = decimal >= 0 ? t.slice(decimal + 1).padEnd(2, "0") : "00";
  const n = Number(`${intPart}.${frac}`);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}
