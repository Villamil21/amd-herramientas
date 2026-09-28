import { saveExcelSheets, suggestedExportName, type ExportSheet } from "../../shared/excelExportService";
import { SIGN_LABEL } from "../../shared/money";
import type { MovementGroup, ParsedStatement } from "../../shared/types";

const pesos = (cents: number) => cents / 100;

/**
 * Hoja 1 «Resumen»: Descripción, Tipo, Cantidad, Total. Hoja 2
 * «Movimientos»: cada movimiento en el orden del extracto. Referencia y
 * Saldo solo se incluyen si se extrajeron.
 */
export function buildIrisBankSheets(statement: ParsedStatement, groups: MovementGroup[]): ExportSheet[] {
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
  const withReference = movements.some((m) => m.document);
  const withBalance = movements.every((m) => m.balanceCents !== undefined);

  const detail: ExportSheet = {
    name: "Movimientos",
    columns: [
      { header: "Día", kind: "text" },
      ...(withReference ? [{ header: "Referencia", kind: "text" as const }] : []),
      { header: "Descripción", kind: "text" },
      { header: "Movimiento", kind: "money" },
      { header: "Tipo", kind: "text" },
      ...(withBalance ? [{ header: "Saldo", kind: "money" as const }] : []),
      { header: "Página", kind: "integer" },
    ],
    rows: movements.map((m) => [
      m.fullDate ?? m.date,
      ...(withReference ? [m.document ?? null] : []),
      m.description,
      pesos(m.valueCents),
      SIGN_LABEL[m.sign],
      ...(withBalance ? [pesos(m.balanceCents!)] : []),
      m.page,
    ]),
  };

  return [summary, detail];
}

/** Diálogo nativo para guardar (Analisis_IrisBank_0983_2026-01). Devuelve la ruta o null si se cancela. */
export function exportIrisBankExcel(statement: ParsedStatement, groups: MovementGroup[], pdfFileName: string) {
  const name = suggestedExportName({ ...statement, bank: "IrisBank" }, pdfFileName);
  return saveExcelSheets(buildIrisBankSheets(statement, groups), name);
}
