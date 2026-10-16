import { describe, expect, it } from "vitest";
import { TAX_PUC, sanctionExpenseKey, sanctionPayableKey, type ExcessKind, type TaxPayment, type TaxPeriodicity, type TaxReturn, type TaxType } from "../types";
import { whBreakdown, whPucKey } from "../withholding/detail";
import { excessFingerprint, obligationYear, periodRange, taxEffects, type TaxInput } from "./effects";
import { taxPucItems } from "./pucItems";

let nextId = 1;
function ret(taxType: TaxType, year: number, period: number | null, periodicity: TaxPeriodicity, extra: Partial<TaxReturn> = {}): TaxReturn {
  const { start, end } = periodRange(periodicity, year, period);
  return {
    id: nextId++, companyId: 1, taxType, year, period, periodicity, periodStart: start, periodEnd: end, formNumber: String(1000 + nextId), previousFormNumber: "", isCorrection: false, supersededBy: null,
    payableCents: 0, favorCents: 0, payments: [], resolution: "", nit: "", companyName: "", fileName: "", incomeOrdinaryCents: null, incomeLossCents: null, advanceNextCents: null,
    advanceTargetYear: taxType === "income" ? year + 1 : null, detail: {}, createdAt: "", updatedAt: "", events: [], ...extra,
  };
}

const pesos = (n: number) => n * 100;
/** Casillas del Formulario 350 de septiembre 2026 (caso real): Servicios PJ $941.000, casilla 129 $317.000, total $624.000. */
const casillas = (over: Record<string, number> = {}) => ({ "44": pesos(941_000), "97": 0, "129": pesos(317_000), "130": pesos(624_000), "137": 0, "138": pesos(624_000), ...over });
const wh = (c: Record<string, number>, extra: Partial<TaxReturn> = {}, manual?: TaxReturn["detail"]["manual"]) =>
  ret("withholding", 2026, 9, "monthly", { payableCents: c["138"], detail: { withholding: { casillas: c }, ...(manual && { manual }) }, ...extra });

const WH_PUC = new Map<string, string>([
  [whPucKey("services"), "236525"],
  [whPucKey("purchases"), "236540"],
  [whPucKey("self"), "236570"],
  [sanctionExpenseKey("withholding"), "531520"],
  [sanctionPayableKey("withholding"), "236595"],
  [TAX_PUC.interestExpense, "530520"],
  [TAX_PUC.excessFavor, "135515"],
  [TAX_PUC.vatPayable, "240801"],
  [TAX_PUC.vatFavor, "135517"],
  [TAX_PUC.incomePayable, "240405"],
  [TAX_PUC.incomeFavor, "135518"],
]);
const run = (returns: TaxReturn[], cut: string, puc = WH_PUC) => taxEffects({ returns, puc, vatPeriodicity: "bimonthly" } satisfies TaxInput, cut);
const adj = (conceptKey: string, pesosValue: number, id = conceptKey) => ({ id, conceptKey, cents: pesos(pesosValue), note: "" });

describe("Retefuente por concepto: PJ + PN en una sola fila", () => {
  it("suma personas jurídicas y naturales y conserva el detalle por casilla", () => {
    const b = whBreakdown(casillas({ "44": pesos(941_000), "97": pesos(59_000), "23": 0 }));
    const services = b.rows.find((r) => r.key === "services")!;
    expect([services.pjCents, services.pnCents, services.grossCents]).toEqual([pesos(941_000), pesos(59_000), pesos(1_000_000)]);
    expect(services.sources.filter((s) => s.kind === "retention").map((s) => [s.casilla, s.party])).toEqual([[44, "PJ"], [97, "PN"]]);
  });

  it("Servicios con PJ $941.000 y PN $0 es UNA fila de $941.000 y usa el PUC 236525", () => {
    const e = run([wh(casillas())], "2026-09-30");
    const line = e.effects.find((x) => x.conceptKey === "services");
    expect(line).toMatchObject({ pucKey: "tax.wh.services", pucCode: "236525" });
    expect(e.effects.filter((x) => x.conceptKey === "services")).toHaveLength(1);
  });
});

