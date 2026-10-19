import { describe, expect, it } from "vitest";
import type { PurchaseDocument, PurchaseLine, PurchaseRule, PurchasesState, YearConcept } from "../../../../types/purchases";
import { buildPucIndex } from "../../puc-codes/services/pucCatalog";
import { NOT_APPLICABLE_PUC } from "./classify";
import { buildPurchasesModel, type PurchasesInput } from "./model";
import { confirmProposalsLabel, proposableLines, PROPOSALS_INCLUDE, proposalInputs, previewRetention } from "./lineDraft";

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

const concepts: YearConcept[] = [
  { year: 2025, code: "5001", description: "Salarios", isActive: true, validFrom: "2025-01-01", validTo: null } as never,
  { year: 2025, code: "5002", description: "Honorarios", isActive: true, validFrom: "2025-01-01", validTo: null } as never,
];
const rate = (id: number, name: string, rateBp: number, baseUvtCenti: number) => ({ id, retentionType: "services", name, baseUvtCenti, rateBp, sortOrder: id, createdAt: "", updatedAt: "" }) as never;
// UVT $50.000: 4 UVT = $200.000 de cuantía mínima. 1 = hoteles y restaurantes 3,5 % (mín. 4 UVT) · 2 = honorarios 11 % (sin mínima) · 3 = 3,5 % sin mínima.
const HOTELS = rate(1, "Servicios de hoteles y restaurantes", 350, 400);
const FEES = rate(2, "Honorarios", 1100, 0);
const FLAT = rate(3, "Servicios sin mínima", 350, 0);

function input(docs: PurchaseDocument[], state: Partial<PurchasesState> = {}): PurchasesInput {
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
    pucIndex: buildPucIndex([{ code: "510506", concept: "Sueldos" }, { code: "1", concept: "Activo" }, { code: "5", concept: "Gastos" }] as never),
    pucConcepts: new Map(),
    concepts1001: concepts,
    rates: [HOTELS, FEES, FLAT],
    uvts: [{ year: 2025, valuePesos: 50_000, updatedAt: "" }],
    catalogs: null,
  };
}

const cls = (docId: number, idx: number, pucCode: string, concept1001: string, retention: { rateId: number }[] = []) =>
  ({ documentId: docId, lineIndex: idx, pucCode, concept1001, retention, ruleId: null, scope: "invoice", confirmedAt: "" }) as never;

const pesos = (n: number) => n * 100;
const retOf = (m: ReturnType<typeof buildPurchasesModel>) => m.proposals["1001"].reduce((s, p) => s + (p.data.retAssumed as number), 0);

