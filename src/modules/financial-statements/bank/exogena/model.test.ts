import { describe, expect, it } from "vitest";
import type { ExoRecord, FormatStatusRow } from "../../../../types/exogena";
import type { BankAccountLifecycle, BankExoReview, BankProfile, BatchSummary, GmfRule, InterestRule } from "../../../../types/fs";
import type { CryptoModel } from "../../crypto/domain/model";
import { buildExportWorkbook } from "../../../exogena/domain/exportWorkbook";
import { cryptoFormatState } from "../../../exogena/domain/cryptoFormat";
import { bankFormatState } from "../../../exogena/domain/bankFormat";
import { pendingChanges } from "../../../exogena/domain/pending";
import { blocking } from "../../../exogena/domain/problems";
import { payrollFormatState } from "../../../exogena/domain/payrollFormat";
import { lastDayOfMonth } from "../../shared/money";
import { buildBankBatch, exogenaPayload, type AccountingStatement, type ExoConcept } from "../bankAccounting";
import { buildBankExo, buildBankExoContribution, bankKeyOf, canonical, toExoStatements, type BankExoInput } from "./model";
import { bankExoPath, parseBankExoFocus } from "./paths";

const YEAR = 2025;
const INTEREST = "ABONO INTERESES AHORROS";
const GMF = "IMPUESTO GMF";

let seq = 0;
const mv = (date: string, description: string, amountCents: number) => ({ date, description, amountCents });
const interest = (cents: number, month = "01"): ExoConcept => ({ description: INTEREST, dc: "C", count: 1, totalCents: cents, movements: [mv(`${YEAR}-${month}-28`, INTEREST, cents)] });
const gmf = (cents: number, count = 3): ExoConcept => ({ description: GMF, dc: "D", count, totalCents: cents, movements: [mv(`${YEAR}-01-15`, GMF, -cents)] });
const transfer = (cents: number): ExoConcept => ({ description: "TRANSFERENCIA RECIBIDA", dc: "C", count: 1, totalCents: cents, movements: [mv(`${YEAR}-01-10`, "TRANSFERENCIA RECIBIDA", cents)] });

interface StatementOptions {
  bank?: string;
  account?: string;
  month: string;
  closing?: number | null;
  status?: BatchSummary["status"];
  replacedBy?: number | null;
  concepts?: ExoConcept[] | null;
  periodEnd?: string;
  id?: number;
  from?: string;
}

function statement(o: StatementOptions): BatchSummary {
  const id = o.id ?? ++seq;
  const bank = o.bank ?? "Bancolombia";
  const closing = o.closing === undefined ? 1_000_00 : o.closing;
  return {
    id,
    companyId: 1,
    source: "bank",
    fileName: `${bank} ${o.month}.pdf`,
    periodLabel: "",
    periodStart: o.from ?? `${o.month}-01`,
    periodEnd: o.periodEnd ?? lastDayOfMonth(o.month),
    dedupeKey: `bank:${bank}:${o.account ?? "111"}:${o.month}`,
    recordCount: 0,
    totalCents: 0,
    status: o.status ?? "active",
    replacedBy: o.replacedBy ?? null,
    metadata: {
      bank,
      accountNumber: o.account ?? "111",
      movementCount: 3,
      openingBalanceCents: 0,
      ...(closing === null ? {} : { closingBalanceCents: closing }),
      ...(o.concepts === null ? {} : { exogena: { version: 1, concepts: o.concepts ?? [] } }),
    },
    createdAt: `2026-01-${String((id % 28) + 1).padStart(2, "0")}T10:00:00Z`,
  };
}

const monthsOf = (n: number) => Array.from({ length: n }, (_, i) => `${YEAR}-${String(i + 1).padStart(2, "0")}`);
/** Los 12 meses del año con los conceptos que se indiquen en cada uno. */
const fullYear = (o: Omit<StatementOptions, "month">, perMonth: (month: string) => ExoConcept[] = () => []) => monthsOf(12).map((month) => statement({ ...o, month, concepts: perMonth(month) }));

const profile = (bank = "Bancolombia", nit = "890903938"): BankProfile => ({ bankKey: bankKeyOf(bank), bank, nit, dv: "8", businessName: `${bank.toUpperCase()} S.A.`, docTypeCode: "31", countryCode: "169", updatedAt: "x" });
const gmfRule = (bank: string, concept = GMF, isGmf = true): GmfRule => ({ bank, concept, isGmf, origin: "manual", confirmed: true, updatedAt: "x" });
const interestRule = (bank: string, concept = INTEREST, isInterest = true): InterestRule => ({ bank, concept, isInterest, origin: "manual", confirmed: true, updatedAt: "x" });
const lifecycle = (bank: string, accountNumber: string, closedPeriod: string | null, openedPeriod: string | null = null): BankAccountLifecycle => ({ companyId: 1, bank, accountNumber, openedPeriod, closedPeriod, status: closedPeriod ? "closed" : "active", updatedAt: "x", events: [] });
const review = (reviewKey: string, decision: "include" | "exclude" = "include"): BankExoReview => ({ companyId: 1, year: YEAR, reviewKey, decision, note: "", updatedAt: "x" });

