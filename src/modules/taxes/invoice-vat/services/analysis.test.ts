import { describe, expect, it } from "vitest";
import type { Supplier, VatType } from "../../../../types/models";
import type { FileResult, InvoiceLine, ParsedInvoice } from "../types";
import { buildReport, nameKey } from "./analysis";

const line = (rateBp: number, baseCents: number, vatCents: number): InvoiceLine => ({ page: 1, description: "", rateBp, baseCents, vatCents });

function invoice(nit: string, number: string, lines: InvoiceLine[], extra: Partial<ParsedInvoice> = {}): ParsedInvoice {
  const bases = lines.reduce((s, l) => s + l.baseCents, 0);
  const vat = lines.reduce((s, l) => s + l.vatCents, 0);
  return { pageCount: 1, documentType: "FACTURA ELECTRÓNICA DE VENTA", invoiceNumber: number, supplierNit: nit, supplierName: `PROV ${nit}`, lines, lineIssues: [], products: lines, subtotalCents: bases, invoiceVatCents: vat, ...extra };
}

const file = (fileName: string, inv: ParsedInvoice): FileResult => ({ fileName, kind: "parsed", invoice: inv });
const supplier = (id: number, nit: string, vatType: VatType, businessName = `PROV ${nit}`): Supplier => ({ id, nit, businessName, vatType, createdAt: "", updatedAt: "" });

