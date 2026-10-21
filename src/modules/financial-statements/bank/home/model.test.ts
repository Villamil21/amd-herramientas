import { describe, expect, it } from "vitest";
import { financialStatementsModule } from "../..";
import type { BankAccountLifecycle, BankEditLogEntry, BankMonthNa, BankPendingEdit, BankProfile, BatchSummary, GmfRule, InterestRule, Movement, Period } from "../../../../types/fs";
import { lastDayOfMonth } from "../../shared/money";
import { buildBankBatch, type AccountingStatement, type ConceptDecision } from "../bankAccounting";
import { bankExoPath, bankImportPath, bankProviderId, BANK_EXO_PROVIDER_ID, parseBankExoFocus } from "../exogena/paths";
import { bankKeyOf, buildBankExo, type BankExoInput } from "../exogena/model";
import { buildImportedStatements } from "../imported/model";
import { buildApplySummary, buildBankHome, buildConceptRows, monthEnded, projectedCents } from "./model";

const BANK = "Bancolombia";
const YEAR = 2026;
const mv = (date: string, description: string, amountCents: number) => ({ date, description, amountCents });

interface Spec {
  id: number;
  account: string;
  month: string;
  /** Conceptos del extracto. */
  concepts?: AccountingStatement["concepts"];
  send?: boolean;
}

const COMPRA = { key: "a", description: "COMPRA TIENDA", dc: "D" as const, count: 2, totalCents: 30_000, movements: [mv("2026-01-02", "COMPRA A", -10_000), mv("2026-01-03", "COMPRA B", -20_000)] };
const GMF = { key: "g", description: "IMPUESTO GMF", dc: "D" as const, count: 2, totalCents: 3_001, movements: [mv("2026-01-05", "GMF", -1_001), mv("2026-01-06", "GMF", -2_000)] };
const INTEREST = { key: "i", description: "ABONO INTERESES AHORROS", dc: "C" as const, count: 1, totalCents: 500, movements: [mv("2026-01-30", "ABONO INTERESES AHORROS", 500)] };

function persist(spec: Spec, gmfConfirmed: boolean) {
  const statement: AccountingStatement = { bank: BANK, accountNumber: spec.account, periodFrom: `${spec.month}-01`, periodTo: lastDayOfMonth(spec.month), movementCount: 3, openingBalanceCents: 0, closingBalanceCents: 900_000_00, concepts: spec.concepts ?? [COMPRA, GMF, INTEREST] };
  const decisions: Record<string, ConceptDecision> = Object.fromEntries(statement.concepts.map((c) => [c.key, spec.send === false ? { destination: "skip" as const } : { destination: "send" as const, pucCode: c.key === "i" ? "421005" : c.key === "g" ? "530505" : "513595" }]));
  const input = buildBankBatch(1, statement, `${spec.account}-${spec.month}.pdf`, decisions, "111005", gmfConfirmed ? new Map([["IMPUESTO GMF", "manual" as const]]) : new Map());
  const batch: BatchSummary = { id: spec.id, companyId: 1, source: "bank", fileName: `${spec.account}-${spec.month}.pdf`, periodLabel: "", periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null, dedupeKey: input.dedupeKey ?? "", recordCount: input.movements.length, totalCents: 0, status: "active", replacedBy: null, metadata: (input.metadata ?? null) as Record<string, unknown> | null, createdAt: "2026-02-01T10:00:00Z" };
  const movements = input.movements.map((m, i) => ({ ...(m as object), id: spec.id * 100 + i, companyId: 1, batchId: spec.id, source: "bank", supplierId: null, employeeId: null, employmentId: null, settlesOn: null, pucConcept: "Concepto", status: "active", createdAt: "x", detail: m.detail ?? null, dc: m.dc ?? null }) as unknown as Movement);
  return { batch, movements };
}

