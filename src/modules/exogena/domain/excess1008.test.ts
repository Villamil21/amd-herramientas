import { describe, expect, it } from "vitest";
import { TAX_PUC, type TaxPayment, type TaxReturn } from "../../financial-statements/tax-obligations/types";
import { excessFingerprint, taxEffects } from "../../financial-statements/tax-obligations/services/effects";
import { taxReconciliation } from "../../financial-statements/tax-obligations/services/reconcile";
import type { Supplier } from "../../../types/models";
import { reconcileDeudores } from "./deudores";
import { buildTaxProposals1008, sourceKeyDian1008 } from "./form1008";

const dian = { id: 7, nit: "800197268", businessName: "DIAN", vatType: null, createdAt: "x", updatedAt: "x", personType: "PJ", docTypeCode: "31", dv: "4", address: "CR 8", countryCode: "169", deptCode: "11", muniCode: "001", dataStatus: "completo" } as unknown as Supplier;
const PUC = new Map<string, string>([[TAX_PUC.excessFavor, "135515"], [TAX_PUC.vatFavor, "135517"], [TAX_PUC.vatPayable, "240801"], [TAX_PUC.withholdingPayable, "236505"], [TAX_PUC.incomePayable, "240405"]]);

const payment = (review: TaxPayment["excessReview"]): TaxPayment => ({ id: 5, returnId: 1, paymentDate: "2025-11-20", amountCents: 100_000_00, excessCents: 25_000_00, excessKind: "favor", excessReview: review, note: "", reference: "", createdAt: "x", updatedAt: "x" });
const vat = (review: TaxPayment["excessReview"]): TaxReturn =>
  ({
    id: 1, companyId: 1, taxType: "vat", year: 2025, period: 5, periodicity: "bimonthly", periodStart: "2025-09-01", periodEnd: "2025-10-31", formNumber: "300-5", previousFormNumber: "", isCorrection: false, supersededBy: null,
    payableCents: 100_000_00, favorCents: 0, resolution: "", nit: "", companyName: "", fileName: "", incomeOrdinaryCents: null, incomeLossCents: null, advanceNextCents: null, advanceTargetYear: null, detail: {}, createdAt: "x", updatedAt: "x", events: [],
    payments: [payment(review)],
  }) as TaxReturn;
const fp = excessFingerprint({ id: 5, paymentDate: "2025-11-20", excessCents: 25_000_00, excessKind: "favor" }, "135515");
const input = (review: TaxPayment["excessReview"]) => ({ returns: [vat(review)], puc: PUC, vatPeriodicity: "bimonthly" as const });

describe("excedentes a favor de DIAN: EEFF y 1008 incluyen o excluyen a la vez", () => {
  const applies = { decision: "applies" as const, fingerprint: fp, decidedAt: "x" };
  const notApplies = { decision: "not_applies" as const, fingerprint: fp, decidedAt: "x" };

  it("aplica → el excedente es deudor en EEFF y fuente del DIAN-1317 en el 1008, con el mismo valor", () => {
    const eeff = taxEffects(input(applies), "2025-12-31").effects.filter((e) => e.kind === "excess_favor");
    expect(eeff.map((e) => e.cents)).toEqual([25_000_00]);
    const { proposals, issues } = buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: input(applies) });
    expect(issues).toHaveLength(0);
    expect(proposals[0]).toMatchObject({ sourceKey: sourceKeyDian1008, data: { balance: 25_000 } });
    expect((proposals[0].data.taxTrace as { kind: string; paymentId?: number }[]).map((t) => [t.kind, t.paymentId])).toEqual([["excess_favor", 5]]);
    // Deudores EEFF = 1008.
    const records = proposals.map((p) => ({ sourceKey: p.sourceKey, data: p.data as unknown as Record<string, unknown> }));
    const rec = reconcileDeudores({ eeffDeudoresCents: 25_000_00, sociosReceivableCents: 0, taxEffects: eeff, records });
    expect(rec.differenceCents).toBe(0);
    expect(rec.rows.find((r) => r.key === "excess_favor")).toMatchObject({ eeffCents: 25_000_00, exogenaCents: 25_000_00, differenceCents: 0 });
  });

  it("no aplica → sale de EEFF y del 1008 a la vez, el pago original se conserva y no vuelve a preguntar", () => {
    const tax = input(notApplies);
    expect(taxEffects(tax, "2025-12-31").effects.some((e) => e.kind === "excess_favor")).toBe(false);
    expect(buildTaxProposals1008({ year: 2025, suppliers: [dian], tax }).proposals).toHaveLength(0);
    expect(taxEffects(tax, "2025-12-31").issues.some((i) => i.code === "excess_review")).toBe(false);
    expect(tax.returns[0].payments[0].excessCents).toBe(25_000_00);
  });

  it("sin decisión → el 1008 queda con un pendiente bloqueante y la propuesta no incluye el excedente", () => {
    const { proposals, issues } = buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: input(null) });
    expect(proposals).toHaveLength(0);
    expect(issues.some((i) => i.level === "blocking" && i.message.includes("excedente"))).toBe(true);
  });

  it("el excedente no crea deuda con la DIAN (nada va al 1009 de lo ya pagado)", () => {
    const e = taxEffects(input(applies), "2025-12-31");
    expect(e.effects.some((x) => x.kind === "vat_payable")).toBe(false);
  });

  it("la conciliación EEFF ↔ 1008 incluye el excedente por impuesto y detecta la diferencia", () => {
    const effects = taxEffects(input(applies), "2025-12-31").effects;
    const proposal = buildTaxProposals1008({ year: 2025, suppliers: [dian], tax: input(applies) }).proposals[0];
    const saved = [{ data: proposal.data as unknown as Record<string, unknown> }];
    const ok = taxReconciliation(effects, [], saved as never, "2025-12-31", "vat");
    expect(ok.rows.find((r) => r.format === "1008")).toMatchObject({ eeffCents: 25_000_00, exogenaCents: 25_000_00, differenceCents: 0 });
    const missing = taxReconciliation(effects, [], [{ data: { ...proposal.data, taxTrace: [] } }] as never, "2025-12-31", "vat");
    expect(missing.rows.find((r) => r.format === "1008")!.differenceCents).toBe(25_000_00);
    expect(missing.ready).toBe(false);
  });
});
