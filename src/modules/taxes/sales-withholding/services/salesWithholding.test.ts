import { describe, expect, it } from "vitest";
import type { Cell, Sheet, Workbook } from "../../../../types/excel";
import type { Company, SelfWithholdingRate } from "../../../../types/models";
import { TAX_COLUMNS } from "../types";
import { analyzeSales, findRate, type TypeRules } from "./analysis";
import { normalizeCiiu } from "./ciiu";
import { cellMicro, microToCents, toMicro, withholdingCents } from "./decimal";
import { buildSalesSheets } from "./excelExport";
import { readSalesWorkbook } from "./workbookReader";

const HEADERS = [
  "Tipo de documento", "CUFE/CUDE", "Folio", "Prefijo", "Divisa", "Forma de Pago", "Medio de Pago", "Fecha Emisión", "Fecha Recepción",
  "NIT Emisor", "Nombre Emisor", "NIT Receptor", "Nombre Receptor", ...TAX_COLUMNS, "Rete IVA", "Rete Renta", "Rete ICA", "Total", "Estado", "Grupo",
];

type RowSpec = { type?: string; cufe?: string; folio?: string; prefix?: string; nit?: string; name?: string; total?: Cell; iva?: Cell; inc?: Cell; reteRenta?: Cell };

const s = (v: string): Cell => ({ t: "s", v });
const n = (v: number): Cell => ({ t: "n", v });
const E: Cell = { t: "e" };

let auto = 0;
function row(spec: RowSpec, headers = HEADERS): Cell[] {
  auto += 1;
  const values: Record<string, Cell> = {
    "Tipo de documento": spec.type === undefined ? s("Factura electrónica") : spec.type ? s(spec.type) : E,
    "CUFE/CUDE": s(spec.cufe ?? `cufe-${auto}`),
    Folio: s(spec.folio ?? String(auto)),
    Prefijo: s(spec.prefix ?? "FE"),
    "Fecha Emisión": s("31-08-2026"),
    "NIT Emisor": s(spec.nit ?? "900738791"),
    "Nombre Emisor": s(spec.name ?? "DIGICORT SAS"),
    IVA: spec.iva ?? n(0),
    INC: spec.inc ?? n(0),
    "Rete Renta": spec.reteRenta ?? n(0),
    Total: spec.total ?? n(0),
  };
  return headers.map((h) => values[h] ?? (TAX_COLUMNS.includes(h as never) ? n(0) : E));
}

function book(rows: RowSpec[], { sheet = "Ventas", headers = HEADERS, extra = [] as Sheet[] } = {}): Workbook {
  return {
    fileName: "Facturacion DIAN.xlsx",
    sheets: [{ name: "Compras", rows: [headers.map(s), row({ total: n(999_999) }, headers)] }, { name: sheet, rows: [headers.map(s), ...rows.map((r) => row(r, headers))] }, ...extra],
  };
}

const rules: TypeRules = new Map([
  ["factura electronica", "invoice"],
  ["nota de credito electronica", "credit_note"],
]);
const rate = (code: string, rateBp: number): SelfWithholdingRate => ({ id: 1, ciiuCode: code, normalizedCode: normalizeCiiu(code), economicActivity: "", rateBp, source: "", createdAt: "", updatedAt: "" });
const company = (patch: Partial<Company> = {}) => ({ id: 1, razonSocial: "DIGICORT SAS", nit: "900738791", dv: "1", ciiuCode: "6201", ...patch }) as Company;
const ctx = { rules, companies: [company()], rates: [rate("6201", 110)] };

function read(wb: Workbook) {
  const r = readSalesWorkbook(wb);
  if (r.kind !== "ok") throw new Error("se esperaba una hoja");
  return r.file;
}

const SAMPLE: RowSpec[] = [
  { total: n(5216.96), iva: n(832.96) }, // base 4.384,00
  { total: n(42573.44), iva: n(6797.44) }, // base 35.776,00
  { type: "Nota de crédito electrónica", prefix: "NC", total: n(3808), iva: n(608) }, // base 3.200,00
];

describe("decimales exactos", () => {
  it("usa la representación decimal de Excel sin errores binarios", () => {
    expect(toMicro(832.96)).toBe(832_960_000n);
    expect(toMicro(0.1 + 0.2)).toBe(300_000n);
    expect(toMicro(-1748)).toBe(-1_748_000_000n);
    expect(cellMicro(E)).toBe(0n);
    expect(cellMicro(s("  "))).toBe(0n);
    expect(cellMicro(s("1.234,56"))).toBe(1_234_560_000n);
    expect(cellMicro(s("N/A"))).toBeNull();
    expect(cellMicro({ t: "x", v: "#VALUE!" })).toBeNull();
    expect(microToCents(1_234_565_000n)).toBe(123_457);
    // 31.355.919 × 1,10 % = 344.915,109 → 344.915,11 (mitad hacia arriba, una sola vez).
    expect(withholdingCents(31_355_919_000_000n, 110)).toBe(34_491_511);
  });
});

