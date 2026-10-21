import { describe, expect, it } from "vitest";
import type { BankConceptMapping, BatchSummary, GmfRule, InterestRule, Movement, MovementEdit, Period } from "../../../../types/fs";
import { buildBankExo } from "../exogena/model";
import { buildBankBatch, type AccountingStatement } from "../bankAccounting";
import { buildImportedStatements, EMPTY_IMPORTED_FILTERS, filterStatements, previewReclassification, reclassInput, type ImportedInput } from "./model";

const BANK = "Bancolombia";
const mv = (date: string, description: string, amountCents: number) => ({ date, description, amountCents });

const statement: AccountingStatement = {
  bank: BANK,
  accountNumber: "111",
  periodFrom: "2025-12-01",
  periodTo: "2025-12-31",
  movementCount: 6,
  openingBalanceCents: 0,
  closingBalanceCents: 900_000_00,
  concepts: [
    { key: "a", description: "COMPRA TIENDA", dc: "D", count: 3, totalCents: 60_000, movements: [mv("2025-12-02", "COMPRA TIENDA A", -10_000), mv("2025-12-03", "COMPRA TIENDA B", -20_000), mv("2025-12-04", "COMPRA TIENDA C", -30_000)] },
    { key: "g", description: "IMPUESTO GMF", dc: "D", count: 2, totalCents: 3_000, movements: [mv("2025-12-05", "GMF", -1_000), mv("2025-12-06", "GMF", -2_000)] },
    { key: "i", description: "ABONO INTERESES AHORROS", dc: "C", count: 1, totalCents: 500, movements: [mv("2025-12-30", "ABONO INTERESES AHORROS", 500)] },
    { key: "n", description: "NOTA NO ENVIADA", dc: "D", count: 1, totalCents: 700, movements: [mv("2025-12-07", "NOTA NO ENVIADA", -700)] },
  ],
};

const gmfRules: GmfRule[] = [{ bank: BANK, concept: "IMPUESTO GMF", isGmf: true, origin: "manual", confirmed: true, updatedAt: "x" }];
const interestRules: InterestRule[] = [{ bank: BANK, concept: "ABONO INTERESES AHORROS", isInterest: true, origin: "manual", confirmed: true, updatedAt: "x" }];
const mappings: BankConceptMapping[] = [{ id: 1, bank: BANK, concept: "COMPRA TIENDA", pucCode: "513595" } as BankConceptMapping];

/** Lo que dejaría en la base el envío del extracto (lote + movimientos con ids), como lo lee la pantalla. */
function persisted() {
  const input = buildBankBatch(1, statement, "dic.pdf", { a: { destination: "send", pucCode: "513595" }, g: { destination: "send", pucCode: "530505" }, i: { destination: "send", pucCode: "421005" }, n: { destination: "skip" } }, "111005", new Map([["IMPUESTO GMF", "manual" as const]]));
  const batch: BatchSummary = { id: 7, companyId: 1, source: "bank", fileName: "dic.pdf", periodLabel: input.periodLabel ?? "", periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null, dedupeKey: input.dedupeKey ?? "", recordCount: input.movements.length, totalCents: 0, status: "active", replacedBy: null, metadata: (input.metadata ?? null) as Record<string, unknown> | null, createdAt: "2026-01-05T10:00:00Z" };
  const movements: Movement[] = input.movements.map((m, i) => ({ ...(m as object), id: 100 + i, companyId: 1, batchId: 7, source: "bank", supplierId: null, employeeId: null, employmentId: null, settlesOn: null, pucConcept: "Concepto", status: "active", createdAt: "x", detail: m.detail ?? null, dc: m.dc ?? null }) as unknown as Movement);
  return { batch, movements };
}

const period = (status: Period["status"]): Period => ({ id: 1, companyId: 1, startDate: "2025-12-01", endDate: "2025-12-31", presentation: "bank", status, validationHash: null, reviewReason: "", closedSnapshot: null, createdAt: "x", updatedAt: "x", events: [], versions: [] });

function build(over: Partial<ImportedInput> = {}) {
  const { batch, movements } = persisted();
  return buildImportedStatements({ companyId: 1, batches: [batch], movements, edits: [], mappings, gmfRules, interestRules, alerts: [], ...over });
}