const profile: BankProfile = { bankKey: bankKeyOf(BANK), bank: BANK, nit: "890903938", dv: "8", businessName: "BANCOLOMBIA S.A.", docTypeCode: "31", countryCode: "169", updatedAt: "x" };
const gmfRule: GmfRule = { bank: BANK, concept: "IMPUESTO GMF", isGmf: true, origin: "manual", confirmed: true, updatedAt: "x" };
const interestRule: InterestRule = { bank: BANK, concept: "ABONO INTERESES AHORROS", isInterest: true, origin: "manual", confirmed: true, updatedAt: "x" };
const lifecycle = (account: string, closedPeriod: string | null): BankAccountLifecycle => ({ companyId: 1, bank: BANK, accountNumber: account, openedPeriod: null, closedPeriod, status: closedPeriod ? "closed" : "active", updatedAt: "x", events: [] });

interface Scenario {
  specs: Spec[];
  rules?: boolean;
  pending?: BankPendingEdit[];
  monthNa?: BankMonthNa[];
  lifecycles?: BankAccountLifecycle[];
  today?: string;
  log?: BankEditLogEntry[];
  /** Sustituye las reglas de interés (por defecto: confirmado si `rules`, ninguna si no). */
  interestRules?: InterestRule[];
}

function scenario(o: Scenario) {
  const rules = o.rules ?? true;
  const stored = o.specs.map((s) => persist(s, rules));
  const batches = stored.map((s) => s.batch);
  const movements = stored.flatMap((s) => s.movements);
  const exoInput: BankExoInput = { companyId: 1, year: YEAR, batches, profiles: [profile], gmfRules: rules ? [gmfRule] : [], interestRules: o.interestRules ?? (rules ? [interestRule] : []), lifecycles: o.lifecycles ?? [], reviews: [] };
  const result = buildBankExo(exoInput);
  const statements = buildImportedStatements({ companyId: 1, batches, movements, edits: [], mappings: [], gmfRules: exoInput.gmfRules, interestRules: exoInput.interestRules, alerts: result.alerts });
  const home = buildBankHome({ bank: BANK, year: YEAR, result, statements, pending: o.pending ?? [], monthNa: o.monthNa ?? [], today: o.today ?? "2026-05-15" });
  return { home, statements, exoInput, result, movements, batches };
}

const spec = (id: number, account: string, month: string): Spec => ({ id, account, month: `${YEAR}-${month}` });

const pendingEdit = (batchId: number, concept: string, over: Partial<BankPendingEdit> = {}): BankPendingEdit => ({ id: 1, companyId: 1, batchId, concept, destination: "send", pucCode: "530510", isGmf: false, previous: { destination: "send", pucCode: "513595", isGmf: false, amountCents: 30_000 }, createdAt: "x", updatedAt: "x", ...over });

describe("navegación: los bancos van solos y cada banco trae lo suyo", () => {
  const fs = financialStatementsModule.submodules.find((s) => s.id === "extractos-bancarios")!;
  it("la pantalla inicial solo muestra bancos: Cobertura y Exógena y Extractos importados no son tarjetas", () => {
    const cards = fs.providers!.filter((p) => !p.hidden).map((p) => p.name);
    expect(cards).toEqual(["Bancolombia", "Bancoomeva", "BBVA", "Coopcentral", "Davivienda", "Iris Bank"].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })));
    expect(cards).not.toContain("Cobertura y Exógena");
    expect(cards).not.toContain("Extractos importados");
    expect(fs.providers!.some((p) => p.name === "Extractos importados")).toBe(false);
  });
  it("la vista de todos los bancos sigue existiendo como ruta oculta (enlace secundario)", () => {
    const hidden = fs.providers!.filter((p) => p.hidden);
    expect(hidden.map((p) => p.id)).toEqual([BANK_EXO_PROVIDER_ID]);
  });
  it("los enlaces de los pendientes y la importación quedan dentro del banco", () => {
    expect(bankProviderId("Bancolombia")).toBe("bancolombia");
    expect(bankImportPath("Iris Bank")).toBe("/herramientas/estados-financieros/extractos-bancarios/iris-bank/importar");
    const path = bankExoPath({ kind: "month", companyId: 3, year: 2026, bank: "Bancolombia", account: "111", month: "2026-03" });
    expect(path.startsWith("/herramientas/estados-financieros/extractos-bancarios/bancolombia/mes~")).toBe(true);
    expect(parseBankExoFocus(path.split("/").pop())).toEqual({ kind: "month", companyId: 3, year: 2026, bank: "Bancolombia", account: "111", month: "2026-03" });
    expect(bankExoPath({ kind: "profile", bank: "Banco Sin Lector" })).toContain("/cobertura-exogena/ficha~");
  });
});

