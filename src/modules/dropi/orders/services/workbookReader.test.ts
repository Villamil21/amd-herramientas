import { describe, expect, it } from "vitest";
import type { Cell, Sheet, Workbook } from "../../../../types/excel";
import { DropiError } from "../types";
import { moneyCents, readOrdersWorkbook } from "./workbookReader";

const s = (v: string): Cell => ({ t: "s", v });
const n = (v: number): Cell => ({ t: "n", v });
const e: Cell = { t: "e" };

const HEADER = [
  "FECHA DE REPORTE",
  "ID",
  "FECHA",
  "NOMBRE CLIENTE",
  "NÚMERO GUIA",
  "ESTATUS",
  "NUMERO DE FACTURA",
  "VALOR FACTURADO",
  "VALOR DE COMPRA EN PRODUCTOS",
  "PRECIO FLETE",
  "COSTO DEVOLUCION FLETE",
  "TOTAL EN PRECIOS DE PROVEEDOR",
  "RAZON SOCIAL PARA FACTURACION",
];

function order(id: number, status: string, purchase: Cell = n(99900)): Cell[] {
  return [s("29-09-2026"), n(id), s("31-08-2026"), s("Cliente"), s("0240"), s(status), s("FV1"), n(14505.5), purchase, n(14505.5), n(0), n(15427), s("EMPRESA S.A.S")];
}

const ordersSheet = (name: string, rows: Cell[][]): Sheet => ({ name, rows: [HEADER.map(s), ...rows] });
const pivot: Sheet = { name: "Sheet2", rows: [[], [e, s("Row Labels"), s("Sum of VALOR DE COMPRA EN PRODUCTOS")], [e, s("ENTREGADO"), n(99900)]] };
const book = (...sheets: Sheet[]): Workbook => ({ fileName: "Ordenes.xlsx", sheets });

describe("moneyCents", () => {
  it("lee números, decimales, vacíos y textos con formato", () => {
    expect(moneyCents(n(99900))).toBe(9990000);
    expect(moneyCents(n(14505.5))).toBe(1450550);
    expect(moneyCents(n(0))).toBe(0);
    expect(moneyCents(e)).toBe(0);
    expect(moneyCents(undefined)).toBe(0);
    expect(moneyCents(s("99900"))).toBe(9990000);
    expect(moneyCents(s("14505.5"))).toBe(1450550);
    expect(moneyCents(s("$ 99.900"))).toBe(9990000);
    expect(moneyCents(s("14.505,50"))).toBe(1450550);
    expect(moneyCents(s("14,505.50"))).toBe(1450550);
  });

  it("marca como no válidos los textos que no son importes", () => {
    expect(moneyCents(s("N/A"))).toBeNull();
    expect(moneyCents({ t: "b", v: true })).toBeNull();
  });
});

describe("readOrdersWorkbook", () => {
  it("elige la hoja por encabezados, no por nombre, e ignora el pivote", () => {
    const result = readOrdersWorkbook(book(pivot, ordersSheet("Ventas", [order(1, "ENTREGADO"), order(2, "CANCELADO")])));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.file.sheetName).toBe("Ventas");
    expect(result.file.ignoredSheets).toEqual(["Sheet2"]);
    expect(result.file.rows.map((r) => [r.rowNumber, r.id, r.statusKey, r.purchaseCents])).toEqual([
      [2, "1", "ENTREGADO", 9990000],
      [3, "2", "CANCELADO", 9990000],
    ]);
    expect(result.file.company).toBe("EMPRESA S.A.S");
    expect(result.file.period).toBe("Agosto 2026");
  });

  it("lee las columnas por nombre aunque cambien de posición", () => {
    const reversed: Sheet = { name: "Data", rows: [[...HEADER].reverse().map(s), [...order(7, "DEVOLUCION")].reverse()] };
    const result = readOrdersWorkbook(book(reversed));
    expect(result.kind === "ok" && result.file.rows[0]).toMatchObject({ id: "7", status: "DEVOLUCION", supplierCents: 1542700, freightCents: 1450550 });
  });

  it("encuentra el encabezado aunque no esté en la primera fila", () => {
    const sheet = ordersSheet("Reporte", [order(1, "ENTREGADO")]);
    sheet.rows.unshift([s("Reporte de órdenes")], []);
    const result = readOrdersWorkbook(book(sheet));
    expect(result.kind === "ok" && result.file.rows[0].rowNumber).toBe(4);
  });

  it("informa la columna que falta", () => {
    const sheet = ordersSheet("Sheet1", [order(1, "ENTREGADO")]);
    const col = HEADER.indexOf("COSTO DEVOLUCION FLETE");
    sheet.rows[0][col] = s("OTRA");
    expect(() => readOrdersWorkbook(book(sheet))).toThrow("El archivo no contiene la columna «COSTO DEVOLUCION FLETE».");
  });

  it("rechaza libros sin la estructura de Dropi", () => {
    expect(() => readOrdersWorkbook(book(pivot))).toThrow(new DropiError("No se encontró una hoja con la estructura de órdenes de Dropi."));
  });

  it("con dos hojas candidatas usa la más completa y lo registra", () => {
    const full = ordersSheet("Ordenes", [order(1, "ENTREGADO"), order(2, "ENTREGADO")]);
    const partial = ordersSheet("Filtro", [order(1, "ENTREGADO")]);
    const result = readOrdersWorkbook(book(partial, full));
    expect(result.kind === "ok" && result.file.sheetName).toBe("Ordenes");
    expect(result.kind === "ok" && result.file.sheetReason).toContain("«Filtro»");
  });

  it("si no se puede decidir, pide elegir la hoja; luego usa la elegida", () => {
    const a = ordersSheet("A", [order(1, "ENTREGADO")]);
    const b = ordersSheet("B", [order(2, "ENTREGADO")]);
    expect(readOrdersWorkbook(book(a, b))).toEqual({
      kind: "choose-sheet",
      candidates: [
        { name: "A", rows: 1 },
        { name: "B", rows: 1 },
      ],
    });
    const chosen = readOrdersWorkbook(book(a, b), "B");
    expect(chosen.kind === "ok" && chosen.file.rows[0].id).toBe("2");
  });

  it("registra importes no válidos, filas sin ID y sin estatus, y omite filas vacías", () => {
    const noId = order(3, "ENTREGADO");
    noId[1] = e;
    const noStatus = order(4, "");
    const result = readOrdersWorkbook(book(ordersSheet("Sheet1", [order(1, "ENTREGADO", s("N/A")), [], noId, noStatus])));
    if (result.kind !== "ok") throw new Error("se esperaba una hoja");
    expect(result.file.rows).toHaveLength(3);
    expect(result.file.invalidMoney).toEqual([{ rowNumber: 2, column: "VALOR DE COMPRA EN PRODUCTOS", text: "N/A" }]);
    expect(result.file.rows[0].purchaseCents).toBe(0);
    expect(result.file.rowsWithoutId).toEqual([4]);
    expect(result.file.rowsWithoutStatus).toEqual([5]);
  });
});
