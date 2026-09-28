import { saveExcelSheets, type ExportSheet } from "../../shared/excelExportService";
import { TYPE_LABEL } from "../../shared/types";
import type { BancoomevaGroup, BancoomevaStatement } from "../types";

const pesos = (cents: number) => cents / 100;

/**
 * Hoja 1 «Resumen»: Descripción, Tipo, Cantidad, Total. Hoja 2
 * «Movimientos»: cada movimiento en el orden del extracto, con Valor Débito
 * y Valor Crédito separados.
 */
export function buildBancoomevaSheets(statement: BancoomevaStatement, groups: BancoomevaGroup[]): ExportSheet[] {
  const summary: ExportSheet = {
    name: "Resumen",
    columns: [
      { header: "Descripción", kind: "text" },
      { header: "Tipo", kind: "text" },
      { header: "Cantidad", kind: "integer" },
      { header: "Total", kind: "money" },
    ],
    rows: groups.map((g) => [g.description, TYPE_LABEL[g.transactionType], g.count, pesos(g.totalCents)]),
  };

  const detail: ExportSheet = {
    name: "Movimientos",
    columns: [
      { header: "Fecha", kind: "text" },
      { header: "Oficina", kind: "text" },
      { header: "Descripción", kind: "text" },
      { header: "Valor Débito", kind: "money" },
      { header: "Valor Crédito", kind: "money" },
      { header: "Tipo", kind: "text" },
      { header: "Valor", kind: "money" },
      { header: "Saldo", kind: "money" },
      { header: "Página", kind: "integer" },
    ],
    rows: statement.movements.map((m) => [
      m.date,
      m.office ?? null,
      m.description,
      pesos(m.debitCents),
      pesos(m.creditCents),
      TYPE_LABEL[m.transactionType],
      pesos(m.amountCents),
      m.balanceCents === undefined ? null : pesos(m.balanceCents),
      m.page,
    ]),
  };

  return [summary, detail];
}

/** Nombre sugerido: Analisis_Bancoomeva_0275_2026-06 (o el del PDF si no hay datos de cuenta). */
export function suggestedBancoomevaName(statement: BancoomevaStatement, pdfFileName: string): string {
  const account = statement.accountNumber?.slice(-4);
  const period = statement.periodTo?.slice(0, 7).replace("/", "-");
  if (account && period) return `Analisis_Bancoomeva_${account}_${period}`;
  return `Analisis_${pdfFileName.replace(/\.pdf$/i, "")}`;
}

/** Diálogo nativo para guardar. Devuelve la ruta o null si se cancela. */
export function exportBancoomevaExcel(statement: BancoomevaStatement, groups: BancoomevaGroup[], pdfFileName: string) {
  return saveExcelSheets(buildBancoomevaSheets(statement, groups), suggestedBancoomevaName(statement, pdfFileName));
}
