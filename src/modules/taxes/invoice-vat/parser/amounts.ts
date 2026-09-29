import type { RateBp } from "../types";

/**
 * Valor en formato colombiano: punto de miles y coma decimal ("133.238,00",
 * "-6.662,00", "0,00", "$ 1.500"). Se admiten 0 a 2 decimales. null si el
 * texto no tiene exactamente ese formato (no se usa parseFloat).
 */
const COP_AMOUNT = /^(-)?\$?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

export function parseCopAmount(text: string): number | null {
  const m = COP_AMOUNT.exec(text.trim());
  if (!m) return null;
  const [, minus, int, dec = ""] = m;
  const cents = Number(int.replace(/\./g, "")) * 100 + Number(dec.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return minus && cents !== 0 ? -cents : cents;
}

export const isCopAmount = (text: string) => parseCopAmount(text) !== null;

/** Tarifa de la columna %: "19.00", "5.00", "0.00", "19,00", "19" o "19%". Hasta 100. */
const RATE = /^(\d{1,3})(?:[.,](\d{1,2}))?\s*%?$/;

export function parseRate(text: string): RateBp | null {
  const m = RATE.exec(text.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

/** Valor con punto decimal del texto del código QR ("44083.00"). */
export function parseDotDecimal(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 1900 → "19 %", 850 → "8,5 %". */
export function formatRateBp(bp: RateBp): string {
  const value = (bp / 100).toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
  return `${value} %`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Centavos → "$44.082" (o "$44.082,50" si hay centavos). */
export function formatCop(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const dec = abs % 100;
  const text = `$${groupThousands(String(Math.floor(abs / 100)))}${dec ? `,${String(dec).padStart(2, "0")}` : ""}`;
  return cents < 0 ? `-${text}` : text;
}
