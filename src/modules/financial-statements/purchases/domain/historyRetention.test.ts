import { describe, expect, it } from "vitest";
import type { PurchaseDocument, PurchaseLine, PurchaseRule, PurchasesState, RateVersion, SupplierFiscalEntry } from "../../../../types/purchases";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { productKey, proposalSourceText } from "./classify";
import { proposalInputs } from "./lineDraft";
import { buildPurchasesModel } from "./model";

const NIT = "901817531";
const SUPPLIER = "900111222";
const PESO = 100;
const line = (code: string, baseCents: number): PurchaseLine => ({ index: 0, page: 1, code, description: `Producto ${code}`, unit: "UN", baseCents, vatCents: 0 });

function doc(id: number, issueDate: string, code = "A", baseCents = 1_000_000 * PESO): PurchaseDocument {
  return {
    id, uploadId: 1, fileName: `f${id}.pdf`, buyerNit: NIT, buyerName: "MONO SAS", year: 2026, issueDate, issuerNit: SUPPLIER, issuerName: "PROVEEDOR SAS",
    numberKey: `FE${id}`, totalCents: baseCents, titleKey: "factura electronica de venta", cufe: null, fingerprint: `fp${id}`, status: "current", duplicateOf: null, importedAt: "2026-01-01",
    data: { pageCount: 1, title: "FACTURA ELECTRÓNICA DE VENTA", number: `FE${id}`, issueDate, issuer: { nit: SUPPLIER, name: "PROVEEDOR SAS", personType: "PJ", fiscalCodes: ["O-13"] }, buyerNit: NIT, buyerName: "MONO SAS", lines: [line(code, baseCents)], subtotalCents: baseCents, vatCents: 0, totalCents: baseCents },
  } as unknown as PurchaseDocument;
}

const rate = (id: number, name: string, rateBp: number) => ({ id, retentionType: "services", name, baseUvtCenti: 0, rateBp, sortOrder: id, createdAt: "", updatedAt: "" }) as never;
const fiscal = (effectiveDate: string, regime: string): SupplierFiscalEntry => ({ supplierNit: SUPPLIER, effectiveDate, regime, source: "manual", note: "", createdAt: "" });
const confirmed = (documentId: number, retention: number[], confirmedAt = "2026-02-16", puc = "519535", concept = "5016") =>
  ({ documentId, lineIndex: 0, pucCode: puc, concept1001: concept, retention: retention.map((rateId) => ({ rateId })), ruleId: null, scope: "invoice", confirmedAt }) as never;
// PUC y concepto del proveedor «por historial» (regla de otro producto, sin retención), como en la factura F3GT-292126.
const generalRule = { id: 1, supplierNit: SUPPLIER, productKey: "c:otro", productLabel: "Otro", pucCode: "519535", concept1001: "5016", retention: [], uses: 3 } as unknown as PurchaseRule;

function model(docs: PurchaseDocument[], lineClasses: unknown[], opts: { history?: SupplierFiscalEntry[]; versions?: RateVersion[]; rules?: PurchaseRule[] } = {}) {
  return buildPurchasesModel({
    buyerNit: NIT, year: 2026,
    state: { uploads: [], documents: docs, lineClasses, flags: [], audit: [] } as unknown as PurchasesState,
    company: { id: 1, nit: NIT, razonSocial: "MONO SAS" } as never,
    companyVat: [{ effectiveDate: "2026-01-01", responsible: true } as never],
    titleTypes: [{ titleKey: "factura electronica de venta", kind: "purchase" } as never],
    rules: opts.rules ?? [generalRule], suppliers: [], supplierFiscal: opts.history ?? [],
    pucIndex: buildPucIndex([{ code: "519535", concept: "Gastos" }, { code: "1", concept: "Activo" }, { code: "5", concept: "Gastos" }] as never),
    pucConcepts: new Map(),
    concepts1001: [{ year: 2026, code: "5016", description: "Servicios", isActive: true, validFrom: "2026-01-01", validTo: null } as never],
    rates: [rate(1, "Servicios generales", 400), rate(2, "Honorarios", 1100)], uvts: [{ year: 2026, valuePesos: 50_000, updatedAt: "" }], rateVersions: opts.versions ?? [], catalogs: null,
  });
}
const proposalOf = (m: ReturnType<typeof model>, docId: number) => m.docs.find((d) => d.doc.id === docId)!.lines[0].proposal;