describe("consulta de extractos ya importados", () => {
  it("abre el detalle persistido: saldos, movimientos, clasificación, intereses y GMF sin leer ningún PDF", () => {
    const [s] = build();
    expect(s).toMatchObject({ bank: BANK, account: "111", fileName: "dic.pdf", openingBalanceCents: 0, closingBalanceCents: 900_000_00, movementCount: 6, status: "active", sentToEeff: true, legacy: false });
    expect(s.interestCents).toBe(500);
    // GMF: 1.000 + 2.000 = 3.000 de bruto → 50 % = 1.500 enviado.
    expect([s.gmfGrossCents, s.gmfReportedCents]).toEqual([3_000, 1_500]);
    const compra = s.lines.filter((l) => l.concept === "COMPRA TIENDA");
    expect(compra.map((l) => [l.cents, l.pucCode, l.destination, l.rule.kind])).toEqual([[10_000, "513595", "eeff", "follows"], [20_000, "513595", "eeff", "follows"], [30_000, "513595", "eeff", "follows"]]);
    expect(s.lines.find((l) => l.concept === "IMPUESTO GMF")).toMatchObject({ destination: "gmf", gmf: "confirmed", pucCode: "530505" });
    expect(s.lines.find((l) => l.concept === "ABONO INTERESES AHORROS")).toMatchObject({ interest: "confirmed", sent: true });
    expect(s.lines.find((l) => l.concept === "NOTA NO ENVIADA")).toMatchObject({ sent: false, destination: "not-sent", movementId: null });
    expect(s.history[0]).toMatchObject({ kind: "imported" });
  });

  it("filtra por banco, cuenta, mes, estado y texto (movimiento, concepto o PUC)", () => {
    const { batch, movements } = persisted();
    const replaced: BatchSummary = { ...batch, id: 8, status: "replaced", replacedBy: 7, fileName: "viejo.pdf", periodEnd: "2025-11-30", periodStart: "2025-11-01" };
    const all = buildImportedStatements({ companyId: 1, batches: [batch, replaced], movements, edits: [], mappings, gmfRules, interestRules, alerts: [] });
    expect(all).toHaveLength(2);
    const f = (patch: Partial<typeof EMPTY_IMPORTED_FILTERS>) => filterStatements(all, { ...EMPTY_IMPORTED_FILTERS, ...patch }).map((s) => s.batchId);
    expect(f({})).toEqual([7, 8]);
    expect(f({ bank: "BBVA" })).toEqual([]);
    expect(f({ account: "111", month: "2025-12" })).toEqual([7]);
    expect(f({ status: "vigente" })).toEqual([7]);
    expect(f({ status: "reemplazado" })).toEqual([8]);
    expect(f({ status: "enviado" })).toEqual([7]);
    expect(f({ text: "compra tienda b" })).toEqual([7, 8]);
    expect(f({ text: "513595" })).toContain(7);
    expect(f({ text: "viejo" })).toEqual([8]);
    expect(f({ text: "no-existe" })).toEqual([]);
  });

  it("«Pendiente» y «Con alertas» distinguen lo no enviado y lo que Exógena observa", () => {
    const { batch, movements } = persisted();
    const none = buildImportedStatements({ companyId: 1, batches: [batch], movements: [], edits: [], mappings, gmfRules, interestRules, alerts: [] });
    expect(filterStatements(none, { ...EMPTY_IMPORTED_FILTERS, status: "pendiente" })).toHaveLength(1);
    const alert = { id: "x", code: "december-missing", severity: "block", dests: ["1012"], title: "t", why: "w", how: "h", actions: [], ref: { bank: BANK, account: "111", month: "2025-12" } } as never;
    const other = { ...(alert as object), id: "y", ref: { bank: "BBVA" } } as never;
    const withAlert = buildImportedStatements({ companyId: 1, batches: [batch], movements, edits: [], mappings, gmfRules, interestRules, alerts: [alert, other] });
    expect(withAlert[0].alerts).toHaveLength(1);
    expect(filterStatements(withAlert, { ...EMPTY_IMPORTED_FILTERS, status: "alertas" })).toHaveLength(1);
  });
});

describe("resumen previo a reclasificar", () => {
  const [s] = build();
  const keys = (indexes: number[]) => new Set(indexes.map((i) => `${s.sentMovements.find((m) => m.description === "COMPRA TIENDA")!.id}:${i}`));

  it("una parte del concepto: valor movido, resto que se queda, clasificación anterior y nueva, y periodo afectado", () => {
    const p = previewReclassification(s, keys([0, 2]), "530510", "Servicios", [period("pdf_generated")]);
    expect(p.errors).toEqual([]);
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0]).toMatchObject({ concept: "COMPRA TIENDA", fromPuc: "513595", toPuc: "530510", toConcept: "Servicios", txCount: 2, txTotal: 3, cents: 40_000, restCents: 20_000, accountingDate: "2025-12-31", txIndexes: [0, 2] });
    expect([p.txCount, p.cents]).toEqual([2, 40_000]);
    expect(p.approved.map((x) => x.status)).toEqual(["pdf_generated"]);
    expect(p.closed).toEqual([]);
  });

  it("el concepto completo no deja resto; un periodo cerrado se señala para no cambiar cifras en silencio", () => {
    const p = previewReclassification(s, keys([0, 1, 2]), "530510", "Servicios", [period("closed")]);
    expect(p.groups[0]).toMatchObject({ cents: 60_000, restCents: 0 });
    expect(p.closed).toHaveLength(1);
    expect(p.approved).toEqual([]);
    expect(previewReclassification(s, keys([0]), "530510", "Servicios", []).periods).toEqual([]);
  });

  it("rechaza lo no enviado, el mismo PUC y el GMF por partes", () => {
    const notSent = s.lines.find((l) => !l.sent)!;
    expect(previewReclassification(s, new Set([notSent.key]), "530510", "x", []).errors[0]).toContain("no se envió");
    expect(previewReclassification(s, keys([0]), "513595", "x", []).errors[0]).toContain("ya está en el PUC");
    const gmfMovement = s.sentMovements.find((m) => m.conceptKey === "bank.gmf")!;
    expect(previewReclassification(s, new Set([`${gmfMovement.id}:0`]), "530510", "x", []).errors.join(" ")).toContain("GMF");
    expect(previewReclassification(s, new Set([`${gmfMovement.id}:0`, `${gmfMovement.id}:1`]), "530510", "x", []).errors).toEqual([]);
  });

  it("arma exactamente lo que recibe el backend, con el motivo y la confirmación", () => {
    const p = previewReclassification(s, keys([1]), "530510", "Servicios", []);
    expect(reclassInput(s, p, "530510", "  Era un servicio ", true)).toEqual({ batchId: 7, pucCode: "530510", reason: "Era un servicio", acknowledgeApproved: true, items: [{ movementId: p.groups[0].movementId, txIndexes: [1] }] });
  });
});

