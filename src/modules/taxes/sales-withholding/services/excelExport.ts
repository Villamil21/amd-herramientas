import { SALES_CATEGORY_LABEL } from "../../../../types/models";
import { saveExcelSheets, type ExportSheet } from "../../../bank-analysis/shared/excelExportService";
import { formatRateBp } from "../../withholding/services/money";
import { TAX_COLUMNS, type AnalyzedRow, type ParsedSalesFile, type SalesAnalysis } from "../types";
import { microToCents } from "./decimal";

const pesos = (micro: bigint | null) => (micro === null ? null : microToCents(micro) / 100);
const centsToPesos = (cents: number | undefined) => (cents === undefined ? null : cents / 100);

export const ROW_STATUS_LABEL: Record<AnalyzedRow["status"], string> = {
  ok: "Validado",
  invalid: "Requiere revisión",
  no_type: "Sin tipo de documento",
  unclassified: "Tipo sin clasificar",
  duplicate: "Posible duplicado (no sumado)",
};

/**
 * «Resumen»: una fila con empresa, tarifa, bases y autorretenciones.
 * «Detalle»: cada documento con Total, cada impuesto restado y la base calculada.
 */
export function buildSalesSheets(a: SalesAnalysis): ExportSheet[] {
  const text = (header: string) => ({ header, kind: "text" as const });
  const money = (header: string) => ({ header, kind: "money" as const });
  const integer = (header: string) => ({ header, kind: "integer" as const });

  const summary: ExportSheet = {
    name: "Resumen",
    columns: [
      text("Empresa"),
      text("NIT"),
      text("Código CIIU"),
      text("Tarifa"),
      integer("Cantidad Facturas"),
      money("Base Facturas"),
      money("Autorretención Facturas"),
      integer("Cantidad Notas Crédito"),
      money("Base Notas Crédito"),
      money("Autorretención Notas Crédito"),
      money("Autorretención neta"),
      money("Autorretención neta redondeada"),
    ],
    rows: [
      [
        a.company?.razonSocial ?? a.issuer?.name ?? null,
        a.issuer?.nit ?? null,
        a.company?.ciiuCode || null,
        a.rate ? formatRateBp(a.rate.rateBp, true) : null,
        a.invoices.count,
        pesos(a.invoices.base),
        centsToPesos(a.invoices.withholdingCents),
        a.creditNotes.count,
        pesos(a.creditNotes.base),
        centsToPesos(a.creditNotes.withholdingCents),
        centsToPesos(a.totals?.netCents),
        centsToPesos(a.totals?.netRoundedCents),
      ],
    ],
  };

  const detail: ExportSheet = {
    name: "Detalle",
    columns: [
      integer("Fila Excel"),
      text("Tipo original"),
      text("Categoría"),
      text("Prefijo"),
      text("Folio"),
      text("Fecha"),
      text("CUFE/CUDE"),
      money("Total"),
      ...TAX_COLUMNS.map(money),
      money("Base calculada"),
      text("Estado"),
    ],
    rows: a.rows.map((r) => [
      r.rowNumber,
      r.documentType || null,
      r.category ? SALES_CATEGORY_LABEL[r.category] : null,
      r.prefix || null,
      r.folio || null,
      r.issueDate || null,
      r.cufe || null,
      r.total === null ? r.invalid.find((i) => i.column === "Total")?.text ?? null : pesos(r.total),
      ...TAX_COLUMNS.map((t) => (r.taxes[t] === null ? r.invalid.find((i) => i.column === t)?.text ?? null : pesos(r.taxes[t]))),
      pesos(r.base),
      r.status === "duplicate" ? `${ROW_STATUS_LABEL.duplicate}: igual a la fila ${r.duplicateOf}` : ROW_STATUS_LABEL[r.status],
    ]),
  };

  return [summary, detail];
}

/** «Facturacion DIAN 09 2026 Digicort SAS.xlsx» → «Autorretencion ventas Facturacion DIAN 09 2026 Digicort SAS». */
export const suggestedSalesName = (fileName: string) => `Autorretencion ventas ${fileName.replace(/\.xlsx?$/i, "")}`;

/** Genera un archivo nuevo; el Excel importado nunca se modifica. */
export function exportSalesExcel(file: ParsedSalesFile, analysis: SalesAnalysis) {
  return saveExcelSheets(buildSalesSheets(analysis), suggestedSalesName(file.fileName));
}
