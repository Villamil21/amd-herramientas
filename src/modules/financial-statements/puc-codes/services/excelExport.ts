import { saveExcelSheets, type ExportSheet } from "../../../bank-analysis/shared/excelExportService";
import { DOC_CATEGORY_LABEL, type PucReport } from "../types";
import { signOf } from "./analysis";
import { formatIssueDate } from "./labels";

const pesos = (cents: number) => cents / 100;

/** Descripción del renglón único de una factura con un solo código (su valor es el Total Bruto, no la suma del detalle). */
export const WHOLE_INVOICE = "Toda la factura (Total Bruto Factura)";

export const SIGN_LABEL = { 1: "Suma (+)", [-1]: "Resta (−)" } as const;

/**
 * Hoja 1 «Detalle»: una fila por producto (código por producto) o una fila
 * por factura (un solo código), de modo que «Valor neto» siempre suma lo
 * mismo que el resumen. Hoja 2 «Resumen PUC»: un renglón por código.
 */
export function buildPucSheets(report: PucReport): ExportSheet[] {
  const detail: ExportSheet = {
    name: "Detalle",
    columns: [
      { header: "Archivo", kind: "text" },
      { header: "Número de factura", kind: "text" },
      { header: "Fecha", kind: "text" },
      { header: "NIT emisor", kind: "text" },
      { header: "Razón social", kind: "text" },
      { header: "Tipo clasificado", kind: "text" },
      { header: "Descripción producto", kind: "text" },
      { header: "Precio unitario de venta", kind: "money" },
      { header: "Código PUC", kind: "text" },
      { header: "Concepto PUC", kind: "text" },
      { header: "Signo", kind: "text" },
      { header: "Valor neto", kind: "money" },
    ],
    rows: [],
  };
  for (const r of report.rows) {
    if (r.excluded || !r.category || r.allocations.length === 0) continue;
    const sign = signOf(r.category);
    const head = [r.fileName, r.number ?? null, r.issueDate ? formatIssueDate(r.issueDate) : null, r.issuerNit ?? null, r.issuerName ?? null, DOC_CATEGORY_LABEL[r.category]];
    if (r.mode === "document") {
      const a = r.allocations[0];
      detail.rows.push([...head, WHOLE_INVOICE, null, a.code, a.concept, SIGN_LABEL[sign], pesos(a.valueCents)]);
      continue;
    }
    for (const l of r.lines) {
      if (!l.code || !l.concept || l.priceCents === undefined) continue;
      detail.rows.push([...head, l.description, pesos(l.priceCents), l.code, l.concept, SIGN_LABEL[sign], pesos(sign * l.priceCents)]);
    }
  }

  const summary: ExportSheet = {
    name: "Resumen PUC",
    columns: [
      { header: "Código", kind: "text" },
      { header: "Concepto", kind: "text" },
      { header: "Total Facturas", kind: "money" },
      { header: "Total Notas crédito", kind: "money" },
      { header: "Total neto", kind: "money" },
    ],
    rows: report.summary.map((s) => [s.code, s.concept, pesos(s.invoicesCents), pesos(s.notesCents), pesos(s.netCents)]),
  };

  return [detail, summary];
}

export function exportPucExcel(report: PucReport, folderName: string) {
  return saveExcelSheets(buildPucSheets(report), `Codigos_PUC_${folderName}`);
}
