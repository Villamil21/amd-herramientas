import { normalizeKey } from "../../../../utils/text";

/** Códigos que excluyen el documento del cálculo de retención. */
export const EXCLUDED_CODES: Record<string, string> = {
  "O-15": "Autorretenedor",
  "O-47": "Régimen simple de tributación",
};

/**
 * Códigos tributarios de un texto de régimen / responsabilidad:
 * "O-13;O-23" → ["O-13", "O-23"], "R-99-PN" → ["R-99-PN"]. Sin repetir y ordenados.
 */
export function fiscalCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/(?<![A-Z0-9])([OR])\s?-\s?(\d{1,2})(?:-(P[NJ]))?(?![0-9])/g)) {
    out.add(`${m[1]}-${m[2].padStart(2, "0")}${m[3] ? `-${m[3]}` : ""}`);
  }
  return [...out].sort();
}

/** Valor que se guarda en el proveedor: los códigos o, si no hay, el texto leído. */
export const regimeValue = (codes: string[], text?: string) => (codes.length ? codes.join(";") : (text ?? "").trim());

/** Clave para comparar regímenes (mismos códigos en cualquier orden = mismo régimen). */
export function regimeKey(value: string | null | undefined): string {
  const codes = fiscalCodes(value);
  return codes.length ? codes.join(";") : normalizeKey(value ?? "");
}

export const excludedCode = (codes: string[]) => codes.find((c) => c in EXCLUDED_CODES);
