import { describe, expect, it } from "vitest";
import type { Supplier, VatType } from "../../../../types/models";
import type { FileResult, InvoiceLine, ParsedInvoice, ProductLine, TitleRule } from "../types";
import { buildReport, interpretLines, nameKey } from "./analysis";
import { buildInvoiceVatSheets } from "./excelExport";
import { NOTES_CATEGORY } from "./labels";

const line = (rateBp: number, baseCents: number, vatCents: number): InvoiceLine => ({ page: 1, description: "", rateBp, baseCents, vatCents });
/** Fila con IVA y % vacíos, como la deja el lector. */
const blank = (baseCents: number | undefined, description = "Peaje"): ProductLine => ({ page: 1, description, baseCents, emptyTax: true, issue: "No se pudo identificar: %, IVA." });

/** Documento cuyos totales concilian con sus filas (las vacías suman su precio y no llevan IVA). */
function invoice(nit: string, number: string, products: ProductLine[], extra: Partial<ParsedInvoice> = {}): ParsedInvoice {
  const lines = products.filter((p): p is InvoiceLine => !p.issue);
  const bases = products.reduce((s, p) => s + (p.baseCents ?? 0), 0);
  const vat = lines.reduce((s, l) => s + l.vatCents, 0);
  return { pageCount: 1, documentType: "FACTURA ELECTRÓNICA DE VENTA", invoiceNumber: number, supplierNit: nit, supplierName: `PROV ${nit}`, lines, lineIssues: [], products, subtotalCents: bases, invoiceVatCents: vat, ...extra };
}

const file = (fileName: string, inv: ParsedInvoice): FileResult => ({ fileName, kind: "parsed", invoice: inv });
const supplier = (id: number, nit: string, vatType: VatType, businessName = `PROV ${nit}`): Supplier => ({ id, nit, businessName, vatType, createdAt: "", updatedAt: "" });

/** Los títulos iniciales de la migración 009 (normalizados como en SQLite). */
const TITLES: TitleRule[] = [
  { normalizedTitle: "factura electronica de venta", category: "invoice" },
  { normalizedTitle: "factura electronica de mandato", category: "invoice" },
  { normalizedTitle: "factura de venta de talonario o de papel", category: "invoice" },
  { normalizedTitle: "nota de credito electronica", category: "credit_note" },
];
const NOTE = { documentType: "Nota de crédito electrónica" };
const P1 = [supplier(1, "1", "purchase")];

