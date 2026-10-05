/// <reference types="node" />
/**
 * Prueba con facturas reales. Los PDF contienen datos de terceros, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   INVOICE_VAT_PDF="/ruta/factura.pdf" npx vitest run invoiceParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * Las reglas generales se verifican en todos; los valores concretos solo en
 * la factura de referencia (NIT 900319753, COFE-3333593).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../bank-analysis/shared/pdf/pdfText";
import { buildReport, interpretLines } from "../services/analysis";
import type { TitleRule } from "../types";
import { parseInvoice } from "./invoiceParser";

const files = (process.env.INVOICE_VAT_PDF ?? "").split(":").filter(Boolean);

const TITLES: TitleRule[] = [{ normalizedTitle: "factura electronica de venta", category: "invoice" }];

describe.skipIf(files.length === 0)("factura electrónica real", () => {
  for (const file of files) {
    it(`procesa ${file.split("/").pop()}`, async () => {
      const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      const invoice = parseInvoice(await readDocumentText(doc));

      expect(invoice.supplierNit).toMatch(/^\d+$/);
      expect(invoice.products.length).toBeGreaterThan(0);
      // Sin ambigüedad no queda ninguna fila pendiente: las de IVA y % vacíos se interpretan como 0 %.
      const reading = interpretLines(invoice);
      expect(reading.pending).toEqual([]);
      expect(reading.products.filter((p) => p.origin === "auto-zero").every((p) => p.rateBp === 0 && p.vatCents === 0)).toBe(true);
      const bases = reading.lines.reduce((s, l) => s + l.baseCents, 0);
      const refs = [invoice.subtotalCents, invoice.grossTotalCents].filter((v) => v !== undefined);
      // Hasta un peso por línea es redondeo del documento.
      if (refs.length) expect(Math.min(...refs.map((r) => Math.abs(r - bases)))).toBeLessThanOrEqual(reading.lines.length * 100);

      if (invoice.invoiceNumber === "FEFL-3798332") {
        // Peaje F2X: una línea con IVA y % vacíos, subtotal $13.300 e IVA $0.
        expect(invoice.products).toMatchObject([{ baseCents: 1_330_000, emptyTax: true }]);
        expect(reading.products).toMatchObject([{ rateBp: 0, vatCents: 0, baseCents: 1_330_000, origin: "auto-zero" }]);
        const f2x = { id: 1, nit: invoice.supplierNit, businessName: invoice.supplierName, vatType: "service" as const, createdAt: "", updatedAt: "" };
        const report = buildReport([{ fileName: "f2x.pdf", kind: "parsed", invoice }], [f2x], TITLES);
        expect(report.rows[0]).toMatchObject({ status: "processed", category: "invoice", base0: 1_330_000, detailVatCents: 0, pendingLines: [] });
        expect(report.summary.invoices.zeroBaseCents).toBe(1_330_000);
      }

      if (invoice.supplierNit !== "900319753" || invoice.invoiceNumber !== "COFE-3333593") return;
      expect(invoice.documentType).toBe("FACTURA ELECTRÓNICA DE VENTA");
      expect(invoice.supplierName).toBe("PRICESMART COLOMBIA S.A.S.");
      expect(invoice.pageCount).toBe(2);
      expect(invoice.lines).toHaveLength(10);
      expect(invoice.lineIssues).toEqual([]);
      expect(invoice.products).toEqual(invoice.lines);
      expect(invoice.products[0]).toEqual({ page: 1, description: "755610 ComidaPerro", rateBp: 500, vatCents: 666_200, baseCents: 13_323_800 });
      const sum = (rate: number, key: "baseCents" | "vatCents") => invoice.lines.filter((l) => l.rateBp === rate).reduce((s, l) => s + l[key], 0);
      expect(invoice.lines.filter((l) => l.rateBp === 500).map((l) => [l.baseCents, l.vatCents])).toEqual([[13_323_800, 666_200], [10_466_700, 523_300]]);
      expect(sum(500, "baseCents")).toBe(23_790_500);
      expect(sum(500, "vatCents")).toBe(1_189_500);
      expect(invoice.lines.filter((l) => l.rateBp === 1900).map((l) => l.baseCents)).toEqual([5_873_900, 4_445_400, 3_689_100, 2_932_800]);
      expect(sum(1900, "baseCents")).toBe(16_941_200);
      expect(sum(1900, "vatCents")).toBe(3_218_700);
      expect(invoice.lines.filter((l) => l.rateBp === 0).map((l) => l.baseCents)).toEqual([5_926_200, 3_590_000, 5_208_600, 4_531_900]);
      expect(sum(0, "baseCents")).toBe(19_256_700);
      expect(bases).toBe(59_988_400);
      expect(invoice.subtotalCents).toBe(59_988_400);
      expect(invoice.grossTotalCents).toBe(59_988_400);
      expect(invoice.invoiceVatCents).toBe(4_408_300);

      // Con el proveedor registrado como Compras: 44.082 por líneas frente a 44.083 del documento.
      const supplier = { id: 1, nit: "900319753", businessName: "PRICESMART COLOMBIA S.A.S.", vatType: "purchase" as const, createdAt: "", updatedAt: "" };
      const report = buildReport([{ fileName: "f.pdf", kind: "parsed", invoice }], [supplier], TITLES);
      const row = report.rows[0];
      expect(row).toMatchObject({ status: "processed", category: "invoice", base5: 23_790_500, vat5: 1_189_500, base19: 16_941_200, vat19: 3_218_700, base0: 19_256_700, detailVatCents: 4_408_200, invoiceVatCents: 4_408_300 });
      expect(row.notes.join(" ")).toContain("$1");
      expect(report.summary.invoices).toMatchObject({
        documentCount: 1,
        purchases5: { baseCents: 23_790_500, vatCents: 1_189_500 },
        purchases19: { baseCents: 16_941_200, vatCents: 3_218_700 },
        services19: { baseCents: 0, vatCents: 0 },
        zeroBaseCents: 19_256_700,
      });
    });
  }
});
