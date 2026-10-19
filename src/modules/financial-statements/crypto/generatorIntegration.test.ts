import { describe, expect, it } from "vitest";
import type { BatchSummary, FsCatalog, FsLine, FsPucMapping, FsSectionKey, Movement } from "../../../types/fs";
import { checklist } from "../generator/checks";
import { buildStatements } from "../generator/engine";
import { purchaseData, saleData, decision, model, stored, upload } from "./domain/testkit";
import { blocking } from "./domain/problems";
import { engineView } from "../shared/accountingPresentation";
import { makePucChecker } from "./domain/pucCheck";
import { buildPucIndex } from "../puc-codes/services/pucCatalog";
import { buildEeffBatch, cryptoOutsideRange, liveMovements, eeffSyncState, staleCryptoYears } from "./eeffBatch";

/**
 * Integración Transacciones Cripto → Generador. El lote de cripto fecha sus movimientos en el corte; el Generador solo cuenta
 * movimientos dentro de su rango. Caso real: corte 2026-12-31 (OTC) y Generador 2026-01-01 → 2026-05-31: el lote quedaba
 * «al día» pero Ventas y Costo de ventas salían en cero sin ninguna alerta.
 */
const SEED: [number, FsSectionKey, string, FsLine["role"]][] = [[18, "income", "Ventas", "sales"], [19, "income", "Ingresos para terceros", "third_party_income"], [21, "costs", "Costo de Ventas", "cost_of_sales"], [22, "costs", "Costo de terceros", "third_party_cost"]];
const catalog: FsCatalog = { lines: SEED.map(([id, section, name, role], i) => ({ id, section, name, role, sortOrder: i, isActive: true, hasHistory: false })), sections: [] };
const map = (pucCode: string, lineId: number): FsPucMapping => ({ pucCode, lineId, excluded: false, updatedAt: "", origin: "manual" });
const MAPPINGS = [map("41359501", 18), map("61359501", 21)];
const PUC: Record<string, string> = { "crypto.sales": "41359501", "crypto.cost_of_sales": "61359501", "crypto.third_income": "413596", "crypto.third_cost": "613596" };
const okPuc = (k: string) => ({ code: PUC[k], valid: true, located: true, location: "EERR" });
const COMPANY = { subscribedTotalShares: null, subscribedNominalValue: null, paidTotalShares: null, paidNominalValue: null };

/** Lo que Rust guarda al enviar el lote: un movimiento activo por componente, con la fecha efectiva y la huella de origen en el lote. */
function persisted(cutoff: string, months: number[]) {
  const rows = [
    ...months.map((mo, i) => stored(1, "purchase", i + 2, purchaseData({ amount: 1000 * mo, date: `2026-${String(mo).padStart(2, "0")}-10`, docType: "NIT", doc: String(100 + mo), business: `E${mo}`, order: String(mo) }))),
    stored(1, "sale", 2, saleData({ amount: 20000, docType: "NIT", doc: "800", business: "V" })),
  ];
  const m = model({ rows, uploads: [upload(1, "a.xlsx", { rowCount: rows.length })], puc: okPuc, decisions: [decision("setting", "cutoff", cutoff), decision("setting", "presentation", "otc")] });
  const input = buildEeffBatch(1, m)!;
  const movements = input.movements.map((x, i) => ({ id: i + 1, companyId: 1, batchId: 1, source: input.source, supplierId: null, employeeId: null, employmentId: null, dc: null, settlesOn: null, pucConcept: "", status: "active", detail: null, createdAt: "", supplierNit: "", supplierName: "", bank: "", accountNumber: "", ...x }) as unknown as Movement);
  const batch = { id: 1, companyId: 1, source: "crypto_ops", fileName: input.fileName, periodLabel: input.periodLabel, periodStart: input.periodStart, periodEnd: input.periodEnd, dedupeKey: input.dedupeKey, recordCount: movements.length, totalCents: 0, status: "active", replacedBy: null, metadata: (input.metadata ?? null) as Record<string, unknown> | null, createdAt: "" } as BatchSummary;
  return { movements, batch, input, m };
}

