import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PurchaseDocument, PurchaseLine, PurchasesState, SupplierFiscalEntry } from "../../../../types/purchases";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { ReteCell } from "../ui/ReteCell";
import { NOT_APPLICABLE_PUC } from "./classify";
import { buildPurchasesModel } from "./model";
import { formatPesosCompact, retentionCell } from "./retentionSummary";

const NIT = "901817531";
const SUPPLIER = "900111222";
const pesos = (n: number) => n * 100;
const line = (index: number, base: number): PurchaseLine => ({ index, page: 1, code: `P${index}`, description: `Producto ${index}`, unit: "UN", baseCents: pesos(base), vatCents: 0 });

function doc(id: number, bases: number[], titleKey = "factura electronica de venta", retefuente?: number): PurchaseDocument {
  const total = bases.reduce((s, b) => s + b, 0);
  return {
    id, uploadId: 1, fileName: `f${id}.pdf`, buyerNit: NIT, buyerName: "MONO SAS", year: 2026, issueDate: "2026-03-10", issuerNit: SUPPLIER, issuerName: "PROVEEDOR SAS",
    numberKey: `FE${id}`, totalCents: pesos(total), titleKey, cufe: null, fingerprint: `fp${id}`, status: "current", duplicateOf: null, importedAt: "2026-01-01",
    data: { pageCount: 1, title: "FACTURA", number: `FE${id}`, issueDate: "2026-03-10", issuer: { nit: SUPPLIER, name: "PROVEEDOR SAS", personType: "PJ", fiscalCodes: ["O-13"] }, buyerNit: NIT, buyerName: "MONO SAS", lines: bases.map((b, i) => line(i, b)), subtotalCents: pesos(total), vatCents: 0, retefuenteCents: retefuente === undefined ? undefined : pesos(retefuente), totalCents: pesos(total) },
  } as unknown as PurchaseDocument;
}
const rate = (id: number, name: string, rateBp: number, baseUvtCenti: number) => ({ id, retentionType: "services", name, baseUvtCenti, rateBp, sortOrder: id, createdAt: "", updatedAt: "" }) as never;
// UVT $50.000. 1: 3,5 % sin mínima · 2: 3,5 % mínima 4 UVT ($200.000) · 3: 2,5 % sin mínima · 4: 4 % sin mínima.
const RATES = [rate(1, "Servicios 3,5", 350, 0), rate(2, "Hoteles 3,5", 350, 400), rate(3, "Compras 2,5", 250, 0), rate(4, "Honorarios 4", 400, 0)];
const cls = (documentId: number, lineIndex: number, retention: number[], puc = "510506") =>
  ({ documentId, lineIndex, pucCode: puc, concept1001: puc === NOT_APPLICABLE_PUC ? "" : "5001", retention: retention.map((rateId) => ({ rateId })), ruleId: null, scope: "invoice", confirmedAt: "" }) as never;
const fiscal = (regime: string): SupplierFiscalEntry => ({ supplierNit: SUPPLIER, effectiveDate: "2026-01-01", regime, source: "manual", note: "", createdAt: "" });

function build(docs: PurchaseDocument[], lineClasses: unknown[], supplierFiscal: SupplierFiscalEntry[] = []) {
  return buildPurchasesModel({
    buyerNit: NIT, year: 2026,
    state: { uploads: [], documents: docs, lineClasses, flags: [], audit: [] } as unknown as PurchasesState,
    company: { id: 1, nit: NIT, razonSocial: "MONO SAS" } as never,
    companyVat: [{ effectiveDate: "2026-01-01", responsible: true } as never],
    titleTypes: [{ titleKey: "factura electronica de venta", kind: "purchase" } as never, { titleKey: "nota credito electronica", kind: "return" } as never],
    rules: [], suppliers: [], supplierFiscal,
    pucIndex: buildPucIndex([{ code: "510506", concept: "Sueldos" }, { code: "1", concept: "Activo" }, { code: "5", concept: "Gastos" }] as never),
    pucConcepts: new Map(),
    concepts1001: [{ year: 2026, code: "5001", description: "Salarios", isActive: true, validFrom: "2026-01-01", validTo: null } as never],
    rates: RATES, uvts: [{ year: 2026, valuePesos: 50_000, updatedAt: "" }], rateVersions: [], catalogs: null,
  });
}
const cell = (m: ReturnType<typeof build>, i = 0) => retentionCell(m.docs[i]);
const text = (m: ReturnType<typeof build>, i = 0) => {
  const c = cell(m, i);
  return c.kind === "empty" ? "—" : c.text;
};

