import type { Presentation } from "../../../types/fs";

/**
 * Presentación contable de una empresa y un año: UNA sola fuente de verdad (la decisión «presentation» de Transacciones Cripto,
 * guardada por empresa y año). El Generador y Transacciones Cripto la leen y la cambian por el mismo camino; nunca hay dos
 * selectores independientes que puedan contradecirse.
 */
export type AccountingPresentation = "otc" | "banks" | "dr";

export const ACCOUNTING_PRESENTATIONS: readonly AccountingPresentation[] = ["otc", "banks", "dr"];

/** El mismo nombre en todas las pantallas. */
export const ACCOUNTING_LABEL: Record<AccountingPresentation, string> = { otc: "OTC", banks: "Bancos", dr: "DR" };

export const DEFAULT_ACCOUNTING_PRESENTATION: AccountingPresentation = "otc";

export const isAccountingPresentation = (v: unknown): v is AccountingPresentation => v === "otc" || v === "banks" || v === "dr";

/**
 * Cómo dibuja el motor del Generador cada presentación: OTC condensa el valor de terceros en Ventas y Costo de ventas; Bancos y DR
 * lo presentan en sus líneas (en DR solo hay ingreso propio). El resultado nunca cambia.
 */
export const engineView = (p: AccountingPresentation): Presentation => (p === "otc" ? "otc" : "bank");