describe("retención común a toda la factura", () => {
  // Pollo, ternera y agua: ninguno supera solo $200.000, los tres suman $240.000.
  const threeLines = () => doc(1, [line(0, pesos(80_000), 0, "Pollo"), line(1, pesos(80_000), 0, "Ternera"), line(2, pesos(80_000), 0, "Agua")]);

  it("la cuantía mínima se evalúa contra el subtotal de la factura y se calcula una sola vez", () => {
    const classes = [0, 1, 2].map((i) => cls(1, i, "510506", "5001", [{ rateId: 1 }]));
    const m = buildPurchasesModel(input([threeLines()], { lineClasses: classes }));
    const d = m.docs[0];
    expect(d.retention.byRate).toHaveLength(1);
    expect(d.retention.byRate[0]).toMatchObject({ rateId: 1, scope: "invoice", baseCents: pesos(240_000), belowMinimum: false, expectedCents: pesos(8_400) });
    expect(d.retention.expectedCents).toBe(pesos(8_400));
    expect(d.retention.invoiceLevelCents).toBe(pesos(8_400));
    // Por línea solo participa con su parte; sumadas dan exactamente la retención de la factura.
    expect(d.lines.map((l) => l.commonRetentionRateIds)).toEqual([[1], [1], [1]]);
    expect(d.lines.reduce((s, l) => s + l.assumedCents, 0)).toBe(pesos(8_400));
  });

  it("sin doble conteo: 1001 suma exactamente la retención de la factura, aunque las líneas vayan a conceptos distintos", () => {
    const classes = [cls(1, 0, "510506", "5001", [{ rateId: 1 }]), cls(1, 1, "510506", "5002", [{ rateId: 1 }]), cls(1, 2, "510506", "5002", [{ rateId: 1 }])];
    const m = buildPurchasesModel(input([threeLines()], { lineClasses: classes }));
    expect(m.proposals["1001"]).toHaveLength(2);
    expect(retOf(m)).toBe(8_400);
    expect(m.proposals["1001"].reduce((s, p) => s + (p.data.exactCents as { retAssumed: number }).retAssumed, 0)).toBe(pesos(8_400));
    expect(m.docs[0].retention.assumedCents).toBe(pesos(8_400));
  });

  it("el redondeo se hace una vez sobre el subtotal, no línea por línea", () => {
    // 3 × $33.333,33 al 3,5 %: por línea serían 3 × 116.667 = 350.001; sobre el subtotal ($100.000) es 350.000.
    const d = doc(1, [line(0, 3_333_333, 0), line(1, 3_333_333, 0), line(2, 3_333_334, 0)]);
    const m = buildPurchasesModel(input([d], { lineClasses: [0, 1, 2].map((i) => cls(1, i, "510506", "5001", [{ rateId: 3 }])) }));
    expect(m.docs[0].retention.expectedCents).toBe(350_000);
    expect(m.docs[0].lines.reduce((s, l) => s + l.assumedCents, 0)).toBe(350_000);
    expect(m.proposals["1001"][0].data.retAssumed).toBe(3_500);
  });

  it("la retención informada tampoco se duplica: se conserva una vez y no hay diferencia", () => {
    const d = doc(1, threeLines().data.lines, pesos(8_400));
    const m = buildPurchasesModel(input([d], { lineClasses: [0, 1, 2].map((i) => cls(1, i, "510506", "5001", [{ rateId: 1 }])) }));
    expect(m.docs[0].retention.mismatch).toBe(false);
    expect(m.docs[0].retention.assumedCents).toBe(0);
    expect(m.docs[0].lines.reduce((s, l) => s + l.practicedCents, 0)).toBe(pesos(8_400));
    expect(m.proposals["1001"][0].data.retPracticed).toBe(8_400);
    expect(m.proposals["1001"][0].data.retAssumed).toBe(0);
  });

  it("bajo la cuantía mínima del subtotal no hay retención en ninguna línea", () => {
    const d = doc(1, [line(0, pesos(80_000), 0), line(1, pesos(80_000), 0)]);
    const m = buildPurchasesModel(input([d], { lineClasses: [0, 1].map((i) => cls(1, i, "510506", "5001", [{ rateId: 1 }])) }));
    expect(m.docs[0].retention.byRate[0]).toMatchObject({ scope: "invoice", baseCents: pesos(160_000), belowMinimum: true, expectedCents: 0 });
    expect(retOf(m)).toBe(0);
  });

  it("una línea 7305 no entra en el subtotal de la retención", () => {
    // Con la línea 7305 el total sería $240.000 (supera la mínima); sin ella, $160.000 (no la supera).
    const d = threeLines();
    const m = buildPurchasesModel(input([d], { lineClasses: [cls(1, 0, "510506", "5001", [{ rateId: 1 }]), cls(1, 1, "510506", "5001", [{ rateId: 1 }]), cls(1, 2, NOT_APPLICABLE_PUC, "")] }));
    expect(m.docs[0].retention.byRate[0]).toMatchObject({ scope: "invoice", baseCents: pesos(160_000), belowMinimum: true });
    expect(retOf(m)).toBe(0);
    expect(m.docs[0].lines[2].commonRetentionRateIds).toEqual([]);
    // Con tres líneas incluidas por $100.000 + $100.000 y una 7305 enorme, solo cuentan las incluidas.
    const big = doc(2, [line(0, pesos(150_000), 0), line(1, pesos(150_000), 0), line(2, pesos(5_000_000), 0)]);
    const m2 = buildPurchasesModel(input([big], { lineClasses: [cls(2, 0, "510506", "5001", [{ rateId: 1 }]), cls(2, 1, "510506", "5001", [{ rateId: 1 }]), cls(2, 2, NOT_APPLICABLE_PUC, "")] }));
    expect(m2.docs[0].retention.byRate[0]).toMatchObject({ baseCents: pesos(300_000), expectedCents: pesos(10_500) });
    expect(retOf(m2)).toBe(10_500);
  });

  it("retenciones distintas por línea: se mantiene el cálculo por línea", () => {
    const d = doc(1, [line(0, pesos(250_000), 0), line(1, pesos(100_000), 0)]);
    const m = buildPurchasesModel(input([d], { lineClasses: [cls(1, 0, "510506", "5001", [{ rateId: 1 }]), cls(1, 1, "510506", "5002", [{ rateId: 2 }])] }));
    const byId = new Map(m.docs[0].retention.byRate.map((e) => [e.rateId, e]));
    expect(byId.get(1)).toMatchObject({ scope: "lines", baseCents: pesos(250_000), expectedCents: pesos(8_750) });
    expect(byId.get(2)).toMatchObject({ scope: "lines", baseCents: pesos(100_000), expectedCents: pesos(11_000) });
    expect(m.docs[0].retention.invoiceLevelCents).toBe(0);
    expect(m.docs[0].lines.map((l) => l.commonRetentionRateIds)).toEqual([[], []]);
    expect(m.docs[0].lines.map((l) => l.assumedCents)).toEqual([pesos(8_750), pesos(11_000)]);
    expect(retOf(m)).toBe(19_750);
  });

  it("un concepto solo en parte de las líneas se calcula con las líneas que lo tienen", () => {
    // Hoteles en dos de tres líneas ($80.000 + $80.000 = $160.000 < mínima); la tercera lleva honorarios.
    const m = buildPurchasesModel(input([threeLines()], { lineClasses: [cls(1, 0, "510506", "5001", [{ rateId: 1 }]), cls(1, 1, "510506", "5001", [{ rateId: 1 }]), cls(1, 2, "510506", "5002", [{ rateId: 2 }])] }));
    const hotels = m.docs[0].retention.byRate.find((e) => e.rateId === 1)!;
    expect(hotels).toMatchObject({ scope: "lines", baseCents: pesos(160_000), belowMinimum: true, expectedCents: 0 });
    expect(retOf(m)).toBe(8_800);
    // Un concepto común más otro parcial: el común cuenta una vez y el parcial por sus líneas.
    const mix = buildPurchasesModel(input([threeLines()], { lineClasses: [cls(1, 0, "510506", "5001", [{ rateId: 1 }, { rateId: 2 }]), cls(1, 1, "510506", "5001", [{ rateId: 1 }]), cls(1, 2, "510506", "5001", [{ rateId: 1 }])] }));
    expect(mix.docs[0].retention.byRate.map((e) => [e.rateId, e.scope])).toEqual([[1, "invoice"], [2, "lines"]]);
    expect(retOf(mix)).toBe(8_400 + 8_800);
    expect(mix.docs[0].lines[0].commonRetentionRateIds).toEqual([1]);
  });

  it("la vista previa de la línea usa el subtotal y reparte la retención común sin perder centavos", () => {
    const bases = [pesos(80_000), pesos(80_000), pesos(80_000)];
    const uvt = [{ year: 2025, valuePesos: 50_000, updatedAt: "" }];
    const previews = bases.map((b, i) => previewRetention(HOTELS as never, [], "2025-03-10", uvt, b, pesos(240_000), { bases, index: i }));
    for (const p of previews) expect(p).toMatchObject({ invoiceLevel: true, belowMinimum: false, invoiceValueCents: pesos(8_400), conceptBaseCents: pesos(240_000) });
    expect(previews.reduce((s, p) => s + p.valueCents, 0)).toBe(pesos(8_400));
    // Sin ser común (otra línea no la tiene) se evalúa por la suma de sus líneas, como antes.
    expect(previewRetention(HOTELS as never, [], "2025-03-10", uvt, bases[0], pesos(160_000))).toMatchObject({ invoiceLevel: false, belowMinimum: true, valueCents: 0 });
  });
});

