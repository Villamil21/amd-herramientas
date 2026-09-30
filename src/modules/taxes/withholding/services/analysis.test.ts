import { describe, expect, it } from "vitest";
import type { DocumentTitleMapping, PersonType, Supplier, SupplierWithholdingRule, UvtValue, WithholdingRate } from "../../../../types/models";
import type { DocDecision, FileResult, ParsedDocument } from "../types";
import { buildWithholdingReport, suggestPersonType, type AnalysisContext } from "./analysis";
import { fiscalCodes, regimeKey } from "./fiscal";
import { mulDivRound, parseHundredths, parsePesosInput, retentionCents, roundToThousands } from "./money";

const pesos = (n: number) => n * 100;

const RATES: WithholdingRate[] = [
  { id: 6, retentionType: "services", name: "Servicios generales (declarantes)", baseUvtCenti: 200, rateBp: 400, sortOrder: 6, createdAt: "", updatedAt: "" },
  { id: 1, retentionType: "purchases", name: "Compras generales (declarantes)", baseUvtCenti: 1000, rateBp: 250, sortOrder: 1, createdAt: "", updatedAt: "" },
  { id: 13, retentionType: "fees", name: "Honorarios y comisiones (personas jurídicas)", baseUvtCenti: 0, rateBp: 1100, sortOrder: 13, createdAt: "", updatedAt: "" },
];
const UVTS: UvtValue[] = [{ year: 2026, valuePesos: 52_374, updatedAt: "" }];
const TITLES: DocumentTitleMapping[] = [
  { id: 1, normalizedTitle: "factura electronica de venta", displayTitle: "FACTURA ELECTRÓNICA DE VENTA", category: "invoice", createdAt: "", updatedAt: "" },
  { id: 2, normalizedTitle: "nota credito electronica", displayTitle: "NOTA CRÉDITO ELECTRÓNICA", category: "credit_note", createdAt: "", updatedAt: "" },
];

function doc(nit: string, number: string, subtotal: number, extra: Partial<ParsedDocument> = {}): ParsedDocument {
  return {
    pageCount: 1,
    title: "FACTURA ELECTRÓNICA DE VENTA",
    number,
    issueDate: "2026-01-15",
    supplierNit: nit,
    supplierName: `PROV ${nit}`,
    taxpayerType: "Persona Jurídica",
    fiscalText: "Régimen Fiscal: R-99-PN",
    fiscalCodes: ["R-99-PN"],
    subtotalCents: pesos(subtotal),
    retefuenteCents: 0,
    products: { columns: [], rows: [] },
    ...extra,
  };
}

const file = (fileName: string, d: ParsedDocument): FileResult => ({ fileName, kind: "parsed", doc: d });

const rule = (rateId: number, extra: Partial<SupplierWithholdingRule> = {}): SupplierWithholdingRule => ({ id: rateId, rateId, baseMode: "invoice_subtotal", isDefault: false, ...extra });

function supplier(id: number, nit: string, personType: PersonType | null, rules: SupplierWithholdingRule[], fiscalRegime: string | null = "R-99-PN"): Supplier {
  return { id, nit, businessName: `PROV ${nit}`, vatType: "service", createdAt: "", updatedAt: "", personType, fiscalRegime, fiscalCheckedAt: null, withholdingRules: rules };
}

function report(files: FileResult[], suppliers: Supplier[], extra: Partial<AnalysisContext> = {}) {
  return buildWithholdingReport(files, { suppliers, rates: RATES, uvts: UVTS, titles: TITLES, ...extra });
}

const decisions = (d: Record<string, DocDecision>) => ({ decisions: d });

