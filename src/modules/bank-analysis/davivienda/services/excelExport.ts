import { saveExcelSheets, suggestedExportName, type ExportSheet } from "../../shared/excelExportService";
import { SIGN_LABEL } from "../../shared/money";
import type { BankMovement, MovementGroup, ParsedStatement } from "../../shared/types";

const pesos = (cents: number) => cents / 100;

type Optional = { header: string; include: boolean; value: (m: BankMovement) => string | null };

/**
 * Hoja 1 «Resumen»: Clase de Movimiento, Tipo, Cantidad, Total. Hoja 2
 * «Movimientos»: cada movimiento en el orden del extracto. Doc. y Oficina
 * solo se incluyen si se extrajeron.
 */
export function buildDaviviendaSheets(statement: ParsedStatement, groups: MovementGroup[]): ExportSheet[] {
  const summary: ExportSheet = {
    name: "Resumen",
    columns: [
      { header: "Clase de Movimiento", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Cantidad", kind: "integer" },
      { header: "Total", kind: "money" },
    ],
    rows: groups.map((g) => [g.description, SIGN_LABEL[g.sign], g.count, pesos(g.totalCents)]),
  };

  const { movements } = statement;
  const optional = (
    [
      { header: "Doc.", include: movements.some((m) => m.document), value: (m) => m.document ?? null },
      { header: "Oficina", include: movements.some((m) => m.branch), value: (m) => m.branch ?? null },
    ] satisfies Optional[]
  ).filter((c) => c.include);

  const detail: ExportSheet = {
    name: "Movimientos",
    columns: [
      { header: "Fecha", kind: "text" },
      { header: "Valor", kind: "money" },
      { header: "Tipo", kind: "text" },
      { header: "Clase de Movimiento", kind: "text" },
      ...optional.map(({ header }) => ({ header, kind: "text" as const })),
      { header: "Página", kind: "integer" },
    ],
    rows: movements.map((m) => [m.fullDate ?? m.date, pesos(m.valueCents), SIGN_LABEL[m.sign], m.description, ...optional.map((c) => c.value(m)), m.page]),
  };

  return [summary, detail];
}

/** Diálogo nativo para guardar (Analisis_Davivienda_0629_2026-01). Devuelve la ruta o null si se cancela. */
export function exportDaviviendaExcel(statement: ParsedStatement, groups: MovementGroup[], pdfFileName: string) {
  const name = suggestedExportName({ ...statement, accountNumber: statement.accountNumber?.replace(/\D/g, "") }, pdfFileName);
  return saveExcelSheets(buildDaviviendaSheets(statement, groups), name);
}
