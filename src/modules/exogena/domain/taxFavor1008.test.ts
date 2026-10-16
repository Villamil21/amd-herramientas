import { describe, expect, it } from "vitest";
import { TAX_PUC, type TaxReturn } from "../../financial-statements/tax-obligations/types";
import type { Supplier } from "../../../types/models";
import { deudoresCents, reconcileDeudores } from "./deudores";
import { buildTaxProposals1008, CONCEPT_DIAN, manualBalanceProblems, rowOrigin1008, sourceKeyDian1008 } from "./form1008";
import { exportBlockers } from "./exportWorkbook";
import type { FormatStatusRow } from "../../../types/exogena";
import { build1009, DIAN_NIT } from "./form1009";
import { taxEffects } from "../../financial-statements/tax-obligations/services/effects";

const dian: Supplier = { id: 7, nit: "800197268", businessName: "DIAN", vatType: null, createdAt: "x", updatedAt: "x", personType: "PJ", docTypeCode: "31", dv: "4", address: "CR 8 6C 38", countryCode: "169", deptCode: "11", muniCode: "001", dataStatus: "completo" } as Supplier;
const PUC = new Map<string, string>([
  [TAX_PUC.vatFavor, "135515"],
  [TAX_PUC.incomeFavor, "135517"],
  [TAX_PUC.incomeAdvance, "135518"],
  [TAX_PUC.vatPayable, "240801"],
  [TAX_PUC.withholdingPayable, "236505"],
  [TAX_PUC.incomePayable, "240405"],
]);

function ret(over: Partial<TaxReturn>): TaxReturn {
  return {
    id: 1, companyId: 1, taxType: "vat", year: 2025, period: 6, periodicity: "bimonthly", periodStart: "2025-11-01", periodEnd: "2025-12-31", formNumber: "300-1", previousFormNumber: "", isCorrection: false, supersededBy: null,
    payableCents: 0, favorCents: 0, resolution: "", nit: "", companyName: "", fileName: "", incomeOrdinaryCents: null, incomeLossCents: null, advanceNextCents: null, advanceTargetYear: null, detail: {}, createdAt: "x", updatedAt: "x", events: [], payments: [], ...over,
  } as TaxReturn;
}
const income2025 = (over: Partial<TaxReturn> = {}) => ret({ id: 2, taxType: "income", year: 2025, period: null, periodicity: "annual", periodStart: "2025-01-01", periodEnd: "2025-12-31", formNumber: "110-1", advanceNextCents: 900_000_00, advanceTargetYear: 2026, ...over });
const tax = (returns: TaxReturn[]) => ({ returns, puc: PUC, vatPeriodicity: "bimonthly" as const });

describe("1008 — saldos a favor de IVA y Renta a nombre de la DIAN", () => {
  it("IVA y Renta a favor vigentes al 31/12 → un solo registro DIAN (1317) con trazabilidad", () => {
    const { proposals } = buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: tax([ret({ favorCents: 300_000_00 }), income2025({ favorCents: 1_200_000_00 })]) });
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.sourceKey).toBe(sourceKeyDian1008);
    expect(p.data).toMatchObject({ concept: CONCEPT_DIAN, docNumber: DIAN_NIT, dv: "4", supplierId: 7, balance: 1_500_000 });
    expect((p.data.taxTrace as { kind: string; formNumber: string; cut: string; resultCents: number; declaredCents: number }[]).map((t) => [t.kind, t.formNumber, t.cut, t.declaredCents, t.resultCents])).toEqual([
      ["vat_favor", "300-1", "2025-12-31", 300_000_00, 300_000_00],
      ["income_favor", "110-1", "2025-12-31", 1_200_000_00, 1_200_000_00],
    ]);
  });

  it("el anticipo de renta NUNCA se propone al 1008 (ni antes ni después de diciembre)", () => {
    for (const year of [2025, 2026]) expect(buildTaxProposals1008({ year, suppliers: [dian], tax: tax([income2025()]) }).proposals).toHaveLength(0);
  });

  it("sin saldo a favor no hay propuesta; con IVA por pagar tampoco (eso va al 1009)", () => {
    expect(buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: tax([ret({ payableCents: 100_000_00 })]) }).proposals).toHaveLength(0);
  });

  it("si falta el último periodo de IVA terminado no se reutiliza el saldo anterior", () => {
    const old = ret({ id: 9, period: 5, periodStart: "2025-09-01", periodEnd: "2025-10-31", favorCents: 50_000_00 });
    expect(buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: tax([old]) }).proposals).toHaveLength(0);
  });

  it("no inventa datos de la DIAN: sin ficha de proveedor el registro sale sin DV ni dirección", () => {
    const p = buildTaxProposals1008({ year: 2025, suppliers: [], tax: tax([ret({ favorCents: 10_000_00 })]) }).proposals[0];
    expect(p.data).toMatchObject({ supplierId: null, docNumber: DIAN_NIT, dv: "", address: "" });
  });

  it("cuenta PUC sin configurar: no se propone y bloquea", () => {
    const r = buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: { returns: [ret({ favorCents: 10_000_00 })], puc: new Map(), vatPeriodicity: "bimonthly" } });
    expect(r.proposals).toHaveLength(0);
    expect(r.issues.some((i) => i.level === "blocking")).toBe(true);
  });

  it("el origen de la fila se explica", () => {
    expect(rowOrigin1008({ origin: "estados_financieros", manualFields: [], sourceKey: sourceKeyDian1008 })).toBe("Calculado desde obligaciones tributarias");
    expect(rowOrigin1008({ origin: "empresas", manualFields: [], sourceKey: "socio-cxc:1" })).toBe("Calculado desde capital");
  });
});