const run = (batches: BatchSummary[], extra: Partial<BankExoInput> = {}) =>
  buildBankExo({
    companyId: 1,
    year: YEAR,
    batches,
    profiles: [profile("Bancolombia"), profile("BBVA", "860003020")],
    gmfRules: [gmfRule("Bancolombia"), gmfRule("BBVA")],
    interestRules: [interestRule("Bancolombia"), interestRule("BBVA")],
    lifecycles: [],
    reviews: [],
    ...extra,
  });

const codes = (r: ReturnType<typeof run>) => r.alerts.map((a) => a.code);

describe("ficha del banco: se configura una vez y se reutiliza", () => {
  it("el mismo banco usa su ficha en cualquier empresa, año y extracto; sin ficha no se inventa nada", () => {
    const batches = [statement({ month: `${YEAR}-12`, concepts: [] })];
    const a = run(batches);
    const b = buildBankExo({ companyId: 99, year: YEAR, batches, profiles: [profile()], gmfRules: [], interestRules: [], lifecycles: [], reviews: [] });
    expect(a.records["1012"][0].data).toMatchObject({ docNumber: "890903938", dv: "8", businessName: "BANCOLOMBIA S.A.", docTypeCode: "31", countryCode: "169" });
    expect(b.records["1012"][0].data).toMatchObject({ docNumber: "890903938", dv: "8" });

    const sin = run(batches, { profiles: [] });
    expect(sin.records["1012"]).toEqual([]);
    const alert = sin.alerts.find((x) => x.code === "profile-missing")!;
    expect(alert).toMatchObject({ severity: "block", dests: ["1012"] });
    expect(alert.actions[0].label).toContain("Configurar ficha de Bancolombia");
    expect(sin.status["1012"]).toBe("block");
  });

  it("la clave del banco ignora mayúsculas y espacios repetidos", () => {
    expect(bankKeyOf("  Iris   bank ")).toBe("IRIS BANK");
    const batches = [statement({ bank: "Iris Bank", month: `${YEAR}-12`, concepts: [] })];
    expect(run(batches, { profiles: [profile("IRIS BANK", "900000001")] }).records["1012"]).toHaveLength(1);
  });
});

