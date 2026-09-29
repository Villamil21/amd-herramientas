import { saveExcelSheets, type ExportSheet } from "../../../bank-analysis/shared/excelExportService";
import { VAT_TYPE_LABEL, type Supplier } from "../../../../types/models";
import { formatRateBp } from "../parser/amounts";
import type { InvoiceReport } from "../types";
import { STATUS_LABEL, SUMMARY_CATEGORIES } from "./labels";

const pesos = (cents: number) => cents / 100;

export function buildInvoiceVatSheets(report: InvoiceReport, suppliers: Supplier[]): ExportSheet[] {
  const summary: ExportSheet = {
    name: "Resumen",
    columns: [
      { header: "Tipo de documento", kind: "text" },
      { header: "Categoría", kind: "text" },
      { header: "Base", kind: "money" },
      { header: "IVA", kind: "money" },
    ],
    rows: report.summaries.flatMap((s) => [
      ...SUMMARY_CATEGORIES.map((c) => [s.documentType, c.label, pesos(c.value(s).baseCents), pesos(c.value(s).vatCents)]),
      ...(s.services5.baseCents || s.services5.vatCents ? [[s.documentType, "Revisión: servicios al 5 %", pesos(s.services5.baseCents), pesos(s.services5.vatCents)]] : []),
      ...s.otherRates.map((o) => [s.documentType, `Revisión: tarifa no configurada ${formatRateBp(o.rateBp)}`, pesos(o.baseCents), pesos(o.vatCents)]),
    ]),
  };

  const invoices: ExportSheet = {
    name: "Facturas",
    columns: [
      { header: "Archivo", kind: "text" },
      { header: "Tipo documento", kind: "text" },
      { header: "Número factura", kind: "text" },
      { header: "NIT", kind: "text" },
      { header: "Razón social", kind: "text" },
      { header: "Tipo IVA", kind: "text" },
      { header: "Base 5%", kind: "money" },
      { header: "IVA 5%", kind: "money" },
      { header: "Base 19%", kind: "money" },
      { header: "IVA 19%", kind: "money" },
      { header: "Base 0%", kind: "money" },
      { header: "IVA según detalle", kind: "money" },
      { header: "IVA según total factura", kind: "money" },
      { header: "Estado", kind: "text" },
    ],
    rows: report.rows.map((r) => [
      r.fileName,
      r.documentType ?? null,
      r.invoiceNumber ?? null,
      r.supplierNit ?? null,
      r.supplierName ?? null,
      r.vatType ? VAT_TYPE_LABEL[r.vatType] : null,
      pesos(r.base5),
      pesos(r.vat5),
      pesos(r.base19),
      pesos(r.vat19),
      pesos(r.base0),
      r.supplierNit ? pesos(r.detailVatCents) : null,
      r.invoiceVatCents !== undefined ? pesos(r.invoiceVatCents) : null,
      r.duplicateOf ? `${STATUS_LABEL[r.status]} (posible duplicado)` : STATUS_LABEL[r.status],
    ]),
  };

  const nits = new Set(report.rows.map((r) => r.supplierNit).filter(Boolean));
  const supplierSheet: ExportSheet = {
    name: "Proveedores",
    columns: [
      { header: "NIT", kind: "text" },
      { header: "Razón social", kind: "text" },
      { header: "Tipo IVA", kind: "text" },
    ],
    rows: suppliers.filter((s) => nits.has(s.nit)).map((s) => [s.nit, s.businessName, VAT_TYPE_LABEL[s.vatType]]),
  };

  const incidents: ExportSheet = {
    name: "Incidencias",
    columns: [
      { header: "Archivo", kind: "text" },
      { header: "Tipo de incidencia", kind: "text" },
      { header: "Detalle", kind: "text" },
    ],
    rows: report.incidents.map((i) => [i.fileName, i.type, i.detail]),
  };

  return [summary, invoices, supplierSheet, incidents];
}

export function exportInvoiceVatExcel(report: InvoiceReport, suppliers: Supplier[], folderName: string) {
  return saveExcelSheets(buildInvoiceVatSheets(report, suppliers), `Analisis_IVA_${folderName}`);
}