describe("buildReport: proveedores y renglones de Facturas", () => {
  it("pide cada proveedor nuevo una sola vez y solo suma sus documentos al configurarlo", () => {
    const files = Array.from({ length: 5 }, (_, i) => file(`a${i}.pdf`, invoice("111", `F-${i}`, [line(1900, 10_000, 1_900)])));
    const pending = buildReport([...files, file("b.pdf", invoice("222", "B-1", [line(0, 500, 0)]))], [], TITLES);
    expect(pending.pendingSuppliers).toEqual([
      { nit: "111", name: "PROV 111", invoiceCount: 5 },
      { nit: "222", name: "PROV 222", invoiceCount: 1 },
    ]);
    expect(pending.summary.invoices).toMatchObject({ documentCount: 0, purchases19: { baseCents: 0, vatCents: 0 }, zeroBaseCents: 0 });
    expect(pending.rows.every((r) => r.status === "pending-supplier")).toBe(true);
    expect(pending.stats).toMatchObject({ files: 6, suppliers: 2, newSuppliers: 2, pending: 6, validated: 0 });

    const done = buildReport(files, [supplier(1, "111", "purchase")], TITLES);
    expect(done.rows.every((r) => r.status === "processed" && r.vatType === "purchase")).toBe(true);
    expect(done.summary.invoices.purchases19).toEqual({ baseCents: 50_000, vatCents: 9_500 });
    expect(done.stats).toMatchObject({ pending: 0, validated: 5 });
  });

  it("separa Compras y Servicios al 19 % y suma juntas las bases al 0 %", () => {
    const report = buildReport(
      [
        file("a.pdf", invoice("111", "A-1", [line(1900, 10_000, 1_900), line(0, 1_000, 0), line(500, 2_000, 100)])),
        file("b.pdf", invoice("222", "B-1", [line(1900, 20_000, 3_800), line(0, 3_000, 0)])),
      ],
      [supplier(1, "111", "purchase"), supplier(2, "222", "service")],
      TITLES,
    );
    expect(report.summary.invoices).toEqual({
      documentCount: 2,
      purchases5: { baseCents: 2_000, vatCents: 100 },
      purchases19: { baseCents: 10_000, vatCents: 1_900 },
      services19: { baseCents: 20_000, vatCents: 3_800 },
      zeroBaseCents: 4_000,
    });
  });

  it("deja para revisión las tarifas no configuradas y los servicios al 5 % (no contaminan el resumen)", () => {
    const report = buildReport([file("s.pdf", invoice("222", "S-1", [line(1000, 10_000, 1_000), line(500, 2_000, 100)]))], [supplier(2, "222", "service")], TITLES);
    const row = report.rows[0];
    expect(row.status).toBe("review");
    expect(row.otherRates).toEqual([{ rateBp: 1000, baseCents: 10_000, vatCents: 1_000 }]);
    expect(row.problems.map((p) => p.code)).toEqual(["other-rate", "services-5"]);
    expect(report.summary.invoices).toMatchObject({ documentCount: 0, purchases5: { baseCents: 0, vatCents: 0 } });
  });

  it("diferencia de redondeo del IVA: informativa y sin alterar valores; una mayor exige revisión", () => {
    const lines = [line(1900, 10_000, 1_900), line(500, 1_000, 50)];
    const report = buildReport([file("a.pdf", invoice("1", "A", lines, { invoiceVatCents: 2_050 })), file("b.pdf", invoice("1", "B", lines, { invoiceVatCents: 9_000 }))], P1, TITLES);
    expect(report.rows[0]).toMatchObject({ status: "processed", detailVatCents: 1_950, vat19: 1_900, vat5: 50 });
    expect(report.rows[0].notes[0]).toContain("Diferencia por validar $1");
    expect(report.rows[1]).toMatchObject({ status: "review", problems: [{ code: "vat-mismatch" }] });
  });

  it("avisa cuando la razón social de un NIT existente es distinta", () => {
    const files = [file("a.pdf", invoice("900", "A", [line(0, 1, 0)], { supplierName: "PRICE SMART COLOMBIA S.A.S." }))];
    const suppliers = [supplier(1, "900", "purchase", "PRICESMART COLOMBIA S.A.S.")];
    const report = buildReport(files, suppliers, TITLES);
    expect(report.nameMismatches).toMatchObject([{ storedName: "PRICESMART COLOMBIA S.A.S.", invoiceName: "PRICE SMART COLOMBIA S.A.S.", invoiceCount: 1 }]);
    expect(report.rows[0].vatType).toBe("purchase");
    expect(buildReport(files, suppliers, TITLES, { keptNames: new Set([nameKey("900", "PRICE SMART COLOMBIA S.A.S.")]) }).nameMismatches).toEqual([]);
  });
});