describe("1012: saldo del extracto de diciembre", () => {
  it("usa el saldo final de diciembre (nunca el de otro mes) y fija concepto, tipo de documento, DV y país", () => {
    const r = run([statement({ month: `${YEAR}-11`, closing: 9_999_00 }), statement({ month: `${YEAR}-12`, closing: 123_456_789 })]);
    expect(r.records["1012"]).toHaveLength(1);
    const rec = r.records["1012"][0];
    expect(rec.sourceKey).toBe("banco-1012:BANCOLOMBIA");
    expect(rec.data).toMatchObject({ concept: "1110", docTypeCode: "31", docNumber: "890903938", dv: "8", businessName: "BANCOLOMBIA S.A.", countryCode: "169", balance: 1_234_568, exactCents: { balance: 123_456_789 } });
    expect(rec.data.audit).toMatchObject({ usedMonth: `${YEAR}-12`, substitutedByOtherMonth: false, totalCents: 123_456_789 });
    expect(r.audit.f1012[0].accounts[0]).toMatchObject({ month: `${YEAR}-12`, closingBalanceCents: 123_456_789 });
    expect(r.status["1012"]).toBe("ready");
  });

  it("si el extracto de diciembre cambió por un reemplazo, vale el vigente y queda la traza", () => {
    const old = statement({ id: 500, month: `${YEAR}-12`, closing: 50_00, status: "replaced", replacedBy: 501 });
    const current = statement({ id: 501, month: `${YEAR}-12`, closing: 70_00 });
    const r = run([old, current]);
    expect(r.records["1012"][0].data.exactCents).toEqual({ balance: 70_00 });
    expect(r.audit.f1012[0].accounts[0]).toMatchObject({ batchId: 501, replacedBatchIds: [500] });
  });

  it("sin extracto de diciembre en una cuenta activa NO inventa el saldo: bloquea solo el 1012 e indica banco, cuenta y mes", () => {
    const r = run(fullYear({}, () => [interest(1_000)]).slice(0, 11));
    expect(r.records["1012"]).toEqual([]);
    const missing = r.alerts.find((a) => a.code === "december-missing")!;
    expect(missing).toMatchObject({ severity: "block", dests: ["1012"], ref: { bank: "Bancolombia", account: "111", month: `${YEAR}-12` } });
    expect(missing.title).toContain("Bancolombia ••••111".replace("••••111", "••••111"));
    expect(missing.title).toContain(`diciembre de ${YEAR}`);
    expect(r.status["1012"]).toBe("block");
    // 1007 y 1011 no se detienen por esto: siguen con los meses importados (solo un aviso).
    expect(r.status["1007"]).not.toBe("block");
    expect(r.status["1011"]).not.toBe("block");
    expect(blocking(buildBankExoContribution({ companyId: 1, year: YEAR, batches: fullYear({}, () => [interest(1_000)]).slice(0, 11), profiles: [profile()], gmfRules: [], interestRules: [interestRule("Bancolombia")], lifecycles: [], reviews: [] }).problems["1007"])).toEqual([]);
  });

  it("una cuenta cerrada en junio no aparece en el 1012 (ni con saldo de junio ni en cero), pero sus intereses sí van al 1007", () => {
    const june = monthsOf(6).map((m) => statement({ month: m, closing: m === `${YEAR}-06` ? 0 : 5_000_00, concepts: [interest(2_500)] }));
    const r = run(june, { lifecycles: [lifecycle("Bancolombia", "111", `${YEAR}-06`)] });
    expect(r.records["1012"]).toEqual([]);
    expect(codes(r)).not.toContain("december-missing");
    expect(r.status["1012"]).toBe("ready");
    expect(r.banks[0].accounts[0].december.state).toBe("closed");
    expect(r.records["1007"]).toHaveLength(1);
    expect(r.records["1007"][0].data).toMatchObject({ concept: "4003", grossIncome: 150, returns: 0, exactCents: { grossIncome: 15_000 } });
  });

  it("un sobregiro, un extracto de diciembre que no llega al 31 o un saldo sin dato no se clasifican en silencio", () => {
    const over = run([statement({ month: `${YEAR}-12`, closing: -300_00 })]);
    expect(over.records["1012"]).toEqual([]);
    const alert = over.alerts.find((a) => a.code === "overdraft")!;
    expect(alert).toMatchObject({ severity: "pending", dests: ["1012"], review: { key: `overdraft:BANCOLOMBIA|111|${YEAR}-12` } });
    expect(over.status["1012"]).toBe("pending");
    // Revisado: incluir lo deja en el formato; excluir lo saca sin bloquear.
    const incl = run([statement({ month: `${YEAR}-12`, closing: -300_00 })], { reviews: [review(alert.review!.key)] });
    expect(incl.records["1012"][0].data.exactCents).toEqual({ balance: -300_00 });
    expect(incl.status["1012"]).toBe("ready");
    const excl = run([statement({ month: `${YEAR}-12`, closing: -300_00 })], { reviews: [review(alert.review!.key, "exclude")] });
    expect(excl.records["1012"]).toEqual([]);
    expect(excl.status["1012"]).toBe("ready");

    const partial = run([statement({ month: `${YEAR}-12`, periodEnd: `${YEAR}-12-15` })]);
    expect(codes(partial)).toContain("partial-december");
    expect(partial.records["1012"]).toEqual([]);

    const noBalance = run([statement({ month: `${YEAR}-12`, closing: null })]);
    expect(noBalance.alerts.find((a) => a.code === "december-no-balance")).toMatchObject({ severity: "block", dests: ["1012"] });
  });

  it("un extracto sin banco asociado bloquea los tres formatos y no forma cuenta", () => {
    const orphan = statement({ month: `${YEAR}-12` });
    orphan.metadata = { ...orphan.metadata, bank: "" };
    const r = run([orphan]);
    expect(r.alerts.find((a) => a.code === "no-bank")).toMatchObject({ severity: "block", dests: ["1012", "1007", "1011"] });
    expect(r.banks).toEqual([]);
  });
});

