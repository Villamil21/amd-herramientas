import { describe, expect, it } from "vitest";
import type { PurchaseDocument, PurchaseLine, PurchaseRule, PurchasesState, YearConcept } from "../../../../types/purchases";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { isNotApplicablePuc, normalizeClassification, NOT_APPLICABLE_PUC, proposeLine, pucProblem } from "./classify";
import { buildPurchasesModel, type PurchasesInput } from "./model";
import { DESTS } from "./status";

const NIT = "901817531";
const line = (index: number, baseCents: number, vatCents: number, description = `Producto ${index}`): PurchaseLine => ({ index, page: 1, code: `P${index}`, description, unit: "UN", baseCents, vatCents });

function doc(id: number, lines: PurchaseLine[], retefuenteCents?: number): PurchaseDocument {
  const base = lines.reduce((s, l) => s + (l.baseCents ?? 0), 0);
  const vat = lines.reduce((s, l) => s + (l.vatCents ?? 0), 0);
  return {
    id,
    uploadId: 1,
    fileName: `f${id}.pdf`,
    buyerNit: NIT,
    buyerName: "MONO SAS",
    year: 2025,
    issueDate: "2025-03-10",
    issuerNit: "900111222",
    issuerName: "PROVEEDOR SAS",
    numberKey: `FE${id}`,
    totalCents: base + vat,
    titleKey: "factura electronica de venta",
    cufe: null,
    fingerprint: `fp${id}`,
    status: "current",
    duplicateOf: null,
    importedAt: "2025-04-01",
    data: {
      pageCount: 1,
      title: "FACTURA ELECTRÓNICA DE VENTA",
      number: `FE${id}`,
      issueDate: "2025-03-10",
      issuer: { nit: "900111222", name: "PROVEEDOR SAS", personType: "PJ", fiscalCodes: ["O-13"] },
      buyerNit: NIT,
      buyerName: "MONO SAS",
      lines,
      subtotalCents: base,
      vatCents: vat,
      retefuenteCents,
      totalCents: base + vat,
    },
  } as PurchaseDocument;
}

const concept: YearConcept = { year: 2025, code: "5001", description: "Salarios", isActive: true, validFrom: "2025-01-01", validTo: null } as never;
const RATE = { id: 1, retentionType: "services", name: "Servicios", baseUvtCenti: 0, rateBp: 400, sortOrder: 1, createdAt: "", updatedAt: "" } as never;

function input(docs: PurchaseDocument[], state: Partial<PurchasesState> = {}, over: Partial<PurchasesInput> = {}): PurchasesInput {
  return {
    buyerNit: NIT,
    year: 2025,
    state: { uploads: [], documents: docs, lineClasses: [], flags: [], audit: [], ...state },
    company: { id: 1, nit: NIT, razonSocial: "MONO SAS" } as never,
    companyVat: [{ effectiveDate: "2025-01-01", responsible: true } as never],
    titleTypes: [{ titleKey: "factura electronica de venta", kind: "purchase" } as never],
    rules: [],
    suppliers: [],
    supplierFiscal: [],
    // 7305 NO está en el catálogo a propósito: la regla no depende de que exista como cuenta.
    pucIndex: buildPucIndex([{ code: "510506", concept: "Sueldos" }, { code: "1", concept: "Activo" }, { code: "5", concept: "Gastos" }] as never),
    pucConcepts: new Map([["7305", "5001"]]),
    concepts1001: [concept],
    rates: [RATE],
    uvts: [{ year: 2025, valuePesos: 50_000, updatedAt: "" }],
    catalogs: null,
    ...over,
  };
}

const cls = (docId: number, idx: number, pucCode: string, concept1001: string, retention: { rateId: number }[] = [], scope: "rule" | "invoice" = "invoice") =>
  ({ documentId: docId, lineIndex: idx, pucCode, concept1001, retention, ruleId: null, scope, confirmedAt: "" }) as never;

const noPending = (m: ReturnType<typeof buildPurchasesModel>) => {
  for (const d of DESTS) expect(m.counts[d]).toEqual({ block: 0, pending: 0, review: 0 });
};

