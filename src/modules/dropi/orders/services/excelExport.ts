import { saveExcelSheets, type ExportSheet } from "../../../bank-analysis/shared/excelExportService";
import type { DropiOrdersAnalysis, ParsedOrdersFile, StatusRules } from "../types";
import { classifyStatus, CATEGORY_LABEL } from "./statuses";

const pesos = (cents: number) => cents / 100;

/** Conceptos del cierre en el orden de la pantalla (también se usan en la prueba con archivos reales). */
export function closingConcepts(a: DropiOrdersAnalysis) {
  const s = a.summary;
  return [
    { section: "Ventas Dropi", concept: "Valor facturado", cents: s.billedCents },
    { section: "Ventas Dropi", concept: "Canceladas / Rechazadas / Guía anulada", cents: s.cancelledRejectedVoidCents },
    { section: "Ventas Dropi", concept: "Devoluciones", cents: s.returnsCents },
    { section: "Ventas Dropi", concept: "En proceso", cents: s.inProcessCents },
    { section: "Ventas Dropi", concept: "Siniestro", cents: s.claimCents },
    { section: "Ventas Dropi", concept: "Indemnizada / En proceso indemnización", cents: s.indemnityCents },
    { section: "Costos Dropi", concept: "Costo producto Dropi", cents: s.deliveredProductCostCents },
    { section: "Costos Dropi", concept: "Costo flete entregados Dropi", cents: s.deliveredFreightCostCents },
    { section: "Costos Dropi", concept: "Costo devolución flete Dropi", cents: s.returnFreightCostCents },
  ];
}

export function orderCounts(a: DropiOrdersAnalysis) {
  const s = a.summary;
  return [
    { concept: "Pedidos despachados Dropi", count: s.dispatchedOrders },
    { concept: "Pedidos entregados Dropi", count: s.deliveredOrders },
    { concept: "Cancelados / Rechazados", count: s.cancelledRejectedOrders },
  ];
}

/**
 * Hojas Resumen, Estados y Datos (solo columnas relevantes para auditar:
 * sin teléfonos, correos ni direcciones). Incidencias si hubo importes no válidos.
 * En Resumen, «Valor» lleva los importes y «Cantidad» los conteos.
 */
export function buildDropiSheets(file: ParsedOrdersFile, analysis: DropiOrdersAnalysis, rules: StatusRules): ExportSheet[] {
  const text = (header: string) => ({ header, kind: "text" as const });
  const money = (header: string) => ({ header, kind: "money" as const });
  const integer = (header: string) => ({ header, kind: "integer" as const });

  const summary: ExportSheet = {
    name: "Resumen",
    columns: [text("Sección"), text("Concepto"), money("Valor"), integer("Cantidad")],
    rows: [
      ["Archivo", "Archivo", file.fileName, null],
      ["Archivo", "Hoja utilizada", file.sheetName, null],
      ...(file.company ? [["Archivo", "Empresa (según el archivo)", file.company, null]] : []),
      ...(file.period ? [["Archivo", "Periodo (columna FECHA)", file.period, null]] : []),
      ["Archivo", "Registros", null, analysis.summary.totalRows],
      ["Archivo", "Pedidos únicos", null, analysis.summary.uniqueOrders],
      ...closingConcepts(analysis).map((c) => [c.section, c.concept, pesos(c.cents), null]),
      ...orderCounts(analysis).map((c) => ["Pedidos", c.concept, null, c.count]),
    ],
  };

  const statuses: ExportSheet = {
    name: "Estados",
    columns: [
      text("Estado"),
      text("Clasificación"),
      integer("Filas"),
      integer("Pedidos únicos"),
      money("Valor compra productos"),
      money("Total precios proveedor"),
      money("Precio flete"),
      money("Costo devolución flete"),
    ],
    rows: analysis.statuses.map((s) => [
      s.display || "(sin estatus)",
      CATEGORY_LABEL[s.category],
      s.rows,
      s.uniqueOrders,
      pesos(s.purchaseCents),
      pesos(s.supplierCents),
      pesos(s.freightCents),
      pesos(s.returnFreightCents),
    ]),
  };

  const data: ExportSheet = {
    name: "Datos",
    columns: [
      integer("Fila Excel"),
      text("ID"),
      text("Fecha"),
      text("Estatus"),
      text("Clasificación"),
      text("Número guía"),
      text("Número factura"),
      text("Cliente"),
      money("Valor de compra en productos"),
      money("Total en precios de proveedor"),
      money("Precio flete"),
      money("Costo devolución flete"),
    ],
    rows: file.rows.map((r) => [
      r.rowNumber,
      r.id || null,
      r.date ?? null,
      r.status || null,
      CATEGORY_LABEL[classifyStatus(r.statusKey, rules)],
      r.guide ?? null,
      r.invoice ?? null,
      r.customer ?? null,
      pesos(r.purchaseCents),
      pesos(r.supplierCents),
      pesos(r.freightCents),
      pesos(r.returnFreightCents),
    ]),
  };

  const sheets = [summary, statuses, data];
  if (file.invalidMoney.length > 0) {
    sheets.push({
      name: "Incidencias",
      columns: [integer("Fila Excel"), text("Columna"), text("Valor en el archivo"), text("Tratamiento")],
      rows: file.invalidMoney.map((i) => [i.rowNumber, i.column, i.text, "No es un importe válido; se sumó como 0"]),
    });
  }
  return sheets;
}

/** «Ordenes Dropi 08 2026 KAES SAS.xlsx» → «Cierre Ordenes Dropi 08 2026 KAES SAS». */
export function suggestedDropiName(fileName: string): string {
  return `Cierre ${fileName.replace(/\.xlsx?$/i, "")}`;
}

export function exportDropiExcel(file: ParsedOrdersFile, analysis: DropiOrdersAnalysis, rules: StatusRules) {
  return saveExcelSheets(buildDropiSheets(file, analysis, rules), suggestedDropiName(file.fileName));
}