describe("varios bancos y varias cuentas", () => {
  const batches = [
    statement({ id: 1, bank: "Bancolombia", account: "111", month: `${YEAR}-12`, closing: 1_000_00, concepts: [interest(100_00), gmf(40_00)] }),
    statement({ id: 2, bank: "Bancolombia", account: "222", month: `${YEAR}-12`, closing: 2_500_00, concepts: [interest(50_00), gmf(60_00)] }),
    statement({ id: 3, bank: "BBVA", account: "999", month: `${YEAR}-12`, closing: 7_000_00, concepts: [interest(25_00), gmf(100_00)] }),
  ];

  it("1012 y 1007 agrupan por banco (suman cuentas) y el 1011 es UNA sola fila de la empresa", () => {
    const r = run(batches);
    const byKey = Object.fromEntries(r.records["1012"].map((p) => [p.sourceKey, p.data]));
    expect(byKey["banco-1012:BANCOLOMBIA"]).toMatchObject({ balance: 3_500, docNumber: "890903938" });
    expect(byKey["banco-1012:BBVA"]).toMatchObject({ balance: 7_000, docNumber: "860003020" });
    expect((byKey["banco-1012:BANCOLOMBIA"].audit as { accounts: unknown[] }).accounts).toHaveLength(2);

    const i = Object.fromEntries(r.records["1007"].map((p) => [p.sourceKey, p.data]));
    expect(i["banco-1007:BANCOLOMBIA"]).toMatchObject({ grossIncome: 150 });
    expect(i["banco-1007:BBVA"]).toMatchObject({ grossIncome: 25 });

    // GMF 40 + 60 + 100 = 200 → 50 % = 100.
    expect(r.records["1011"]).toHaveLength(1);
    expect(r.records["1011"][0]).toMatchObject({ sourceKey: "banco-1011:8211", data: { concept: "8211", balance: 100 } });
    expect(r.audit.f1011.banks.map((b) => b.bank).sort()).toEqual(["BBVA", "Bancolombia"]);
  });
});

describe("1007: intereses de todos los meses", () => {
  it("suma los intereses de los 12 meses y no confunde abonos, transferencias ni consignaciones con intereses", () => {
    const r = run(fullYear({ closing: 1_000_00 }, () => [interest(1_000_50), transfer(5_000_000_00)]));
    expect(r.records["1007"]).toHaveLength(1);
    // 12 × 1.000,50 = 12.006,00
    expect(r.records["1007"][0].data).toMatchObject({ concept: "4003", docTypeCode: "31", docNumber: "890903938", dv: "8", countryCode: "169", grossIncome: 12_006, returns: 0 });
    const audit = r.audit.f1007[0];
    expect(audit.months).toHaveLength(12);
    expect(audit.months[0]).toMatchObject({ month: `${YEAR}-01`, cents: 1_000_50 });
    expect(audit.months.every((m) => m.items.every((it) => it.concept === INTEREST))).toBe(true);
    expect(audit.totalCents).toBe(12_006_00);
  });

  it("un concepto que solo parece interés no entra hasta que se confirma por banco y concepto", () => {
    const batches = [statement({ month: `${YEAR}-12`, concepts: [interest(500_00)] })];
    const sugerido = run(batches, { interestRules: [] });
    expect(sugerido.records["1007"]).toEqual([]);
    const alert = sugerido.alerts.find((a) => a.code === "interest-suggested")!;
    expect(alert).toMatchObject({ severity: "pending", dests: ["1007"] });
    expect(sugerido.status["1007"]).toBe("pending");
    // Rechazado: no es interés y no vuelve a preguntar.
    const no = run(batches, { interestRules: [interestRule("Bancolombia", INTEREST, false)] });
    expect(no.records["1007"]).toEqual([]);
    expect(codes(no)).not.toContain("interest-suggested");
    // Una transferencia nunca se sugiere como interés.
    expect(codes(run([statement({ month: `${YEAR}-12`, concepts: [transfer(100_00)] })], { interestRules: [] }))).not.toContain("interest-suggested");
    // Una salida «intereses» (costo financiero) tampoco.
    const cost: ExoConcept = { description: "INTERESES CREDITO", dc: "D", count: 1, totalCents: 10_00, movements: [] };
    expect(codes(run([statement({ month: `${YEAR}-12`, concepts: [cost] })], { interestRules: [] }))).not.toContain("interest-suggested");
  });
});

