import { describe, expect, it } from "vitest";
import { fieldOfHeader } from "./headers";
import { CryptoFormatError, parseCryptoWorkbook } from "./parse";
import { blank, book, n, PURCHASE_HEADERS, s, SALE_HEADERS, sheet } from "./testkit";

const purchaseRow = [n(1_000_000), s("CC"), s("1018423456"), s("ANA"), blank, s("PEREZ"), blank, blank, s("Cali"), s("2026-01-15"), s("A-1")];
const saleRow = [s("NIT"), s("800197268"), blank, blank, blank, blank, blank, s("EMPRESA SAS"), n(5_000_000)];

describe("lectura del libro de Transacciones Cripto", () => {
  it("usa solo las hojas Compras y Ventas e ignora Hoja3, C y V", () => {
    const parsed = parseCryptoWorkbook(
      book("enero.xlsx", sheet("Compras", PURCHASE_HEADERS, [purchaseRow]), sheet("Ventas", SALE_HEADERS, [saleRow]), sheet("Hoja3", ["x"], [[s("1")]]), sheet("C", ["x"], [[s("1")]]), sheet("V", ["x"], [[s("1")]])),
    );
    expect(parsed.sheets).toEqual(["Compras", "Ventas"]);
    expect(parsed.ignoredSheets).toEqual(["Hoja3", "C", "V"]);
    expect([parsed.purchases, parsed.sales]).toEqual([1, 1]);
  });

  it("tolera mayúsculas, espacios y la errata «Identificación del terro»", () => {
    const header = [...PURCHASE_HEADERS];
    header[2] = "  IDENTIFICACIÓN  del terro ";
    header[0] = "VALOR TOTAL DE LA OPERACIÓN";
    header[9] = " fecha ";
    const parsed = parseCryptoWorkbook(book("a.xlsx", sheet(" compras ", header, [purchaseRow])));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].data["  IDENTIFICACIÓN  del terro".trim()]).toBe("1018423456");
    expect(fieldOfHeader("purchase", "Identificación del terro...")).toBe("docNumber");
    expect(fieldOfHeader("purchase", "Identificación del tercero para quien se recibió ingreso")).toBe("docNumber");
  });

  it("ubica las columnas por nombre aunque cambien de orden y conserva las vacías sin exigirlas", () => {
    const header = ["Fecha", "Valor total de la operación", "Otra columna", "Código mcp"];
    const parsed = parseCryptoWorkbook(book("a.xlsx", sheet("Compras", header, [[s("2026-02-01"), n(50), s("dato"), blank]])));
    expect(parsed.rows[0].data).toEqual({ Fecha: "2026-02-01", "Valor total de la operación": 50, "Otra columna": "dato" });
  });

  it("guarda las fechas ISO, los importes como número y la identificación como texto", () => {
    const parsed = parseCryptoWorkbook(book("a.xlsx", sheet("Compras", PURCHASE_HEADERS, [[s("$ 1.250.000,50"), s("CC"), n(800197268), blank, blank, blank, blank, blank, blank, n(46037), blank]])));
    const data = parsed.rows[0].data;
    expect(data["Valor total de la operación"]).toBe(1_250_000.5);
    expect(data["Identificación del tercero para quien se recibió ingreso"]).toBe("800197268");
    expect(data["Fecha"]).toBe("2026-01-15");
  });

  it("la huella no depende de la posición de la fila", () => {
    const a = parseCryptoWorkbook(book("a.xlsx", sheet("Compras", PURCHASE_HEADERS, [purchaseRow])));
    const b = parseCryptoWorkbook(book("b.xlsx", sheet("Compras", PURCHASE_HEADERS, [[...Array(11).fill(blank)], purchaseRow])));
    expect(b.rows[0].rowNumber).toBe(a.rows[0].rowNumber + 1);
    expect(b.rows[0].fingerprint).toBe(a.rows[0].fingerprint);
  });

  it("explica qué columna mínima falta", () => {
    expect(() => parseCryptoWorkbook(book("a.xlsx", sheet("Compras", ["Valor total de la operación", "Orden"], [[n(1), s("x")]])))).toThrow(/Fecha/);
    expect(() => parseCryptoWorkbook(book("a.xlsx", sheet("Ventas", ["DV"], [[s("1")]])))).toThrow(/Ingresos brutos recibidos/);
    expect(() => parseCryptoWorkbook(book("a.xlsx", sheet("Hoja3", ["x"], [])))).toThrow(CryptoFormatError);
  });

  it("avisa cuando falta una de las dos hojas", () => {
    const parsed = parseCryptoWorkbook(book("a.xlsx", sheet("Compras", PURCHASE_HEADERS, [purchaseRow])));
    expect(parsed.warnings[0]).toMatch(/Ventas/);
  });
});
