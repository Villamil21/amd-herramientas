/// <reference types="node" />
/**
 * Prueba con facturas reales. Los PDF contienen datos de terceros, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   WITHHOLDING_PDF="/ruta/factura.pdf" npx vitest run withholdingParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * Las reglas generales se verifican en todos; los valores concretos solo en
 * la factura de referencia (NIT 901398069, FE-29827).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../bank-analysis/shared/pdf/pdfText";
import { buildWithholdingReport, suggestPersonType } from "../services/analysis";
import { parseWithholdingDocument } from "./withholdingParser";

const files = (process.env.WITHHOLDING_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("retención en la fuente con facturas reales", () => {
  for (const file of files) {
    it(`procesa ${file.split("/").pop()}`, async () => {
      const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      const doc = parseWithholdingDocument(await readDocumentText(pdf));

      expect(doc.supplierNit).toMatch(/^\d+$/);
      expect(doc.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.number).toBeTruthy();
      expect(doc.subtotalCents).toBeGreaterThan(0);
      expect(doc.products.rows.length).toBeGreaterThan(0);
      for (const hidden of ["IVA", "%", "INC"]) expect(doc.products.columns).not.toContain(hidden);
      expect(doc.products.rows.every((r) => r.cells.length === doc.products.columns.length)).toBe(true);

      if (doc.supplierNit !== "901398069" || doc.number !== "FE-29827") return;
      expect(doc).toMatchObject({
        title: "FACTURA ELECTRÓNICA DE VENTA",
        issueDate: "2026-01-31",
        supplierName: "MONO COLOMBIA S.A.S.",
        taxpayerType: "Persona Jurídica",
        fiscalCodes: ["R-99-PN"],
        subtotalCents: 195_000_000,
        retefuenteCents: 7_800_000,
        pageCount: 2,
      });
      expect(suggestPersonType(doc.taxpayerType)).toBe("PJ");
      expect(doc.products.columns).toEqual([
        "Nro.",
        "Código",
        "Descripción",
        "U/M",
        "Cantidad",
        "Precio unitario",
        "Descuento detalle",
        "Recargo detalle",
        "Precio unitario de venta",
      ]);
      expect(doc.products.rows.map((r) => r.cells)).toEqual([
        ["1", "M20", "Plan mínimo garantizado por uso de la plataforma tecnológica", "ZZ", "1,00", "1.950.000,00", "0,00", "0,00", "1.950.000,00"],
      ]);

      // Proveedor configurado: Servicios → Servicios generales (declarantes), PJ, base = subtotal.
      const report = buildWithholdingReport([{ fileName: "mono.pdf", kind: "parsed", doc }], {
        suppliers: [
          {
            id: 1, nit: "901398069", businessName: "MONO COLOMBIA S.A.S.", vatType: "service", createdAt: "", updatedAt: "",
            personType: "PJ", fiscalRegime: "R-99-PN", withholdingRules: [{ id: 1, rateId: 6, baseMode: "invoice_subtotal", isDefault: true }],
          },
        ],
        rates: [{ id: 6, retentionType: "services", name: "Servicios generales (declarantes)", baseUvtCenti: 200, rateBp: 400, sortOrder: 6, createdAt: "", updatedAt: "" }],
        uvts: [{ year: 2026, valuePesos: 52_374, updatedAt: "" }],
        titles: [{ id: 1, normalizedTitle: "factura electronica de venta", displayTitle: "FACTURA ELECTRÓNICA DE VENTA", category: "invoice", createdAt: "", updatedAt: "" }],
      });
      expect(report.period.label).toBe("Enero 2026");
      expect(report.rows[0]).toMatchObject({
        status: "validated",
        category: "invoice",
        personType: "PJ",
        minBaseCents: 10_474_800,
        baseCents: 195_000_000,
        rateBp: 400,
        impliedRateBp: 400,
        calculatedCents: 7_800_000,
        retentionCents: 7_800_000,
        counts: true,
      });
      expect(report.summary.find((l) => l.retentionType === "services")!.pj).toEqual({ baseCents: 195_000_000, retentionCents: 7_800_000 });
    });
  }
});
