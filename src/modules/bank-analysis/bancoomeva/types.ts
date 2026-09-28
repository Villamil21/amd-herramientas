/**
 * Modelo del extracto Bancoomeva. Como en Coopcentral, hay dos columnas de
 * valor: VALOR CREDITO (entra dinero) y VALOR DEBITO (sale dinero). El tipo
 * lo decide la columna que trae el valor, nunca el texto de la descripción
 * (N/CNC, N/DND…).
 *
 * Importes en centavos enteros y siempre positivos, tal como en el PDF.
 */
import type { CheckStatus, DebitCreditSummary, ParseIssue, TransactionType } from "../shared/types";

export interface BancoomevaMovement {
  /** Orden dentro del extracto, contando también las filas anómalas. */
  index: number;
  /** Fecha tal como aparece (DD-MM-AAAA). */
  date: string;
  office?: string;
  description: string;
  debitCents: number;
  creditCents: number;
  transactionType: TransactionType;
  /** Valor de la columna que determinó el tipo (positivo). */
  amountCents: number;
  balanceCents?: number;
  page: number;
}

/** Fila con valor en VALOR DEBITO y VALOR CREDITO a la vez: no se clasifica, se deja para revisión. */
export interface BancoomevaAnomaly {
  index: number;
  page: number;
  date: string;
  description: string;
  debitCents: number;
  creditCents: number;
  balanceCents?: number;
  text: string;
}

/** Bloque SALDO INICIAL · TOTAL DEBITO · TOTAL CREDITO · SALDO FINAL (se repite en cada página). */
export interface BancoomevaTotals {
  openingBalanceCents?: number;
  totalDebitsCents?: number;
  totalCreditsCents?: number;
  closingBalanceCents?: number;
}

export interface BancoomevaStatement {
  bank: "Bancoomeva";
  accountNumber?: string;
  /** AAAA/MM/DD */
  periodFrom?: string;
  periodTo?: string;
  pageCount: number;
  movementsByPage: Record<number, number>;
  movements: BancoomevaMovement[];
  anomalies: BancoomevaAnomaly[];
  issues: ParseIssue[];
  /** Totales del extracto completo (se toman una sola vez). */
  totals: BancoomevaTotals;
  /** Páginas cuyo bloque de totales no coincide con el de la primera página que lo trae. */
  totalsMismatchPages: number[];
  /** Descripciones reconstruidas a partir de varias líneas del PDF. */
  joinedLines: number;
}

export interface BancoomevaGroup {
  key: string;
  description: string;
  transactionType: TransactionType;
  count: number;
  totalCents: number;
  movements: BancoomevaMovement[];
}

export type BancoomevaSummary = DebitCreditSummary;

export interface BancoomevaCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface BancoomevaValidation {
  validated: boolean;
  checks: BancoomevaCheck[];
}