describe("dinero", () => {
  it("calcula sin punto flotante y redondea a miles de forma convencional", () => {
    expect(retentionCents(pesos(1_950_000), 400)).toBe(pesos(78_000));
    expect(mulDivRound(5, 1, 10)).toBe(1);
    expect(mulDivRound(-5, 1, 10)).toBe(-1);
    expect(roundToThousands(pesos(650_500))).toBe(pesos(651_000));
    expect(roundToThousands(pesos(650_499))).toBe(pesos(650_000));
    expect(roundToThousands(pesos(650_499) + 99)).toBe(pesos(650_000));
    expect(parseHundredths("2,5")).toBe(250);
    expect(parseHundredths("4 %")).toBe(400);
    expect(parseHundredths("0,1")).toBe(10);
    expect(parseHundredths("x")).toBeNull();
    expect(parsePesosInput("1.950.000")).toBe(pesos(1_950_000));
    expect(parsePesosInput("$ 400000")).toBe(pesos(400_000));
  });

  it("interpreta códigos fiscales y PJ / PN", () => {
    expect(fiscalCodes("O-13;O-23")).toEqual(["O-13", "O-23"]);
    expect(fiscalCodes("R-99-PN")).toEqual(["R-99-PN"]);
    expect(fiscalCodes("Responsabilidad tributaria: 01 - IVA")).toEqual([]);
    expect(regimeKey("O-23; O-13")).toBe(regimeKey("O-13;O-23"));
    expect(suggestPersonType("Persona Jurídica")).toBe("PJ");
    expect(suggestPersonType("Persona Natural y asimiladas")).toBe("PN");
  });
});