describe("casilla 129: devoluciones siempre negativas, distribuibles y parciales", () => {
  it("sin distribuir: la 129 queda pendiente (bloquea) y el concepto viaja por su valor positivo", () => {
    const e = run([wh(casillas())], "2026-09-30");
    expect(e.issues.find((i) => i.code === "undistributed_129")).toMatchObject({ level: "blocking" });
    expect(e.effects.find((x) => x.conceptKey === "services")!.cents).toBe(pesos(941_000));
  });

  it("distribución parcial: lo distribuido resta al concepto y el resto sigue pendiente", () => {
    const e = run([wh(casillas(), {}, { adjustments129: [adj("services", 100_000)] })], "2026-09-30");
    expect(e.effects.find((x) => x.conceptKey === "services")!.cents).toBe(pesos(841_000));
    expect(e.issues.find((i) => i.code === "undistributed_129")!.message).toContain("217.000");
  });

  it("distribución completa: retenciones positivas − 129 + sanciones = total declarado y lo que viaja suma el saldo a pagar", () => {
    const c = casillas();
    const manual = { adjustments129: [adj("services", 200_000, "a"), adj("purchases", 117_000, "b")] };
    const b = whBreakdown(c, manual);
    expect(b.positiveCents - b.casilla129Cents + b.sanctionCents).toBe(b.formTotalCents);
    expect(b.differenceCents).toBe(0);
    expect(b.undistributed129Cents).toBe(0);
    const e = run([wh(c, {}, manual)], "2026-09-30");
    expect(e.issues.some((i) => i.code === "undistributed_129")).toBe(false);
    // «Compras» no tiene retención positiva: la devolución deja el concepto en negativo (nota crédito de una factura anterior).
    expect(e.effects.find((x) => x.conceptKey === "purchases")!.cents).toBe(-pesos(117_000));
  });

  it("se pueden agregar filas aunque el formulario traiga 0 en la 129", () => {
    const b = whBreakdown(casillas({ "129": 0, "130": pesos(941_000), "138": pesos(941_000) }), { adjustments129: [adj("services", 50_000)] });
    expect(b.casilla129Cents).toBe(0);
    expect(b.rows.find((r) => r.key === "services")!.netCents).toBe(pesos(891_000));
  });
});

describe("autorretenciones: un único PUC para el total del periodo", () => {
  it("suma las casillas 68–76 y 121–128 en una fila con el detalle para auditoría", () => {
    const b = whBreakdown(casillas({ "129": 0, "44": 0, "59": pesos(10_000_000), "68": pesos(30_000), "70": pesos(20_000), "123": pesos(5_000), "138": pesos(55_000) }));
    const self = b.rows.find((r) => r.key === "self")!;
    expect(self.grossCents).toBe(pesos(55_000));
    expect(self.sources.map((s) => s.casilla)).toContain(59);
    const e = run([wh(casillas({ "129": 0, "44": 0, "68": pesos(30_000), "70": pesos(20_000), "138": pesos(50_000) }))], "2026-09-30");
    expect(e.effects.filter((x) => x.conceptKey === "self")).toEqual([expect.objectContaining({ pucCode: "236570", cents: pesos(50_000) })]);
  });
});

describe("ningún valor llega a EEFF sin PUC", () => {
  it("un concepto sin PUC queda pendiente (pucCode null) con un aviso accionable", () => {
    const puc = new Map(WH_PUC);
    puc.delete(whPucKey("services"));
    const e = run([wh(casillas({ "129": 0, "138": pesos(941_000) }))], "2026-09-30", puc);
    expect(e.effects.find((x) => x.conceptKey === "services")!.pucCode).toBeNull();
    expect(e.issues.find((i) => i.code === "puc_missing")).toMatchObject({ level: "blocking", pucKey: "tax.wh.services" });
  });

  it("las claves a configurar salen de los conceptos presentes (no se pide un PUC por tipo de tercero)", () => {
    const keys = taxPucItems("withholding", [wh(casillas({ "97": pesos(1_000) }))]).map((i) => i.key);
    expect(keys).toContain("tax.wh.services");
    expect(keys.filter((k) => k.startsWith("tax.wh."))).toHaveLength(1);
    expect(keys).toEqual(expect.arrayContaining([sanctionExpenseKey("withholding"), sanctionPayableKey("withholding"), TAX_PUC.interestExpense, TAX_PUC.excessFavor]));
  });

  it("el resultado fiscal (renta líquida / pérdida) también exige PUC", () => {
    const old = ret("income", 2025, null, "annual", { incomeOrdinaryCents: pesos(10_000_000) });
    const puc = new Map(WH_PUC);
    expect(run([old], "2026-06-30", puc).effects.find((x) => x.kind === "prior_results")!.pucCode).toBeNull();
    puc.set(TAX_PUC.priorResults, "370510");
    expect(run([old], "2026-06-30", puc).effects.find((x) => x.kind === "prior_results")!.pucCode).toBe("370510");
  });
});