describe("PUC 7305 — NO APLICA", () => {
  it("se confirma sin concepto 1001 ni retenciones y cuenta como resuelta para todos los destinos", () => {
    const m = buildPurchasesModel(input([doc(1, [line(0, 100_000_00, 19_000_00)])], { lineClasses: [cls(1, 0, NOT_APPLICABLE_PUC, "")] }));
    expect(m.alerts.filter((a) => ["line-unconfirmed", "puc-invalid", "concept-invalid"].includes(a.code))).toEqual([]);
    for (const d of DESTS) expect(m.status[d]).toBe("ready");
    noPending(m);
    expect(m.totals.pendingLines).toBe(0);
    expect(m.docs[0].lines[0].notApplicable).toBe(true);
  });

  it("no genera movimientos de EEFF ni registros 1001, 1005 o 1006", () => {
    const m = buildPurchasesModel(input([doc(1, [line(0, 100_000_00, 19_000_00)])], { lineClasses: [cls(1, 0, NOT_APPLICABLE_PUC, "")] }));
    expect(m.eeff.movements).toEqual([]);
    expect(m.eeff.totalCents).toBe(0);
    expect(m.proposals["1001"]).toEqual([]);
    expect(m.proposals["1005"]).toEqual([]);
    expect(m.proposals["1006"]).toEqual([]);
    expect(m.totals.purchaseCents).toBe(0);
    expect(m.totals.purchaseVatCents).toBe(0);
  });

  it("tampoco con una empresa no responsable de IVA (el IVA no pasa al costo)", () => {
    const m = buildPurchasesModel(input([doc(1, [line(0, 100_000_00, 19_000_00)])], { lineClasses: [cls(1, 0, NOT_APPLICABLE_PUC, "")] }, { companyVat: [{ effectiveDate: "2025-01-01", responsible: false } as never] }));
    expect(m.eeff.movements).toEqual([]);
    expect(m.proposals["1001"]).toEqual([]);
  });

  it("no genera ni calcula retenciones, aunque la factura informe una o queden datos viejos", () => {
    const stale = cls(1, 0, NOT_APPLICABLE_PUC, "5001", [{ rateId: 1 }]);
    const m = buildPurchasesModel(input([doc(1, [line(0, 100_000_00, 19_000_00)], 4_000_00)], { lineClasses: [stale] }));
    const l = m.docs[0].lines[0];
    expect([l.concept1001, l.retention, l.practicedCents, l.assumedCents]).toEqual(["", [], 0, 0]);
    expect(m.docs[0].retention.practicedCents).toBe(0);
    expect(m.docs[0].retention.expectedCents).toBe(0);
    expect(m.alerts.some((a) => a.code.startsWith("retention"))).toBe(false);
    expect(m.proposals["1001"]).toEqual([]);
  });

  it("en una factura mixta solo la línea normal alimenta los destinos; la excluida queda como informativa en la cobertura", () => {
    const d = doc(1, [line(0, 100_000_00, 19_000_00), line(1, 50_000_00, 9_500_00)]);
    const m = buildPurchasesModel(input([d], { lineClasses: [cls(1, 0, "510506", "5001"), cls(1, 1, NOT_APPLICABLE_PUC, "")] }));
    expect(m.eeff.movements).toHaveLength(1);
    expect(m.eeff.movements[0].amountCents).toBe(100_000_00);
    expect(m.proposals["1001"][0].data.deductible).toBe(100_000);
    expect(m.proposals["1001"][0].data.ivaDeductible).toBe(19_000);
    expect(m.proposals["1005"][0].data.discountable).toBe(19_000);
    expect(m.totals.purchaseCents).toBe(100_000_00);
    expect(m.docs[0].baseCents).toBe(100_000_00);
    expect(m.docs[0].lines[1].excludedBaseCents).toBe(50_000_00);
    const march = m.coverage.find((c) => c.month === 3)!;
    expect([march.purchaseCents, march.notApplicableLines, march.notApplicableCents]).toEqual([100_000_00, 1, 50_000_00]);
    noPending(m);
  });

  it("de una clasificación normal a 7305 limpia concepto y retenciones (dominio y persistencia lo normalizan)", () => {
    const normal = { pucCode: "510506", concept1001: "5001", retention: [{ rateId: 1 }] };
    expect(normalizeClassification(normal)).toBe(normal);
    expect(normalizeClassification({ ...normal, pucCode: NOT_APPLICABLE_PUC })).toEqual({ pucCode: NOT_APPLICABLE_PUC, concept1001: "", retention: [] });
    // Con retención activa antes del cambio hay retención; después de cambiar a 7305 ya no.
    const d = doc(1, [line(0, 100_000_00, 0)]);
    const before = buildPurchasesModel(input([d], { lineClasses: [cls(1, 0, "510506", "5001", [{ rateId: 1 }])] }));
    expect(before.docs[0].retention.expectedCents).toBeGreaterThan(0);
    const after = buildPurchasesModel(input([d], { lineClasses: [cls(1, 0, NOT_APPLICABLE_PUC, "", [])] }));
    expect(after.docs[0].retention.expectedCents).toBe(0);
    expect(after.eeff.movements).toEqual([]);
  });

  it("de 7305 a una cuenta normal vuelve a exigir PUC válido, concepto 1001 y retenciones", () => {
    const d = doc(1, [line(0, 100_000_00, 19_000_00)]);
    // Misma línea, ahora con cuenta normal pero sin concepto: bloquea 1001 (ya no queda «resuelta»).
    const noConcept = buildPurchasesModel(input([d], { lineClasses: [cls(1, 0, "510506", "")] }));
    expect(noConcept.alerts.some((a) => a.code === "concept-invalid")).toBe(true);
    expect(noConcept.status["1001"]).toBe("block");
    expect(noConcept.docs[0].lines[0].notApplicable).toBe(false);
    // PUC inexistente: bloquea EEFF.
    const badPuc = buildPurchasesModel(input([d], { lineClasses: [cls(1, 0, "999999", "5001")] }));
    expect(badPuc.alerts.some((a) => a.code === "puc-invalid")).toBe(true);
    expect(badPuc.status.EEFF).toBe("block");
    // Con todo, vuelve a alimentar los destinos y las retenciones se calculan.
    const ok = buildPurchasesModel(input([d], { lineClasses: [cls(1, 0, "510506", "5001", [{ rateId: 1 }])] }));
    expect(ok.eeff.movements).toHaveLength(1);
    expect(ok.docs[0].lines[0].assumedCents).toBeGreaterThan(0);
  });

  it("7305 es válido como PUC aunque no esté en el catálogo", () => {
    const index = buildPucIndex([{ code: "510506", concept: "Sueldos" }] as never);
    expect(isNotApplicablePuc("7305")).toBe(true);
    expect(isNotApplicablePuc("730505")).toBe(false);
    expect(pucProblem(index, "7305")).toBeUndefined();
    expect(pucProblem(index, "999999")).toBeTruthy();
  });

  it("guardado como regla de producto/proveedor se propone en una factura futura, sin concepto ni retención", () => {
    const rule = { id: 9, supplierNit: "900111222", productKey: "c:p0", productLabel: "Producto 0", pucCode: NOT_APPLICABLE_PUC, concept1001: "5001", retention: [{ rateId: 1 }], uses: 1, sourceDocumentId: 1, createdAt: "", updatedAt: "" } as PurchaseRule;
    const supplier = { withholdingRules: [{ rateId: 1, isDefault: true }] } as never;
    const p = proposeLine(line(0, 1, 0), { rulesByKey: new Map([["c:p0", rule]]), pucConcepts: new Map([["7305", "5001"]]), supplierRules: [rule], supplier });
    expect([p.pucCode, p.concept1001, p.retention, p.sources.concept, p.sources.retention]).toEqual([NOT_APPLICABLE_PUC, "", [], undefined, undefined]);

    // Factura futura: la propuesta aparece, pero igual exige confirmación explícita y no ofrece concepto ni retención.
    const future = doc(2, [line(0, 70_000_00, 13_300_00)]);
    const pending = buildPurchasesModel(input([future], {}, { rules: [rule] }));
    expect(pending.docs[0].lines[0].proposal.pucCode).toBe(NOT_APPLICABLE_PUC);
    expect(pending.docs[0].lines[0].proposal.concept1001).toBe("");
    expect(pending.counts.EEFF.pending).toBe(1);
    // Confirmada con el alcance de regla: queda resuelta y excluida.
    const done = buildPurchasesModel(input([future], { lineClasses: [cls(2, 0, NOT_APPLICABLE_PUC, "", [], "rule")] }, { rules: [rule] }));
    noPending(done);
    expect(done.eeff.movements).toEqual([]);
    expect(done.docs[0].lines[0].class?.scope).toBe("rule");
  });
});