describe("cobertura por período de un banco", () => {
  it("cada mes indica cuentas y estado, por empresa, cuenta y año", () => {
    const s = scenario({
      specs: [spec(1, "111", "01"), spec(2, "222", "01"), spec(3, "111", "02"), spec(4, "222", "02"), { ...spec(5, "111", "03"), concepts: [COMPRA, { ...GMF, description: "GRAVAMEN MOV FINANCIEROS ESPECIAL" }] }, { ...spec(6, "111", "04"), send: false, concepts: [COMPRA] }],
      lifecycles: [lifecycle("222", "2026-02")],
      pending: [pendingEdit(3, "COMPRA TIENDA")],
    });
    const m = (n: string) => s.home.months.find((x) => x.month === `${YEAR}-${n}`)!;
    expect(m("01").text).toBe("Ene 2026 · 2 cuentas · Enviado");
    expect(m("01").status).toBe("sent");
    // Con un cambio guardado sin aplicar: Actualización pendiente (la otra cuenta sigue enviada).
    expect(m("02").status).toBe("update-pending");
    expect(m("02").accounts.find((a) => a.account === "111")!.status).toBe("update-pending");
    expect(m("02").accounts.find((a) => a.account === "222")!.status).toBe("sent");
    // Un posible GMF sin confirmar pide revisión.
    expect(m("03").status).toBe("review");
    expect(m("03").accounts.find((a) => a.account === "111")!.reasons.join(" ")).toContain("posible interés o GMF");
    // Cuenta con extracto sin nada enviado: Pendiente. La cuenta 222 cerrada en febrero no se espera en marzo ni en abril.
    expect(m("04").status).toBe("pending");
    expect(m("04").accounts.find((a) => a.account === "222")!.status).toBe("na");
    expect(m("03").text).toContain("1 cuenta");
    expect(s.home.accounts.map((a) => a.accountNumber)).toEqual(["111", "222"]);
  });

  it("sin extracto: Falta si el mes ya terminó, Aún no termina si es el actual o futuro, No aplica si la cuenta cerró o el usuario lo registró", () => {
    const na: BankMonthNa = { companyId: 1, bankKey: bankKeyOf(BANK), accountNumber: "111", month: `${YEAR}-03`, reason: "Cuenta sin movimiento", createdAt: "x" };
    const s = scenario({ specs: [spec(1, "111", "01")], today: "2026-05-15", monthNa: [na] });
    const status = (n: string) => s.home.months.find((x) => x.month === `${YEAR}-${n}`)!.status;
    expect(status("01")).toBe("sent");
    expect(status("02")).toBe("missing");
    expect(status("03")).toBe("na");
    expect(status("04")).toBe("missing");
    expect(status("05")).toBe("not-ended");
    expect(status("12")).toBe("not-ended");
    expect(s.home.months.find((x) => x.month === `${YEAR}-03`)!.accounts[0].reasons).toEqual(["Cuenta sin movimiento"]);
    expect(monthEnded("2026-04", "2026-05-15")).toBe(true);
    expect(monthEnded("2026-05", "2026-05-15")).toBe(false);
    // Una cuenta cerrada en enero: lo posterior no aplica.
    const closed = scenario({ specs: [spec(1, "111", "01")], lifecycles: [lifecycle("111", "2026-01")] });
    expect(closed.home.months.find((x) => x.month === `${YEAR}-06`)!.status).toBe("na");
  });

  it("un banco sin extractos muestra los meses terminados como Falta y no inventa cuentas", () => {
    const s = scenario({ specs: [] });
    expect(s.home.accounts).toEqual([]);
    expect(s.home.months[0].text).toBe("Ene 2026 · sin cuentas · Falta");
    expect(s.home.months[11].status).toBe("not-ended");
  });

  it("la cobertura de un banco no mezcla extractos de otros bancos ni de otro año", () => {
    const other = persist({ id: 9, account: "999", month: "2026-01" }, true);
    other.batch.metadata = { ...other.batch.metadata, bank: "BBVA" };
    const base = scenario({ specs: [spec(1, "111", "01")] });
    const result = buildBankExo({ ...base.exoInput, batches: [...base.batches, other.batch] });
    const home = buildBankHome({ bank: BANK, year: YEAR, result, statements: base.statements, pending: [], monthNa: [], today: "2026-05-15" });
    expect(home.accounts.map((a) => a.accountNumber)).toEqual(["111"]);
    const y2025 = persist({ id: 10, account: "111", month: "2025-12" }, true);
    const r2 = buildBankExo({ ...base.exoInput, batches: [...base.batches, y2025.batch] });
    expect(buildBankHome({ bank: BANK, year: YEAR, result: r2, statements: base.statements, pending: [], monthNa: [], today: "2026-05-15" }).months[11].status).toBe("not-ended");
  });
});

