/**
 * Pendientes de Transacciones Cripto. Cada uno dice exactamente qué falta y, cuando se resuelve en esta misma pantalla, lleva
 * lo necesario para abrir la resolución (tipo de documento, ciudad, país, dirección…).
 */
export type CryptoProblemKind =
  | "document_type"
  | "identification"
  | "name"
  | "city_unknown"
  | "city_ambiguous"
  | "city_multiple"
  | "city_empty"
  | "country"
  | "address"
  | "assignment"
  | "assignment_invalid"
  | "amount"
  | "duplicate"
  | "unclassified"
  | "year"
  | "coverage"
  | "puc"
  | "cutoff"
  | "unproposed";

export interface CryptoProblem {
  level: "blocking" | "warning";
  kind: CryptoProblemKind;
  message: string;
  /** Registro de Exógena afectado (`source_key`). */
  recordKey?: string;
  /** Campo afectado del registro. */
  field?: string;
  /** Datos para abrir la resolución (clave de tercero, valor original, etc.). */
  payload?: Record<string, string | number>;
}

export const blocking = (problems: readonly CryptoProblem[]) => problems.filter((p) => p.level === "blocking");
