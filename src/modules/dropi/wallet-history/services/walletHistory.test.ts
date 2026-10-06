import { describe, expect, it } from "vitest";
import type { Cell, Sheet, Workbook } from "../../../../types/excel";
import { WalletHistoryError } from "../types";
import { analyzeWallet, EXPECTED_DESCRIPTION, splitGmf } from "./analysis";
import { buildWalletSheets } from "./excelExport";
import { parseDateTime, readWalletWorkbook } from "./workbookReader";

const HEADER = ["ID", "FECHA", "TIPO", "MONTO", "MONTO PREVIO", "ORDEN ID", "NUMERO DE GUIA", "DESCRIPCIÓN", "CUENTA", "CONCEPTO DE RETIRO"];

const cell = (v: string | number | null): Cell => (v === null ? { t: "e" } : typeof v === "number" ? { t: "n", v } : { t: "s", v });

type RowSpec = { id?: number | string; date?: string; type?: string; amount?: number | string | null; previous?: number; description?: string; concept?: string };

function row({ id = 1, date = "31-08-2026 10:19", type = "SALIDA", amount = 1164659, previous = 71438283.9, description = EXPECTED_DESCRIPTION, concept = "Pago nomina - Diseñador" }: RowSpec): Cell[] {
  return [id, date, type, amount, previous, null, null, description, null, concept].map((v) => cell(v as string | number | null));
}

const sheet = (name: string, rows: RowSpec[], header = HEADER): Sheet => ({ name, rows: [header.map(cell), ...rows.map(row)] });
const book = (...sheets: Sheet[]): Workbook => ({ fileName: "Historial cartera Dropi 08 2026 Prueba SAS.xlsx", sheets });

function read(wb: Workbook) {
  const r = readWalletWorkbook(wb);
  if (r.kind !== "ok") throw new Error("se esperaba una hoja");
  return r.file;
}
const analyze = (rows: RowSpec[]) => {
  const file = read(book(sheet("HISTORIAL DE CARTERA", rows)));
  return analyzeWallet(file.movements, { checkType: file.hasType });
};

describe("4x1000 incluido en el MONTO", () => {
  it("valor pagado = MONTO / 1,004 y 4x1000 = MONTO − valor pagado (ejemplo del requerimiento)", () => {
    expect(splitGmf(116465900)).toEqual({ paidCents: 116001892, gmfCents: 464008 });
  });

  it("valor pagado + 4x1000 = MONTO siempre, y el 4x1000 es el 0,4 % del valor pagado (±1 centavo)", () => {
    for (let cents = 1; cents < 3_000_000; cents += 997) {
      const { paidCents, gmfCents } = splitGmf(cents);
      expect(paidCents + gmfCents).toBe(cents);
      expect(Math.abs(paidCents * 1.004 - cents)).toBeLessThanOrEqual(0.51);
    }
  });

  it("no es MONTO × 0,996", () => {
    expect(splitGmf(116465900).paidCents).not.toBe(Math.round(116465900 * 0.996));
  });
});