describe("buildReport: solo dos categorías de documento", () => {
  it("clasifica los títulos iniciales sin distinguir mayúsculas, tildes ni espacios", () => {
    const report = buildReport(
      [
        file("m.pdf", invoice("1", "M-1", [line(1900, 10_000, 1_900)], { documentType: "FACTURA ELECTRÓNICA DE MANDATO" })),
        file("p.pdf", invoice("1", "P-1", [line(1900, 10_000, 1_900)], { documentType: "Factura  de venta de talonario o de PAPEL" })),
        file("n.pdf", invoice("1", "N-1", [line(1900, 4_000, 760)], { documentType: "NOTA DE CREDITO  ELECTRONICA" })),
      ],
      P1,
      TITLES,
    );
    expect(report.rows.map((r) => [r.category, r.status])).toEqual([["invoice", "processed"], ["invoice", "processed"], ["credit_note", "processed"]]);
    expect(report.unknownTitles).toEqual([]);
    expect(report.stats).toMatchObject({ invoices: 2, notes: 1 });
    // Las Notas no se mezclan con las Facturas ni se netean.
    expect(report.summary.invoices.purchases19).toEqual({ baseCents: 20_000, vatCents: 3_800 });
    expect(report.summary.notes).toEqual({ documentCount: 1, baseCents: 4_000, vatCents: 760 });
  });

  it("pregunta una sola vez por un título nuevo y lo aplica al guardarse la decisión", () => {
    const files = [
      file("x1.pdf", invoice("1", "X-1", [line(1900, 10_000, 1_900)], { documentType: "DOCUMENTO NUEVO XYZ" })),
      file("x2.pdf", invoice("1", "X-2", [line(1900, 5_000, 950)], { documentType: "Documento  nuevo xyz" })),
    ];
    const pending = buildReport(files, P1, TITLES);
    expect(pending.unknownTitles).toEqual([{ normalizedTitle: "documento nuevo xyz", displayTitle: "DOCUMENTO NUEVO XYZ", documentCount: 2 }]);
    expect(pending.rows.every((r) => r.status === "pending-title" && r.category === undefined)).toBe(true);
    expect(pending.summary.invoices.documentCount + pending.summary.notes.documentCount).toBe(0);

    const saved = buildReport(files, P1, [...TITLES, { normalizedTitle: "documento nuevo xyz", category: "credit_note" }]);
    expect(saved.unknownTitles).toEqual([]);
    expect(saved.summary.notes).toEqual({ documentCount: 2, baseCents: 15_000, vatCents: 2_850 });
  });

  it("resume las Notas crédito en una sola fila, sin separar tarifa ni Compras / Servicios", () => {
    const note = invoice("2", "NC-1", [line(1900, 10_000_000, 1_900_000), line(500, 5_000_000, 250_000), line(0, 2_000_000, 0)], NOTE);
    const report = buildReport([file("n.pdf", note)], [supplier(2, "2", "service")], TITLES);
    // Base 19 % $100.000 + 5 % $50.000 + 0 % $20.000 = $170.000; IVA $19.000 + $2.500 = $21.500.
    expect(report.rows[0]).toMatchObject({ status: "processed", category: "credit_note", problems: [] });
    expect(report.summary.notes).toEqual({ documentCount: 1, baseCents: 17_000_000, vatCents: 2_150_000 });
    expect(report.summary.invoices.documentCount).toBe(0);

    const summarySheet = buildInvoiceVatSheets(report, [supplier(2, "2", "service")])[0];
    expect(summarySheet.rows).toHaveLength(5);
    expect(summarySheet.rows[4]).toEqual(["Nota crédito", NOTES_CATEGORY, 170_000, 21_500]);
    expect(summarySheet.rows.slice(0, 4).every((r) => r[0] === "Factura electrónica")).toBe(true);
  });

  it("un documento sin título no se puede clasificar: queda por revisar hasta excluirlo", () => {
    const files = [file("s.pdf", invoice("1", "S-1", [line(0, 1_000, 0)], { documentType: "Documento sin título" }))];
    const report = buildReport(files, P1, TITLES);
    expect(report.rows[0]).toMatchObject({ status: "review", problems: [{ code: "title-missing" }] });
    expect(report.unknownTitles).toEqual([]);
    expect(buildReport(files, P1, TITLES, { decisions: { "s.pdf": { excluded: true } } }).stats).toMatchObject({ pending: 0, excluded: 1, validated: 0 });
  });
});

