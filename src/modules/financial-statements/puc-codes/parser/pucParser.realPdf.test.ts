/// <reference types="node" />
/**
 * Prueba con facturas reales. Los PDF contienen datos de terceros, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   PUC_INVOICE_PDF="/ruta/factura.pdf" npx vitest run pucParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * Las reglas generales se verifican en todos; los valores concretos solo en
 * la factura de referencia (PRICESMART, COFE-3333593).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../bank-analysis/shared/pdf/pdfText";
import { buildReport, withDocumentCode, withLineCodes } from "../services/analysis";
import { loadSeededCatalog } from "../services/catalogFixture";
import { buildPendingActions, exportBlock } from "../services/pending";
import { buildPucIndex } from "../services/pucCatalog";
import type { TitleRule } from "../types";
import { parsePucDocument } from "./pucParser";

const files = (process.env.PUC_INVOICE_PDF ?? "").split(":").filter(Boolean);
const index = buildPucIndex(loadSeededCatalog());
const TITLES: TitleRule[] = [{ normalizedTitle: "factura electronica de venta", category: "invoice" }];

describe.skipIf(files.length === 0)("factura electrónica real", () => {
  for (const path of files) {
    it(`procesa ${path.split("/").pop()}`, async () => {
      const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useWasm: false, verbosity: 0 }).promise;
      const doc = parsePucDocument(await readDocumentText(pdf));

      expect(doc.issuerNit).toMatch(/^\d+$/);
      expect(doc.products.length).toBeGreaterThan(0);
      expect(doc.products.map((p) => p.row)).toEqual(doc.products.map((_, i) => i + 1));
      if (doc.cufe) expect(doc.cufe).toMatch(/^[0-9a-f]{64,128}$/);
      if (doc.issueDate) expect(doc.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const p of doc.products) {
        // Una fila es válida con descripción y precio; si falta algo queda marcada, nunca con un valor inventado.
        if (p.issue) expect(p.priceCents === undefined || p.description === "").toBe(true);
        else expect(p.priceCents).toBeGreaterThanOrEqual(0);
      }

      if (doc.number !== "COFE-3333593") return;
      expect(doc.title).toBe("FACTURA ELECTRÓNICA DE VENTA");
      expect(doc.issuerNit).toBe("900319753");
      expect(doc.issuerName).toBe("PRICESMART COLOMBIA S.A.S.");
      expect(doc.issueDate).toBe("2026-05-10");
      expect(doc.cufe).toBe("724b04ffb4ab54a48e4d0870648680c0693b30cf844209ea1a8236faf3ecd54e35c2eb5dadd862f304f71be2c3c4e08c");
      expect(doc.pageCount).toBe(2);
      // Las 10 filas de la tabla, que continúa en la página 2: Descripción + Precio unitario de venta.
      expect(doc.products.map((p) => [p.description.replace(/^\d+\s+/, ""), p.priceCents])).toEqual([
        ["ComidaPerro", 13_323_800],
        ["MS Perro Ad", 10_466_700],
        ["Deterge Fab", 5_873_900],
        ["Desodorante", 4_445_400],
        ["Filete", 5_926_200],
        ["Nueces", 3_689_100],
        ["Arandanos", 3_590_000],
        ["Palmolive G", 2_932_800],
        ["85-15 Molid", 5_208_600],
        ["Pechuga", 4_531_900],
      ]);
      expect(doc.products.some((p) => p.issue)).toBe(false);
      expect(doc.grossTotalCents).toBe(59_988_400);

      const results = [{ fileName: "pricesmart.pdf", kind: "parsed" as const, doc }];
      // Recién importada: Factura electrónica, Pendiente, exportación bloqueada.
      const fresh = buildReport(results, index, TITLES);
      expect(fresh.rows[0]).toMatchObject({ category: "invoice", classification: "pending" });
      expect(exportBlock(fresh, buildPendingActions(fresh))).toBe("Falta 1 pendiente por resolver.");

      // Un solo código: Valor asignado = Total Bruto Factura = $599.884,00.
      const single = buildReport(results, index, TITLES, { "pricesmart.pdf": withDocumentCode({}, "513595") });
      expect(single.rows[0]).toMatchObject({ classification: "classified", problems: [], assignedCents: 59_988_400 });
      expect(single.rows[0].lines.every((l) => l.code === "513595")).toBe(true);
      expect(single.summary).toEqual([{ code: "513595", concept: "OTROS", invoicesCents: 59_988_400, notesCents: 0, netCents: 59_988_400 }]);
      expect(exportBlock(single, buildPendingActions(single))).toBeNull();

      // Por producto: cada línea aporta su Precio unitario de venta.
      const byProduct = buildReport(results, index, TITLES, { "pricesmart.pdf": withLineCodes(withLineCodes({}, [0, 1], "513595"), [2, 3, 4, 5, 6, 7, 8, 9], "519530") });
      expect(byProduct.rows[0].classification).toBe("classified");
      expect(byProduct.summary.map((s) => [s.code, s.netCents])).toEqual([
        ["513595", 23_790_500],
        ["519530", 36_197_900],
      ]);
    });
  }
});