describe("1009 — mismo saldo que el ESF, con traza", () => {
  it("el saldo pendiente (declarado − pagos ≤ corte) coincide con el efecto del ESF y conserva sanciones", () => {
    const r = ret({ taxType: "withholding", periodicity: "monthly", period: 12, periodStart: "2025-12-01", periodEnd: "2025-12-31", payableCents: 520_000_00, payments: [{ id: 1, returnId: 1, paymentDate: "2025-12-20", amountCents: 200_000_00, note: "", reference: "", excessCents: 0, excessKind: "", excessReview: null, createdAt: "x", updatedAt: "x" }, { id: 2, returnId: 1, paymentDate: "2026-01-10", amountCents: 100_000_00, note: "", reference: "", excessCents: 0, excessKind: "", excessReview: null, createdAt: "x", updatedAt: "x" }] });
    const eff = taxEffects(tax([r]), "2025-12-31").effects[0];
    const built = build1009({ year: 2025, company: { shareholders: [] }, suppliers: [dian], movements: [], catalog: { lines: [], sections: [] }, mappings: [], batches: [], tax: tax([r]), statements: { esf: { liabilities: 0 } as never } });
    expect(built.proposals[0].data.balanceCents).toBe(eff.cents);
    expect(eff.cents).toBe(320_000_00);
    expect(built.proposals[0].data.taxTrace).toEqual([expect.objectContaining({ taxType: "withholding", declaredCents: 520_000_00, paidCents: 200_000_00, cut: "2025-12-31", resultCents: 320_000_00, formNumber: "300-1" })]);
  });
});

describe("Deudores del ESF ↔ total 1008", () => {
  const sections = (names: [string, number][], key: "asset_current" | "asset_noncurrent") => ({ [key]: { lines: names.map(([name, cents]) => ({ line: { name }, cents })) } });
  it("suma Deudores corrientes y no corrientes (la clasificación no excluye)", () => {
    const st = { sections: { ...sections([["Deudores", 100], ["Disponible", 999]], "asset_current"), ...sections([["Deudores", 50]], "asset_noncurrent") } } as never;
    expect(deudoresCents(st)).toBe(150);
  });

  it("explica la diferencia por fuente: socios, IVA, Renta y otros", () => {
    const effects = [{ kind: "vat_favor" as const, cents: 300_000_00 }, { kind: "income_favor" as const, cents: 1_200_000_00 }];
    const records = [
      { sourceKey: "socio-cxc:1", data: { balance: 2_000_000 } },
      { sourceKey: sourceKeyDian1008, data: { balance: 1_500_000, taxTrace: [{ kind: "vat_favor", resultCents: 300_000_00 }, { kind: "income_favor", resultCents: 1_200_000_00 }] } },
    ];
    const ok = reconcileDeudores({ eeffDeudoresCents: 3_500_000_00, sociosReceivableCents: 2_000_000_00, taxEffects: effects, records });
    expect(ok.differenceCents).toBe(0);
    expect(ok.rows.map((r) => [r.key, r.differenceCents])).toEqual([["socios", 0], ["vat_favor", 0], ["income_favor", 0], ["excess_favor", 0], ["other", 0]]);
    // El ESF trae 400.000 de otros deudores que el 1008 no tiene.
    const gap = reconcileDeudores({ eeffDeudoresCents: 3_900_000_00, sociosReceivableCents: 2_000_000_00, taxEffects: effects, records });
    expect(gap.differenceCents).toBe(400_000_00);
    expect(gap.rows.find((r) => r.key === "other")).toMatchObject({ eeffCents: 400_000_00, exogenaCents: 0, differenceCents: 400_000_00 });
  });
});