function generator(cutoff: string, months: number[], start: string, end: string) {
  const { movements, batch, input, m } = persisted(cutoff, months);
  const run = (presentation: "bank" | "otc") => buildStatements({ company: COMPANY, catalog, mappings: MAPPINGS, movements, bankBalances: [], start, end, presentation });
  const s = run("otc");
  const line = (name: string) => s.sections.income.lines.concat(s.sections.costs.lines).find((l) => l.line.name === name)!.cents;
  const checks = checklist(s, run("bank"), [], [], 0, staleCryptoYears([batch]), cryptoOutsideRange([batch], start, end), { start, end });
  const component = (key: string) => m.components.find((c) => c.key === key)!.cents;
  return { sales: line("Ventas"), cost: line("Costo de Ventas"), salesExpected: component("sales"), costExpected: component("cost_of_sales"), checks, batch, input };
}

const JAN_MAY = [1, 2, 3, 4, 5];
const JAN_DEC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe("fecha efectiva del lote de Transacciones Cripto", () => {
  it("cobertura enero–mayo y corte 31/12: se fecha el 31/05 y entra en EEFF enero–mayo", () => {
    const g = generator("2026-12-31", JAN_MAY, "2026-01-01", "2026-05-31");
    expect(g.input.movements.map((x) => x.accountingDate)).toEqual(["2026-05-31", "2026-05-31"]);
    expect(g.input.periodEnd).toBe("2026-05-31");
    expect(g.input.metadata).toMatchObject({ cutoff: "2026-12-31", effectiveDate: "2026-05-31" });
    expect(g.salesExpected).toBeGreaterThan(0);
    expect(g.sales).toBe(g.salesExpected);
    expect(g.cost).toBe(g.costExpected);
    expect(g.checks.find((c) => c.id === "crypto")?.ok).toBe(true);
  });

  it("la misma cobertura entra también en EEFF enero–diciembre", () => {
    const g = generator("2026-12-31", JAN_MAY, "2026-01-01", "2026-12-31");
    expect(g.sales).toBe(g.salesExpected);
    expect(g.cost).toBe(g.costExpected);
    expect(g.checks.find((c) => c.id === "crypto")?.ok).toBe(true);
  });

  it("cobertura enero–diciembre y corte 31/12: se fecha el 31/12 y entra en enero–diciembre", () => {
    const g = generator("2026-12-31", JAN_DEC, "2026-01-01", "2026-12-31");
    expect(g.input.movements.map((x) => x.accountingDate)).toEqual(["2026-12-31", "2026-12-31"]);
    expect(g.sales).toBe(g.salesExpected);
    expect(g.cost).toBe(g.costExpected);
  });

  it("un corte anterior a la última cobertura manda: se fecha en el corte", () => {
    const g = generator("2026-03-31", [1, 2, 3], "2026-01-01", "2026-03-31");
    expect(g.input.movements.every((x) => x.accountingDate === "2026-03-31")).toBe(true);
    expect(g.sales).toBe(g.salesExpected);
  });

  it("un Generador que termina antes de la fecha efectiva no recibe el lote y lo avisa", () => {
    const g = generator("2026-12-31", JAN_MAY, "2026-01-01", "2026-04-30");
    expect(g.sales).toBe(0);
    const crypto = g.checks.find((c) => c.id === "crypto");
    expect(crypto?.ok).toBe(false);
    expect(crypto?.detail).toContain("2026-05-31");
    expect(crypto?.detail).toContain("2026-04-30");
  });
});

