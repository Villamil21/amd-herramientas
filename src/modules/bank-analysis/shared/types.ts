/**
 * Tipos comunes a todos los bancos. Cada parser convierte su formato de
 * extracto en un ParsedStatement; agrupación, validación, resumen, interfaz y
 * exportación trabajan solo con estos tipos.
 *
 * Todos los importes están en centavos enteros para sumar sin errores de
 * coma flotante.
 */

export type Sign = "positive" | "negative" | "zero";

export interface BankMovement {
  /** Posición en el extracto (0, 1, 2…), en el orden en que aparece. */
  index: number;
  /** Fecha tal como aparece en el extracto (ej. "2/01"). */
  date: string;
  /** Fecha completa DD/MM/AAAA cuando el periodo del extracto permite deducir el año. */
  fullDate?: string;
  description: string;
  valueCents: number;
  balanceCents?: number;
  branch?: string;
  document?: string;
  page: number;
  sign: Sign;
}

/** Totales del bloque RESUMEN del extracto (los que se pudieron leer). */
export interface StatementTotals {
  previousBalanceCents?: number;
  totalCreditsCents?: number;
  totalDebitsCents?: number;
  currentBalanceCents?: number;
}

/** Texto dentro de la tabla que parecía un movimiento pero no se pudo interpretar. */
export interface ParseIssue {
  page: number;
  text: string;
  reason: string;
}

export interface ParsedStatement {
  bank: string;
  accountNumber?: string;
  periodFrom?: string;
  periodTo?: string;
  pageCount: number;
  /** Movimientos encontrados en cada página (página → cantidad). */
  movementsByPage: Record<number, number>;
  movements: BankMovement[];
  totals: StatementTotals;
  issues: ParseIssue[];
  /** Descripciones reconstruidas a partir de varias líneas del PDF. */
  joinedLines: number;
}

export interface MovementGroup {
  key: string;
  description: string;
  sign: Sign;
  count: number;
  totalCents: number;
  movements: BankMovement[];
}

export interface StatementSummary {
  movementCount: number;
  conceptCount: number;
  positiveGroups: number;
  negativeGroups: number;
  zeroGroups: number;
  totalPositiveCents: number;
  totalNegativeCents: number;
  netCents: number;
}

export type CheckStatus = "ok" | "failed" | "unavailable";

export interface ValidationCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface StatementValidation {
  /** true solo si todos los controles disponibles pasaron y no hubo filas sin interpretar. */
  validated: boolean;
  checks: ValidationCheck[];
}

/** Error con un mensaje listo para mostrar al usuario. */
export class StatementError extends Error {}
