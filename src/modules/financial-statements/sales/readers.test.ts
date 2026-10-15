/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cell, Workbook } from "../../../types/excel";
import { readEInvoiceWorkbook, readTpsvWorkbook, SalesFormatError } from "./readers";

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
