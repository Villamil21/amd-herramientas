import type { Cell } from "../../../../types/excel";
import { parseNumericText } from "../../../../utils/numbers";

/**
 * Importes exactos en millonésimas de peso (bigint). Excel guarda números
 * binarios (832.96 es 832.9599999…); se toma su representación decimal más
 * corta, que es la que muestra Excel, y se escala sin pasar por floats.
 */
export const SCALE = 1_000_000n;
const DECIMALS = 6;

/** Mitad hacia arriba (lejos de cero), como el resto de módulos tributarios. */
function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = (abs * 2n + d) / (d * 2n);
  return neg ? -q : q;
}

/** Número de Excel → millonésimas. null si no es finito. */
export function toMicro(value: number): bigint | null {
  if (!Number.isFinite(value)) return null;
  // String() da la representación más corta que identifica al número; en notación
  // exponencial (muy grande o muy pequeño) se pasa a decimales fijos.
  let text = String(value);
  if (/e/i.test(text)) text = value.toFixed(DECIMALS + 2);
  const negative = text.startsWith("-");
  const [int, frac = ""] = text.replace("-", "").split(".");
  const extra = frac.length > DECIMALS ? frac.slice(DECIMALS) : "";
  let micro = BigInt(int || "0") * SCALE + BigInt(frac.slice(0, DECIMALS).padEnd(DECIMALS, "0") || "0");
  // Más de 6 decimales (no ocurre en archivos DIAN): se redondea en la sexta.
  if (extra && Number(extra[0]) >= 5) micro += 1n;
  return negative ? -micro : micro;
}

/**
 * Importe de una celda. Vacía = 0. Texto numérico ("1.234,56", "$ 1.234") se
 * acepta; texto no numérico o error de Excel = null (requiere revisión).
 */
export function cellMicro(cell: Cell | undefined): bigint | null {
  if (!cell || cell.t === "e") return 0n;
  if (cell.t === "n") return toMicro(cell.v);
  if (cell.t === "s") {
    if (!cell.v.trim()) return 0n;
    const value = parseNumericText(cell.v);
    return value === null ? null : toMicro(value);
  }
  return null;
}

/** Millonésimas → centavos (solo para mostrar o exportar; los cálculos usan millonésimas). */
export const microToCents = (micro: bigint) => Number(divRound(micro, 10_000n));

/** Base (millonésimas) × tarifa (centésimas de punto) → centavos, redondeado una sola vez. */
export const withholdingCents = (baseMicro: bigint, rateBp: number) => Number(divRound(baseMicro * BigInt(rateBp), 100_000_000n));

export const sumMicro = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
