import { describe, expect, it } from "vitest";
import { TAX_PUC, type TaxReturn } from "../types";
import { periodsAffectedByPuc, returnView, versionsOf } from "./view";
import { taxEffects } from "./effects";

const base = { companyId: 1, taxType: "vat", year: 2026, period: 3, periodicity: "bimonthly", periodStart: "2026-05-01", periodEnd: "2026-06-30", supersededBy: null, payableCents: 0, favorCents: 0, resolution: "", payments: [], incomeOrdinaryCents: null, incomeLossCents: null, advanceNextCents: null } as unknown as TaxReturn;
const r = (over: Partial<TaxReturn>): TaxReturn => ({ ...base, id: 1, ...over });
const pay = (paymentDate: string, amountCents: number) => ({ id: 1, returnId: 1, paymentDate, amountCents, note: "", reference: "", excessCents: 0, excessKind: "" as const, excessReview: null, createdAt: "", updatedAt: "" });

describe("vista de una declaración a una fecha de corte", () => {
  it("saldo al corte = declarado − pagos con fecha ≤ corte; un pago posterior no reduce la obligación", () => {
    const x = r({ payableCents: 1000, payments: [pay("2026-07-10", 400), pay("2026-09-01", 600)] });
    expect(returnView(x, "2026-07-31", "bimonthly", [])).toMatchObject({ paidCents: 400, balanceCents: 600, status: "partial", balanceKind: "payable" });
    expect(returnView(x, "2026-07-09", "bimonthly", [])).toMatchObject({ paidCents: 0, balanceCents: 1000, status: "pending" });
    expect(returnView(x, "2026-09-30", "bimonthly", [])).toMatchObject({ paidCents: 1000, balanceCents: 0, status: "paid" });
  });

  it("la fecha de presentación nunca es fecha de pago: sin pagos el saldo sigue completo", () => {
    const x = r({ payableCents: 1000, detail: { presentedOn: "2026-07-12" } });
    expect(returnView(x, "2026-12-31", "bimonthly", []).balanceCents).toBe(1000);
  });

  it("periodo no terminado al corte: no hay saldo causado", () => {
    expect(returnView(r({ payableCents: 1000 }), "2026-06-15", "bimonthly", []).balanceCents).toBe(0);
  });

  it("saldo a favor: solo el de la foto vigente cuenta como saldo al corte", () => {
    const x = r({ favorCents: 700 });
    const effects = taxEffects({ returns: [x], puc: new Map([[TAX_PUC.vatFavor, "135515"]]), vatPeriodicity: "bimonthly" }, "2026-06-30").effects;
    expect(returnView(x, "2026-06-30", "bimonthly", effects)).toMatchObject({ balanceKind: "favor", balanceCents: 700 });
    expect(returnView(r({ id: 2, favorCents: 700, period: 2, periodStart: "2026-03-01", periodEnd: "2026-04-30" }), "2026-06-30", "bimonthly", effects)).toMatchObject({ balanceKind: "none", balanceCents: 0 });
  });
});

describe("correcciones y PUC", () => {
  it("las versiones del mismo periodo se agrupan; otro periodo no", () => {
    const a = r({ id: 1, supersededBy: 2 });
    const b = r({ id: 2 });
    const other = r({ id: 3, period: 4 });
    expect(versionsOf(b, [a, b, other]).map((x) => x.id)).toEqual([1, 2]);
  });

  it("cuenta periodos afectados por cada cuenta PUC sin configurar", () => {
    const list = [r({ id: 1, favorCents: 5 }), r({ id: 2, payableCents: 5, period: 2 }), r({ id: 3, favorCents: 5, supersededBy: 9, period: 1 })];
    expect(periodsAffectedByPuc(list, TAX_PUC.vatFavor)).toBe(1);
    expect(periodsAffectedByPuc(list, TAX_PUC.vatPayable)).toBe(1);
    expect(periodsAffectedByPuc(list, TAX_PUC.incomeFavor)).toBe(0);
  });

  it("el aviso de cuenta PUC sin configurar es uno solo aunque haya varias declaraciones", () => {
    const list = [r({ id: 1, payableCents: 5 }), r({ id: 2, payableCents: 5, period: 2, periodStart: "2026-03-01", periodEnd: "2026-04-30" })];
    const { issues } = taxEffects({ returns: list, puc: new Map(), vatPeriodicity: "bimonthly" }, "2026-12-31");
    expect(issues.filter((i) => i.message.includes("IVA por pagar"))).toHaveLength(1);
  });
});