describe("1011: GMF anual con el 50 % aplicado una sola vez", () => {
  it("aplica el 50 % exacto al total anual (no por extracto) y lo redondea a pesos una sola vez", () => {
    // 12 × 1.000,50 = 12.006,00 de GMF; 50 % = 6.003 (por extracto, redondeado cada vez, daría 6.000).
    const r = run(fullYear({}, () => [gmf(1_000_50)]));
    expect(r.records["1011"]).toHaveLength(1);
    expect(r.records["1011"][0].data).toMatchObject({ concept: "8211", balance: 6_003 });
    expect(r.audit.f1011).toMatchObject({ grossCents: 1_200_600, percent: 50, reportedCents: 600_300, reportedPesos: 6_003 });
    expect(r.audit.f1011.banks[0].months).toHaveLength(12);
  });

  it("redondea la mitad hacia arriba solo al final (44.444,935 → 44.445)", () => {
    const r = run([statement({ month: `${YEAR}-01`, concepts: [gmf(1_234_567)] }), statement({ month: `${YEAR}-02`, concepts: [gmf(7_654_321)] }), statement({ month: `${YEAR}-03`, concepts: [gmf(99)] })]);
    expect(r.audit.f1011.grossCents).toBe(8_888_987);
    expect(r.records["1011"][0].data.balance).toBe(44_445);
  });

  it("un movimiento que parece GMF sin confirmar se muestra como pendiente y no se incluye", () => {
    const suspicious: ExoConcept = { description: "GRAVAMEN MOVIMIENTOS FINANCIEROS ESPECIAL", dc: "D", count: 1, totalCents: 999_00, movements: [] };
    const r = run([statement({ month: `${YEAR}-12`, concepts: [gmf(40_00), suspicious] })]);
    expect(r.audit.f1011.grossCents).toBe(40_00);
    expect(r.alerts.find((a) => a.code === "gmf-suggested")).toMatchObject({ severity: "pending", dests: ["1011"] });
    expect(r.status["1011"]).toBe("pending");
    // Un concepto sin ninguna pinta de GMF se ignora sin alertas.
    expect(codes(run([statement({ month: `${YEAR}-12`, concepts: [transfer(1_00)] })]))).not.toContain("gmf-suggested");
  });

  it("sin GMF no hay fila 8211 y las devoluciones mayores que los cobros se revisan antes de incluirse", () => {
    expect(run([statement({ month: `${YEAR}-12`, concepts: [] })]).records["1011"]).toEqual([]);
    const refund: ExoConcept = { description: GMF, dc: "C", count: 1, totalCents: 10_00, movements: [] };
    const r = run([statement({ month: `${YEAR}-12`, concepts: [refund] })]);
    expect(r.alerts.find((a) => a.code === "gmf-negative")).toMatchObject({ severity: "pending", dests: ["1011"] });
    expect(r.records["1011"]).toEqual([]);
  });
});

describe("reimportación y reemplazo sin duplicar valores", () => {
  it("un extracto reemplazado no suma: solo cuenta el vigente (una vez)", () => {
    const old = statement({ id: 10, month: `${YEAR}-01`, status: "replaced", replacedBy: 11, concepts: [interest(900_00), gmf(90_00)] });
    const current = statement({ id: 11, month: `${YEAR}-01`, concepts: [interest(100_00), gmf(10_00)] });
    const voided = statement({ id: 12, month: `${YEAR}-02`, status: "voided", concepts: [interest(777_00)] });
    const r = run([old, current, voided]);
    expect(r.audit.f1007[0].totalCents).toBe(100_00);
    expect(r.audit.f1011.grossCents).toBe(10_00);
    expect(r.banks[0].accounts[0].cells[0]).toMatchObject({ state: "loaded" });
    expect(r.banks[0].accounts[0].cells[0].history.map((s) => s.batchId)).toEqual([10]);
    // El mes del extracto anulado vuelve a «pendiente» (no se ve cargado).
    expect(r.banks[0].accounts[0].cells[1].state).toBe("voided");
  });

  it("dos extractos vigentes que cubren el mismo mes de la misma cuenta bloquean (no se elige uno ni se suman dos veces)", () => {
    const a = statement({ id: 20, month: `${YEAR}-03`, concepts: [interest(100_00)] });
    const b = { ...statement({ id: 21, month: `${YEAR}-03`, concepts: [interest(100_00)] }), dedupeKey: "otro" };
    const r = run([a, b]);
    const alert = r.alerts.find((x) => x.code === "overlap")!;
    expect(alert).toMatchObject({ severity: "block", dests: ["1007", "1011"] });
    expect(alert.why).toContain("#20");
    expect(r.status["1007"]).toBe("block");
  });

  it("calcular dos veces desde lo mismo da las mismas claves y valores", () => {
    const batches = fullYear({}, () => [interest(1_000), gmf(500)]);
    const first = run(batches);
    const second = run(batches);
    expect(second.records).toEqual(first.records);
    const stored = (list: typeof first.records["1007"]): ExoRecord[] => list.map((p, i) => ({ id: i, companyId: 1, year: YEAR, formatCode: "1007", sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: p.data, manualFields: [], manuallyModifiedAt: null, syncedAt: null, createdAt: "x", updatedAt: "x" }));
    expect(pendingChanges(stored(first.records["1007"]), second.records["1007"])).toEqual([]);
  });
});

