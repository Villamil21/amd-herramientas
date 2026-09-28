import { call } from "../../../services/tauri";
import { SIGN_LABEL } from "./money";
import type { MovementGroup, ParsedStatement } from "./types";

type ColumnKind = "text" | "money" | "integer";
type Cell = string | number | null;

export interface ExportSheet {
  name: string;
  columns: { header: string; kind: ColumnKind }[];
  rows: Cell[][];
}

const pesos = (cents: number) => cents / 100;

/**
 * Hoja 1 «Resumen»: un renglón por grupo. Hoja 2 «Movimientos»: cada
 * movimiento en el orden del extracto. Las columnas opcionales (saldo,
 * sucursal, documento) solo se incluyen si se extrajeron.
 */
export function buildExportSheets(statement: ParsedStatement, groups: MovementGroup[]): ExportSheet[] {
  const summary: ExportSheet = {
    name: "Resumen",
    columns: [
      { header: "Descripción", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Cantidad", kind: "integer" },
      { header: "Total", kind: "money" },
    ],
    rows: groups.map((g) => [g.description, SIGN_LABEL[g.sign], g.count, pesos(g.totalCents)]),
  };

  const { movements } = statement;
  const optional = [
    { header: "Saldo", kind: "money" as const, include: movements.every((m) => m.balanceCents !== undefined), value: (i: number) => pesos(movements[i].balanceCents!) },
    { header: "Sucursal", kind: "text" as const, include: movements.some((m) => m.branch), value: (i: number) => movements[i].branch ?? null },
    { header: "Dcto.", kind: "text" as const, include: movements.some((m) => m.document), value: (i: number) => movements[i].document ?? null },
  ].filter((c) => c.include);

  const detail: ExportSheet = {
    name: "Movimientos",
    columns: [
      { header: "Fecha", kind: "text" },
      { header: "Descripción", kind: "text" },
      { header: "Valor", kind: "money" },
      ...optional.map(({ header, kind }) => ({ header, kind })),
      { header: "Página", kind: "integer" },
    ],
    rows: movements.map((m, i) => [m.fullDate ?? m.date, m.description, pesos(m.valueCents), ...optional.map((c) => c.value(i)), m.page]),
  };

  return [summary, detail];
}

/** Nombre sugerido: Analisis_Bancolombia_1369_2026-01 (o el del PDF si no hay datos de cuenta). */
export function suggestedExportName(statement: ParsedStatement, pdfFileName: string): string {
  const account = statement.accountNumber?.slice(-4);
  const period = statement.periodTo?.slice(0, 7).replace("/", "-");
  if (account && period) return `Analisis_${statement.bank}_${account}_${period}`;
  return `Analisis_${pdfFileName.replace(/\.pdf$/i, "")}`;
}

/** Guarda hojas ya construidas con el diálogo nativo. Devuelve la ruta o null si se cancela. */
export function saveExcelSheets(sheets: ExportSheet[], suggestedName: string) {
  return call<string | null>("save_excel", { sheets, suggestedName });
}

/** Diálogo nativo para guardar. Devuelve la ruta o null si se cancela. */
export function exportStatementExcel(statement: ParsedStatement, groups: MovementGroup[], pdfFileName: string) {
  return saveExcelSheets(buildExportSheets(statement, groups), suggestedExportName(statement, pdfFileName));
}
