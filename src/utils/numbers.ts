import type { Cell } from "../types/excel";

/**
 * Interpreta un número escrito como texto. Soporta:
 * 3906000 · 3.906.000 · 3,906,000 · 3906000.00 · 3906000,00 · $ 3.906.000,00 · (1.000) · -1.000
 *
 * Si hay un único separador seguido de exactamente 3 dígitos (ej. "3.906"),
 * se interpreta como separador de miles, que es la convención colombiana.
 */
export function parseNumericText(text: string): number | null {
  let s = text.replace(/[\s $]/g, "").replace(/^COP/i, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    const [intPart, decPart, ...rest] = s.split(decimal);
    if (rest.length > 0) return null;
    const groups = intPart.split(thousands);
    if (groups.slice(1).some((g) => g.length !== 3)) return null;
    normalized = `${groups.join("")}.${decPart}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (parts.slice(1).some((p) => p.length !== 3)) return null;
      normalized = parts.join("");
    } else {
      const [a, b] = parts;
      const looksLikeThousands = b.length === 3 && a.length >= 1 && a.length <= 3 && a !== "0";
      normalized = looksLikeThousands ? a + b : `${a}.${b}`;
    }
  } else {
    normalized = s;
  }

  if (!/^\d*\.?\d*$/.test(normalized) || normalized === ".") return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Valor monetario de una celda. Vacía = 0. Devuelve null si no es un número válido.
 * Se prioriza el valor numérico original de Excel sobre el texto visible.
 */
export function cellAmount(cell: Cell | undefined): number | null {
  if (!cell || cell.t === "e") return 0;
  if (cell.t === "n") return Number.isFinite(cell.v) ? cell.v : null;
  if (cell.t === "s") return cell.v.trim() === "" ? 0 : parseNumericText(cell.v);
  return null;
}

/** Pesos → centavos enteros, para sumar sin errores de coma flotante. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

/** Tarifa escrita por el usuario ("9,66" o "9.66"), hasta 4 decimales. */
export function parseRate(text: string): number | null {
  const s = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) ? value : null;
}
