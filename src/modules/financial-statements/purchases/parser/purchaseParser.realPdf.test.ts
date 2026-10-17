/// <reference types="node" />
/**
 * Prueba con facturas reales (contienen datos de terceros: NO están en el repositorio). Se indican con una variable de entorno:
 *
 *   PURCHASE_PDF="/ruta/a.pdf:/ruta/b.pdf" npx vitest run purchaseParser.realPdf
 *
 * Sin la variable, la prueba se omite. Los valores concretos se verifican solo en las facturas de referencia
 * (MONO COLOMBIA FE-29827 y PRICESMART COFE-3333593).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../bank-analysis/shared/pdf/pdfText";
import { parsePurchaseDocument } from "./purchaseParser";

const files = (process.env.PURCHASE_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("compras con facturas reales", () => {
  for (const file of files) {
    it(`lee ${file.split("/").pop()}`, async () => {
      const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      const doc = parsePurchaseDocument(await readDocumentText(pdf));

      expect(doc.issuer.nit).toMatch(/^\d+$/);
      expect(doc.buyerNit).toMatch(/^\d+$/);
      expect(doc.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.cufe).toMatch(/^[0-9a-f]{96}$/);
      expect(doc.lines.length).toBeGreaterThan(0);
      for (const line of doc.lines) {
        expect(line.issue).toBeUndefined();
        expect(line.baseCents).toBeGreaterThan(0);
        expect(line.quantity).toBeGreaterThan(0);
      }
      const sum = doc.lines.reduce((s, l) => s + (l.baseCents ?? 0), 0);
      expect(sum).toBe(doc.subtotalCents);

      if (doc.number === "FE-29827") {
        expect(doc).toMatchObject({
          title: "FACTURA ELECTRÓNICA DE VENTA",
          issueDate: "2026-01-31",
          buyerNit: "901817531",
          subtotalCents: 195_000_000,
          vatCents: 37_050_000,
          retefuenteCents: 7_800_000,
          totalCents: 232_050_000,
        });
        expect(doc.issuer).toMatchObject({ nit: "901398069", name: "MONO COLOMBIA S.A.S.", personType: "PJ", fiscalCodes: ["R-99-PN"] });
        expect(doc.lines).toHaveLength(1);
        expect(doc.lines[0]).toMatchObject({ code: "M20", unit: "ZZ", quantity: 1, unitPriceCents: 195_000_000, baseCents: 195_000_000, vatCents: 37_050_000, rateBp: 1900 });
      }
      if (doc.number === "COFE-3333593") {
        expect(doc).toMatchObject({ issueDate: "2026-05-10", buyerNit: "901748281", subtotalCents: 59_988_400, vatCents: 4_408_300, retefuenteCents: 0, totalCents: 64_396_800 });
        expect(doc.issuer).toMatchObject({ nit: "900319753", fiscalCodes: ["O-13", "O-23"] });
        expect(doc.lines).toHaveLength(10);
        expect(doc.lines[2]).toMatchObject({ description: expect.stringContaining("Deterge"), quantity: 1, baseCents: 5_873_900, vatCents: 1_116_000, rateBp: 1900 });
      }
    });
  }
});