describe("Confirmar N propuestas completas (encabezado de la factura)", () => {
  const d = () => doc(1, [line(0, pesos(80_000), 0, "Pollo"), line(1, pesos(80_000), 0, "Ternera"), line(2, pesos(80_000), 0, "Agua")]);
  const rule = (i: number, retention: { rateId: number }[]): PurchaseRule =>
    ({ id: i + 1, supplierNit: "900111222", productKey: `c:p${i}`, productLabel: `Producto ${i}`, pucCode: "510506", concept1001: "5001", retention, uses: 1, sourceDocumentId: 1, createdAt: "", updatedAt: "" }) as PurchaseRule;
  const withRules = (retention: { rateId: number }[]) => ({ ...input([d()]), rules: [0, 1, 2].map((i) => rule(i, retention)) });

  it("confirma de cada propuesta PUC, concepto 1001 y todas las retenciones", () => {
    const m = buildPurchasesModel(withRules([{ rateId: 1 }, { rateId: 2 }]));
    const inputs = proposalInputs(1, "900111222", m.docs[0].lines);
    expect(inputs.map((i) => i.lineIndex)).toEqual([0, 1, 2]);
    for (const i of inputs) expect(i).toMatchObject({ documentId: 1, pucCode: "510506", concept1001: "5001", retention: [{ rateId: 1 }, { rateId: 2 }] });
  });

  it("no crea ni modifica reglas de producto o proveedor", () => {
    const m = buildPurchasesModel(withRules([{ rateId: 1 }]));
    const inputs = proposalInputs(1, "900111222", m.docs[0].lines);
    expect(inputs.every((i) => i.saveRule === false)).toBe(true);
    expect(new Set(inputs.map((i) => i.productKey)).size).toBe(3);
  });

  it("las N líneas quedan Confirmadas, salen del conteo «Por confirmar» y EEFF/1001 se recalculan", () => {
    const before = buildPurchasesModel(withRules([{ rateId: 1 }]));
    expect(proposableLines(before.docs[0].lines)).toHaveLength(3);
    expect(before.totals.pendingLines).toBe(3);
    expect(before.eeff.movements).toEqual([]);
    expect(before.proposals["1001"]).toEqual([]);
    const lineClasses = proposalInputs(1, "900111222", before.docs[0].lines).map((i) => cls(1, i.lineIndex, i.pucCode, i.concept1001, i.retention));
    const after = buildPurchasesModel({ ...withRules([{ rateId: 1 }]), state: { uploads: [], documents: [d()], lineClasses, flags: [], audit: [] } });
    expect(after.docs[0].lines.every((l) => l.confirmed)).toBe(true);
    expect(after.docs[0].lines.map((l) => l.retention)).toEqual([[{ rateId: 1 }], [{ rateId: 1 }], [{ rateId: 1 }]]);
    expect(after.totals.pendingLines).toBe(0);
    expect(proposableLines(after.docs[0].lines)).toHaveLength(0);
    expect(after.eeff.totalCents).toBe(pesos(240_000));
    expect(after.proposals["1001"][0].data.deductible).toBe(240_000);
    // Misma retención en todas las líneas: tope sobre el subtotal y una sola retención.
    expect(after.docs[0].retention.byRate).toHaveLength(1);
    expect(after.docs[0].retention.byRate[0]).toMatchObject({ scope: "invoice", baseCents: pesos(240_000), belowMinimum: false });
    expect(retOf(after)).toBe(8_400);
  });

  it("una propuesta sin retención no inventa ninguna, y 7305 se confirma sin concepto ni retenciones", () => {
    const m = buildPurchasesModel({ ...input([d()]), rules: [rule(0, []), { ...rule(1, [{ rateId: 1 }]), pucCode: NOT_APPLICABLE_PUC, concept1001: "" }] });
    const inputs = proposalInputs(1, "900111222", m.docs[0].lines);
    expect(inputs.map((i) => [i.lineIndex, i.pucCode, i.concept1001, i.retention])).toEqual([[0, "510506", "5001", []], [1, NOT_APPLICABLE_PUC, "", []], [2, "510506", "5001", []]]);
    // La línea 2 no tiene regla: su propuesta es la sugerencia general del proveedor, sin retención inventada.
  });

  it("el botón y la ayuda dicen qué incluye y que es solo para esta factura", () => {
    expect(confirmProposalsLabel(2)).toBe("Confirmar 2 propuestas completas (solo esta factura)");
    expect(PROPOSALS_INCLUDE).toBe("Incluye PUC, concepto 1001 y retenciones. Solo aplica a esta factura.");
  });
});