describe("retención sugerida por facturas anteriores confirmadas", () => {
  it("el mismo proveedor: PUC y concepto por historial y también la retención confirmada, con su origen", () => {
    const m = model([doc(1, "2026-02-15"), doc(2, "2026-03-10")], [confirmed(1, [1])]);
    const p = proposalOf(m, 2);
    expect(p).toMatchObject({ pucCode: "519535", concept1001: "5016", retention: [{ rateId: 1 }], retentionFrom: "2026-02-15" });
    expect(p.sources.retention).toBe("history");
    expect(proposalSourceText("history", p.retentionFrom)).toBe("Sugerida por factura confirmada del proveedor del 15/02/2026");
  });

  it("prioriza la más reciente del mismo producto; sin producto, la más reciente de la clasificación equivalente", () => {
    const docs = [doc(1, "2026-02-01", "A"), doc(2, "2026-02-20", "B"), doc(3, "2026-03-10", "A"), doc(4, "2026-03-11", "C")];
    const m = model(docs, [confirmed(1, [2]), confirmed(2, [1])]);
    expect(proposalOf(m, 3).retention).toEqual([{ rateId: 2 }]);
    expect(proposalOf(m, 3).retentionFrom).toBe("2026-02-01");
    expect(proposalOf(m, 4).retention).toEqual([{ rateId: 1 }]);
    expect(proposalOf(m, 4).retentionFrom).toBe("2026-02-20");
  });

  it("una regla confirmada del producto con retención manda sobre el historial", () => {
    const withRule = { ...generalRule, id: 2, productKey: productKey(line("A", 1)), retention: [{ rateId: 2 }] } as unknown as PurchaseRule;
    const m = model([doc(1, "2026-02-15"), doc(2, "2026-03-10")], [confirmed(1, [1])], { rules: [generalRule, withRule] });
    expect(proposalOf(m, 2).retention).toEqual([{ rateId: 2 }]);
    expect(proposalOf(m, 2).sources.retention).toBe("rule");
  });

  it("no reutiliza propuestas pendientes ni facturas posteriores ni de otro PUC", () => {
    // La anterior solo tiene propuesta (sin clasificación confirmada): no hay nada que sugerir.
    expect(proposalOf(model([doc(1, "2026-02-15"), doc(2, "2026-03-10")], []), 2).retention).toEqual([]);
    // Una factura posterior no cuenta como historial.
    expect(proposalOf(model([doc(1, "2026-04-15"), doc(2, "2026-03-10")], [confirmed(1, [1])]), 2).retention).toEqual([]);
    // Otra clasificación (otro PUC) no es equivalente.
    expect(proposalOf(model([doc(1, "2026-02-15", "B"), doc(2, "2026-03-10", "A")], [confirmed(1, [1], "2026-02-16", "513505", "5016")]), 2).retention).toEqual([]);
  });

  it("si el régimen vigente en la fecha nueva es O-15 u O-47 no sugiere ni muestra retenciones", () => {
    for (const regime of ["O-15", "O-47"]) {
      const m = model([doc(1, "2026-02-15"), doc(2, "2026-03-10")], [confirmed(1, [1])], { history: [fiscal("2026-01-01", "O-13"), fiscal("2026-03-01", regime)] });
      expect(m.docs.find((d) => d.doc.id === 2)!.exemption?.code).toBe(regime);
      expect(proposalOf(m, 2).retention).toEqual([]);
      // La factura anterior, de cuando aún retenía, conserva todo.
      expect(proposalOf(m, 1).retention).toEqual([]);
      expect(m.docs.find((d) => d.doc.id === 1)!.lines[0].retention).toEqual([{ rateId: 1 }]);
    }
  });

  it("al volver a un régimen con retención no se arrastra lo de las facturas de la etapa exenta", () => {
    const history = [fiscal("2026-01-01", "O-15"), fiscal("2026-03-01", "O-13")];
    const m = model([doc(1, "2026-02-15"), doc(2, "2026-03-10")], [confirmed(1, [1])], { history });
    expect(m.docs.find((d) => d.doc.id === 2)!.exemption).toBeUndefined();
    expect(proposalOf(m, 2).retention).toEqual([]);
  });

  it("solo copia el concepto: tarifa y cuantía salen de la vigencia de la fecha de la factura nueva", () => {
    const versions = [{ rateId: 1, effectiveFrom: "2026-03-01", baseUvtCenti: 0, rateBp: 600, note: "", createdAt: "" }] as RateVersion[];
    const docs = [doc(1, "2026-02-15"), doc(2, "2026-03-10")];
    const first = model(docs, [confirmed(1, [1])], { versions });
    expect(first.docs[0].retention.assumedCents).toBe(40_000 * PESO); // 4 % vigente en febrero
    const p = proposalOf(first, 2);
    // El usuario confirma la propuesta tal cual: la retención se calcula con el 6 % vigente en marzo.
    const second = model(docs, [confirmed(1, [1]), confirmed(2, p.retention.map((r) => r.rateId))], { versions });
    expect(second.docs[1].retention.assumedCents).toBe(60_000 * PESO);
    expect(second.docs[0].retention.assumedCents).toBe(40_000 * PESO);
  });

  it("la propuesta completa de la factura incluye PUC, concepto 1001 y la retención sugerida, y se puede cambiar", () => {
    const m = model([doc(1, "2026-02-15"), doc(2, "2026-03-10")], [confirmed(1, [1])]);
    const target = m.docs.find((d) => d.doc.id === 2)!;
    const [input] = proposalInputs(2, SUPPLIER, target.lines);
    expect(input).toMatchObject({ pucCode: "519535", concept1001: "5016", retention: [{ rateId: 1 }], saveRule: false });
    // Antes de confirmar el usuario puede cambiarla o quitarla (la clasificación confirmada manda sobre la sugerencia).
    const changed = model([doc(1, "2026-02-15"), doc(2, "2026-03-10")], [confirmed(1, [1]), confirmed(2, [2])]);
    expect(changed.docs[1].lines[0].retention).toEqual([{ rateId: 2 }]);
    const removed = model([doc(1, "2026-02-15"), doc(2, "2026-03-10")], [confirmed(1, [1]), confirmed(2, [])]);
    expect(removed.docs[1].lines[0].retention).toEqual([]);
    expect(removed.docs[1].retention.assumedCents).toBe(0);
  });
});