describe("DIAN–1317 con saldo editado a mano y saldos a favor que desaparecen", () => {
  const status = (formatCode: string, st: FormatStatusRow["status"]): FormatStatusRow => ({ formatCode, status: st, notApplicableReason: "", lastSyncedAt: null, sourceFingerprint: "", updatedAt: "", recordCount: 1 });
  // Registro guardado: sincronizado con 1.500.000 y luego editado a mano a 2.000.000.
  const stored = (over: Record<string, unknown> = {}) => ({ sourceKey: sourceKeyDian1008, origin: "estados_financieros" as const, manualFields: ["balance"], data: { businessName: "DIAN", concept: CONCEPT_DIAN, balance: 2_000_000, taxTrace: [{ kind: "vat_favor" }], ...over } });

  it("sin saldos a favor, el registro con valor manual sigue proponiéndose en $0 con desglose vacío", () => {
    const none = tax([ret({ favorCents: 0 })]);
    expect(buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: none }).proposals).toHaveLength(0);
    const kept = buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: none, keepManualDian: true }).proposals;
    expect(kept).toHaveLength(1);
    expect(kept[0].data).toMatchObject({ concept: CONCEPT_DIAN, balance: 0, taxTrace: [] });
  });

  it("la diferencia manual vs fuentes es un pendiente bloqueante (propuesta $0)", () => {
    const proposals = buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: tax([]), keepManualDian: true }).proposals;
    const problems = manualBalanceProblems([stored()], proposals);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ level: "blocking", recordKey: sourceKeyDian1008, field: "balance", code: "manual_balance" });
    expect(problems[0].message).toContain("2000000");
    expect(problems[0].message).toContain("(0)");
    // Incluso si la fuente ni siquiera propone el registro, el cálculo es $0.
    expect(manualBalanceProblems([stored()], [])).toHaveLength(1);
  });

  it("no marca «Listo» ni permite exportar mientras exista esa diferencia", () => {
    const problems = manualBalanceProblems([stored()], []);
    const listo = exportBlockers({ statuses: { "1008": status("1008", "listo") }, problems: { "1008": problems }, reconciliation1009: null });
    expect(listo.some((b) => b.format === "1008" && b.message.includes("pendiente"))).toBe(true);
    // La página reabre un 1008 «listo» con pendientes bloqueantes: queda «requiere actualización» y tampoco exporta.
    const reopened = exportBlockers({ statuses: { "1008": status("1008", "requiere_actualizacion") }, problems: { "1008": problems }, reconciliation1009: null });
    expect(reopened.length).toBeGreaterThan(0);
  });

  it("al confirmar el reemplazo (se limpia la marca manual y el saldo vuelve a $0) no hay pendiente", () => {
    expect(manualBalanceProblems([stored({ balance: 0, taxTrace: [] })].map((r) => ({ ...r, manualFields: [] })), [])).toEqual([]);
    // Con la marca manual y un valor igual al calculado tampoco hay diferencia.
    expect(manualBalanceProblems([stored({ balance: 0 })], [])).toEqual([]);
  });

  it("un registro manual puro (sin fuente) nunca se compara", () => {
    expect(manualBalanceProblems([{ ...stored(), origin: "manual" as never }], [])).toEqual([]);
  });
});