describe("filas con IVA y % vacíos", () => {
  it("las interpreta como 0 % cuando el documento concilia (peaje F2X: subtotal $13.300, IVA $0)", () => {
    const f2x = invoice("830", "FEFL-3798332", [blank(1_330_000)]);
    expect([f2x.subtotalCents, f2x.invoiceVatCents, f2x.lines.length]).toEqual([1_330_000, 0, 0]);
    const report = buildReport([file("f2x.pdf", f2x)], [supplier(1, "830", "service")], TITLES);
    const row = report.rows[0];
    expect(row).toMatchObject({ status: "processed", base0: 1_330_000, detailVatCents: 0, lineCount: 1, pendingLines: [], problems: [] });
    // En el detalle se ve la decisión del lector, no guiones.
    expect(row.products).toMatchObject([{ rateBp: 0, vatCents: 0, baseCents: 1_330_000, origin: "auto-zero" }]);
    expect(row.notes[0]).toContain("se interpretó como 0 %");
    expect(report.summary.invoices.zeroBaseCents).toBe(1_330_000);
  });

  it("junto a líneas gravadas: solo si el IVA del documento ya está explicado por ellas", () => {
    const mixed = invoice("1", "A", [line(1900, 100_000, 19_000), blank(50_000)]);
    expect(buildReport([file("a.pdf", mixed)], P1, TITLES).rows[0]).toMatchObject({ status: "processed", base19: 100_000, base0: 50_000 });
    // En una Nota crédito también alimenta la base (una sola fila).
    expect(buildReport([file("n.pdf", { ...mixed, ...NOTE })], P1, TITLES).summary.notes).toEqual({ documentCount: 1, baseCents: 150_000, vatCents: 19_000 });
  });

  it("no asume 0 % si hay ambigüedad", () => {
    const pendingOf = (inv: ParsedInvoice) => buildReport([file("a.pdf", inv)], P1, TITLES).rows[0];
    // El documento reporta IVA que las demás líneas no explican: la fila vacía podría estar gravada.
    const withVat = pendingOf(invoice("1", "A", [line(1900, 100_000, 19_000), blank(50_000)], { invoiceVatCents: 28_500 }));
    expect(withVat).toMatchObject({ status: "review", pendingLines: [1], base0: 0 });
    expect(withVat.problems[0].code).toBe("lines");
    // El subtotal no concilia con las bases.
    expect(pendingOf(invoice("1", "B", [blank(50_000)], { subtotalCents: 80_000 })).pendingLines).toEqual([0]);
    // Faltan los totales del documento.
    expect(pendingOf(invoice("1", "C", [blank(50_000)], { subtotalCents: undefined })).pendingLines).toEqual([0]);
    expect(pendingOf(invoice("1", "D", [blank(50_000)], { invoiceVatCents: undefined })).pendingLines).toEqual([0]);
    // No se identificó el «Precio unitario de venta».
    expect(pendingOf(invoice("1", "E", [line(0, 50_000, 0), blank(undefined)])).pendingLines).toEqual([1]);
    // Otra columna indica una tarifa: no es una fila vacía.
    const rated: ProductLine = { page: 1, description: "Con tarifa", rateBp: 1900, baseCents: 50_000, issue: "No se pudo identificar: IVA." };
    expect(pendingOf(invoice("1", "F", [rated])).pendingLines).toEqual([0]);
    expect(pendingOf(invoice("1", "F", [rated])).products[0].origin).toBeUndefined();
  });

  it("acepta un peso de redondeo por línea para decidir el 0 %, pero la diferencia de bases se confirma", () => {
    const inv = invoice("1", "FVED-1", [line(1900, 46_875, 8_906), blank(4_008_304_100, "FLETE")], { subtotalCents: 4_008_350_875 });
    const files = [file("d.pdf", inv)];
    const row = buildReport(files, P1, TITLES).rows[0];
    expect(row.pendingLines).toEqual([]);
    expect(row).toMatchObject({ status: "review", problems: [{ code: "base-mismatch" }] });
    const confirmed = buildReport(files, P1, TITLES, { decisions: { "d.pdf": { confirmed: true } } });
    expect(confirmed.rows[0]).toMatchObject({ status: "processed", problems: [], base0: 4_008_304_100 });
    expect(confirmed.rows[0].notes.join(" ")).toContain("Confirmado por el usuario");
  });

  it("el usuario define la tarifa de una fila dudosa o la ignora, sin volver a leer el PDF", () => {
    const inv = invoice("1", "A", [line(1900, 100_000, 19_000), blank(50_000)], { subtotalCents: 150_000, invoiceVatCents: 28_500 });
    const report = (lines: Record<number, 0 | 500 | 1900 | "ignore">, extra = {}) => buildReport([file("a.pdf", inv)], P1, TITLES, { decisions: { "a.pdf": { lines, ...extra } } }).rows[0];

    // 19 %: la celda de IVA está vacía → base × tarifa, y el documento concilia.
    expect(report({ 1: 1900 })).toMatchObject({ status: "processed", base19: 150_000, vat19: 28_500, pendingLines: [] });
    expect(report({ 1: 1900 }).products[1]).toMatchObject({ rateBp: 1900, vatCents: 9_500, origin: "manual" });
    // 0 %: el precio unitario de venta suma como excluido / exento / no gravado; el IVA ya no concilia y se debe confirmar.
    expect(report({ 1: 0 })).toMatchObject({ status: "review", base0: 50_000, problems: [{ code: "vat-mismatch" }] });
    expect(report({ 1: 0 }, { confirmed: true })).toMatchObject({ status: "processed", base0: 50_000 });
    expect(report({ 1: 500 })).toMatchObject({ base5: 50_000, vat5: 2_500 });
    // Ignorar: la fila no suma y deja de estar pendiente.
    const ignored = report({ 1: "ignore" });
    expect(ignored).toMatchObject({ pendingLines: [], base0: 0, base19: 100_000 });
    expect(ignored.products[1].origin).toBe("ignored");
    expect(ignored.products[1].rateBp).toBeUndefined();
    expect(ignored.problems.map((p) => p.code)).toEqual(["base-mismatch", "vat-mismatch"]);

    // Una fila sin precio de venta no admite tarifa: solo se puede ignorar.
    const noPrice = invoice("1", "B", [line(0, 50_000, 0), blank(undefined)]);
    expect(interpretLines(noPrice, { lines: { 1: 0 } }).pending).toEqual([1]);
    expect(interpretLines(noPrice, { lines: { 1: "ignore" } }).pending).toEqual([]);
  });
});

