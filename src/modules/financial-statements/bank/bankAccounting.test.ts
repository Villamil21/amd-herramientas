import { describe, expect, it } from "vitest";
import type { BankAccountLifecycle, BatchSummary, GmfRule } from "../../../types/fs";
import { bankAccountingCents } from "../generator/engine";
import { buildBankBatch, gmfAccountingCents, gmfRuleKey, gmfState, hasEarlierStatement, isGmfConcept, lifecycleQuestions, type AccountingConcept, type AccountingStatement } from "./bankAccounting";

const concept = (key: string, description: string, dc: "D" | "C", totalCents: number, count = 1): AccountingConcept => ({
  key,
  description,
  dc,
  count,
  totalCents,
  movements: [{ date: "2026-08-10", description, amountCents: dc === "D" ? -totalCents : totalCents }],
});

const statement = (concepts: AccountingConcept[], extra: Partial<AccountingStatement> = {}): AccountingStatement => ({
  bank: "BBVA",
  accountNumber: "0013007491",
  periodFrom: "2026-08-01",
  periodTo: "2026-08-31",
  openingBalanceCents: 1_000,
  closingBalanceCents: 2_000,
  concepts,
  ...extra,
});

const pesos = (n: number) => n * 100;

describe("GMF — detección por palabras clave", () => {
  it("reconoce las variantes de escritura del GMF / 4x1000", () => {
    for (const text of [
      "GMF",
      "Cobro gmf",
      "IMPUESTO 4X1000",
      "IMPTO 4 x 1000",
      "4 x 1.000",
      "4 POR MIL",
      "GRAVAMEN",
      "Gravamen Mov. Financieros",
      "IMPUESTO MOV FINANCIEROS",
      "IMPTO GOBIERNO MOVIMIENTOS FINANCIEROS",
    ])
      expect([text, isGmfConcept(text)]).toEqual([text, true]);
  });

  it("no convierte cualquier impuesto bancario en GMF", () => {
    for (const text of ["IVA COMISION", "IMPUESTO", "RETENCION EN LA FUENTE", "COMISION MOVIMIENTOS", "CUOTA MANEJO", "TRANSFERENCIA 41000"]) expect([text, isGmfConcept(text)]).toEqual([text, false]);
  });

  it("la decisión guardada (banco + concepto exacto) manda sobre la detección", () => {
    const rule = (concept: string, isGmf: boolean): [string, GmfRule] => [
      gmfRuleKey("BBVA", concept),
      { bank: "BBVA", concept, isGmf, origin: isGmf ? "auto" : "manual", confirmed: true, updatedAt: "" },
    ];
    const rules = new Map([rule("IMPUESTO MOV FINANCIEROS", false), rule("CARGO ESPECIAL", true)]);
    expect(gmfState("BBVA", "IMPUESTO MOV FINANCIEROS", rules)).toBe("rejected");
    expect(gmfState("BBVA", "CARGO ESPECIAL", rules)).toBe("confirmed");
    expect(gmfState("BBVA", "GRAVAMEN 4X1000", rules)).toBe("suggested");
    expect(gmfState("Bancolombia", "IMPUESTO MOV FINANCIEROS", rules)).toBe("suggested");
    expect(gmfState("BBVA", "COMISION", rules)).toBe("none");
  });
});

