import { describe, expect, it } from "vitest";
import type { Cell, Workbook } from "../../../types/excel";
import type { SalesDocCategory } from "../../../types/fs";
import { classifyEInvoice, eeffAmountCents, toExoDocs } from "./einvoiceDocs";
import { exoBaseCents, icuiIndex, readEInvoiceWorkbook, resolveExoScope } from "./readers";

const s = (v: string): Cell => ({ t: "s", v });
const n = (v: number): Cell => ({ t: "n", v });

/** Encabezados del Excel de la DIAN con ICUI antes de las retenciones. */
const DIAN = ["Tipo de documento", "CUFE/CUDE", "Folio", "Prefijo", "Fecha Emisión", "NIT Emisor", "Nombre Emisor", "NIT Receptor", "Nombre Receptor", "IVA", "ICA", "IC", "ICUI", "Rete Fuente", "Rete IVA", "Rete ICA", "Total", "Estado"];
const head = DIAN.map(s);
const row = (type: string, cufe: string, folio: string, date: string, nit: string, name: string, vals: { iva: number; icui: number; reteFuente: number; total: number }) => [
  s(type), s(cufe), s(folio), s("FE"), s(date), s("901000111"), s("MI EMPRESA SAS"), s(nit), s(name), n(vals.iva), n(0), n(0), n(vals.icui), n(vals.reteFuente), n(0), n(0), n(vals.total), s("Aprobado"),
];

export const sampleBook = (): Workbook => ({
  fileName: "ventas.xlsx",
  sheets: [
    {
      name: "Ventas",
      rows: [
        head,
        row("Factura electrónica", "CUFE-1", "1", "2026-03-10", "900.111.222-5", "CLIENTE UNO SAS", { iva: 190_000, icui: 10_000, reteFuente: 20_000, total: 1_190_000 }),
        row("Nota de crédito electrónica", "CUDE-2", "2", "2026-04-02", "900111222", "CLIENTE UNO SAS", { iva: 19_000, icui: 0, reteFuente: 0, total: 119_000 }),
        row("Factura electrónica", "CUFE-3", "3", "2026-05-15", "1020304050", "PEREZ ANA", { iva: 95_000, icui: 0, reteFuente: 0, total: 595_000 }),
        row("Factura electrónica", "CUFE-4", "4", "2025-12-20", "901222333", "CLIENTE DOS SAS", { iva: 38_000, icui: 0, reteFuente: 0, total: 238_000 }),
        row("Documento soporte", "CUFE-5", "5", "2026-06-01", "900111222", "CLIENTE UNO SAS", { iva: 0, icui: 0, reteFuente: 0, total: 50_000 }),
      ],
    },
  ],
});

const TYPES = new Map<string, SalesDocCategory>([
  ["factura electronica", "sale"],
  ["nota de credito electronica", "return"],
]);

describe("alcance de la base del 1007 (IVA … ICUI)", () => {
  it("EEFF conserva Total − (IVA … Rete ICA) y el 1007 resta solo hasta ICUI, ubicando los encabezados por nombre", () => {
    const read = readEInvoiceWorkbook(sampleBook());
    expect(read.taxColumns).toEqual(["IVA", "ICA", "IC", "ICUI", "Rete Fuente", "Rete IVA", "Rete ICA"]);
    const scope = resolveExoScope(read.taxColumns)!;
    expect(scope).toMatchObject({ lastColumn: "ICUI", resolvedBy: "header", columns: ["IVA", "ICA", "IC", "ICUI"] });
    const [fe] = read.rows;
    expect(fe.baseCents).toBe((1_190_000 - 190_000 - 10_000 - 20_000) * 100);
    expect(exoBaseCents(fe, scope)).toBe((1_190_000 - 190_000 - 10_000) * 100);
    expect(fe.ivaCents).toBe(19_000_000);
  });

  it("sin ICUI ni equivalente no se adivina: queda sin alcance hasta que el usuario elige la columna", () => {
    const columns = ["IVA", "ICA", "Rete Fuente", "Rete ICA"];
    expect(icuiIndex(columns)).toBe(-1);
    expect(resolveExoScope(columns)).toBeUndefined();
    expect(resolveExoScope(columns, "Columna inexistente")).toBeUndefined();
    expect(resolveExoScope(columns, "ICA")).toMatchObject({ columns: ["IVA", "ICA"], lastColumn: "ICA", resolvedBy: "manual" });
  });

  it("reconoce el equivalente configurado sin tildes ni mayúsculas", () => {
    expect(icuiIndex(["IVA", "IC Ultraprocesados", "Rete ICA"])).toBe(1);
  });
});

describe("clasificación y destinos", () => {
  it("un tipo nuevo no va a ningún destino hasta que se clasifica, y la decisión lo habilita", () => {
    const read = readEInvoiceWorkbook(sampleBook());
    const before = classifyEInvoice(read.rows, TYPES);
    expect(before.unknownTypes).toEqual([["documento soporte", "Documento soporte"]]);
    expect(before.unknownDocuments["documento soporte"]).toHaveLength(1);
    expect(before.counted.map((r) => r.cufe)).toEqual(["cufe-1", "cude-2", "cufe-3", "cufe-4"]);
    const decided = new Map(TYPES).set("documento soporte", "ignore");
    const after = classifyEInvoice(read.rows, decided);
    expect(after.unknownTypes).toEqual([]);
    expect(after.ignored).toHaveLength(1);
    expect(after.counted).toHaveLength(4);
    const asSale = classifyEInvoice(read.rows, new Map(TYPES).set("documento soporte", "sale"));
    expect(asSale.counted).toHaveLength(5);
  });

  it("los signos de Estados Financieros no cambian: la venta suma y la devolución resta la base", () => {
    const read = readEInvoiceWorkbook(sampleBook());
    const [fe, nc] = read.rows;
    expect(eeffAmountCents(fe, "sale")).toBe(97_000_000);
    expect(eeffAmountCents(nc, "return")).toBe(-10_000_000);
  });

  it("el detalle para Exógena trae un documento una sola vez y conserva el año de cada fecha", () => {
    const read = readEInvoiceWorkbook(sampleBook());
    const scope = resolveExoScope(read.taxColumns);
    const rows = classifyEInvoice(read.rows, TYPES).counted;
    const docs = toExoDocs([...rows, rows[0]], TYPES, "ventas.xlsx", read.taxColumns, scope);
    expect(docs).toHaveLength(4);
    expect(docs.map((d) => [d.documentId, d.category, d.issueDate.slice(0, 4)])).toEqual([
      ["cufe-1", "sale", "2026"],
      ["cude-2", "return", "2026"],
      ["cufe-3", "sale", "2026"],
      ["cufe-4", "sale", "2025"],
    ]);
    expect(docs[0]).toMatchObject({ eeffBaseCents: 97_000_000, exoBaseCents: 99_000_000, exoColumns: ["IVA", "ICA", "IC", "ICUI"], receiverNitRaw: "900.111.222-5" });
    expect(toExoDocs(rows, TYPES, "x", read.taxColumns, undefined)[0]).toMatchObject({ exoBaseCents: null, exoColumns: [] });
  });
});