describe("lectura de la hoja Ventas", () => {
  it("detecta Ventas sin distinguir mayúsculas ni espacios y no usa Compras", () => {
    const file = read(book(SAMPLE, { sheet: "  VeNtAs " }));
    expect(file.sheetName).toBe("  VeNtAs ");
    expect(file.ignoredSheets).toEqual(["Compras"]);
    expect(file.rows).toHaveLength(3);
  });

  it("explica cuando no existe la hoja Ventas", () => {
    expect(() => readSalesWorkbook({ fileName: "x.xlsx", sheets: [{ name: "Compras", rows: [HEADERS.map(s)] }] })).toThrow(
      "No se encontró una hoja llamada Ventas en el archivo seleccionado.",
    );
  });

  it("pide elegir si varias hojas se llaman Ventas", () => {
    const wb = book(SAMPLE, { extra: [{ name: "VENTAS ", rows: [HEADERS.map(s), row({ total: n(1) })] }] });
    const r = readSalesWorkbook(wb);
    expect(r).toEqual({ kind: "choose-sheet", candidates: [{ name: "Ventas", rows: 3 }, { name: "VENTAS ", rows: 1 }] });
    const chosen = readSalesWorkbook(wb, "VENTAS ");
    expect(chosen.kind === "ok" && chosen.file.rows).toHaveLength(1);
  });

  it("localiza las columnas por nombre: mover columnas no cambia el resultado", () => {
    const moved = [...HEADERS];
    // ICUI al inicio y Total antes de IVA.
    moved.splice(moved.indexOf("ICUI"), 1);
    moved.unshift("ICUI");
    moved.splice(moved.indexOf("Total"), 1);
    moved.splice(moved.indexOf("IVA"), 0, "Total");
    const a = analyzeSales(read(book(SAMPLE)).rows, ctx);
    const b = analyzeSales(read(book(SAMPLE, { headers: moved })).rows, ctx);
    expect(microToCents(b.invoices.base)).toBe(4_016_000);
    expect(microToCents(b.creditNotes.base)).toBe(320_000);
    expect(b.invoices).toEqual(a.invoices);
    expect(b.creditNotes).toEqual(a.creditNotes);
  });

  it("lista todas las columnas faltantes de una sola vez", () => {
    const headers = HEADERS.filter((h) => h !== "ICUI");
    expect(() => readSalesWorkbook(book(SAMPLE, { headers }))).toThrow('No se puede calcular la base porque falta la columna "ICUI".');
    const fewer = HEADERS.filter((h) => h !== "ICUI" && h !== "Timbre" && h !== "Total");
    expect(() => readSalesWorkbook(book(SAMPLE, { headers: fewer }))).toThrow('faltan las columnas "Total", "Timbre", "ICUI".');
  });

  it("resta solo IVA…ICUI: las retenciones del archivo no afectan la base", () => {
    const file = read(book([{ total: n(119_000), iva: n(19_000), inc: n(1_000), reteRenta: n(2_500) }]));
    expect(microToCents(file.rows[0].taxesSum!)).toBe(2_000_000);
    expect(microToCents(file.rows[0].base!)).toBe(9_900_000);
  });
});

