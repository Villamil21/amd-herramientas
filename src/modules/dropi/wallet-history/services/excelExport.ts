import { saveExcelSheets, type ExportSheet } from "../../../bank-analysis/shared/excelExportService";
import type { AnalyzedMovement, ParsedWalletFile, WalletAnalysis } from "../types";
import { INCIDENT_LABEL } from "./analysis";

const pesos = (cents: number | null) => (cents === null ? null : cents / 100);

export const statusLabel = (m: AnalyzedMovement) => (m.incidents.length === 0 ? "Validado" : m.incidents.map((i) => INCIDENT_LABEL[i]).join(" · "));

const incidentText = (m: AnalyzedMovement) => m.incidents.map((i) => (i === "invalid_amount" && m.amountProblem ? `${INCIDENT_LABEL[i]} (${m.amountProblem})` : INCIDENT_LABEL[i])).join(" · ");

/**
 * Hoja «Resumen» (Fecha, Valor pagado, 4x1000, Concepto retiro, Estado) con los
 * totales de los retiros validados al final; «Detalle» con ID, hora, tipo y MONTO
 * para auditar; «Incidencias» si alguna fila requiere revisión.
 */
export function buildWalletSheets(analysis: WalletAnalysis): ExportSheet[] {
  const text = (header: string) => ({ header, kind: "text" as const });
  const money = (header: string) => ({ header, kind: "money" as const });
  const { movements, totals, review } = analysis;

  const summary: ExportSheet = {
    name: "Resumen",
    columns: [text("Fecha"), money("Valor pagado"), money("4x1000"), text("Concepto retiro"), text("Estado")],
    rows: [
      ...movements.map((m) => [m.date || null, pesos(m.paidCents), pesos(m.gmfCents), m.concept || null, statusLabel(m)]),
      [null, null, null, null, null],
      ["Total valor pagado", pesos(totals.paidCents), null, null, "Solo retiros validados"],
      ["Total 4x1000", null, pesos(totals.gmfCents), null, "Solo retiros validados"],
      ["Total monto", pesos(totals.amountCents), null, null, "Valor total retirado (valor pagado + 4x1000)"],
      ...(review.count > 0 ? [["Por revisar (no incluidos)", pesos(review.amountCents), null, null, `${review.count} movimiento(s); ver hoja Incidencias`]] : []),
    ],
  };

  const detail: ExportSheet = {
    name: "Detalle",
    columns: [{ header: "Fila Excel", kind: "integer" as const }, text("ID"), text("Fecha"), text("Hora"), text("Tipo"), money("Monto"), money("Valor pagado"), money("4x1000"), text("Descripción"), text("Concepto retiro"), text("Estado")],
    rows: movements.map((m) => [
      m.rowNumber,
      m.id || null,
      m.date || null,
      m.time ?? null,
      m.type || null,
      m.amountCents === null ? m.amountText || null : pesos(m.amountCents),
      pesos(m.paidCents),
      pesos(m.gmfCents),
      m.description || null,
      m.concept || null,
      statusLabel(m),
    ]),
  };

  const sheets = [summary, detail];
  const flagged = movements.filter((m) => m.incidents.length > 0);
  if (flagged.length > 0) {
    sheets.push({
      name: "Incidencias",
      columns: [text("ID"), text("Fecha"), money("Monto"), text("Descripción"), text("Concepto retiro"), text("Incidencia")],
      rows: flagged.map((m) => [m.id || null, m.date || null, m.amountCents === null ? m.amountText || null : pesos(m.amountCents), m.description || null, m.concept || null, incidentText(m)]),
    });
  }
  return sheets;
}

/** «Historial cartera Dropi 08 2026 SK Glam SAS.xlsx» → «Resumen Historial cartera Dropi 08 2026 SK Glam SAS». */
export const suggestedWalletName = (fileName: string) => `Resumen ${fileName.replace(/\.xlsx?$/i, "")}`;

export function exportWalletExcel(file: ParsedWalletFile, analysis: WalletAnalysis) {
  return saveExcelSheets(buildWalletSheets(analysis), suggestedWalletName(file.fileName));
}
