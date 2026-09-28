import { saveExcelSheets, type ExportSheet } from "../../../../bank-analysis/shared/excelExportService";
import { UIAF_COLUMNS, type UiafReport } from "../types";

const text = (header: string) => ({ header, kind: "text" as const });

/**
 * Una hoja por Código Tipo (Transacciones = 2, Sheet1 = 3, como el Excel de
 * referencia; otros códigos en «Tipo N»), con las 26 columnas como TEXTO y en
 * el orden del TXT. Las filas inválidas no se reparten en columnas: van
 * completas a «Filas inválidas».
 */
export function buildUiafSheets(report: UiafReport): ExportSheet[] {
  const sheets: ExportSheet[] = report.groups.map((g) => ({
    name: g.sheetName,
    columns: UIAF_COLUMNS.map(text),
    rows: g.records.map((r) => r.values),
  }));
  if (report.invalid.length > 0) {
    sheets.push({
      name: "Filas inválidas",
      columns: [text("Línea"), text("Campos"), text("Motivo"), text("Contenido")],
      rows: report.invalid.map((i) => [String(i.line), String(i.fieldCount), i.reason, i.text]),
    });
  }
  return sheets;
}

/** Mismo nombre del TXT: TPSV210012650126.txt → TPSV210012650126.xlsx. */
export function suggestedUiafName(txtFileName: string): string {
  return txtFileName.replace(/\.txt$/i, "") || "Reporte_UIAF";
}

export function exportUiafExcel(report: UiafReport, txtFileName: string) {
  return saveExcelSheets(buildUiafSheets(report), suggestedUiafName(txtFileName));
}
