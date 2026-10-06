import { saveExcelSheets, type ExportSheet } from "../../shared/excelExportService";
import { BBVA_TYPE_LABEL, type BbvaGroup, type BbvaStatement } from "../types";

const pesos = (cents: number) => cents / 100;

/**
 * Hoja 1 «Resumen»: Concepto, Tipo, Cantidad de movimientos, Total. Hoja 2
 * «Movimientos»: cada movimiento en el orden del extracto, con Cargo y Abono
 * separados; la columna que el extracto deja vacía queda vacía.
 */
export function buildBbvaSheets(statement: BbvaStatement, groups: BbvaGroup[]): ExportSheet[] {
  const summary: ExportSheet = {
    name: "Resumen",
    columns: [
      { header: "Concepto", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Cantidad de movimientos", kind: "integer" },
      { header: "Total", kind: "money" },
    ],
    rows: groups.map((g) => [g.concept, BBVA_TYPE_LABEL[g.transactionType], g.count, pesos(g.totalCents)]),
  };

  const detail: ExportSheet = {
    name: "Movimientos",
    columns: [
      { header: "Movimiento", kind: "text" },
      { header: "Fecha operación", kind: "text" },
      { header: "Fecha valor", kind: "text" },
      { header: "Concepto", kind: "text" },
      { header: "Cargo", kind: "money" },
      { header: "Abono", kind: "money" },
      { header: "Saldo", kind: "money" },
      { header: "Página", kind: "integer" },
    ],
    rows: statement.movements.map((m) => [
      m.movementNumber ?? null,
      m.operationDate,
      m.valueDate,
      m.concept,
      m.transactionType === "debit" ? pesos(m.chargeCents) : null,
      m.transactionType === "credit" ? pesos(m.creditCents) : null,
      m.balanceCents === undefined ? null : pesos(m.balanceCents),
      m.page,
    ]),
  };

  return [summary, detail];
}

/** Nombre sugerido: Analisis_BBVA_7491_2026-08 (o el del PDF si no hay datos de cuenta). */
export function suggestedBbvaName(statement: BbvaStatement, pdfFileName: string): string {
  const account = statement.accountNumber?.slice(-4);
  const period = statement.periodTo?.slice(0, 7).replace("/", "-");
  if (account && period) return `Analisis_BBVA_${account}_${period}`;
  return `Analisis_${pdfFileName.replace(/\.pdf$/i, "")}`;
}

/** Diálogo nativo para guardar. Devuelve la ruta o null si se cancela. */
export function exportBbvaExcel(statement: BbvaStatement, groups: BbvaGroup[], pdfFileName: string) {
  return saveExcelSheets(buildBbvaSheets(statement, groups), suggestedBbvaName(statement, pdfFileName));
}