describe("columna Rete de la tabla de facturas", () => {
  it("retención única calculada: porcentaje y valor", () => {
    // $ 89.039,14 × 3,5 % = $ 3.116,37
    const m = build([doc(1, [89_039.14])], [cls(1, 0, [1])]);
    expect(text(m)).toBe("3,5 % · $ 3.116");
    expect(cell(m)).toMatchObject({ kind: "calculated", belowMinimum: false });
  });

  it("concepto configurado que no supera la cuantía mínima: porcentaje y $ 0, con la explicación, sin bloqueo ni pendiente", () => {
    const m = build([doc(1, [100_000])], [cls(1, 0, [2])]);
    const c = cell(m);
    expect(c).toMatchObject({ kind: "calculated", text: "3,5 % · $ 0", belowMinimum: true, hint: "No supera la cuantía mínima" });
    const html = renderToStaticMarkup(createElement(ReteCell, { cell: c }));
    expect(html).toContain("3,5 % · $ 0");
    expect(html).toContain('title="No supera la cuantía mínima"');
    expect(m.docs[0].alerts.filter((a) => a.severity === "block" || a.severity === "pending" || /retenci|cuant/i.test(a.title))).toEqual([]);
  });

  it("varias retenciones: porcentajes únicos y suma de valores", () => {
    // Línea 0 al 2,5 % y línea 1 al 4 %: 2,5 % de 200.000 = 5.000 y 4 % de 200.000 = 8.000 → 13.000.
    const m = build([doc(1, [200_000, 200_000])], [cls(1, 0, [3]), cls(1, 1, [4])]);
    expect(text(m)).toBe("2,5 % + 4 % · $ 13.000");
    // Dos conceptos distintos con el mismo porcentaje se muestran una sola vez.
    const same = build([doc(1, [200_000, 200_000])], [cls(1, 0, [1]), cls(1, 1, [2])]);
    expect(text(same)).toMatch(/^3,5 % · /);
  });

  it("la misma retención en todas las líneas se cuenta una vez sobre el subtotal", () => {
    const m = build([doc(1, [80_000, 80_000, 80_000])], [0, 1, 2].map((i) => cls(1, i, [2])));
    // Ninguna línea supera $200.000, pero el subtotal ($240.000) sí: 3,5 % × 240.000 = 8.400, una sola vez.
    expect(text(m)).toBe("3,5 % · $ 8.400");
  });

  it("O-15 y O-47: No aplica, sin porcentajes ni valores", () => {
    for (const regime of ["O-15", "O-47"]) {
      const m = build([doc(1, [200_000])], [cls(1, 0, [1])], [fiscal(regime)]);
      expect(cell(m)).toEqual({ kind: "exempt", text: "No aplica" });
    }
  });

  it("sin concepto de retención confirmado: Sin retención (una propuesta pendiente no cuenta)", () => {
    expect(cell(build([doc(1, [200_000])], [cls(1, 0, [])]))).toEqual({ kind: "none", text: "Sin retención" });
    expect(cell(build([doc(1, [200_000])], []))).toEqual({ kind: "none", text: "Sin retención" });
  });

  it("las líneas 7305 NO APLICA quedan fuera del porcentaje, del valor y de la base", () => {
    // La 7305 (100.000) no suma: la retención del 4 % es solo sobre la otra línea (200.000 = 8.000).
    const m = build([doc(1, [200_000, 100_000])], [cls(1, 0, [4]), cls(1, 1, [3], NOT_APPLICABLE_PUC)]);
    expect(text(m)).toBe("4 % · $ 8.000");
    // Solo 7305: sin retención.
    expect(cell(build([doc(1, [100_000])], [cls(1, 0, [3], NOT_APPLICABLE_PUC)])).kind).toBe("none");
  });

  it("devoluciones: el valor resta, igual que la base, sin duplicar", () => {
    const m = build([doc(1, [200_000], "nota credito electronica")], [cls(1, 0, [4])]);
    expect(m.docs[0].baseCents).toBe(-pesos(200_000));
    expect(text(m)).toBe("4 % · -$ 8.000");
  });

  it("al confirmar, editar o quitar la clasificación la celda cambia", () => {
    const docs = [doc(1, [200_000])];
    expect(text(build(docs, []))).toBe("Sin retención");
    expect(text(build(docs, [cls(1, 0, [4])]))).toBe("4 % · $ 8.000");
    expect(text(build(docs, [cls(1, 0, [3])]))).toBe("2,5 % · $ 5.000");
    expect(text(build(docs, [cls(1, 0, [3, 4])]))).toBe("2,5 % + 4 % · $ 13.000");
    expect(text(build(docs, [cls(1, 0, [])]))).toBe("Sin retención");
  });

  it("documentos que no cuentan (duplicados o excluidos) no muestran retención", () => {
    const evidence = { ...doc(1, [200_000]), status: "evidence" } as PurchaseDocument;
    expect(cell(build([evidence], [cls(1, 0, [4])])).kind).toBe("empty");
  });

  it("sin decimales: el valor se redondea a pesos enteros", () => {
    // 3,5 % de $ 89.039,14 = 3.116,3699 → 3.116; con centavos altos sube: 3,5 % de $ 89.100 = 3.118,50 → 3.119.
    expect(formatPesosCompact(311_637)).toBe("$ 3.116");
    expect(formatPesosCompact(311_850)).toBe("$ 3.119");
    expect(formatPesosCompact(0)).toBe("$ 0");
    expect(formatPesosCompact(-800_000)).toBe("-$ 8.000");
    expect(formatPesosCompact(-20)).toBe("$ 0");
    expect(text(build([doc(1, [89_100])], [cls(1, 0, [1])]))).toBe("3,5 % · $ 3.119");
    expect(text(build([doc(1, [89_039.14])], [cls(1, 0, [1])]))).toBe("3,5 % · $ 3.116");
  });
});

