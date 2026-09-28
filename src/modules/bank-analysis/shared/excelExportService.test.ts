import { describe, expect, it } from "vitest";
import { buildExportSheets, suggestedExportName } from "./excelExportService";
import { groupMovements } from "./groupingService";
import type { BankMovement, ParsedStatement } from "./types";

const movement = (index: number, description: string, valueCents: number, extra: Partial<BankMovement> = {}): BankMovement => ({
  index,
  date: "2/01",
  fullDate: "02/01/2026",
  description,
  valueCents,
  balanceCents: 1000 + index,
  page: 1,
  sign: valueCents > 0 ? "positive" : valueCents < 0 ? "negative" : "zero",
  ...extra,
});

const statement = (movements: BankMovement[]): ParsedStatement => ({
  bank: "Bancolombia",
  accountNumber: "55400011369",
  periodFrom: "2025/12/31",
  periodTo: "2026/01/31",
  pageCount: 1,
  movementsByPage: { 1: movements.length },
  movements,
  totals: {},
  issues: [],
  joinedLines: 0,
});

describe("exportación a Excel", () => {
  it("hoja Resumen por grupo y hoja Movimientos con valores en pesos y signo", () => {
    const s = statement([movement(0, "ABONO", 129), movement(1, "IMPTO", -12653060), movement(2, "ABONO", 62178)]);
    const [resumen, detalle] = buildExportSheets(s, groupMovements(s.movements));
    expect(resumen.columns.map((c) => c.header)).toEqual(["Descripción", "Tipo", "Cantidad", "Total"]);
    expect(resumen.rows).toEqual([
      ["ABONO", "Positivo", 2, 623.07],
      ["IMPTO", "Negativo", 1, -126530.6],
    ]);
    expect(detalle.columns.map((c) => c.header)).toEqual(["Fecha", "Descripción", "Valor", "Saldo", "Página"]);
    expect(detalle.rows[1]).toEqual(["02/01/2026", "IMPTO", -126530.6, 10.01, 1]);
  });

  it("incluye Sucursal y Dcto. solo si se extrajeron, y omite Saldo si falta en algún movimiento", () => {
    const s = statement([movement(0, "A", 100, { branch: "CENTRO", balanceCents: undefined }), movement(1, "B", 100)]);
    const [, detalle] = buildExportSheets(s, groupMovements(s.movements));
    expect(detalle.columns.map((c) => c.header)).toEqual(["Fecha", "Descripción", "Valor", "Sucursal", "Página"]);
    expect(detalle.rows[1]).toEqual(["02/01/2026", "B", 1, null, 1]);
  });

  it("sugiere un nombre con banco, cuenta y periodo", () => {
    expect(suggestedExportName(statement([]), "x.pdf")).toBe("Analisis_Bancolombia_1369_2026-01");
    expect(suggestedExportName({ ...statement([]), accountNumber: undefined }, "Extracto Enero.pdf")).toBe("Analisis_Extracto Enero");
  });
});