describe("buildWithholdingReport", () => {
  it("MONO: servicios generales PJ, 4 % sobre 1.950.000 coincide con la Rete fuente y va a la declaración", () => {
    const mono = doc("901398069", "FE-29827", 1_950_000, { issueDate: "2026-01-31", retefuenteCents: pesos(78_000) });
    const r = report([file("mono.pdf", mono)], [supplier(1, "901398069", "PJ", [rule(6)])]);
    expect(r.period).toMatchObject({ key: "2026-01", label: "Enero 2026" });
    expect(r.rows[0]).toMatchObject({
      status: "validated",
      category: "invoice",
      personType: "PJ",
      minBaseCents: pesos(104_748),
      baseCents: pesos(1_950_000),
      rateBp: 400,
      calculatedCents: pesos(78_000),
      informedCents: pesos(78_000),
      impliedRateBp: 400,
      comparison: "match",
      retentionCents: pesos(78_000),
      counts: true,
    });
    expect(r.summary.find((l) => l.retentionType === "services")!.pj).toEqual({ baseCents: pesos(1_950_000), retentionCents: pesos(78_000) });
    expect(r.totals).toEqual({ invoicesCents: pesos(78_000), notesCents: 0, netCents: pesos(78_000), netRoundedCents: pesos(78_000) });
  });

  it("pide la configuración del proveedor nuevo una sola vez por NIT y sugiere PJ", () => {
    const r = report([file("a.pdf", doc("1", "A-1", 500_000)), file("b.pdf", doc("1", "A-2", 500_000))], []);
    expect(r.rows.every((x) => x.status === "pending-supplier" && !x.counts)).toBe(true);
    expect(r.pendingSuppliers).toMatchObject([{ nit: "1", documentCount: 2, taxpayerType: "Persona Jurídica", fiscalRegime: "R-99-PN" }]);
    expect(suggestPersonType(r.pendingSuppliers[0].taxpayerType)).toBe("PJ");
    // Proveedor creado desde IVA sin configuración de retención.
    const partial = report([file("a.pdf", doc("1", "A-1", 500_000))], [supplier(1, "1", null, [])]);
    expect(partial.pendingSuppliers[0]).toMatchObject({ supplierId: 1, missing: ["PJ / PN", "reglas de retención"] });
  });

  it("O-15 y O-47: ignorados, sin base ni retención", () => {
    const files = [
      file("o15.pdf", doc("1", "A-1", 1_000_000, { fiscalCodes: ["O-13", "O-15"], retefuenteCents: pesos(40_000) })),
      file("o47.pdf", doc("2", "B-1", 1_000_000, { fiscalCodes: ["O-47"] })),
    ];
    const r = report(files, [supplier(1, "1", "PJ", [rule(6)]), supplier(2, "2", "PN", [rule(6)])]);
    expect(r.rows.map((x) => [x.status, x.excludedCode, x.counts])).toEqual([
      ["ignored-regime", "O-15", false],
      ["ignored-regime", "O-47", false],
    ]);
    expect(r.summary.every((l) => l.pj.baseCents === 0 && l.pn.baseCents === 0)).toBe(true);
    expect(r.totals.netCents).toBe(0);
    expect(r.stats.ignored).toBe(2);
  });

  it("detecta el cambio de régimen frente al guardado y los conflictos del lote", () => {
    const s = supplier(1, "1", "PJ", [rule(6)], "R-99-PN");
    const changed = report([file("a.pdf", doc("1", "A-1", 1_000_000, { fiscalCodes: ["O-15"], fiscalText: "Régimen Fiscal: O-15" }))], [s]);
    expect(changed.fiscalChanges).toMatchObject([{ supplierId: 1, stored: "R-99-PN", detected: "O-15", files: ["a.pdf"] }]);
    expect(report([file("a.pdf", doc("1", "A-1", 1_000_000, { fiscalCodes: ["O-15"] }))], [s], { dismissedFiscal: new Set(["1|O-15"]) }).fiscalChanges).toEqual([]);

    const noRegime = report([file("a.pdf", doc("1", "A-1", 1_000_000))], [supplier(1, "1", "PJ", [rule(6)], null)]);
    expect(noRegime.fiscalMissing).toMatchObject([{ supplierId: 1, detected: "R-99-PN" }]);

    const conflict = report([file("a.pdf", doc("1", "A-1", 1_000_000)), file("b.pdf", doc("1", "A-2", 1_000_000, { fiscalCodes: ["O-13"] }))], [s]);
    expect(conflict.fiscalConflicts[0].variants.map((v) => v.files)).toEqual([["a.pdf"], ["b.pdf"]]);
    expect(conflict.fiscalChanges).toEqual([]);
  });

  it("base por debajo del tope: retención 0 y su base NO va al resumen (PJ ni PN)", () => {
    const files = [file("a.pdf", doc("1", "A", 1_000_000)), file("b.pdf", doc("1", "B", 90_000)), file("c.pdf", doc("2", "C", 90_000))];
    const r = report(files, [supplier(1, "1", "PJ", [rule(6)]), supplier(2, "2", "PN", [rule(6)])]);
    expect(r.rows.map((x) => x.status)).toEqual(["validated", "below-minimum", "below-minimum"]);
    expect(r.rows[1]).toMatchObject({ baseCents: pesos(90_000), minBaseCents: pesos(104_748), calculatedCents: 0, retentionCents: 0, counts: false });
    const services = r.summary.find((l) => l.retentionType === "services")!;
    expect(services.pj).toEqual({ baseCents: pesos(1_000_000), retentionCents: pesos(40_000) });
    expect(services.pn).toEqual({ baseCents: 0, retentionCents: 0 });
    expect(r.stats.belowMinimum).toBe(2);
  });

  it("base manual: se pide por documento y es la que va al resumen", () => {
    const s = supplier(1, "1", "PJ", [rule(6, { baseMode: "manual" })]);
    const files = [file("a.pdf", doc("1", "A", 1_000_000))];
    expect(report(files, [s]).rows[0].status).toBe("pending-base");
    const r = report(files, [s], decisions({ "a.pdf": { manualBaseCents: pesos(400_000) } }));
    expect(r.rows[0]).toMatchObject({ status: "validated", baseCents: pesos(400_000), retentionCents: pesos(16_000) });
    expect(r.summary.find((l) => l.retentionType === "services")!.pj.baseCents).toBe(pesos(400_000));
  });

  it("Rete fuente distinta: se valida al confirmar la tarifa implícita o con base y tarifa corregidas que coinciden", () => {
    const s = supplier(1, "1", "PJ", [rule(1)]); // Compras 2,5 %
    const files = [file("a.pdf", doc("1", "A", 2_000_000, { retefuenteCents: pesos(40_000) }))];
    const pending = report(files, [s]);
    expect(pending.rows[0]).toMatchObject({ status: "difference", impliedRateBp: 200, calculatedCents: pesos(50_000), counts: false });
    expect(pending.totals.invoicesCents).toBe(0);

    const accepted = report(files, [s], decisions({ "a.pdf": { review: { kind: "accept-informed" } } }));
    expect(accepted.rows[0]).toMatchObject({ status: "validated", baseCents: pesos(2_000_000), rateBp: 200, retentionCents: pesos(40_000) });

    const corrected = report(files, [s], decisions({ "a.pdf": { review: { kind: "corrected", baseCents: pesos(1_000_000), rateBp: 400 } } }));
    expect(corrected.rows[0]).toMatchObject({ status: "validated", baseCents: pesos(1_000_000), retentionCents: pesos(40_000) });
    expect(corrected.summary.find((l) => l.retentionType === "purchases")!.pj.baseCents).toBe(pesos(1_000_000));

    const wrong = report(files, [s], decisions({ "a.pdf": { review: { kind: "corrected", baseCents: pesos(1_000_000), rateBp: 350 } } }));
    expect(wrong.rows[0].status).toBe("difference");
    expect(wrong.rows[0].issues).toContain("La base y tarifa ingresadas no coinciden con la Rete fuente informada.");
  });

  it("mes predominante: excluye los otros meses; en empate pregunta", () => {
    const s = supplier(1, "1", "PJ", [rule(6)]);
    const jan = Array.from({ length: 18 }, (_, i) => file(`e${i}.pdf`, doc("1", `E-${i}`, 1_000_000)));
    const feb = [file("f1.pdf", doc("1", "F-1", 1_000_000, { issueDate: "2026-02-02" })), file("f2.pdf", doc("1", "N-1", 1_000_000, { issueDate: "2026-02-03", title: "NOTA CRÉDITO ELECTRÓNICA" }))];
    const r = report([...jan, ...feb], [s]);
    expect(r.period.label).toBe("Enero 2026");
    expect(r.stats.outOfPeriod).toBe(2);
    expect(r.rows.filter((x) => x.status === "out-of-period").every((x) => !x.counts)).toBe(true);
    expect(r.totals).toMatchObject({ invoicesCents: pesos(18 * 40_000), notesCents: 0 });

    const tie = [file("a.pdf", doc("1", "A", 1_000_000)), file("b.pdf", doc("1", "B", 1_000_000, { issueDate: "2026-02-01" }))];
    const undecided = report(tie, [s]);
    expect(undecided.period.key).toBeUndefined();
    expect(undecided.period.tie.map((m) => m.key)).toEqual(["2026-01", "2026-02"]);
    expect(undecided.rows.every((x) => x.status === "pending-period" && !x.counts)).toBe(true);
    expect(report(tie, [s], { periodChoice: "2026-02" }).rows.map((x) => x.status)).toEqual(["out-of-period", "validated"]);
  });

  it("duplicados (NIT + número, sin importar el archivo) se cuentan una sola vez", () => {
    const mono = doc("901398069", "FE-29827", 1_950_000, { retefuenteCents: pesos(78_000) });
    const r = report([file("a.pdf", mono), file("copia.pdf", { ...mono, number: "FE 29827" })], [supplier(1, "901398069", "PJ", [rule(6)])]);
    expect(r.rows[1]).toMatchObject({ status: "duplicate", duplicateOf: "a.pdf", counts: false });
    expect(r.totals.invoicesCents).toBe(pesos(78_000));
    expect(r.summary.find((l) => l.retentionType === "services")!.pj.baseCents).toBe(pesos(1_950_000));
  });

  it("Notas: mismos criterios que las facturas y total neto redondeado a miles", () => {
    const s = supplier(1, "1", "PJ", [rule(13)]); // Honorarios 11 %, sin tope
    const note = (n: string, base: number, extra: Partial<ParsedDocument> = {}) => doc("1", n, base, { title: "NOTA CRÉDITO ELECTRÓNICA", ...extra });
    const files = [
      file("f.pdf", doc("1", "F", 6_363_636.37)), // 700.000 de retención
      file("n1.pdf", note("N-1", 450_000)), // 49.500
      file("n2.pdf", note("N-2", 100_000, { fiscalCodes: ["O-15"] })),
      file("n3.pdf", note("N-3", 100_000, { issueDate: "2026-02-01" })),
      file("n4.pdf", note("N-1", 450_000)),
    ];
    const r = report(files, [s]);
    expect(r.rows.map((x) => x.status)).toEqual(["validated", "validated", "ignored-regime", "out-of-period", "duplicate"]);
    expect(r.rows[1].category).toBe("credit_note");
    expect(r.totals).toEqual({ invoicesCents: pesos(700_000), notesCents: pesos(49_500), netCents: pesos(650_500), netRoundedCents: pesos(651_000) });
    // Las notas no se mezclan con la base de la declaración (facturas).
    expect(r.summary.find((l) => l.retentionType === "fees")!.pj.baseCents).toBe(636_363_637);
    expect(r.detail.map((d) => [d.category, d.documentCount])).toEqual([
      ["credit_note", 1],
      ["invoice", 1],
    ]);

    // Nota por debajo del tope: no suma.
    const below = report([file("n.pdf", note("N-9", 50_000))], [supplier(1, "1", "PJ", [rule(6)])]);
    expect(below.rows[0].status).toBe("below-minimum");
    expect(below.totals.notesCents).toBe(0);
  });

  it("título nuevo: pendiente hasta clasificarlo", () => {
    const r = report([file("a.pdf", doc("1", "A", 1_000_000, { title: "NOTA DÉBITO ELECTRÓNICA" }))], [supplier(1, "1", "PJ", [rule(6)])]);
    expect(r.rows[0].status).toBe("pending-title");
    expect(r.unknownTitles).toEqual([{ normalizedTitle: "nota debito electronica", displayTitle: "NOTA DÉBITO ELECTRÓNICA", documentCount: 1 }]);
  });

  it("separa PJ y PN en el resumen", () => {
    const r = report(
      [file("a.pdf", doc("1", "A", 1_000_000)), file("b.pdf", doc("2", "B", 2_000_000)), file("c.pdf", doc("2", "C", 50_000))],
      [supplier(1, "1", "PJ", [rule(6)]), supplier(2, "2", "PN", [rule(6)])],
    );
    const services = r.summary.find((l) => l.retentionType === "services")!;
    expect(services.pj).toEqual({ baseCents: pesos(1_000_000), retentionCents: pesos(40_000) });
    expect(services.pn).toEqual({ baseCents: pesos(2_000_000), retentionCents: pesos(80_000) });
  });

  it("varias reglas: usa la predeterminada, permite cambiarla por factura y pregunta si no hay predeterminada", () => {
    const files = [file("a.pdf", doc("1", "A", 1_000_000))];
    const noDefault = supplier(1, "1", "PJ", [rule(6), rule(13)]);
    expect(report(files, [noDefault]).rows[0]).toMatchObject({ status: "review", ruleOptions: [{ rateId: 6 }, { rateId: 13 }] });
    const withDefault = supplier(1, "1", "PJ", [rule(6), rule(13, { isDefault: true })]);
    expect(report(files, [withDefault]).rows[0]).toMatchObject({ status: "validated", rule: { retentionType: "fees" }, retentionCents: pesos(110_000) });
    expect(report(files, [withDefault], decisions({ "a.pdf": { rateId: 6 } })).rows[0]).toMatchObject({ rule: { retentionType: "services" }, retentionCents: pesos(40_000) });
  });

  it("errores de configuración: subtipo eliminado, sin UVT del año, falta número", () => {
    const deleted = report([file("a.pdf", doc("1", "A", 1_000_000))], [supplier(1, "1", "PJ", [rule(99)])]);
    expect(deleted.rows[0].status).toBe("review");
    expect(deleted.rows[0].issues[0]).toContain("ya no existe");
    const noUvt = report([file("a.pdf", doc("1", "A", 1_000_000, { issueDate: "2027-03-01" }))], [supplier(1, "1", "PJ", [rule(6)])]);
    expect(noUvt.rows[0].issues[0]).toContain("no hay valor UVT para 2027");
    const noNumber = report([file("a.pdf", doc("1", "", 1_000_000, { number: undefined }))], [supplier(1, "1", "PJ", [rule(6)])]);
    expect(noNumber.rows[0]).toMatchObject({ status: "review", counts: false });
  });

  it("archivos no compatibles no detienen el lote", () => {
    const r = report([{ fileName: "x.pdf", kind: "incompatible", message: "No se encontró la sección «Detalles de Productos»." }, file("a.pdf", doc("1", "A", 1_000_000))], [supplier(1, "1", "PJ", [rule(6)])]);
    expect(r.stats).toMatchObject({ files: 2, processed: 1, ignored: 1, failed: 1, validated: 1 });
  });
});