describe("persistencia: reinicio y respaldo", () => {
  const batches = [...fullYear({ closing: 2_000_00 }, () => [interest(1_000), gmf(500)]), ...fullYear({ bank: "BBVA", account: "999", closing: 9_000_00 }, () => [interest(7_00)])];
  const input: BankExoInput = { companyId: 1, year: YEAR, batches, profiles: [profile(), profile("BBVA", "860003020")], gmfRules: [gmfRule("Bancolombia")], interestRules: [interestRule("Bancolombia"), interestRule("BBVA")], lifecycles: [lifecycle("Bancolombia", "111", null, `${YEAR}-01`)], reviews: [] };

  it("el resultado sale solo de lo guardado: una copia serializada (como el respaldo) da exactamente lo mismo", () => {
    const restored = JSON.parse(JSON.stringify(input)) as BankExoInput;
    expect(buildBankExo(restored)).toEqual(buildBankExo(input));
  });

  it("lo que vuelve de SQLite (claves en orden alfabético) no genera cambios fantasma", () => {
    const result = buildBankExo(input);
    const sortedKeysRoundtrip = (v: unknown) => JSON.parse(JSON.stringify(canonical(v)));
    for (const format of ["1012", "1007", "1011"] as const) {
      const stored: ExoRecord[] = result.records[format].map((p, i) => ({ id: i, companyId: 1, year: YEAR, formatCode: format, sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: sortedKeysRoundtrip(p.data), manualFields: [], manuallyModifiedAt: null, syncedAt: "x", createdAt: "x", updatedAt: "x" }));
      expect(pendingChanges(stored, result.records[format])).toEqual([]);
    }
  });

  it("al cambiar el origen (un extracto reemplazado) el registro guardado queda «desactualizado»", () => {
    const first = buildBankExoContribution(input);
    const stored: ExoRecord[] = first.proposals["1012"].map((p, i) => ({ id: i, companyId: 1, year: YEAR, formatCode: "1012", sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: p.data, manualFields: [], manuallyModifiedAt: null, syncedAt: "x", createdAt: "x", updatedAt: "x" }));
    expect(bankFormatState("1012", first, stored).problems).toEqual([]);
    const replaced = input.batches.map((b) => (b.metadata?.accountNumber === "111" && b.periodEnd === `${YEAR}-12-31` ? { ...b, metadata: { ...b.metadata, closingBalanceCents: 3_000_00 } } : b));
    const next = buildBankExoContribution({ ...input, batches: replaced });
    const state = bankFormatState("1012", next, stored);
    expect(state.changes.map((c) => c.kind)).toEqual(["changed"]);
    expect(blocking(state.problems).map((p) => p.message)).toEqual([expect.stringContaining("desactualizado")]);
  });

  it("un extracto enviado antes de existir los datos de Exógena no se calcula a ciegas: pide reimportarlo y no bloquea el 1012", () => {
    const old = statement({ month: `${YEAR}-12`, concepts: null });
    const r = run([old]);
    expect(r.alerts.find((a) => a.code === "legacy-statement")).toMatchObject({ severity: "block", dests: ["1007", "1011"] });
    expect(r.records["1012"]).toHaveLength(1);
    expect(r.status["1012"]).toBe("ready");
  });

  it("buildBankBatch guarda TODOS los conceptos del extracto para Exógena, vayan o no a Estados Financieros", () => {
    const st: AccountingStatement = {
      bank: "Bancolombia",
      accountNumber: "111",
      periodFrom: `${YEAR}-12-01`,
      periodTo: `${YEAR}-12-31`,
      movementCount: 3,
      openingBalanceCents: 0,
      closingBalanceCents: 1_000_00,
      concepts: [
        { key: "a", description: INTEREST, dc: "C", count: 1, totalCents: 100_00, movements: [{ date: `${YEAR}-12-30`, description: INTEREST, amountCents: 100_00 }] },
        { key: "b", description: GMF, dc: "D", count: 2, totalCents: 8_00, movements: [] },
      ],
    };
    const batch = buildBankBatch(1, st, "dic.pdf", { a: { destination: "skip" }, b: { destination: "skip" } }, "111005");
    const meta = batch.metadata as { exogena: unknown; closingBalanceCents: number };
    expect(meta.exogena).toEqual(exogenaPayload(st));
    expect(toExoStatements([{ id: 1, companyId: 1, source: "bank", fileName: "dic.pdf", periodLabel: "", periodStart: batch.periodStart!, periodEnd: batch.periodEnd!, dedupeKey: "", recordCount: 0, totalCents: 0, status: "active", replacedBy: null, metadata: batch.metadata as Record<string, unknown>, createdAt: "x" }])[0].payload?.concepts).toHaveLength(2);
  });
});

