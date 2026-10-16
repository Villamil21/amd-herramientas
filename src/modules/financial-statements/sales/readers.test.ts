/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cell, Workbook } from "../../../types/excel";
import { readEInvoiceWorkbook, readTpsvWorkbook, SalesFormatError, TPSV_TXT_COLUMNS, tpsvTextToWorkbook } from "./readers";

const s = (v: string): Cell => ({ t: "s", v });
const n = (v: number): Cell => ({ t: "n", v });

const HEAD = ["Tipo de documento", "CUFE/CUDE", "Folio", "Prefijo", "Fecha Emisión", "NIT Emisor", "Nombre Emisor", "IVA", "ICA", "Rete IVA", "Rete Renta", "Rete ICA", "Total", "Estado"].map(s);

describe("facturación electrónica", () => {
  it("base = Total − suma de las columnas desde IVA hasta Rete ICA, ubicadas por encabezado", () => {
    // Columnas en otro orden y con una columna extra antes: no se depende de letras de Excel.
    const book: Workbook = {
      fileName: "x.xlsx",
      sheets: [
        { name: "Compras", rows: [HEAD, [s("Factura electrónica"), s("AAA"), s("1"), s("C"), s("01-08-2026"), s("800"), s("PROV"), n(19), n(0), n(0), n(0), n(0), n(119), s("ok")]] },
        {
          name: "Ventas",
          rows: [
            [s("Extra"), ...HEAD],
            [s("x"), s("Factura electrónica"), s("ABC"), s("12558"), s("FE"), s("31-08-2026"), s("900738791"), s("DIGICORT SAS -"), n(832.96), n(10), n(-5), n(-20), n(-3), n(5216.96), s("Aprobado")],
            [s("x"), s("Nota de crédito electrónica"), s(""), s("7"), s("NC"), s("2026-08-15"), s("900.738.791-1"), s("DIGICORT"), n(19), n(0), n(0), n(0), n(0), n(119), s("Aprobado")],
          ],
        },
      ],
    };
    const read = readEInvoiceWorkbook(book);
    expect(read.sheets).toEqual(["Ventas"]);
    expect(read.taxColumns).toEqual(["IVA", "ICA", "Rete IVA", "Rete Renta", "Rete ICA"]);
    const [fe, nc] = read.rows;
    expect(fe).toMatchObject({ number: "FE12558", issueDate: "2026-08-31", issuerNit: "900738791", cufe: "abc", baseCents: 521_696 - 81_496 });
    expect(nc).toMatchObject({ docTypeKey: "nota de credito electronica", issuerNit: "900738791", baseCents: 10_000, cufe: "" });
  });

  it("sin los encabezados no se adivina", () => {
    expect(() => readEInvoiceWorkbook({ fileName: "x", sheets: [{ name: "Hoja1", rows: [[s("Total")]] }] })).toThrow(SalesFormatError);
  });
});

describe("reporte de operaciones", () => {
  const head = ["N° Registro", "Fecha", "Código Tipo", "Monto Transacción", "Monto Acumulado", "Monto Acumulado 2"].map(s);
  it("usa solo «Monto Acumulado», revisa todas las hojas y marca filas repetidas", () => {
    const book: Workbook = {
      fileName: "tpsv.xlsx",
      sheets: [
        { name: "Transacciones", rows: [head, [s("1"), s("2026-01-02"), s("2"), s("4005"), s("15000000"), s("15000000")], [s("2"), s("2026-01-02"), s("2"), s("1"), s("4576200"), s("19576200")]] },
        { name: "Sheet1", rows: [head, [s("15"), s("2026-01-02"), s("3"), s("793"), s("3000000"), s("101342826")], [s("1"), s("2026-01-02"), s("2"), s("4005"), s("15000000"), s("15000000")], [s("16"), s("2026-01-03"), s("9"), s("1"), s("10"), s("10")]] },
      ],
    };
    const read = readTpsvWorkbook(book);
    expect(read.sheets).toEqual(["Transacciones", "Sheet1"]);
    expect(read.rows.map((r) => [r.registro, r.kind, r.amountCents / 100, Boolean(r.repeated)])).toEqual([
      ["1", "buy", 15_000_000, false],
      ["2", "buy", 4_576_200, false],
      ["15", "sell", 3_000_000, false],
      ["1", "buy", 15_000_000, true],
      ["16", undefined, 10, false],
    ]);
  });
});