describe("detalle persistido y edición por concepto", () => {
  const s = scenario({ specs: [spec(1, "111", "01")] });
  const [st] = s.statements;

  it("abre el extracto ya guardado: conceptos agrupados con tipo, cantidad, total, destino, PUC, GMF y regla", () => {
    const rows = buildConceptRows(st, [], []);
    const compra = rows.find((r) => r.description === "COMPRA TIENDA")!;
    expect(compra).toMatchObject({ type: "Salida", count: 2, outflowCents: 30_000, state: "sent", current: { destination: "send", pucCode: "513595", isGmf: false }, hasDetail: true });
    expect(compra.transactions).toHaveLength(2);
    const gmf = rows.find((r) => r.description === "IMPUESTO GMF")!;
    expect(gmf).toMatchObject({ current: { isGmf: true, pucCode: "530505" }, sentCents: 1_501, gmfLabel: "GMF · 50 % del neto" });
    expect(rows.find((r) => r.description === "ABONO INTERESES AHORROS")).toMatchObject({ type: "Ingreso", interest: "confirmed" });
  });

  it("un cambio guardado marca la fila como «Cambio sin actualizar» y muestra anterior y nuevo SIN alterar lo enviado", () => {
    const before = s.movements.filter((m) => m.status === "active").map((m) => [m.id, m.pucCode, m.amountCents]);
    const rows = buildConceptRows(st, [pendingEdit(1, "COMPRA TIENDA")], []);
    const row = rows.find((r) => r.description === "COMPRA TIENDA")!;
    expect(row.state).toBe("update-pending");
    expect(row.current.pucCode).toBe("513595");
    expect(row.effective.pucCode).toBe("530510");
    expect(row.pending?.previous.pucCode).toBe("513595");
    expect(s.movements.filter((m) => m.status === "active").map((m) => [m.id, m.pucCode, m.amountCents])).toEqual(before);
    // Las demás filas no cambian.
    expect(rows.filter((r) => r.pending)).toHaveLength(1);
  });

  it("proyecta el valor nuevo: GMF por el 50 % del neto, No enviar en cero", () => {
    const rows = buildConceptRows(st, [], []);
    const gmf = rows.find((r) => r.description === "IMPUESTO GMF")!;
    expect(projectedCents(gmf, { ...gmf.current, isGmf: false })).toBe(3_001);
    expect(projectedCents(gmf, gmf.current)).toBe(1_501);
    expect(projectedCents(gmf, { ...gmf.current, destination: "skip" })).toBe(0);
  });

  it("los conceptos «No enviar» salen como No aplica y los extractos antiguos conservan solo la edición de PUC", () => {
    const skipped = scenario({ specs: [{ ...spec(2, "111", "02"), send: false, concepts: [COMPRA] }] }).statements[0];
    expect(buildConceptRows(skipped, [], [])[0]).toMatchObject({ state: "not-applicable", current: { destination: "skip" } });
    // Un concepto que ni se envió ni se marcó «No enviar» queda pendiente de decisión.
    expect(buildConceptRows({ ...skipped, skipped: [] }, [], [])[0].state).toBe("pending");
    expect(buildConceptRows({ ...st, legacy: true }, [], [])[0].hasDetail).toBe(false);
  });

  it("la bitácora aparece como regla u origen de la fila", () => {
    const entry: BankEditLogEntry = { id: 1, companyId: 1, batchId: 1, concept: "COMPRA TIENDA", reason: "Era un servicio", previous: { destination: "send", pucCode: "513595" }, next: { destination: "send", pucCode: "530510" }, createdAt: "2026-03-01T10:00:00Z" };
    const row = buildConceptRows(st, [], [entry]).find((r) => r.description === "COMPRA TIENDA")!;
    expect(row.ruleText).toContain("Era un servicio");
    expect(row.history).toHaveLength(1);
  });
});

