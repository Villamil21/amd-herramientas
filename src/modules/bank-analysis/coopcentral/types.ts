/**
 * Modelo del extracto Coopcentral. A diferencia de Bancolombia (una columna
 * VALOR con signo), aquí hay dos columnas: CREDITOS (entra dinero) y DEBITOS
 * (sale dinero). El tipo lo decide la columna que trae el valor, nunca el
 * texto del concepto.
 *
 * Importes en centavos enteros y siempre positivos, tal como en el PDF.
 */
import type { CheckStatus, ParseIssue } from "../shared/types";

export type TransactionType = "credit" | "debit";

export interface CoopcentralMovement {
  /** Orden dentro del extracto, contando también las filas anómalas. */
  index: number;
  concept: string;
  creditCents: number;
  debitCents: number;
  transactionType: TransactionType;
  /** Valor de la columna que determinó el tipo (positivo). */
  amountCents: number;
  balanceCents?: number;
  document?: string;
  office?: string;
  /** DD/MM/AAAA (el PDF usa A/M/D). */
  applicationDate?: string;
  operationDate?: string;
  electronicTransfer?: string;
  page: number;
}

/** Fila con valor en CREDITOS y en DEBITOS a la vez: no se clasifica, se deja para revisión. */
export interface CoopcentralAnomaly {
  index: number;
  page: number;
  concept: string;
  creditCents: number;
  debitCents: number;
  balanceCents?: number;
  text: string;
}

/** Bloque «TOTALES DEL PERIODO AGRUPADOS POR CONCEPTO» (solo para validar, nunca genera movimientos). */
export interface CoopcentralPeriodTotals {
  consignacionesCents?: number;
  retirosCents?: number;
  notasDebitoCents?: number;
  notasCreditoCents?: number;
  saldoEnCanjeCents?: number;
  interesesRecibidosCents?: number;
  retencionCents?: number;
  gmfCents?: number;
}

export interface CoopcentralStatement {
  bank: "Coopcentral";
  accountNumber?: string;
  periodFrom?: string;
  periodTo?: string;
  pageCount: number;
  movementsByPage: Record<number, number>;
  movements: CoopcentralMovement[];
  anomalies: CoopcentralAnomaly[];
  issues: ParseIssue[];
  /** Fila SALDO INICIAL. */
  openingBalanceCents?: number;
  /** Fila SALDO FINAL. */
  closingBalanceCents?: number;
  periodTotals: CoopcentralPeriodTotals;
  /** Conceptos reconstruidos a partir de varias líneas del PDF. */
  joinedLines: number;
}

export interface CoopcentralGroup {
  key: string;
  concept: string;
  transactionType: TransactionType;
  count: number;
  totalCents: number;
  movements: CoopcentralMovement[];
}

export interface CoopcentralSummary {
  movementCount: number;
  /** Conceptos únicos sin importar si aparecen como crédito o débito. */
  conceptCount: number;
  creditGroups: number;
  debitGroups: number;
  totalCreditsCents: number;
  totalDebitsCents: number;
  /** Total créditos − total débitos. */
  netCents: number;
}

export interface CoopcentralCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  /** Informativo: se muestra, pero no impide marcar el análisis como validado. */
  informative?: boolean;
}

export interface CoopcentralValidation {
  validated: boolean;
  checks: CoopcentralCheck[];
}

export const TYPE_LABEL: Record<TransactionType, string> = { credit: "Crédito", debit: "Débito" };
export const TYPE_ORDER: Record<TransactionType, number> = { credit: 0, debit: 1 };
