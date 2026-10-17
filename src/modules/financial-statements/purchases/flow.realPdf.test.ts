/// <reference types="node" />
/**
 * Flujo completo con facturas reales (sin Tauri): lectura → plan de carga (NIT comprador y año deducidos) → modelo con
 * clasificación → destinos. Se activa con PURCHASE_PDF="/ruta/a.pdf:/ruta/b.pdf" (MONO FE-29827 y PRICESMART COFE-3333593).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../bank-analysis/shared/pdf/pdfText";
import { buildPucIndex } from "../puc-codes/services/pucCatalog";
import { buildPurchasesModel } from "./domain/model";
import { planFolder, type ReadResult } from "./import";
import { parsePurchaseDocument } from "./parser/purchaseParser";

const files = (process.env.PURCHASE_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("flujo de compras con facturas reales", () => {
  it("deduce empresa y año, y bloquea por nombre/ clasificación hasta confirmar", async () => {
    const results: ReadResult[] = [];
    for (const file of files) {
      const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      results.push({ fileName: file.split("/").pop()!, kind: "parsed", data: parsePurchaseDocument(await readDocumentText(pdf)) });
    }
    const plan = planFolder(results);
    // Los dos PDF son de empresas distintas: una carga = un NIT, el otro es excepción.
    expect(plan.main).toHaveLength(1);
    expect(plan.others).toHaveLength(1);
    expect(plan.unreadable).toHaveLength(0);

    for (const f of [plan.main[0], plan.others[0].files[0]]) {
      expect(f.year).toBe(Number(f.issueDate!.slice(0, 4)));
      const doc = { id: 1, uploadId: 1, fileName: f.fileName, buyerNit: f.buyerNit, buyerName: f.buyerName, year: f.year, issueDate: f.issueDate, issuerNit: f.issuerNit, issuerName: f.issuerName, numberKey: f.numberKey, totalCents: f.totalCents, titleKey: f.titleKey, cufe: f.cufe, fingerprint: f.fingerprint, status: "current" as const, duplicateOf: null, data: f.data, importedAt: "" };
      const model = buildPurchasesModel({
        buyerNit: f.buyerNit,
        year: f.year,
        state: { uploads: [], documents: [doc], lineClasses: [], flags: [], audit: [] },
        companyVat: [{ companyId: 1, effectiveDate: `${f.year}-01-01`, responsible: true, source: "manual", note: "", createdAt: "" }],
        titleTypes: [{ titleKey: "factura electronica de venta", displayTitle: "FACTURA ELECTRÓNICA DE VENTA", kind: "purchase", isSystem: true }],
        rules: [],
        suppliers: [],
        supplierFiscal: [],
        pucIndex: buildPucIndex([]),
        pucConcepts: new Map(),
        concepts1001: [],
        rates: [],
        uvts: [],
        catalogs: null,
      });
      // Sin empresa registrada: bloquea los cuatro destinos; las líneas no confirmadas no llegan a EEFF.
      expect(model.alerts.some((a) => a.code === "unknown-company")).toBe(true);
      expect(model.status.EEFF).toBe("block");
      expect(model.eeff.movements).toHaveLength(0);
      expect(model.totals.pendingLines).toBe(f.data.lines.length);
      // Las líneas suman el subtotal del documento.
      expect(model.docs[0].baseCents).toBe(f.data.subtotalCents);
    }
  });
});