describe("resumen de confirmación de «Actualizar Estados Financieros»", () => {
  const s = scenario({ specs: [spec(1, "111", "01")] });
  const [st] = s.statements;
  const period = (status: Period["status"]): Period => ({ id: 1, companyId: 1, startDate: "2026-01-01", endDate: "2026-01-31", presentation: "bank", status, validationHash: null, reviewReason: "", closedSnapshot: null, createdAt: "x", updatedAt: "x", events: [], versions: [] });
  const edits = [pendingEdit(1, "COMPRA TIENDA"), pendingEdit(1, "IMPUESTO GMF", { pucCode: "530505", isGmf: false, previous: { destination: "send", pucCode: "530505", isGmf: true, amountCents: 1_501 } })];

  it("lista concepto, destino y PUC anterior y nuevo, valor afectado, periodo e impacto en Exógena", () => {
    const rows = buildConceptRows(st, edits, []);
    const sum = buildApplySummary(st, rows, [period("pdf_generated")], s.exoInput);
    expect(sum.changes.map((c) => c.concept).sort()).toEqual(["COMPRA TIENDA", "IMPUESTO GMF"]);
    const gmf = sum.changes.find((c) => c.concept === "IMPUESTO GMF")!;
    expect([gmf.before.cents, gmf.after.cents, gmf.before.isGmf, gmf.after.isGmf]).toEqual([1_501, 3_001, true, false]);
    expect([sum.beforeCents, sum.afterCents]).toEqual([30_000 + 1_501, 30_000 + 3_001]);
    expect(sum.gmfRuleChanges).toEqual([{ concept: "IMPUESTO GMF", isGmf: false }]);
    expect(sum.approved).toHaveLength(1);
    expect(sum.closed).toEqual([]);
    // Quitar el GMF cambia el 1011 (sale de 15 pesos a 0), no el 1012 ni el 1007.
    const impact = Object.fromEntries(sum.impact.map((i) => [i.format, i]));
    expect(impact["1011"].changed).toBe(true);
    expect(impact["1012"].changed).toBe(false);
    expect(impact["1007"].changed).toBe(false);
  });

  it("un periodo cerrado se separa del aprobado y uno sin periodo no pide nada", () => {
    const rows = buildConceptRows(st, [pendingEdit(1, "COMPRA TIENDA")], []);
    expect(buildApplySummary(st, rows, [period("closed")], s.exoInput).closed).toHaveLength(1);
    const none = buildApplySummary(st, rows, [], s.exoInput);
    expect([none.periods, none.closed, none.approved]).toEqual([[], [], []]);
    // Un cambio de PUC no mueve ningún formato.
    expect(none.impact.every((i) => !i.changed)).toBe(true);
  });
});