describe("diferencia entre lo calculado y la retención informada", () => {
  const statusOf = (m: ReturnType<typeof build>) => {
    const d = m.docs[0];
    return { review: d.alerts.some((a) => a.severity === "review" && a.code === "retention-mismatch"), cell: retentionCell(d) };
  };

  it("si la informada difiere del cálculo hay alerta por revisar y la celda lo marca", () => {
    // Cálculo: 4 % de $ 200.000 = $ 8.000; la factura informa $ 5.000.
    const m = build([doc(1, [200_000], "factura electronica de venta", 5_000)], [cls(1, 0, [4])]);
    const { review, cell: c } = statusOf(m);
    expect(review).toBe(true);
    expect(c).toMatchObject({ kind: "calculated", text: "4 % · $ 8.000", informed: { text: "Informada $ 5.000: revisar" } });
    expect(renderToStaticMarkup(createElement(ReteCell, { cell: c }))).toContain("Informada $ 5.000: revisar");
  });

  it("si coincide no hay alerta ni marca", () => {
    const m = build([doc(1, [200_000], "factura electronica de venta", 8_000)], [cls(1, 0, [4])]);
    expect(statusOf(m).review).toBe(false);
    expect((retentionCell(m.docs[0]) as { informed?: unknown }).informed).toBeUndefined();
  });

  it("si la factura informa retención y ninguna línea confirmada tiene concepto, también se revisa", () => {
    const m = build([doc(1, [200_000], "factura electronica de venta", 5_000)], [cls(1, 0, [])]);
    const { review, cell: c } = statusOf(m);
    expect(review).toBe(true);
    expect(c).toMatchObject({ kind: "calculated", informed: { cents: pesos(5_000) } });
  });

  it("proveedor O-15/O-47 con retención informada sigue como No aplica (su decisión va por la alerta propia)", () => {
    const m = build([doc(1, [200_000], "factura electronica de venta", 5_000)], [cls(1, 0, [])], [fiscal("O-15")]);
    expect(cell(m)).toEqual({ kind: "exempt", text: "No aplica" });
    expect(m.docs[0].alerts.some((a) => a.code === "retention-mismatch")).toBe(false);
  });

  it("la factura con diferencia no queda «Lista» en la tabla: la alerta es de revisión", () => {
    const m = build([doc(1, [200_000], "factura electronica de venta", 5_000)], [cls(1, 0, [4])]);
    const sev = m.docs[0].alerts.map((a) => a.severity);
    expect(sev).toContain("review");
    expect(sev).not.toContain("block");
  });
});