describe("GMF — 50 % del valor neto", () => {
  it("redondea al centavo y conserva el signo", () => {
    expect([gmfAccountingCents(pesos(80_000)), gmfAccountingCents(-pesos(30_000)), gmfAccountingCents(3), gmfAccountingCents(0)]).toEqual([pesos(40_000), -pesos(15_000), 2, 0]);
  });

  const decisions = { out: { destination: "send" as const, pucCode: "530505" }, in: { destination: "send" as const, pucCode: "530505" }, fee: { destination: "send" as const, pucCode: "530520" } };

  it("prueba 26 — salidas $120.000, devoluciones $20.000 → neto $100.000 → EEFF $50.000; el extracto se conserva", () => {
    const s = statement([
      concept("out", "IMPUESTO MOV FINANCIEROS", "D", pesos(120_000), 30),
      concept("in", "IMPUESTO MOV FINANCIEROS", "C", pesos(20_000), 2),
      concept("fee", "COMISION", "D", pesos(9_000)),
    ]);
    const batch = buildBankBatch(1, s, "Agosto.pdf", decisions, "111005", new Map([["IMPUESTO MOV FINANCIEROS", "auto"]]));
    const gmf = batch.movements.find((m) => m.conceptKey === "bank.gmf")!;
    expect(batch.movements).toHaveLength(2);
    expect([gmf.amountCents, gmf.dc, gmf.pucCode]).toEqual([pesos(50_000), "D", "530505"]);
    // Gasto (naturaleza débito): +$50.000 en los Estados Financieros.
    expect(bankAccountingCents(gmf.dc!, gmf.amountCents, true)).toBe(pesos(50_000));
    expect((gmf.detail as { gmf: unknown }).gmf).toEqual({
      confirmed: true,
      origin: "auto",
      percent: 50,
      outflowCents: pesos(120_000),
      inflowCents: pesos(20_000),
      originalNetCents: pesos(100_000),
      accountingCents: pesos(50_000),
    });
    expect((gmf.detail as { movements: unknown[]; count: number }).movements).toHaveLength(2);
    expect((gmf.detail as { count: number }).count).toBe(32);
    // La otra mitad no va a ninguna cuenta: no hay contrapartida inventada.
    expect(batch.movements.find((m) => m.description === "COMISION")!.amountCents).toBe(pesos(9_000));
    expect(batch.bankConceptMappings!.filter((m) => m.concept === "IMPUESTO MOV FINANCIEROS")).toHaveLength(2);
  });

  it("devoluciones mayores que los cargos: neto −$30.000 → EEFF −$15.000", () => {
    const s = statement([concept("out", "GMF", "D", pesos(20_000)), concept("in", "GMF", "C", pesos(50_000))]);
    const gmf = buildBankBatch(1, s, "x.pdf", decisions, "111005", new Map([["GMF", "manual"]])).movements[0];
    expect([gmf.amountCents, gmf.dc]).toEqual([pesos(15_000), "C"]);
    expect(bankAccountingCents(gmf.dc!, gmf.amountCents, true)).toBe(-pesos(15_000));
  });

  it("prueba 27 — sin GMF confirmado (Quitar GMF) no se aplica el 50 %", () => {
    const s = statement([concept("out", "IMPUESTO MOV FINANCIEROS", "D", pesos(120_000)), concept("in", "IMPUESTO MOV FINANCIEROS", "C", pesos(20_000))]);
    const batch = buildBankBatch(1, s, "x.pdf", decisions, "111005");
    expect(batch.movements.map((m) => [m.amountCents, m.dc])).toEqual([
      [pesos(120_000), "D"],
      [pesos(20_000), "C"],
    ]);
  });
});

describe("apertura y cierre de cuentas — siempre con confirmación", () => {
  const life = (extra: Partial<BankAccountLifecycle> = {}): BankAccountLifecycle => ({
    companyId: 1,
    bank: "BBVA",
    accountNumber: "0013007491",
    openedPeriod: null,
    closedPeriod: null,
    status: "active",
    updatedAt: "",
    events: [],
    ...extra,
  });
  const earlier: BatchSummary = {
    id: 1,
    companyId: 1,
    source: "bank",
    fileName: "",
    periodLabel: "",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    dedupeKey: "",
    recordCount: 1,
    totalCents: 0,
    status: "active",
    replacedBy: null,
    metadata: { bank: "BBVA", accountNumber: "0013007491" },
    createdAt: "",
  };

  it("prueba 22 — saldo final 0 pregunta por el cierre (sin asumirlo)", () => {
    expect(lifecycleQuestions(statement([], { periodFrom: "2026-06-01", periodTo: "2026-06-30", closingBalanceCents: 0 }), null, true)).toEqual([{ kind: "closed", period: "2026-06" }]);
  });

  it("prueba 23 — «No, sigue activa» no vuelve a preguntar por ese mes", () => {
    const answered = life({ events: [{ bank: "BBVA", accountNumber: "0013007491", action: "kept_active", period: "2026-03", note: "", previous: null, createdAt: "" }] });
    const march = statement([], { periodFrom: "2026-03-01", periodTo: "2026-03-31", closingBalanceCents: 0 });
    expect(lifecycleQuestions(march, answered, true)).toEqual([]);
    expect(lifecycleQuestions({ ...march, periodFrom: "2026-04-01", periodTo: "2026-04-30" }, answered, true)).toEqual([{ kind: "closed", period: "2026-04" }]);
  });

  it("prueba 24 — saldo inicial 0 sin extractos anteriores pregunta por la apertura", () => {
    const april = statement([], { periodFrom: "2026-04-01", periodTo: "2026-04-30", openingBalanceCents: 0 });
    expect(hasEarlierStatement(april, [])).toBe(false);
    expect(lifecycleQuestions(april, null, false)).toEqual([{ kind: "opened", period: "2026-04" }]);
    expect(lifecycleQuestions(april, life({ openedPeriod: "2026-04" }), false)).toEqual([]);
  });

  it("prueba 25 — saldo inicial 0 con historial anterior NO pregunta si es nueva", () => {
    const april = statement([], { periodFrom: "2026-04-01", periodTo: "2026-04-30", openingBalanceCents: 0 });
    expect(hasEarlierStatement(april, [earlier])).toBe(true);
    expect(lifecycleQuestions(april, null, hasEarlierStatement(april, [earlier]))).toEqual([]);
    // Un extracto anulado u otra cuenta no cuentan como historial.
    expect(
      hasEarlierStatement(april, [
        { ...earlier, status: "voided" },
        { ...earlier, metadata: { bank: "BBVA", accountNumber: "999" } },
      ]),
    ).toBe(false);
  });
});
