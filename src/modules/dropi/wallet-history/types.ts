/**
 * Historial de carteras Dropi: retiros de saldo de la cartera. Los importes se
 * manejan en centavos (enteros) para que el 4x1000 y las sumas no acumulen
 * errores de coma flotante.
 */

/** Incidencias posibles de un movimiento; una fila puede tener varias. */
export type Incident = "type" | "duplicate" | "invalid_amount" | "gmf_review";

/** Cómo se obtuvo el valor pagado: la regla de Dropi (MONTO = pagado / 0,996) o una edición manual. */
export type SplitMethod = "calculated" | "manual";

export interface WalletMovement {
  /** Número de fila en Excel (1 = primera fila de la hoja). */
  rowNumber: number;
  /** "" si la fila no trae ID. */
  id: string;
  /** Fecha para mostrar (31/08/2026) o el texto original si no es una fecha reconocible. */
  date: string;
  /** Hora del archivo (10:19), solo para trazabilidad. */
  time?: string;
  /** Clave ordenable AAAA-MM-DD (vacía si la fecha no se reconoce). */
  dateKey: string;
  /** Texto original de TIPO (recortado). */
  type: string;
  /** MONTO en centavos: valor total descontado de la cartera (incluye el 4x1000). null = vacío o no válido. */
  amountCents: number | null;
  /** Texto original de MONTO (para mostrar cuando no es válido). */
  amountText: string;
  /** Texto original de DESCRIPCIÓN. */
  description: string;
  /** CONCEPTO DE RETIRO tal como viene en el archivo. */
  concept: string;
}

export interface ParsedWalletFile {
  fileName: string;
  sheetName: string;
  /** Por qué se usó esa hoja (se muestra al usuario). */
  sheetReason: string;
  /** Otras hojas del libro que no se usaron. */
  ignoredSheets: string[];
  /** El archivo trae la columna ID (sin ella no se detectan duplicados). */
  hasId: boolean;
  /** El archivo trae la columna TIPO. */
  hasType: boolean;
  movements: WalletMovement[];
  /** Periodo según la columna FECHA (informativo). */
  period?: string;
}

export type ReadResult =
  | { kind: "ok"; file: ParsedWalletFile }
  /** Varias hojas tienen la estructura y no se puede decidir con seguridad. */
  | { kind: "choose-sheet"; candidates: { name: string; rows: number }[] };

export interface AnalyzedMovement extends WalletMovement {
  /** Valor pagado: el B con redondeo(B / 0,996) = MONTO, o el editado. null si no se pudo determinar. */
  paidCents: number | null;
  /** 4x1000 = MONTO − Valor pagado. null si no se pudo determinar. */
  gmfCents: number | null;
  /** Valor pagado según la regla de Dropi (aunque luego se haya editado); null si no tiene solución. */
  calculatedPaidCents: number | null;
  method: SplitMethod | null;
  incidents: Incident[];
  /** Explicación del valor inválido (vacío, no numérico, negativo o cero). */
  amountProblem?: string;
}

export interface WalletTotals {
  /** Retiros validados (sin incidencias). */
  count: number;
  /** SUM(MONTO) de los retiros validados. */
  amountCents: number;
  paidCents: number;
  gmfCents: number;
}

export interface WalletAnalysis {
  /** Solo los retiros de saldo en cartera: los demás conceptos del archivo se ignoran. */
  movements: AnalyzedMovement[];
  /** Solo filas validadas: las que requieren revisión no se suman. */
  totals: WalletTotals;
  /** Filas que requieren revisión y la suma de su MONTO (las que tienen un monto válido). */
  review: { count: number; amountCents: number };
  /** Cantidad de filas por incidencia. */
  incidentCounts: Record<Incident, number>;
}

export class WalletHistoryError extends Error {}