describe("cobertura por empresa, banco, cuenta y mes", () => {
  it("cada mes distingue cargado, reemplazado, anulado, pendiente y no aplica, y cada banco queda completo, parcial o faltante", () => {
    const batches = [
      ...fullYear({ account: "111" }),
      statement({ id: 900, bank: "BBVA", account: "999", month: `${YEAR}-01`, status: "replaced", replacedBy: 901 }),
      statement({ id: 901, bank: "BBVA", account: "999", month: `${YEAR}-01` }),
      statement({ id: 902, bank: "BBVA", account: "999", month: `${YEAR}-02`, status: "voided" }),
      statement({ id: 903, bank: "BBVA", account: "999", month: `${YEAR}-03` }),
    ];
    const r = run(batches, { lifecycles: [lifecycle("BBVA", "999", `${YEAR}-06`)] });
    const bancolombia = r.banks.find((b) => b.bank === "Bancolombia")!;
    expect(bancolombia.coverage).toBe("complete");
    expect(bancolombia.loadedMonths).toBe(12);
    const bbva = r.banks.find((b) => b.bank === "BBVA")!;
    expect(bbva.coverage).toBe("partial");
    const cells = bbva.accounts[0].cells;
    expect(cells[0]).toMatchObject({ state: "loaded" });
    expect(cells[0].history.map((s) => s.batchId)).toEqual([900]);
    expect(cells[1].state).toBe("voided");
    expect(cells[2].state).toBe("loaded");
    expect(cells[3].state).toBe("pending");
    expect(cells[6].state).toBe("na");
    expect(bbva.loadedMonths).toBe(2);
    expect(bbva.expectedMonths).toBe(6);
    // Cada celda conoce el extracto que la originó y sus valores.
    expect(cells[2].active[0]).toMatchObject({ batchId: 903, closingBalanceCents: 1_000_00 });
    // Un banco sin ningún mes cargado en el año es «faltante».
    const none = run([statement({ month: `${YEAR - 1}-12` })]);
    expect(none.banks[0]).toMatchObject({ coverage: "missing", loadedMonths: 0 });
  });

  it("las celdas señalan qué formatos bloquea su pendiente (diciembre sin saldo, extracto sin datos)", () => {
    const r = run([statement({ month: `${YEAR}-11` }), statement({ month: `${YEAR}-10`, concepts: null })]);
    const cells = r.banks[0].accounts[0].cells;
    expect(cells[11].blocks).toEqual(["1012"]);
    expect(cells[9].blocks).toEqual(["1007", "1011"]);
    expect(r.banks[0].blocks).toEqual(["1012", "1007", "1011"]);
  });

  it("los pendientes llevan al banco, ficha o mes exacto que los resuelve", () => {
    const r = run([statement({ month: `${YEAR}-11` })], { profiles: [] });
    const missing = r.alerts.find((a) => a.code === "december-missing")!;
    expect(missing.actions.map((a) => a.label)).toEqual(["Importar extracto de Bancolombia", "Abrir cuenta y mes"]);
    expect(missing.actions[0].path).toBe("/herramientas/estados-financieros/extractos-bancarios/bancolombia");
    const focus = parseBankExoFocus(missing.actions[1].path.split("/").pop());
    expect(focus).toEqual({ kind: "month", companyId: 1, year: YEAR, bank: "Bancolombia", account: "111", month: `${YEAR}-12` });
    const profileFocus = parseBankExoFocus(bankExoPath({ kind: "profile", bank: "BBVA" }).split("/").pop());
    expect(profileFocus).toEqual({ kind: "profile", bank: "BBVA" });
  });
});