describe("buildReport", () => {
  it("pide cada proveedor nuevo una sola vez y no genera resumen hasta clasificarlo", () => {
    const files = Array.from({ length: 5 }, (_, i) => file(`a${i}.pdf`, invoice("111", `F-${i}`, [line(1900, 10_000, 1_900)])));
    const pending = buildReport([...files, file("b.pdf", invoice("222", "B-1", [line(0, 500, 0)]))], []);
    expect(pending.pendingSuppliers).toEqual([
      { nit: "111", name: "PROV 111", invoiceCount: 5 },
      { nit: "222", name: "PROV 222", invoiceCount: 1 },
    ]);
    expect(pending.summaries).toEqual([]);
    expect(pending.rows.every((r) => r.status === "pending-supplier")).toBe(true);
    expect(pending.stats).toMatchObject({ files: 6, suppliers: 2, newSuppliers: 2, pending: 6 });

    const done = buildReport(files, [supplier(1, "111", "purchase")]);
    expect(done.rows.every((r) => r.status === "processed" && r.vatType === "purchase")).toBe(true);
    expect(done.summaries[0].purchases19).toEqual({ baseCents: 50_000, vatCents: 9_500 });
  });

  it("separa Compras y Servicios al 19 % y suma juntas las bases al 0 %", () => {
    const report = buildReport(
      [
        file("a.pdf", invoice("111", "A-1", [line(1900, 10_000, 1_900), line(0, 1_000, 0), line(500, 2_000, 100)])),
        file("b.pdf", invoice("222", "B-1", [line(1900, 20_000, 3_800), line(0, 3_000, 0)])),
      ],
      [supplier(1, "111", "purchase"), supplier(2, "222", "service")],
    );
    expect(report.summaries).toHaveLength(1);
    expect(report.summaries[0]).toMatchObject({
      invoiceCount: 2,
      purchases5: { baseCents: 2_000, vatCents: 100 },
      purchases19: { baseCents: 10_000, vatCents: 1_900 },
      services19: { baseCents: 20_000, vatCents: 3_800 },
      zeroBaseCents: 4_000,
      services5: { baseCents: 0, vatCents: 0 },
    });
  });

  it("genera un resumen independiente por cada título, sin netear", () => {
    const report = buildReport(
      [
        file("f.pdf", invoice("111", "F-1", [line(1900, 10_000, 1_900)])),
        file("n.pdf", invoice("111", "N-1", [line(1900, 4_000, 760)], { documentType: "Nota  electrónica de venta" })),
        file("n2.pdf", invoice("111", "N-2", [line(1900, 1_000, 190)], { documentType: "NOTA ELECTRONICA DE VENTA" })),
      ],
      [supplier(1, "111", "purchase")],
    );
    expect(report.summaries.map((s) => [s.documentType, s.invoiceCount, s.purchases19.baseCents])).toEqual([
      ["FACTURA ELECTRÓNICA DE VENTA", 1, 10_000],
      ["Nota  electrónica de venta", 2, 5_000],
    ]);
    expect(report.stats.documentTypes).toBe(2);
  });

  it("conserva tarifas no configuradas y servicios al 5 % para revisión", () => {
    const report = buildReport(
      [file("s.pdf", invoice("222", "S-1", [line(1000, 10_000, 1_000), line(500, 2_000, 100)]))],
      [supplier(2, "222", "service")],
    );
    const row = report.rows[0];
    expect(row.status).toBe("review");
    expect(row.otherRates).toEqual([{ rateBp: 1000, baseCents: 10_000, vatCents: 1_000 }]);
    expect(row.issues).toContain("Se encontró una tarifa de IVA no configurada: 10 %.");
    expect(row.issues).toContain("Servicios al 5 % detectados: requieren clasificación en el resumen.");
    expect(report.summaries[0].purchases5.baseCents).toBe(0);
    expect(report.summaries[0].services5).toEqual({ baseCents: 2_000, vatCents: 100 });
    expect(report.summaries[0].otherRates).toEqual([{ rateBp: 1000, baseCents: 10_000, vatCents: 1_000 }]);
  });

  it("diferencia de redondeo del IVA: informativa y sin alterar valores; una mayor exige revisión", () => {
    const lines = [line(1900, 10_000, 1_900), line(500, 1_000, 50)];
    const report = buildReport(
      [file("a.pdf", invoice("1", "A", lines, { invoiceVatCents: 2_050 })), file("b.pdf", invoice("1", "B", lines, { invoiceVatCents: 9_000 }))],
      [supplier(1, "1", "purchase")],
    );
    expect(report.rows[0]).toMatchObject({ status: "processed", detailVatCents: 1_950, vat19: 1_900, vat5: 50 });
    expect(report.rows[0].notes[0]).toContain("Diferencia por validar $1");
    expect(report.rows[1].status).toBe("review");
  });

  it("marca la suma de bases distinta del subtotal", () => {
    const report = buildReport([file("a.pdf", invoice("1", "A", [line(1900, 10_000, 1_900)], { subtotalCents: 30_000, grossTotalCents: 30_000 }))], [supplier(1, "1", "purchase")]);
    expect(report.rows[0].status).toBe("review");
    expect(report.rows[0].issues[0]).toContain("no coincide con el subtotal");
  });

  it("detecta posibles duplicados y los excluye del resumen salvo que se pida", () => {
    const inv = invoice("1", "COFE-1", [line(1900, 10_000, 1_900)]);
    const files = [file("a.pdf", inv), file("a (copia).pdf", { ...inv, invoiceNumber: "COFE1" })];
    const report = buildReport(files, [supplier(1, "1", "purchase")]);
    expect(report.rows[1]).toMatchObject({ status: "review", duplicateOf: "a.pdf" });
    expect(report.summaries[0].purchases19.baseCents).toBe(10_000);
    expect(buildReport(files, [supplier(1, "1", "purchase")], { includeDuplicates: true }).summaries[0].purchases19.baseCents).toBe(20_000);
  });

  it("avisa cuando la razón social de un NIT existente es distinta", () => {
    const files = [file("a.pdf", invoice("900", "A", [line(0, 1, 0)], { supplierName: "PRICE SMART COLOMBIA S.A.S." }))];
    const suppliers = [supplier(1, "900", "purchase", "PRICESMART COLOMBIA S.A.S.")];
    const report = buildReport(files, suppliers);
    expect(report.nameMismatches).toMatchObject([{ storedName: "PRICESMART COLOMBIA S.A.S.", invoiceName: "PRICE SMART COLOMBIA S.A.S.", invoiceCount: 1 }]);
    expect(report.rows[0].vatType).toBe("purchase");
    expect(buildReport(files, suppliers, { keptNames: new Set([nameKey("900", "PRICE SMART COLOMBIA S.A.S.")]) }).nameMismatches).toEqual([]);
  });

  it("continúa el lote con archivos no compatibles o con error", () => {
    const report = buildReport(
      [file("a.pdf", invoice("1", "A", [line(0, 1, 0)])), { fileName: "x.pdf", kind: "incompatible", message: "No se encontró la sección «Detalles de Productos»." }, { fileName: "y.pdf", kind: "error", message: "El PDF está dañado." }],
      [supplier(1, "1", "purchase")],
    );
    expect(report.stats).toMatchObject({ files: 3, processed: 1, failed: 2 });
    expect(report.incidents.filter((i) => i.type !== "Información").map((i) => [i.fileName, i.type])).toEqual([["x.pdf", "No compatible"], ["y.pdf", "Error"]]);
  });
});