describe("buildReport: solo documentos válidos en el resumen", () => {
  it("marca la suma de bases distinta del subtotal y la deja fuera hasta confirmarla", () => {
    const files = [file("ok.pdf", invoice("1", "OK", [line(1900, 10_000, 1_900)])), file("a.pdf", invoice("1", "A", [line(1900, 10_000, 1_900)], { subtotalCents: 30_000, grossTotalCents: 30_000 }))];
    const report = buildReport(files, P1, TITLES);
    expect(report.rows[1].status).toBe("review");
    expect(report.rows[1].issues[0]).toContain("no coincide con el subtotal");
    expect(report.summary.invoices).toMatchObject({ documentCount: 1, purchases19: { baseCents: 10_000, vatCents: 1_900 } });
    expect(report.stats).toMatchObject({ validated: 1, pending: 1 });
    expect(buildReport(files, P1, TITLES, { decisions: { "a.pdf": { confirmed: true } } }).summary.invoices.purchases19.baseCents).toBe(20_000);
  });

  it("un posible duplicado queda pendiente hasta que el usuario lo incluye o lo excluye", () => {
    const inv = invoice("1", "COFE-1", [line(1900, 10_000, 1_900)]);
    const files = [file("a.pdf", inv), file("a (copia).pdf", { ...inv, invoiceNumber: "COFE1" })];
    const report = buildReport(files, P1, TITLES);
    expect(report.rows[1]).toMatchObject({ status: "review", duplicateOf: "a.pdf", problems: [{ code: "duplicate" }] });
    expect(report.summary.invoices.purchases19.baseCents).toBe(10_000);

    const included = buildReport(files, P1, TITLES, { decisions: { "a (copia).pdf": { includeDuplicate: true } } });
    expect(included.rows[1].status).toBe("processed");
    expect(included.summary.invoices.purchases19.baseCents).toBe(20_000);

    const excluded = buildReport(files, P1, TITLES, { decisions: { "a (copia).pdf": { excluded: true } } });
    expect(excluded.rows[1].status).toBe("excluded");
    expect(excluded.summary.invoices.purchases19.baseCents).toBe(10_000);
    expect(excluded.stats).toMatchObject({ pending: 0, excluded: 1, validated: 1 });
  });

  it("un documento excluido no pide configurar su proveedor ni clasificar su título", () => {
    const files = [file("x.pdf", invoice("999", "X-1", [line(0, 1_000, 0)], { documentType: "OTRO DOCUMENTO" }))];
    expect(buildReport(files, [], TITLES)).toMatchObject({ pendingSuppliers: [{ nit: "999" }], unknownTitles: [{ normalizedTitle: "otro documento" }] });
    expect(buildReport(files, [], TITLES, { decisions: { "x.pdf": { excluded: true } } })).toMatchObject({ pendingSuppliers: [], unknownTitles: [], stats: { pending: 0 } });
  });

  it("continúa el lote con archivos no compatibles o con error, que quedan pendientes hasta excluirlos", () => {
    const files: FileResult[] = [
      file("a.pdf", invoice("1", "A", [line(0, 1, 0)])),
      { fileName: "x.pdf", kind: "incompatible", message: "No se encontró la sección «Detalles de Productos»." },
      { fileName: "y.pdf", kind: "error", message: "El PDF está dañado." },
    ];
    const report = buildReport(files, P1, TITLES);
    expect(report.stats).toMatchObject({ files: 3, validated: 1, pending: 2 });
    expect(report.incidents.filter((i) => i.type !== "Información").map((i) => [i.fileName, i.type])).toEqual([["x.pdf", "No compatible"], ["y.pdf", "Error"]]);
    expect(buildReport(files, P1, TITLES, { decisions: { "x.pdf": { excluded: true }, "y.pdf": { excluded: true } } }).stats).toMatchObject({ validated: 1, pending: 0, excluded: 2 });
  });
});