describe("convivencia con las fuentes existentes de 1007 y 1011", () => {
  const input: BankExoInput = {
    companyId: 1,
    year: YEAR,
    batches: [statement({ month: `${YEAR}-12`, closing: 1_000_00, concepts: [interest(500_00), gmf(200_00)] })],
    profiles: [profile()],
    gmfRules: [gmfRule("Bancolombia")],
    interestRules: [interestRule("Bancolombia")],
    lifecycles: [],
    reviews: [],
  };
  const bank = buildBankExoContribution(input);
  const cryptoRecord = { sourceKey: "ingresos:31|900111222", originRef: "Transacciones Cripto · Ventas", data: { concept: "4001", docTypeCode: "31", docNumber: "900111222", grossIncome: 5_000, returns: 0 } };
  const cryptoModel = { form1007: { records: [cryptoRecord] }, form1647: { records: [] }, problems: { f1007: [], f1647: [] } } as unknown as CryptoModel;
  const rec = (format: string, p: { sourceKey: string; origin: ExoRecord["origin"]; originRef: string; data: ExoRecord["data"] }, id: number): ExoRecord => ({ id, companyId: 1, year: YEAR, formatCode: format, sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: p.data, manualFields: [], manuallyModifiedAt: null, syncedAt: "x", createdAt: "x", updatedAt: "x" });

  it("el 1007 suma los intereses a lo de Cripto sin tocarlo y con claves propias (concepto 4003, no 4001)", () => {
    const state = cryptoFormatState(cryptoModel, "1007", [], null, bank);
    expect(state.proposals.map((p) => p.sourceKey)).toEqual(["ingresos:31|900111222", "banco-1007:BANCOLOMBIA"]);
    expect(state.proposals.map((p) => p.data.concept)).toEqual(["4001", "4003"]);
    // Sin los extractos, el 1007 de Cripto queda exactamente como estaba.
    expect(cryptoFormatState(cryptoModel, "1007", []).proposals).toHaveLength(1);
    // Lo ya guardado de ambos orígenes no se marca «retirado» ni «cambiado».
    const saved = [rec("1007", { ...cryptoRecord, origin: "estados_financieros" }, 1), rec("1007", state.proposals[1], 2)];
    expect(cryptoFormatState(cryptoModel, "1007", saved, null, bank).changes).toEqual([]);
    // Los pendientes de los bancos llegan al 1007 y solo a él.
    const pend = cryptoFormatState(cryptoModel, "1007", saved, null, buildBankExoContribution({ ...input, profiles: [] }));
    expect(blocking(pend.problems).map((p) => p.message).join(" ")).toContain("falta la ficha del banco");
  });

  it("el 1011 suma el 8211 a los conceptos de Nómina sin reemplazarlos y una sincronización conserva ambos", () => {
    const payroll = { sourceKey: "nomina:8207", origin: "estados_financieros" as const, originRef: "Nómina", data: { concept: "8207", balance: 1_000_000 } };
    const state = payrollFormatState("1011", [payroll], [], [], bank);
    expect(state.proposals.map((p) => p.sourceKey)).toEqual(["nomina:8207", "banco-1011:8211"]);
    const saved = state.proposals.map((p, i) => rec("1011", p, i));
    const next = payrollFormatState("1011", [payroll], [], saved, bank);
    expect(next.changes).toEqual([]);
    // Solo queda el aviso de cobertura (meses sin extracto), nada bloqueante.
    expect(blocking(next.problems)).toEqual([]);
    // El 2276 no recibe nada de los bancos.
    expect(payrollFormatState("2276", [], [], [], bank).proposals).toEqual([]);
  });

  it("el Excel único incluye 1012, 1007 (4001 y 4003) y 1011 (nómina y 8211) con sus columnas oficiales", () => {
    const listo = (code: string): FormatStatusRow => ({ formatCode: code, status: "listo", notApplicableReason: "", lastSyncedAt: null, sourceFingerprint: "", updatedAt: "", recordCount: 0 });
    const wb = buildExportWorkbook({
      company: { razonSocial: "MI EMPRESA SAS", nit: "901000111", dv: "5" },
      year: YEAR,
      statuses: { "1012": listo("1012"), "1007": listo("1007"), "1011": listo("1011") },
      records: {
        "1012": bank.proposals["1012"].map((p, i) => rec("1012", p, i)),
        "1007": [rec("1007", { ...cryptoRecord, origin: "estados_financieros" }, 1), ...bank.proposals["1007"].map((p, i) => rec("1007", p, i + 2))],
        "1011": [rec("1011", { sourceKey: "nomina:8207", origin: "estados_financieros", originRef: "Nómina", data: { concept: "8207", balance: 9 } }, 1), ...bank.proposals["1011"].map((p, i) => rec("1011", p, i + 2))],
      },
    });
    const sheet = (name: string) => wb.sheets.find((s) => s.name === name)!;
    expect(sheet("1012").columns.map((c) => c.header)).toEqual([
      "Concepto",
      "Tipo de documento",
      "Número de Identificación",
      "DV",
      "Primer apellido del informado",
      "Segundo apellido del informado",
      "Primer nombre del informado",
      "Otros nombres del informado",
      "Razón social informado",
      "País de residencia o domicilio",
      "Valor al 31-12",
    ]);
    expect(sheet("1012").rows).toEqual([["1110", "31", "890903938", "8", null, null, null, null, "BANCOLOMBIA S.A.", "169", 1_000]]);
    const concept = (name: string) => sheet(name).rows.map((r) => r[0]);
    expect(concept("1007")).toEqual(["4001", "4003"]);
    expect(concept("1011")).toEqual(["8207", "8211"]);
    expect(sheet("1011").rows[1][1]).toBe(100);
  });
});