describe("Ventas sin fecha y corte dentro de la cobertura", () => {
  const rows = [
    ...JAN_MAY.map((mo, i) => stored(1, "purchase", i + 2, purchaseData({ amount: 1000 * mo, date: `2026-${String(mo).padStart(2, "0")}-10`, docType: "NIT", doc: String(100 + mo), business: `E${mo}`, order: String(mo) }))),
    stored(1, "sale", 2, saleData({ amount: 20000, docType: "NIT", doc: "800", business: "V" })),
  ];
  const build = (extra: Partial<Parameters<typeof upload>[2]> = {}) =>
    model({ rows, uploads: [upload(1, "a.xlsx", { rowCount: rows.length, ...extra })], puc: okPuc, decisions: [decision("setting", "cutoff", "2026-04-30"), decision("setting", "presentation", "otc")] });

  it("no incluye el total de Ventas de enero–mayo ni arma el lote: queda bloqueado", () => {
    const m = build();
    expect(m.eeff.salesCents).toBeNull();
    expect(m.eeff.ownIncomeCents).toBeNull();
    expect(m.components.every((c) => c.cents === null || c.key === "cost_of_sales")).toBe(true);
    expect(buildEeffBatch(1, m)).toBeNull();
    const reason = blocking(m.problems.eeff).map((p) => p.message).join(" ");
    expect(reason).toContain("2026-04-30");
    expect(reason).toContain("2026-01 a 2026-05");
    expect(reason).toContain("ajusta el período de cobertura");
  });

  it("con un lote ya enviado, el efecto se retira del cálculo vigente", () => {
    const sent = persisted("2026-12-31", JAN_MAY).batch;
    expect(eeffSyncState(sent, buildEeffBatch(1, build()))).toBe("retire");
  });

  it("al ajustar la cobertura a enero–abril, el cálculo es válido y se fecha el 30/04", () => {
    const m = build({ coverageOverride: ["2026-01", "2026-02", "2026-03", "2026-04"] });
    expect(m.eeff.ownIncomeCents).not.toBeNull();
    const batch = buildEeffBatch(1, m)!;
    expect(batch.movements.every((x) => x.accountingDate === "2026-04-30")).toBe(true);
  });
});

