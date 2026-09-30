/**
 * Aritmética en centavos enteros (sin punto flotante). Las tarifas van en
 * centésimas de punto (4 % → 400) y la base UVT en centésimas de UVT (2 → 200).
 */

/** a × b / d redondeado a la unidad, mitad hacia arriba (lejos de cero). Sin redondeo bancario. */
export function mulDivRound(a: number, b: number, d: number): number {
  const n = BigInt(Math.round(a)) * BigInt(Math.round(b));
  const den = BigInt(d);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = (abs * 2n + den) / (den * 2n);
  return Number(neg ? -q : q);
}

/** Retención = Base × Tarifa, en centavos. */
export const retentionCents = (baseCents: number, rateBp: number) => mulDivRound(baseCents, rateBp, 10_000);

/** Base mínima en centavos = Base UVT × Valor UVT (centésimas de UVT × pesos = centavos). */
export const minBaseCents = (baseUvtCenti: number, uvtPesos: number) => baseUvtCenti * uvtPesos;

/** Tarifa implícita (centésimas de punto) = Rete fuente / Base × 100. */
export const impliedRateBp = (retentionCents: number, baseCents: number) => (baseCents > 0 ? mulDivRound(retentionCents, 10_000, baseCents) : undefined);

/** Diferencia aceptada entre la retención calculada y la informada (redondeo del documento). */
export const ROUNDING_TOLERANCE_CENTS = 100;

export const sameRetention = (a: number, b: number) => Math.abs(a - b) <= ROUNDING_TOLERANCE_CENTS;

/** Al múltiplo de $1.000 más cercano: 500 o más sube, menos de 500 baja (simétrico para negativos). */
export function roundToThousands(cents: number): number {
  const unit = 100_000;
  const abs = Math.abs(cents);
  const rounded = Math.floor((abs + unit / 2) / unit) * unit;
  return cents < 0 ? -rounded : rounded;
}

/** 400 → "4 %", 250 → "2,5 %", 10 → "0,1 %". Con `fixed` siempre dos decimales: "4,00 %". */
export function formatRateBp(bp: number, fixed = false): string {
  const text = (bp / 100).toFixed(2);
  const value = (fixed ? text : text.replace(/\.?0+$/, "")).replace(".", ",");
  return `${value} %`;
}

/** Centésimas de UVT → "2", "2,5". */
export const formatUvt = (centi: number) => (centi / 100).toFixed(2).replace(/\.?0+$/, "").replace(".", ",");

/**
 * Texto con coma decimal → centésimas ("2,5" → 250, "4" → 400, "0,1" → 10).
 * null si no es un número válido con hasta dos decimales.
 */
export function parseHundredths(text: string): number | null {
  const m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(text.trim().replace(/\s*%$/, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Pesos escritos por el usuario ("1.950.000", "1950000", "1.950.000,50") → centavos. */
export function parsePesosInput(text: string): number | null {
  const t = text.trim().replace(/^\$\s*/, "");
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1].replace(/\./g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** "2026-01" → "Enero 2026". */
export const periodLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`;

/** "2026-01-31" → "31/01/2026". */
export const formatDate = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