describe("lectura del historial", () => {
  it("detecta la hoja por encabezados aunque tenga otro nombre y omite MONTO PREVIO", () => {
    const file = read(book({ name: "Resumen", rows: [[cell("Otra cosa")]] }, sheet("Hoja1", [{}, { id: 2, previous: 999 }])));
    expect(file.sheetName).toBe("Hoja1");
    expect(file.ignoredSheets).toEqual(["Resumen"]);
    expect(file.movements).toHaveLength(2);
    expect(Object.keys(file.movements[0])).not.toContain("previous");
    expect(file.movements[0]).toMatchObject({ id: "1", date: "31/08/2026", time: "10:19", dateKey: "2026-08-31", amountCents: 116465900 });
    expect(file.period).toBe("Agosto 2026");
  });

  it("encuentra el encabezado aunque no esté en la primera fila", () => {
    const s = sheet("X", [{}]);
    s.rows.unshift([cell("HISTORIAL DE CARTERA")], []);
    expect(read(book(s)).movements[0].rowNumber).toBe(4);
  });

  it("con varias hojas candidatas usa la de estructura más completa", () => {
    const partial = sheet("Parcial", [{}, {}, {}], ["FECHA", "TIPO", "MONTO", "MONTO PREVIO", "ORDEN ID", "NUMERO DE GUIA", "DESCRIPCIÓN", "CUENTA", "CONCEPTO DE RETIRO", "OTRA"]);
    const file = read(book(partial, sheet("Completa", [{}])));
    expect(file.sheetName).toBe("Completa");
  });

  it("si dos hojas son iguales pide elegir", () => {
    const r = readWalletWorkbook(book(sheet("A", [{}]), sheet("B", [{ id: 5 }])));
    expect(r).toEqual({ kind: "choose-sheet", candidates: [{ name: "A", rows: 1 }, { name: "B", rows: 1 }] });
    const chosen = readWalletWorkbook(book(sheet("A", [{}]), sheet("B", [{ id: 5 }])), "B");
    expect(chosen.kind === "ok" && chosen.file.movements[0].id).toBe("5");
  });

  it("informa las columnas requeridas que faltan", () => {
    const wb = book(sheet("X", [{}], ["ID", "FECHA", "TIPO", "MONTO", "DESCRIPCIÓN"]));
    expect(() => readWalletWorkbook(wb)).toThrow(new WalletHistoryError("El archivo no contiene la columna «CONCEPTO DE RETIRO»."));
    expect(() => readWalletWorkbook(book({ name: "X", rows: [[cell("ID"), cell("FECHA")]] }))).toThrow(WalletHistoryError);
  });

  it("conserva el concepto de retiro exactamente como viene", () => {
    const file = read(book(sheet("X", [{ concept: "Pago Nomina - Servicio al cliente quincena + Bono $340.000" }, { concept: "VIDEO UGC" }])));
    expect(file.movements.map((m) => m.concept)).toEqual(["Pago Nomina - Servicio al cliente quincena + Bono $340.000", "VIDEO UGC"]);
  });

  it("interpreta fechas de texto y fechas nativas de Excel", () => {
    expect(parseDateTime({ t: "s", v: "04-08-2026 18:02" })).toEqual({ date: { year: 2026, month: 8, day: 4 }, time: "18:02" });
    expect(parseDateTime({ t: "s", v: "2026-08-04" })).toEqual({ date: { year: 2026, month: 8, day: 4 }, time: undefined });
    expect(parseDateTime({ t: "n", v: 46238.75 })).toEqual({ date: { year: 2026, month: 8, day: 4 }, time: "18:00" });
    expect(parseDateTime({ t: "s", v: "31-02-2026" })).toBeNull();
  });
});

