/**
 * Cierre de órdenes Dropi. Los importes se manejan en centavos (enteros)
 * para que las sumas de miles de filas no acumulen errores de coma flotante.
 */

/** Estados con regla fija (no configurables por el usuario). */
export type FixedStatus = "delivered" | "cancelled" | "rejected" | "void" | "returned" | "indemnity";

/** Destinos que el usuario puede asignar a los demás estados. */
export type ConfigurableCategory = "in_process" | "claim" | "indemnity";

/** Clasificación de cada estado en el cierre. */
export type StatusCategory = "delivered" | "cancelled_group" | "returned" | "in_process" | "claim" | "indemnity" | "unclassified";

/** Estado normalizado → destino guardado por el usuario (SQLite). */
export type StatusRules = ReadonlyMap<string, ConfigurableCategory>;

export interface DropiOrderRow {
  /** Número de fila en Excel (1 = primera fila de la hoja). */
  rowNumber: number;
  /** "" si la fila no trae ID. */
  id: string;
  /** Texto original del estado (recortado). */
  status: string;
  /** Estado normalizado: mayúsculas, sin tildes, "_" como espacio, espacios colapsados. */
  statusKey: string;
  purchaseCents: number;
  supplierCents: number;
  freightCents: number;
  returnFreightCents: number;
  /** Columnas informativas para buscar (si existen en el archivo). */
  guide?: string;
  invoice?: string;
  customer?: string;
  date?: string;
}

export interface InvalidMoneyCell {
  rowNumber: number;
  column: string;
  text: string;
}

export interface ParsedOrdersFile {
  fileName: string;
  sheetName: string;
  /** Por qué se usó esa hoja (se muestra al usuario). */
  sheetReason: string;
  /** Otras hojas del libro que no se usaron para el cálculo. */
  ignoredSheets: string[];
  rows: DropiOrderRow[];
  /** Razón social si el archivo trae una sola (informativa). */
  company?: string;
  /** Periodo según la columna FECHA (informativo). */
  period?: string;
  invalidMoney: InvalidMoneyCell[];
  rowsWithoutId: number[];
  rowsWithoutStatus: number[];
}

export type ReadResult =
  | { kind: "ok"; file: ParsedOrdersFile }
  /** Varias hojas tienen la estructura y no se puede decidir con seguridad. */
  | { kind: "choose-sheet"; candidates: { name: string; rows: number }[] };

export interface MoneyTotals {
  purchaseCents: number;
  supplierCents: number;
  freightCents: number;
  returnFreightCents: number;
}

export interface StatusDetail extends MoneyTotals {
  key: string;
  /** Texto original (el primero encontrado en el archivo). */
  display: string;
  category: StatusCategory;
  fixed?: FixedStatus;
  /** Puede asignarse a En proceso, Siniestro o Indemnización. */
  configurable: boolean;
  rows: number;
  uniqueOrders: number;
}

export interface DropiOrdersSummary {
  billedCents: number;
  cancelledRejectedVoidCents: number;
  returnsCents: number;
  inProcessCents: number;
  claimCents: number;
  indemnityCents: number;
  /** Uso interno (validaciones); no es una métrica del bloque Ventas Dropi. */
  deliveredCents: number;
  unclassifiedCents: number;

  deliveredProductCostCents: number;
  deliveredFreightCostCents: number;
  returnFreightCostCents: number;

  dispatchedOrders: number;
  deliveredOrders: number;
  cancelledRejectedOrders: number;

  totalRows: number;
  uniqueOrders: number;
}

export interface DropiOrdersAnalysis {
  summary: DropiOrdersSummary;
  statuses: StatusDetail[];
  /** Estados configurables aún sin destino. */
  pending: StatusDetail[];
  /** Todos los estados tienen destino. */
  complete: boolean;
  /** IDs que aparecen en más de una fila (los importes se suman por fila). */
  repeatedIds: { id: string; rows: number }[];
  /** IDs con más de un estado distinto. */
  conflictingIds: { id: string; statuses: string[] }[];
}

export class DropiError extends Error {}