describe("sanciones: gasto y cuenta por pagar", () => {
  const withSanction = () => wh(casillas({ "129": 0, "138": pesos(941_000 + 50_000), "137": pesos(50_000) }), { payableCents: pesos(991_000) });

  it("Retefuente (casilla 137): separa la sanción del total, con su gasto y su cuenta por pagar", () => {
    const e = run([withSanction()], "2026-09-30");
    expect(e.effects.find((x) => x.kind === "sanction_payable")).toMatchObject({ pucCode: "236595", cents: pesos(50_000) });
    expect(e.effects.find((x) => x.kind === "sanction_expense")).toMatchObject({ pucCode: "531520", cents: pesos(50_000), date: "2026-09-30" });
    expect(e.effects.filter((x) => x.kind.endsWith("payable")).reduce((n, x) => n + x.cents, 0)).toBe(pesos(991_000));
  });

  it("si falta alguno de los dos PUC, la sanción no se envía y hay un pendiente específico", () => {
    const puc = new Map(WH_PUC);
    puc.delete(sanctionExpenseKey("withholding"));
    const e = run([withSanction()], "2026-09-30", puc);
    expect(e.effects.find((x) => x.kind === "sanction_expense")!.pucCode).toBeNull();
    expect(e.effects.find((x) => x.kind === "sanction_payable")!.pucCode).toBe("236595");
    expect(e.issues.find((i) => i.pucKey === sanctionExpenseKey("withholding"))).toBeTruthy();
  });

  it("IVA y Renta separan la sanción cuando el formulario la discrimina", () => {
    const vat = ret("vat", 2026, 1, "bimonthly", { payableCents: pesos(1_100_000), detail: { values: { sanctions: { label: "Sanciones", cents: pesos(100_000), casilla: "87", expectedCasilla: null, foundBy: "label" } } } });
    const e = run([vat], "2026-03-01");
    expect(e.effects.find((x) => x.kind === "vat_payable")!.cents).toBe(pesos(1_000_000));
    expect(e.effects.find((x) => x.kind === "sanction_payable")!.cents).toBe(pesos(100_000));
    expect(e.effects.find((x) => x.kind === "sanction_expense")!.pucKey).toBe(sanctionExpenseKey("vat"));
  });

  it("un pago parcial baja la cuenta por pagar de la sanción pero no su gasto", () => {
    const r = withSanction();
    r.payments = [{ id: 1, returnId: r.id, paymentDate: "2026-10-10", amountCents: pesos(495_500), excessCents: 0, excessKind: "", excessReview: null, note: "", reference: "", createdAt: "", updatedAt: "" }];
    const e = run([r], "2026-10-31");
    expect(e.effects.find((x) => x.kind === "sanction_payable")!.cents).toBe(pesos(25_000));
    expect(e.effects.find((x) => x.kind === "sanction_expense")!.cents).toBe(pesos(50_000));
    expect(e.effects.filter((x) => x.kind.endsWith("payable")).reduce((n, x) => n + x.cents, 0)).toBe(pesos(495_500));
  });
});