describe("validaciones", () => {
  it("todas las filas correctas quedan validadas y cuadran", () => {
    const a = analyze([{ id: 1 }, { id: 2, amount: 1706828 }]);
    expect(a.review.count).toBe(0);
    expect(a.movements.every((m) => m.incidents.length === 0)).toBe(true);
    expect(a.totals.count).toBe(2);
    expect(a.totals.paidCents + a.totals.gmfCents).toBe(a.totals.amountCents);
  });

  it("los movimientos con otra descripción se ignoran: no son retiros ni requieren revisión", () => {
    const a = analyze([{ id: 1 }, { id: 2, description: "OTRO MOVIMIENTO" }, { id: 3 }]);
    expect(a.movements.map((m) => m.id)).toEqual(["1", "3"]);
    expect(a.movements.every((m) => m.incidents.length === 0)).toBe(true);
    expect(a.totals.count).toBe(2);
    expect(a.review).toEqual({ count: 0, amountCents: 0 });
  });

  it("de un archivo con conceptos mixtos solo procesa los retiros de saldo", () => {
    const many = (n: number, from: number, description: string): RowSpec[] => Array.from({ length: n }, (_, i) => ({ id: from + i, description, amount: 1000 + i }));
    const a = analyze([
      ...many(50, 1000, "SALIDA DE COBRO DE DEVOLUCIÓN POR ENTREGA NO EFECTIVA: 4567890"),
      ...many(10, 1, EXPECTED_DESCRIPTION),
      ...many(25, 2000, "SALIDA POR COBRO DE FLETE INICIAL: 4567890"),
      ...many(100, 3000, "ENTRADA POR GANANCIA EN LA ORDEN COMO DROPSHIPPER"),
    ]);
    expect(a.movements).toHaveLength(10);
    expect(a.totals.count).toBe(10);
    expect(a.totals.amountCents).toBe((10 * 1000 + 45) * 100);
    expect(a.totals.paidCents + a.totals.gmfCents).toBe(a.totals.amountCents);
    expect(a.review.count).toBe(0);
    expect(Object.values(a.incidentCounts)).toEqual([0, 0, 0]);
  });

  it("la descripción se compara completa, sin distinguir mayúsculas ni espacios de más", () => {
    const a = analyze([
      { id: 1, description: "SALIDA  POR  PETICION  DE  RETIRO  DE  SALDO  EN  CARTERA" },
      { id: 2, description: `  ${EXPECTED_DESCRIPTION} ` },
      { id: 3, description: "salida por peticion de retiro de saldo en cartera" },
      { id: 4, description: "Salida por peticion de retiro de saldo en cartera" },
    ]);
    expect(a.movements.map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
    expect(a.review.count).toBe(0);
  });

  it("un concepto parecido no es un retiro de saldo", () => {
    const a = analyze([
      { id: 1, description: "SALIDA POR PETICION DE RETIRO" },
      { id: 2, description: "SALIDA POR RETIRO DE SALDO" },
      { id: 3, description: "SALIDA POR PETICION DE RETIRO DE SALDO EN CARTERA MANUAL" },
      { id: 4, description: "SALIDA" },
      { id: 5, description: "" },
    ]);
    expect(a.movements).toEqual([]);
    expect(a.totals).toEqual({ count: 0, amountCents: 0, paidCents: 0, gmfCents: 0 });
    expect(a.review.count).toBe(0);
  });

  it("los movimientos ignorados no cuentan como duplicados ni como montos inválidos", () => {
    const a = analyze([{ id: 1 }, { id: 1, description: "SALIDA POR COBRO DE FLETE INICIAL: 1" }, { id: 2, description: "OTRO MOVIMIENTO", amount: "ABC" }, { id: 3, description: "OTRO MOVIMIENTO", type: "ENTRADA" }]);
    expect(a.movements.map((m) => m.incidents)).toEqual([[]]);
    expect(a.review.count).toBe(0);
  });

  it("un retiro de saldo con MONTO no numérico sí requiere revisión", () => {
    const a = analyze([{ id: 1 }, { id: 2, amount: "ABC" }, { id: 3, description: "OTRO MOVIMIENTO", amount: "ABC" }]);
    expect(a.movements.map((m) => m.incidents)).toEqual([[], ["invalid_amount"]]);
    expect(a.review.count).toBe(1);
    expect(a.totals.count).toBe(1);
  });

  it("un TIPO distinto de SALIDA se advierte", () => {
    const a = analyze([{ id: 1 }, { id: 2, type: "ENTRADA" }]);
    expect(a.movements[1].incidents).toEqual(["type"]);
  });

  it("un ID repetido marca las filas y no se suman dos veces", () => {
    const a = analyze([{ id: 1 }, { id: 1 }, { id: 2 }]);
    expect(a.movements.map((m) => m.incidents)).toEqual([["duplicate"], ["duplicate"], []]);
    expect(a.totals.count).toBe(1);
    expect(a.totals.amountCents).toBe(116465900);
  });

  it("filas iguales con distinto ID no son duplicadas", () => {
    const a = analyze([{ id: 238891473, amount: 5020080 }, { id: 238891381, amount: 5020080 }]);
    expect(a.incidentCounts.duplicate).toBe(0);
    expect(a.totals.count).toBe(2);
  });

  it("MONTO vacío, no numérico, negativo o cero requiere revisión y no produce NaN", () => {
    const a = analyze([{ id: 1, amount: null }, { id: 2, amount: "abc" }, { id: 3, amount: -5000 }, { id: 4, amount: 0 }, { id: 5, amount: "1.164.659" }]);
    expect(a.movements.map((m) => m.amountProblem)).toEqual(["MONTO vacío", "MONTO no numérico: «abc»", "MONTO negativo", "MONTO en cero", undefined]);
    expect(a.movements.slice(0, 2).every((m) => m.paidCents === null && m.gmfCents === null)).toBe(true);
    expect(a.totals).toEqual({ count: 1, amountCents: 116465900, paidCents: 116001892, gmfCents: 464008 });
    // Los inválidos no suman al total por revisar.
    expect(a.review).toEqual({ count: 4, amountCents: 0 });
    const cells = buildWalletSheets(a).flatMap((s) => s.rows.flat());
    expect(cells.some((c) => typeof c === "number" && Number.isNaN(c))).toBe(false);
    expect(cells).not.toContain("undefined");
  });

  it("una fila con varias incidencias las conserva todas", () => {
    const a = analyze([{ id: 7, type: "ENTRADA", amount: "x" }, { id: 7 }]);
    expect(a.movements[0].incidents).toEqual(["type", "duplicate", "invalid_amount"]);
  });

  it("sin columna TIPO no se valida el tipo", () => {
    const header = HEADER.filter((h) => h !== "TIPO");
    const s: Sheet = { name: "X", rows: [header.map(cell), [cell(1), cell("31-08-2026 10:19"), cell(1000), cell(0), cell(null), cell(null), cell(EXPECTED_DESCRIPTION), cell(null), cell("VIDEO UGC")]] };
    const file = read(book(s));
    expect(file.hasType).toBe(false);
    expect(analyzeWallet(file.movements, { checkType: file.hasType }).movements[0].incidents).toEqual([]);
  });
});

describe("exportación", () => {
  it("Resumen con totales, Detalle e Incidencias solo si hay filas por revisar", () => {
    const file = read(book(sheet("X", [{ id: 1 }, { id: 2, type: "ENTRADA" }, { id: 3, description: "SALIDA POR COBRO DE FLETE INICIAL: 4567890" }])));
    const sheets = buildWalletSheets(analyzeWallet(file.movements, { checkType: true }));
    expect(sheets.map((s) => s.name)).toEqual(["Resumen", "Detalle", "Incidencias"]);
    const [summary] = sheets;
    expect(summary.columns.map((c) => c.header)).toEqual(["Fecha", "Valor pagado", "4x1000", "Concepto retiro", "Estado"]);
    expect(summary.rows[0]).toEqual(["31/08/2026", 1160018.92, 4640.08, "Pago nomina - Diseñador", "Validado"]);
    expect(summary.rows[1][4]).toBe("Tipo inesperado");
    // El movimiento con otro concepto no llega a ninguna hoja.
    expect(sheets[1].rows).toHaveLength(2);
    const labels = summary.rows.map((r) => r[0]);
    expect(labels).toContain("Total valor pagado");
    expect(labels).toContain("Total 4x1000");
    expect(summary.rows.find((r) => r[0] === "Total monto")![1]).toBe(1164659);
    expect(sheets[2].rows).toEqual([["2", "31/08/2026", 1164659, EXPECTED_DESCRIPTION, "Pago nomina - Diseñador", "Tipo inesperado"]]);

    const clean = read(book(sheet("X", [{ id: 1 }])));
    expect(buildWalletSheets(analyzeWallet(clean.movements, { checkType: true })).map((s) => s.name)).toEqual(["Resumen", "Detalle"]);
  });
});
