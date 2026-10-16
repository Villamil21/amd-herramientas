import { describe, expect, it } from "vitest";
import { taxReconciliation } from "./reconcile";
import type { TaxEffect, TaxTrace } from "./effects";

const trace = (kind: TaxTrace["kind"], taxType: TaxTrace["taxType"], resultCents: number, returnId = 1): TaxTrace => ({ returnId, taxType, kind, year: 2026, period: 1, periodLabel: "x", formNumber: "1", declaredCents: resultCents, paidCents: 0, cut: "2026-12-31", resultCents });
const eff = (kind: TaxEffect["kind"], cents: number, t: TaxTrace): TaxEffect => ({ kind, taxType: t.taxType, pucKey: "tax.vat_payable", pucCode: "240801", label: "x", cents, returnIds: [t.returnId], trace: t });
const rec = (data: Record<string, unknown>) => ({ data });

describe("conciliación EEFF vs Exógena por impuesto", () => {
  const ret = eff("withholding_payable", 500, trace("withholding_payable", "withholding", 500, 1));
  const ivaFavor = eff("vat_favor", 300, trace("vat_favor", "vat", 300, 2));
  it("EEFF = 1009 y 1008 a 31/12 → listo", () => {
    const r = taxReconciliation([ret, ivaFavor], [rec({ taxTrace: [ret.trace], balanceCents: 500 })], [rec({ taxTrace: [ivaFavor.trace], balance: 3 })], "2026-12-31");
    expect(r.rows.map((x) => [x.key, x.eeffCents, x.exogenaCents, x.differenceCents])).toEqual([
      ["withholding:1009", 500, 500, 0],
      ["vat:1008", 300, 300, 0],
    ]);
    expect(r.ready).toBe(true);
  });
  it("sin registros guardados no hay diferencia calculable ni «listo»", () => {
    const r = taxReconciliation([ret], null, null, "2026-12-31");
    expect(r.rows[0].exogenaCents).toBeNull();
    expect(r.ready).toBe(false);
  });
  it("una corrección manual del saldo en Exógena aparece aparte y rompe la conciliación", () => {
    const r = taxReconciliation([ret], [rec({ taxTrace: [ret.trace], balanceCents: 700 })], [], "2026-12-31");
    expect(r.rows.find((x) => x.key === "manual:1009")?.exogenaCents).toBe(200);
    expect(r.differenceCents).toBe(-200);
    expect(r.ready).toBe(false);
  });
  it("fuera del 31/12 nunca queda «listo»; el filtro por impuesto ignora los demás", () => {
    expect(taxReconciliation([ret], [rec({ taxTrace: [ret.trace], balanceCents: 500 })], [], "2026-11-30").ready).toBe(false);
    expect(taxReconciliation([ret, ivaFavor], [], [], "2026-12-31", "vat").rows.map((x) => x.taxType)).toEqual(["vat"]);
  });
});
