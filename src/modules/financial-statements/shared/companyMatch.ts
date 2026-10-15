import type { Company } from "../../../types/models";
import { normalizeKey } from "../../../utils/text";

/**
 * La empresa de un documento se identifica por NIT (nunca por el nombre). El
 * nombre escrito en el documento es una validación secundaria: si es muy
 * distinto al de la empresa guardada se genera una alerta bloqueante.
 */

/** «900.738.791-1» → «900738791» (sin dígito de verificación). */
export function normalizeNit(value: string | undefined | null): string {
  return (value ?? "").split("-")[0].replace(/\D/g, "");
}

export function findCompanyByNit(companies: Company[], nit: string | undefined | null): Company | undefined {
  const key = normalizeNit(nit);
  return key ? companies.find((c) => normalizeNit(c.nit) === key) : undefined;
}

/** Formas societarias y relleno que no distinguen a una empresa de otra. */
const NOISE = new Set(["sas", "sa", "s", "a", "ltda", "limitada", "eu", "e", "u", "inc", "corp", "y", "cia", "en", "c", "de", "la", "el", "los", "las", "bic", "sociedad", "por", "acciones", "simplificada", "anonima", "colombia"]);

function coreTokens(name: string): string[] {
  return normalizeKey(name)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t));
}

/**
 * Los nombres son «el mismo» salvo diferencias menores: mayúsculas, tildes,
 * puntuación y forma societaria (GESAP SAS = GESAP S.A.S. = Gesap Sas). Un
 * nombre que comparte menos de la mitad de sus palabras propias es distinto.
 */
export function namesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = coreTokens(a ?? "");
  const y = coreTokens(b ?? "");
  if (x.length === 0 || y.length === 0) return true; // sin nombre no hay con qué comparar
  const joinedX = x.join("");
  const joinedY = y.join("");
  if (joinedX === joinedY || joinedX.includes(joinedY) || joinedY.includes(joinedX)) return true;
  const setY = new Set(y);
  const shared = x.filter((t) => setY.has(t)).length;
  return shared / Math.max(x.length, y.length) >= 0.5;
}
