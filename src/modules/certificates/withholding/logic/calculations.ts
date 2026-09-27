import type { Concept, TipoRetencion, UnidadTarifa } from "../../../../types/models";
import { normalizeKey } from "../../../../utils/text";

const RATE_SCALE = 10_000n; // las tarifas admiten hasta 4 decimales

/**
 * Valor retenido en centavos, redondeado al peso más cercano (como el
 * certificado de referencia: 37.731,96 → $ 37.732,00).
 * Se calcula con enteros (BigInt) para evitar errores de coma flotante.
 *
 *   Porcentaje: base × tarifa / 100
 *   Por mil:    base × tarifa / 1000
 */
export function retainedCents(baseCents: number, rate: number, unit: UnidadTarifa): number {
  const divisor = unit === "PORCENTAJE" ? 100n : 1000n;
  const rateScaled = BigInt(Math.round(rate * Number(RATE_SCALE)));
  const numerator = BigInt(Math.round(baseCents)) * rateScaled;
  const denominator = divisor * RATE_SCALE * 100n; // → pesos
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  let pesos = abs / denominator;
  if ((abs % denominator) * 2n >= denominator) pesos += 1n; // mitad hacia arriba
  const cents = Number(pesos) * 100;
  return negative ? -cents : cents;
}

/**
 * Tipo de retención de un concepto. Se usa el campo estructurado; el nombre
 * solo es respaldo para conceptos antiguos o importados sin tipo válido.
 */
export function resolveTipo(concept: Pick<Concept, "nombre"> & { tipoRetencion?: string | null }): TipoRetencion | null {
  if (concept.tipoRetencion === "ICA" || concept.tipoRetencion === "RETEFUENTE") return concept.tipoRetencion;
  const name = normalizeKey(concept.nombre);
  if (/\bica\b/.test(name)) return "ICA";
  if (/retencion|retefuente|rete fuente/.test(name)) return "RETEFUENTE";
  return null;
}

export function certificateTitle(tipos: TipoRetencion[]): string {
  const hasIca = tipos.includes("ICA");
  const hasRete = tipos.includes("RETEFUENTE");
  if (hasIca && hasRete) return "CERTIFICADO DE RETENCIÓN E ICA A TÍTULO DE RENTA";
  if (hasIca) return "CERTIFICADO DE ICA A TÍTULO DE RENTA";
  return "CERTIFICADO DE RETENCIÓN A TÍTULO DE RENTA";
}

const LEGAL_SUFFIX = /\b(S\s?\.?\s?A\s?\.?\s?S|S\s?\.?\s?A|LTDA|E\s?\.?\s?U|S\s?\.?\s?EN\s?C)\.?\s*$/i;

function fileToken(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

/** Certificado_Retencion_MONO_COLOMBIA_2026-03_2026-04.pdf */
export function certificateFileName(tipos: TipoRetencion[], retenido: string, startYm: string, endYm: string): string {
  const hasIca = tipos.includes("ICA");
  const hasRete = tipos.includes("RETEFUENTE");
  const kind = hasIca && hasRete ? "Retencion_ICA" : hasIca ? "ICA" : "Retencion";
  const name = fileToken(retenido.trim().replace(LEGAL_SUFFIX, "")) || "RETENIDO";
  const period = startYm === endYm ? startYm : `${startYm}_${endYm}`;
  return `Certificado_${kind}_${name}_${period}.pdf`;
}