describe("después de reclasificar: una sola vez, con historial y Exógena intacto sobre lo guardado", () => {
  it("el extracto reflejado desde la base muestra el PUC nuevo, el resto con el anterior y la auditoría; los valores no se duplican", () => {
    const { batch, movements } = persisted();
    const old = movements.find((m) => m.description === "COMPRA TIENDA")!;
    const txs = (old.detail as { movements: unknown[] }).movements;
    // Lo que deja el backend: original «Ajustado», movido (tx 0 y 2) y resto (tx 1).
    const moved = { ...old, id: 200, pucCode: "530510", pucConcept: "Servicios", amountCents: 40_000, detail: { ...(old.detail as object), movements: [txs[0], txs[2]], count: 2, reclassified: { from: "513595", to: "530510" } } } as Movement;
    const rest = { ...old, id: 201, amountCents: 20_000, detail: { ...(old.detail as object), movements: [txs[1]], count: 1 } } as Movement;
    const after = [...movements.map((m) => (m.id === old.id ? ({ ...m, status: "adjusted" } as Movement) : m)), moved, rest];
    const edit: MovementEdit = {
      id: 1,
      companyId: 1,
      originalMovementId: old.id,
      newMovementId: 200,
      reason: "Era un servicio",
      origin: "bank_reclass",
      previous: { accountingDate: "2025-12-31", pucCode: "513595", pucConcept: "Concepto", description: "COMPRA TIENDA", amountCents: 60_000, status: "active" },
      next: { accountingDate: "2025-12-31", pucCode: "530510", pucConcept: "Servicios", description: "COMPRA TIENDA", amountCents: 40_000, status: "active", transactions: [{ amountCents: 10_000 }, { amountCents: 30_000 }] },
      createdAt: "2026-02-01T10:00:00Z",
    };
    const [before] = build();
    const [s] = buildImportedStatements({ companyId: 1, batches: [batch], movements: after, edits: [edit], mappings, gmfRules, interestRules, alerts: [] });
    expect(s.lines.filter((l) => l.concept === "COMPRA TIENDA").map((l) => [l.cents, l.pucCode])).toEqual([[10_000, "530510"], [20_000, "513595"], [30_000, "530510"]]);
    expect(s.lines.find((l) => l.pucCode === "530510" && l.concept === "COMPRA TIENDA")?.reclassifiedFrom).toBe("513595");
    // El total enviado a EEFF y los valores derivados de Exógena son los mismos que antes: nada se cuenta dos veces.
    expect(s.sentCents).toBe(before.sentCents);
    expect([s.interestCents, s.gmfGrossCents, s.gmfReportedCents]).toEqual([before.interestCents, before.gmfGrossCents, before.gmfReportedCents]);
    expect(s.history.map((h) => h.kind)).toEqual(["imported", "reclassified"]);
    expect(s.history[1].text).toContain("513595 a 530510");

    // 1012, 1007 y 1011 salen del extracto persistido (que no cambia): idénticos antes y después.
    const exo = (batches: BatchSummary[]) =>
      buildBankExo({ companyId: 1, year: 2025, batches, profiles: [{ bankKey: "BANCOLOMBIA", bank: BANK, nit: "890903938", dv: "8", businessName: "BANCOLOMBIA S.A.", docTypeCode: "31", countryCode: "169", updatedAt: "x" }], gmfRules, interestRules, lifecycles: [], reviews: [] });
    const result = exo([batch]);
    expect(result.records["1012"][0].data.exactCents).toEqual({ balance: 900_000_00 });
    expect(result.records["1007"][0].data.exactCents).toEqual({ grossIncome: 500 });
    expect(result.records["1011"][0].data.balance).toBe(15);
    expect(exo([{ ...batch }]).records).toEqual(result.records);
  });
});