describe("análisis y autorretención", () => {
  it("separa Facturas y Notas Crédito y resta la autorretención de las notas", () => {
    const a = analyzeSales(read(book(SAMPLE)).rows, ctx);
    expect(a.invoices.count).toBe(2);
    expect(a.creditNotes.count).toBe(1);
    expect(a.invoices.withholdingCents).toBe(44_176); // 40.160 × 1,1 % = 441,76
    expect(a.creditNotes.withholdingCents).toBe(3_520); // 3.200 × 1,1 % = 35,20
    expect(a.totals).toEqual({ netCents: 40_656, netRoundedCents: 0 });
    expect(a.complete).toBe(true);
    const [summary] = buildSalesSheets(a);
    expect(summary.rows[0].slice(0, 4)).toEqual(["DIGICORT SAS", "900738791", "6201", "1,10 %"]);
  });

  it("reconoce tipos con mayúsculas y espacios repetidos", () => {
    const a = analyzeSales(read(book([{ type: "  NOTA de   crédito electrónica ", total: n(100) }])).rows, ctx);
    expect(a.rows[0].category).toBe("credit_note");
    expect(a.newTypes).toEqual([]);
  });

  it("pregunta por un tipo nuevo una vez y no vuelve a preguntar al guardarlo", () => {
    const rows = read(book([...SAMPLE, { type: "Documento electrónico X", total: n(1000) }, { type: "Documento electrónico X", total: n(500) }])).rows;
    const before = analyzeSales(rows, ctx);
    expect(before.newTypes).toEqual([{ key: "documento electronico x", label: "Documento electrónico X", rows: 2 }]);
    expect(before.pending[0]).toMatchObject({ kind: "new_type", blocking: true, title: 'Se encontró un nuevo tipo de documento: "Documento electrónico X"' });
    expect(before.complete).toBe(false);
    expect(before.invoices.count).toBe(2);

    const saved = new Map(rules).set("documento electronico x", "invoice");
    const after = analyzeSales(rows, { ...ctx, rules: saved });
    expect(after.newTypes).toEqual([]);
    expect(after.invoices.count).toBe(4);
    expect(microToCents(after.invoices.base)).toBe(4_016_000 + 150_000);
  });

  it("no suma dos veces un CUFE/CUDE repetido", () => {
    const rows = read(book([...SAMPLE, { cufe: "cufe-dup", total: n(1000) }, { cufe: "CUFE-DUP", total: n(1000) }])).rows;
    const a = analyzeSales(rows, ctx);
    expect(a.invoices.count).toBe(3);
    expect(microToCents(a.invoices.base)).toBe(4_016_000 + 100_000);
    const dup = a.rows.find((r) => r.status === "duplicate")!;
    expect(dup.duplicateOf).toBe(dup.rowNumber - 1);
    expect(a.pending.find((p) => p.kind === "duplicate")).toMatchObject({ blocking: false });
  });

  it("marca como «Requiere revisión» un valor no numérico (no lo convierte en 0)", () => {
    const a = analyzeSales(read(book([...SAMPLE, { total: s("abc"), iva: n(10) }])).rows, ctx);
    const bad = a.rows.find((r) => r.status === "invalid")!;
    expect(bad.invalid).toEqual([{ column: "Total", text: "abc" }]);
    expect(bad.counted).toBe(false);
    expect(a.invoices.count).toBe(2);
    expect(a.complete).toBe(false);
  });

  it("bloquea con varios NIT Emisor y no calcula tarifa", () => {
    const a = analyzeSales(read(book([...SAMPLE, { nit: "800.123.456-7", name: "OTRA SAS", total: n(10) }])).rows, ctx);
    expect(a.pending.find((p) => p.kind === "multiple_nits")?.items).toEqual(["NIT 900738791 · DIGICORT SAS · 3 filas", "NIT 800123456 · OTRA SAS · 1 fila"]);
    expect(a.totals).toBeUndefined();
    expect(a.invoices.withholdingCents).toBeUndefined();
  });

  it("empresa no registrada, sin CIIU o con CIIU fuera de la tabla: pendiente bloqueante, sin tarifa", () => {
    const rows = read(book(SAMPLE)).rows;
    expect(analyzeSales(rows, { ...ctx, companies: [] }).pending.map((p) => p.kind)).toEqual(["company_missing"]);
    const noCiiu = analyzeSales(rows, { ...ctx, companies: [company({ ciiuCode: "" })] });
    expect(noCiiu.pending[0].title).toBe("La empresa DIGICORT SAS no tiene Código CIIU configurado.");
    const missing = analyzeSales(rows, { ...ctx, companies: [company({ ciiuCode: "9999" })] });
    expect(missing.pending[0].title).toBe("El Código CIIU 9999 de la empresa no existe en la Tabla de Autorretenciones.");
    expect(missing.totals).toBeUndefined();
  });

  it("busca la empresa en Empresas aunque el NIT esté guardado con puntos o DV", () => {
    const rows = read(book(SAMPLE)).rows;
    expect(analyzeSales(rows, { ...ctx, companies: [company({ nit: "900.738.791-1" })] }).company).toBeDefined();
    expect(analyzeSales(rows, { ...ctx, companies: [company({ nit: "9007387911", dv: "1" })] }).company).toBeDefined();
  });

  it("CIIU con cero inicial: 111 de la tabla = 0111 de la empresa", () => {
    expect(normalizeCiiu("111")).toBe("0111");
    expect(normalizeCiiu("0111")).toBe("0111");
    expect(findRate([rate("111", 120)], "0111")?.rateBp).toBe(120);
    const a = analyzeSales(read(book(SAMPLE)).rows, { ...ctx, companies: [company({ ciiuCode: "0111" })], rates: [rate("111", 120)] });
    expect(a.rate?.rateBp).toBe(120);
    // Tarifa editada: el cálculo usa la de la tabla, no una fija.
    const edited = analyzeSales(read(book(SAMPLE)).rows, { ...ctx, rates: [rate("6201", 150)] });
    expect(edited.invoices.withholdingCents).toBe(60_240);
  });
});