describe("cambio de presentación OTC → Bancos", () => {
  const rows = [
    ...JAN_MAY.map((mo, i) => stored(1, "purchase", i + 2, purchaseData({ amount: 1000 * mo, date: `2026-${String(mo).padStart(2, "0")}-10`, docType: "NIT", doc: String(100 + mo), business: `E${mo}`, order: String(mo) }))),
    stored(1, "sale", 2, saleData({ amount: 20000, docType: "NIT", doc: "800", business: "V" })),
  ];
  // Configuración real de GESAP: cada componente en su PUC y cada PUC en su línea con rol.
  const PUCS = { "crypto.sales": "41359501", "crypto.third_income": "41509501", "crypto.cost_of_sales": "61359501", "crypto.third_cost": "61509501" };
  const index = buildPucIndex(Object.values(PUCS).map((code) => ({ code, concept: "x", custom: true, active: true }) as never));
  const lines = (over: Record<number, Partial<FsLine>> = {}): FsCatalog => ({
    lines: [[18, "income", "Ventas", "sales"], [19, "income", "Ingresos para terceros", "third_party_income"], [21, "costs", "Costo de Ventas", "cost_of_sales"], [22, "costs", "Costo de terceros", "third_party_cost"]].map(([id, section, name, role], i) => ({ id, section, name, role, sortOrder: i, isActive: true, hasHistory: false, ...over[id as number] }) as FsLine),
    sections: [],
  });
  const maps = (over: Record<string, number> = {}) => new Map<string, FsPucMapping>([["41359501", 18], ["41509501", 19], ["61359501", 21], ["61509501", 22]].map(([code, line]) => [code as string, map(code as string, over[code as string] ?? (line as number))]));
  const modelWith = (presentation: string, catalog: FsCatalog, mappings: Map<string, FsPucMapping>, removed: string[] = []) => {
    const settings = new Map(Object.entries(PUCS).filter(([k]) => !removed.includes(k)));
    return model({ rows, uploads: [upload(1, "a.xlsx", { rowCount: rows.length })], puc: makePucChecker(settings, index, catalog, mappings), decisions: [decision("setting", "cutoff", "2026-05-31"), decision("setting", "presentation", presentation)] });
  };
  const sentAs = (input: NonNullable<ReturnType<typeof buildEeffBatch>>) => ({ id: 1, companyId: 1, source: "crypto_ops", fileName: "", periodLabel: "", periodStart: null, periodEnd: null, dedupeKey: input.dedupeKey, recordCount: 0, totalCents: 0, status: "active", replacedBy: null, metadata: input.metadata ?? null, createdAt: "" }) as BatchSummary;
  const asMovements = (input: NonNullable<ReturnType<typeof buildEeffBatch>>) => input.movements.map((x, i) => ({ id: i + 1, companyId: 1, batchId: 1, source: input.source, supplierId: null, employeeId: null, employmentId: null, dc: null, settlesOn: null, pucConcept: "", status: "active", detail: null, createdAt: "", supplierNit: "", supplierName: "", bank: "", accountNumber: "", ...x }) as unknown as Movement);
  const view = (input: NonNullable<ReturnType<typeof buildEeffBatch>>, presentation: "bank" | "otc", catalog: FsCatalog, mappings: Map<string, FsPucMapping>) => {
    const s = buildStatements({ company: COMPANY, catalog, mappings: [...mappings.values()], movements: asMovements(input), bankBalances: [], start: "2026-01-01", end: "2026-05-31", presentation });
    const all = s.sections.income.lines.concat(s.sections.costs.lines);
    const get = (name: string) => all.find((l) => l.line.name === name)?.cents ?? 0;
    return { ventas: get("Ventas"), terceros: get("Ingresos para terceros"), costo: get("Costo de Ventas"), costoTerceros: get("Costo de terceros"), unclassified: s.unclassified.length };
  };

  it("OTC → Bancos reemplaza los movimientos OTC por los de Bancos y el Generador Banco los separa", () => {
    const catalog = lines();
    const mappings = maps();
    const otc = buildEeffBatch(1, modelWith("otc", catalog, mappings))!;
    const banks = buildEeffBatch(1, modelWith("banks", catalog, mappings))!;
    expect(otc.movements.map((x) => x.conceptKey)).toEqual(["crypto.sales", "crypto.cost_of_sales"]);
    expect(banks.movements.map((x) => x.conceptKey)).toEqual(["crypto.sales", "crypto.third_income", "crypto.third_cost"]);
    expect(banks.dedupeKey).toBe(otc.dedupeKey);
    expect(eeffSyncState(sentAs(otc), banks)).toBe("update");
    const own = 5_000_00 * 1; // ingreso propio: 20.000 − 15.000 en pesos, en centavos
    const asBanks = view(banks, "bank", catalog, mappings);
    expect(asBanks).toMatchObject({ ventas: own, costo: 0, unclassified: 0 });
    expect(asBanks.terceros).toBeGreaterThan(0);
    expect(asBanks.costoTerceros).toBe(asBanks.terceros);
    // El lote OTC anterior, visto en el Generador Banco, sí mezclaba el valor de terceros en Ventas (lo que el usuario veía).
    expect(view(otc, "bank", catalog, mappings).terceros).toBe(0);
  });

  it("si falta la PUC de terceros, el lote OTC anterior se retira y el resultado se bloquea", () => {
    const catalog = lines();
    const otc = buildEeffBatch(1, modelWith("otc", catalog, maps()))!;
    const blocked = modelWith("banks", catalog, maps(), ["crypto.third_income"]);
    expect(buildEeffBatch(1, blocked)).toBeNull();
    expect(eeffSyncState(sentAs(otc), buildEeffBatch(1, blocked))).toBe("retire");
  });

  it("una PUC de terceros ubicada en una línea que no es de terceros también bloquea", () => {
    const catalog = lines();
    const otc = buildEeffBatch(1, modelWith("otc", catalog, maps()))!;
    const wrong = modelWith("banks", catalog, maps({ "41509501": 18 }));
    expect(blocking(wrong.problems.eeff).map((p) => p.message).join(" ")).toContain("Ingresos para terceros");
    expect(buildEeffBatch(1, wrong)).toBeNull();
    expect(eeffSyncState(sentAs(otc), buildEeffBatch(1, wrong))).toBe("retire");
  });

  it("una línea de terceros desactivada bloquea: el Generador la dejaría sin clasificar", () => {
    const catalog = lines({ 22: { isActive: false } });
    const otc = buildEeffBatch(1, modelWith("otc", lines(), maps()))!;
    const inactive = modelWith("banks", catalog, maps());
    expect(buildEeffBatch(1, inactive)).toBeNull();
    expect(eeffSyncState(sentAs(otc), buildEeffBatch(1, inactive))).toBe("retire");
  });

  it("una sola fuente de verdad: la presentación guardada decide el lote y el Generador la dibuja sin bloqueo", () => {
    const catalog = lines();
    const mappings = maps();
    for (const accounting of ["otc", "banks", "dr"] as const) {
      const m = modelWith(accounting, catalog, mappings);
      const input = buildEeffBatch(1, m)!;
      const sent = sentAs(input);
      expect(m.settings.presentation).toBe(accounting);
      expect(sent.metadata).toMatchObject({ presentation: accounting });
      // El Generador toma la vista del mismo valor guardado: no hay un segundo selector que pueda contradecirlo.
      const engine = engineView(accounting);
      const v = view(input, engine, catalog, mappings);
      expect(v.unclassified).toBe(0);
      const s = buildStatements({ company: COMPANY, catalog, mappings: [...mappings.values()], movements: asMovements(input), bankBalances: [], start: "2026-01-01", end: "2026-05-31", presentation: engine });
      const checks = checklist(s, s, [], [], 0, staleCryptoYears([sent]), cryptoOutsideRange([sent], "2026-01-01", "2026-05-31"), { start: "2026-01-01", end: "2026-05-31" }, false);
      expect(checks.find((c) => c.id === "crypto")?.ok).toBe(true);
    }
    // OTC condensa el valor de terceros; Bancos lo presenta en sus líneas.
    const otc = view(buildEeffBatch(1, modelWith("otc", catalog, mappings))!, "otc", catalog, mappings);
    const banks = view(buildEeffBatch(1, modelWith("banks", catalog, mappings))!, "bank", catalog, mappings);
    expect(banks.terceros).toBeGreaterThan(0);
    expect(otc.ventas).toBe(banks.ventas + banks.terceros);
    expect(otc.costo).toBe(banks.costoTerceros);
  });

  it("si la actualización falla por periodo cerrado, el lote previo sale del cálculo y el Generador bloquea", () => {
    const catalog = lines();
    const mappings = maps();
    const input = buildEeffBatch(1, modelWith("otc", catalog, mappings))!;
    const outdated = { ...sentAs(input), metadata: { ...(input.metadata as object), outdated: 1, outdatedReason: "El periodo cerrado de 2026-05 no se puede modificar." } } as BatchSummary;
    const movements = liveMovements(asMovements(input), [outdated]);
    expect(movements).toHaveLength(0);
    const s = buildStatements({ company: COMPANY, catalog, mappings: [...mappings.values()], movements, bankBalances: [], start: "2026-01-01", end: "2026-05-31", presentation: "otc" });
    expect(s.sections.income.lines.find((l) => l.line.name === "Ventas")?.cents).toBe(0);
    const crypto = checklist(s, s, [], [], 0, staleCryptoYears([outdated]), cryptoOutsideRange([outdated], "2026-01-01", "2026-05-31"), { start: "2026-01-01", end: "2026-05-31" }, false).find((c) => c.id === "crypto");
    expect(crypto?.ok).toBe(false);
    expect(crypto?.detail).toContain("periodo cerrado");
    expect(crypto?.detail).toContain("solo para auditoría");
    // Cuando el periodo se pueda actualizar, el cálculo vigente vuelve a intentarse.
    expect(eeffSyncState(outdated, input)).toBe("update");
  });

  it("mientras Cripto se está sincronizando tras un cambio, la lista lo indica sin tratarlo como error permanente", () => {
    const s = buildStatements({ company: COMPANY, catalog: lines(), mappings: [], movements: [], bankBalances: [], start: "2026-01-01", end: "2026-05-31", presentation: "otc" });
    const c = checklist(s, s, [], [], 0, [], [], { start: "2026-01-01", end: "2026-05-31" }, true).find((x) => x.id === "crypto");
    expect(c).toMatchObject({ ok: false });
    expect(c?.detail).toContain("se está actualizando");
  });

  it("DR: solo Ventas = ingreso propio, sin movimientos de costo ni de terceros y sin exigir sus PUC", () => {
    const catalog = lines();
    const mappings = maps();
    const dr = modelWith("dr", catalog, mappings);
    const banks = modelWith("banks", catalog, mappings);
    const input = buildEeffBatch(1, dr)!;
    expect(input.movements.map((x) => x.conceptKey)).toEqual(["crypto.sales"]);
    expect(input.movements[0].amountCents).toBe(dr.eeff.ownIncomeCents);
    expect(input.movements[0].amountCents).toBe(banks.components.find((c) => c.key === "sales")!.cents);
    expect(dr.components.map((c) => c.key)).toEqual(["sales"]);
    // Ni Costo de ventas ni las cuentas de terceros hacen falta: sin ellas el lote DR se arma igual.
    const withoutThirdPucs = modelWith("dr", catalog, new Map([["41359501", map("41359501", 18)]]), ["crypto.third_income", "crypto.third_cost", "crypto.cost_of_sales"]);
    expect(blocking(withoutThirdPucs.problems.eeff)).toEqual([]);
    expect(buildEeffBatch(1, withoutThirdPucs)!.movements.map((x) => x.conceptKey)).toEqual(["crypto.sales"]);
    // Con las mismas cuentas, Bancos sí las exige.
    expect(buildEeffBatch(1, modelWith("banks", catalog, mappings, ["crypto.third_income"]))).toBeNull();
  });

  it("DR en el Generador: Ventas recibe el ingreso propio y las demás líneas quedan en cero", () => {
    const catalog = lines();
    const mappings = maps();
    const input = buildEeffBatch(1, modelWith("dr", catalog, mappings))!;
    const own = modelWith("dr", catalog, mappings).eeff.ownIncomeCents!;
    for (const engine of ["bank", "otc"] as const) {
      expect(view(input, engine, catalog, mappings)).toEqual({ ventas: own, terceros: 0, costo: 0, costoTerceros: 0, unclassified: 0 });
    }
    // Distinto de Bancos: allí el valor de referencia se presenta aparte.
    const asBanks = view(buildEeffBatch(1, modelWith("banks", catalog, mappings))!, "bank", catalog, mappings);
    expect(asBanks.terceros).toBeGreaterThan(0);
    expect(asBanks.ventas).toBe(own);
  });

  it("de Bancos a DR el lote anterior se reemplaza (mismo año, otra huella) y no deja movimientos de terceros", () => {
    const catalog = lines();
    const mappings = maps();
    const banks = buildEeffBatch(1, modelWith("banks", catalog, mappings))!;
    const dr = buildEeffBatch(1, modelWith("dr", catalog, mappings))!;
    expect(dr.dedupeKey).toBe(banks.dedupeKey);
    expect(eeffSyncState(sentAs(banks), dr)).toBe("update");
    expect(dr.movements.some((x) => x.conceptKey !== "crypto.sales")).toBe(false);
  });
});
