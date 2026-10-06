/**
 * Modelo del «Extracto de Cuenta» de BBVA. La tabla trae dos columnas de
 * valor: Cargos (sale dinero) y Abonos (entra dinero). El tipo lo decide la
 * columna que trae el valor, nunca el texto del concepto.
 *
 * Importes en centavos enteros y siempre positivos, tal como en el PDF.
 */
import type { CheckStatus, ParseIssue, TransactionType } from "../shared/types";

/** credit = Abono (ingreso) · debit = Cargo (egreso). */
export const BBVA_TYPE_LABEL: Record<TransactionType, string> = { credit: "Abono", debit: "Cargo" };

export interface BbvaMovement {
  /** Orden dentro del extracto, contando también las filas anómalas. */
  index: number;
  /** Número de la columna Movimiento; las últimas filas del extracto (intereses, retefuente) no lo traen. */
  movementNumber?: string;
  /** Fecha operación tal como aparece (DD-MM-AAAA). */
  operationDate: string;
  /** Fecha valor tal como aparece (DD-MM-AAAA). */
  valueDate: string;
  concept: string;
  /** Valor de la columna Cargos (0 si está vacía). */
  chargeCents: number;
  /** Valor de la columna Abonos (0 si está vacía). */
  creditCents: number;
  transactionType: TransactionType;
  /** Valor de la columna que determinó el tipo (positivo). */
  amountCents: number;
  balanceCents?: number;
  page: number;
  /** Posición de la fila dentro de la tabla de su página (1, 2, 3…). */
  row: number;
  /** Línea base de la fila en la página (coordenadas PDF: crece hacia arriba). */
  y: number;
}

/** Fila con valor en Cargos y en Abonos a la vez: no se clasifica, se deja para revisión. */
export interface BbvaAnomaly {
  index: number;
  movementNumber?: string;
  operationDate: string;
  valueDate: string;
  concept: string;
  chargeCents: number;
  creditCents: number;
  balanceCents?: number;
  page: number;
  row: number;
  y: number;
  text: string;
}

/** Una línea del bloque «Resumen de movimientos»: cantidad (No.) y valor. */
export interface BbvaSummaryLine {
  /** Cantidad de movimientos; el extracto la deja vacía cuando no hubo ninguno. */
  count?: number;
  cents: number;
}

/** Bloque «Resumen de movimientos» de la primera página (lo que se pudo leer). */
export interface BbvaTotals {
  /** SALDO CIERRE MES ANTERIOR. */
  openingBalanceCents?: number;
  credits?: BbvaSummaryLine;
  interest?: BbvaSummaryLine;
  charges?: BbvaSummaryLine;
  vat?: BbvaSummaryLine;
  fourPerThousand?: BbvaSummaryLine;
  withholdings?: BbvaSummaryLine;
  /** SALDO FINAL. */
  closingBalanceCents?: number;
}

export interface BbvaStatement {
  bank: "BBVA";
  accountNumber?: string;
  clientName?: string;
  /** AAAA/MM/DD */
  periodFrom?: string;
  periodTo?: string;
  /** Fecha de corte, AAAA/MM/DD. */
  cutoffDate?: string;
  pageCount: number;
  movementsByPage: Record<number, number>;
  movements: BbvaMovement[];
  anomalies: BbvaAnomaly[];
  issues: ParseIssue[];
  totals: BbvaTotals;
}

export interface BbvaGroup {
  key: string;
  concept: string;
  transactionType: TransactionType;
  count: number;
  totalCents: number;
  movements: BbvaMovement[];
}

export interface BbvaSummary {
  movementCount: number;
  /** Conceptos únicos sin importar si aparecen como cargo o abono. */
  conceptCount: number;
  creditGroups: number;
  chargeGroups: number;
  totalCreditsCents: number;
  totalChargesCents: number;
  /** Total abonos − total cargos. */
  netCents: number;
}

export interface BbvaCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface BbvaValidation {
  validated: boolean;
  checks: BbvaCheck[];
}