describe("interés generado (1007) desde el detalle del extracto", () => {
  const rejectRule: InterestRule = { ...interestRule, isInterest: false };
  const INTEREST_OUT = { key: "m", description: "INTERESES MORA PAGADOS", dc: "D" as const, count: 1, totalCents: 900, movements: [mv("2026-01-20", "INTERESES MORA PAGADOS", -900)] };
  const interestOf = (o: Partial<Scenario> & Pick<Spec, "concepts" | "send">, concept = "ABONO INTERESES AHORROS") => {
    const { concepts, send, ...rest } = o;
    const s = scenario({ specs: [{ ...spec(1, "111", "01"), concepts, send }], ...rest });
    const st = s.statements[0];
    return { s, st, row: buildConceptRows(st, o.pending ?? [], []).find((r) => r.description === concept)! };
  };

  it("un abono «ABONO INTERESES AHORROS» sin regla aparece como «Parece interés» y avisa en alertas", () => {
    const { s, st, row } = interestOf({ rules: false });
    expect(row).toMatchObject({ interest: "suggested", canBeInterest: true });
    expect(st.interestCents).toBe(0);
    expect(st.lines.filter((l) => l.concept === "ABONO INTERESES AHORROS").every((l) => l.interest === "suggested")).toBe(true);
    expect(s.home.months[0]!.accounts[0]!.reasons.join(" ")).toContain("posible interés");
  });

  it("confirmarlo lo incluye en el 1007 y en el total de intereses del extracto", () => {
    const before = interestOf({ rules: false });
    const after = interestOf({ rules: false, interestRules: [interestRule] });
    expect(before.s.result.banks[0]!.interestCents).toBe(0);
    expect(after.row.interest).toBe("confirmed");
    expect(after.st.interestCents).toBe(500);
    expect(after.s.result.banks[0]!.interestCents).toBe(500);
  });

  it("rechazarlo lo excluye del 1007 y evita la sugerencia y la alerta en el mismo banco y concepto", () => {
    const { s, st, row } = interestOf({ rules: false, interestRules: [rejectRule] });
    expect(row.interest).toBe("rejected");
    expect(st.interestCents).toBe(0);
    expect(s.result.banks[0]!.interestCents).toBe(0);
    expect(st.lines.some((l) => l.interest === "suggested")).toBe(false);
    // Un extracto futuro del mismo banco con el mismo concepto ya no se sugiere.
    const next = scenario({ specs: [spec(1, "111", "01"), spec(2, "111", "02")], rules: false, interestRules: [rejectRule] });
    expect(next.statements.flatMap((x) => x.lines).some((l) => l.interest === "suggested")).toBe(false);
    expect(s.home.months[0]!.accounts[0]!.reasons.join(" ")).not.toContain("ABONO INTERESES AHORROS");
  });

  it("una salida que menciona «interés» no puede ser interés generado", () => {
    const { row, st } = interestOf({ rules: false, concepts: [COMPRA, INTEREST_OUT] }, "INTERESES MORA PAGADOS");
    expect(row).toMatchObject({ type: "Salida", canBeInterest: false, interest: "none" });
    expect(st.interestCents).toBe(0);
  });

  it("la decisión de interés no cambia PUC, destino, GMF ni cambios pendientes del extracto", () => {
    const confirmed = interestOf({ rules: false, interestRules: [interestRule] });
    const rejected = interestOf({ rules: false, interestRules: [rejectRule] });
    const classify = (x: typeof confirmed) => buildConceptRows(x.st, [], []).map((r) => [r.description, r.current, r.sentCents, r.gmfLabel, r.pending]);
    expect(classify(confirmed)).toEqual(classify(rejected));
    expect(confirmed.st.sentCents).toBe(rejected.st.sentCents);
    expect(confirmed.st.gmfGrossCents).toBe(rejected.st.gmfGrossCents);
    // El interés sigue yendo a EEFF (421005) además de poder ser 1007.
    expect(confirmed.row.current).toMatchObject({ destination: "send", pucCode: "421005" });
  });

  it("funciona en un extracto ya enviado y también si no se envió; un extracto antiguo sin detalle no ofrece la acción", () => {
    const notSent = interestOf({ rules: false, send: false });
    expect(notSent.row).toMatchObject({ interest: "suggested", canBeInterest: true, hasDetail: true });
    const legacy = scenario({ specs: [spec(1, "111", "01")], rules: false });
    const st = { ...legacy.statements[0]!, legacy: true };
    expect(buildConceptRows(st, [], [])[0]!.hasDetail).toBe(false);
  });
});