describe("pagos por encima del saldo: intereses y excedentes", () => {
  const paid = (r: TaxReturn, kind: ExcessKind, review?: TaxPayment["excessReview"]): TaxReturn => ({
    ...r,
    payments: [{ id: 7, returnId: r.id, paymentDate: "2026-10-20", amountCents: r.payableCents, excessCents: pesos(30_000), excessKind: kind, excessReview: review ?? null, note: "", reference: "", createdAt: "", updatedAt: "" }],
  });
  const base = () => wh(casillas({ "129": 0, "138": pesos(941_000) }));

  it("interés: gasto con su PUC, sin Deudores ni 1008", () => {
    const e = run([paid(base(), "interest")], "2026-12-31");
    expect(e.effects.find((x) => x.kind === "interest_expense")).toMatchObject({ pucCode: "530520", cents: pesos(30_000), date: "2026-10-20" });
    expect(e.effects.some((x) => x.kind === "excess_favor")).toBe(false);
    expect(e.excessReviews).toHaveLength(0);
  });

  it("excedente a favor sin decisión: bloquea y no entra a EEFF/1008", () => {
    const e = run([paid(base(), "favor")], "2026-12-31");
    expect(e.excessReviews).toEqual([expect.objectContaining({ cents: pesos(30_000), needsReview: true, decision: null })]);
    expect(e.issues.find((i) => i.code === "excess_review")).toMatchObject({ level: "blocking" });
    expect(e.effects.some((x) => x.kind === "excess_favor")).toBe(false);
  });

  it("aprobado: entra como deudor con traza; no aplica: sale y no vuelve a preguntar", () => {
    const fp = excessFingerprint({ id: 7, paymentDate: "2026-10-20", excessCents: pesos(30_000), excessKind: "favor" }, "135515");
    const applies = run([paid(base(), "favor", { decision: "applies", fingerprint: fp, decidedAt: "x" })], "2026-12-31");
    expect(applies.effects.find((x) => x.kind === "excess_favor")).toMatchObject({ pucCode: "135515", cents: pesos(30_000), trace: expect.objectContaining({ kind: "excess_favor", paymentId: 7 }) });
    expect(applies.issues.some((i) => i.code === "excess_review")).toBe(false);
    const no = run([paid(base(), "favor", { decision: "not_applies", fingerprint: fp, decidedAt: "x" })], "2026-12-31");
    expect(no.effects.some((x) => x.kind === "excess_favor")).toBe(false);
    expect(no.excessReviews[0]).toMatchObject({ decision: "not_applies", needsReview: false });
    expect(no.issues.some((i) => i.code === "excess_review")).toBe(false);
  });

  it("si cambia el PUC o el valor, la decisión anterior deja de valer y se vuelve a preguntar", () => {
    const fp = excessFingerprint({ id: 7, paymentDate: "2026-10-20", excessCents: pesos(30_000), excessKind: "favor" }, "135515");
    const r = paid(base(), "favor", { decision: "not_applies", fingerprint: fp, decidedAt: "x" });
    const changedPuc = new Map(WH_PUC).set(TAX_PUC.excessFavor, "135599");
    expect(run([r], "2026-12-31", changedPuc).excessReviews[0]).toMatchObject({ stale: true, needsReview: true });
    r.payments[0].excessCents = pesos(31_000);
    expect(run([r], "2026-12-31").excessReviews[0]).toMatchObject({ stale: true, needsReview: true });
  });
});

describe("corriente / no corriente", () => {
  it("el año de la obligación frente al del corte decide la presentación (Retefuente, IVA y Renta)", () => {
    const whOld = ret("withholding", 2025, 12, "monthly", { payableCents: pesos(100_000) });
    const vatOld = ret("vat", 2025, 6, "bimonthly", { payableCents: pesos(200_000) });
    const incomeDeclared2026 = ret("income", 2025, null, "annual", { payableCents: pesos(300_000), detail: { presentedOn: "2026-04-10" } });
    const e = run([whOld, vatOld, incomeDeclared2026], "2026-12-31");
    expect(Object.fromEntries(e.effects.filter((x) => x.kind.endsWith("payable")).map((x) => [x.taxType, Boolean(x.noncurrent)]))).toEqual({ withholding: true, vat: true, income: false });
    // Al año siguiente la renta declarada en 2026 que sigue pendiente pasa a no corriente.
    expect(run([incomeDeclared2026], "2027-06-30").effects[0].noncurrent).toBe(true);
    expect(obligationYear(incomeDeclared2026)).toBe(2026);
  });

  it("los saldos a favor de años anteriores también son no corrientes", () => {
    const vatFavor = ret("vat", 2025, 6, "bimonthly", { favorCents: pesos(400_000) });
    const e = run([vatFavor], "2026-01-31");
    expect(e.effects.find((x) => x.kind === "vat_favor")!.noncurrent).toBe(true);
    const sameYear = ret("vat", 2026, 1, "bimonthly", { favorCents: pesos(400_000) });
    expect(run([sameYear], "2026-03-31").effects.find((x) => x.kind === "vat_favor")!.noncurrent).toBeFalsy();
  });

  it("el anticipo de EEFF 2026 es solo el de la renta 2025; el de la renta 2024 ya se consumió", () => {
    const dr2024 = ret("income", 2024, null, "annual", { advanceNextCents: pesos(80_000) });
    const dr2025 = ret("income", 2025, null, "annual", { advanceNextCents: pesos(120_000) });
    const adv = run([dr2024, dr2025], "2026-08-31").effects.filter((x) => x.kind === "income_advance");
    expect(adv.map((x) => x.cents)).toEqual([pesos(120_000)]);
  });
});
