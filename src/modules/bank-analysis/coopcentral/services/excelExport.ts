import { saveExcelSheets, type ExportSheet } from "../../shared/excelExportService";
import { TYPE_LABEL, type CoopcentralGroup, type CoopcentralMovement, type CoopcentralStatement } from "../types";

const pesos = (cents: number) => cents / 100;

type Optional = { header: string; kind: "text" | "money"; include: boolean; value: (m: CoopcentralMovement) => string | number | null };

/**
 * Hoja 1 «Resumen»: Concepto, Tipo, Cantidad, Total. Hoja 2 «Movimientos»:
 * cada movimiento en el orden del extracto, con Crédito y Débito separados.
 * Las columnas opcionales solo se incluyen si se extrajeron.
 */
export function buildCoopcentralSheets(statement: CoopcentralStatement, groups: CoopcentralGroup[]): ExportSheet[] {
  const summary: ExportSheet = {
    name: "Resumen",
    columns: [
      { header: "Concepto", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Cantidad", kind: "integer" },
      { header: "Total", kind: "money" },
    ],
    rows: groups.map((g) => [g.concept, TYPE_LABEL[g.transactionType], g.count, pesos(g.totalCents)]),
  };

  const { movements } = statement;
  const candidates: Optional[] = [
    { header: "Documento", kind: "text", include: movements.some((m) => m.document), value: (m) => m.document ?? null },
    { header: "Fecha Aplicación", kind: "text", include: movements.some((m) => m.applicationDate), value: (m) => m.applicationDate ?? null },
    { header: "Fecha Operación", kind: "text", include: movements.some((m) => m.operationDate), value: (m) => m.operationDate ?? null },
    { header: "Saldo", kind: "money", include: movements.every((m) => m.balanceCents !== undefined), value: (m) => pesos(m.balanceCents!) },
  ];
  const optional = candidates.filter((c) => c.include);

  const detail: ExportSheet = {
    name: "Movimientos",
    columns: [
      { header: "Concepto", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Crédito", kind: "money" },
      { header: "Débito", kind: "money" },
      { header: "Valor", kind: "money" },
      ...optional.map(({ header, kind }) => ({ header, kind })),
      { header: "Página", kind: "integer" },
    ],
    rows: movements.map((m) => [
      m.concept,
      TYPE_LABEL[m.transactionType],
      pesos(m.creditCents),
      pesos(m.debitCents),
      pesos(m.amountCents),
      ...optional.map((c) => c.value(m)),
      m.page,
    ]),
  };

  return [summary, detail];
}

/** Nombre sugerido: Analisis_Coopcentral_1022_2026-02 (o el del PDF si no hay datos de cuenta). */
export function suggestedCoopcentralName(statement: CoopcentralStatement, pdfFileName: string): string {
  const account = statement.accountNumber?.replace(/\D/g, "").slice(-4);
  const period = statement.periodTo?.slice(0, 7).replace("/", "-");
  if (account && period) return `Analisis_Coopcentral_${account}_${period}`;
  return `Analisis_${pdfFileName.replace(/\.pdf$/i, "")}`;
}

export function exportCoopcentralExcel(statement: CoopcentralStatement, groups: CoopcentralGroup[], pdfFileName: string) {
  return saveExcelSheets(buildCoopcentralSheets(statement, groups), suggestedCoopcentralName(statement, pdfFileName));
}