describe("reporte de operaciones en TXT", () => {
  const line = (n: number, date: string, type: number, amount: number, amount2: number) =>
    [n, date, type, "41958607", "13", "41958607", "CLAUDIA", "CAPERA", "CO", "63001", "2", "W1", "W1", "USDT", "4005", amount, "4005", amount2, "W1", "31", "901418451", "BINANCE", "COLOMBIA SAS", "CO", "BINANCE", "CO"].join("|");
  const txt = ["         0210012652026-01-31       3", line(1, "2026-01-02", 2, 15000000, 99999999), line(2, "2026-01-21", 3, 32017955, 0), line(3, "2026-01-21", 7, 10, 10), "         021001265       3XXXX"].join("\r\n");

  it("se normaliza a la misma estructura del Excel: Tipo 2 compra, Tipo 3 venta, «Monto Acumulado» (nunca el 2)", () => {
    const read = readTpsvWorkbook(tpsvTextToWorkbook("TPSV.txt", txt));
    expect(read.sheets).toEqual(["TXT"]);
    expect(read.rows.map((r) => [r.registro, r.date, r.kind, r.amountCents])).toEqual([
      ["1", "2026-01-02", "buy", 1_500_000_000],
      ["2", "2026-01-21", "sell", 3_201_795_500],
      ["3", "2026-01-21", undefined, 1_000],
    ]);
  });

  it("el TXT y su Excel equivalente producen las mismas huellas (detección de duplicado)", () => {
    const fromTxt = readTpsvWorkbook(tpsvTextToWorkbook("TPSV.txt", txt)).rows.map((r) => r.fingerprint);
    const excel: Workbook = {
      fileName: "TPSV.xlsx",
      sheets: [
        {
          name: "Transacciones",
          rows: [
            TPSV_TXT_COLUMNS.map(s),
            ...txt
              .split("\r\n")
              .filter((l) => l.includes("|"))
              .map((l) => l.split("|").map((v, i) => (i === 1 ? s(v) : /^\d+$/.test(v) ? n(Number(v)) : s(v)))),
          ],
        },
      ],
    };
    expect(readTpsvWorkbook(excel).rows.map((r) => r.fingerprint)).toEqual(fromTxt);
  });

  it("un TXT sin la estructura no se adivina", () => {
    expect(() => tpsvTextToWorkbook("x.txt", "hola\nmundo")).toThrow(SalesFormatError);
    expect(() => tpsvTextToWorkbook("x.txt", "a|b|c")).toThrow(SalesFormatError);
  });
});

/**
 * Archivos reales (no se guardan en el repositorio): JSON del libro volcado con
 *   EXCEL_DUMP_IN=… EXCEL_DUMP_OUT=… cargo test dump_workbook_json
 *   FS_EINVOICE_JSON=dian.json FS_TPSV_JSON=tpsv.json npx vitest run sales/readers
 */
const einvoice = process.env.FS_EINVOICE_JSON;
const tpsv = process.env.FS_TPSV_JSON;

describe.skipIf(!einvoice)("facturación electrónica real", () => {
  it("lee la hoja Ventas con 151 facturas y 7 notas crédito", () => {
    const read = readEInvoiceWorkbook(JSON.parse(readFileSync(einvoice!, "utf8")));
    expect(read.sheets).toEqual(["Ventas"]);
    expect(read.taxColumns[0]).toBe("IVA");
    expect(read.taxColumns[read.taxColumns.length - 1]).toBe("Rete ICA");
    const count = (key: string) => read.rows.filter((r) => r.docTypeKey === key).length;
    expect([count("factura electronica"), count("nota de credito electronica")]).toEqual([151, 7]);
    expect(read.rows.every((r) => !r.issue && r.issuerNit === "900738791" && r.cufe.length >= 64)).toBe(true);
  });
});

describe.skipIf(!tpsv)("reporte de operaciones real", () => {
  it("lee compras (Transacciones) y ventas (Sheet1) sin duplicar", () => {
    const read = readTpsvWorkbook(JSON.parse(readFileSync(tpsv!, "utf8")));
    expect(read.rows.filter((r) => r.kind === "buy").length).toBe(477);
    expect(read.rows.filter((r) => r.kind === "sell").length).toBe(164);
    expect(read.rows.some((r) => r.repeated || r.issue)).toBe(false);
  });
});
