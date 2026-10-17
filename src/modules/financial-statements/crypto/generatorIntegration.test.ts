import { describe, expect, it } from "vitest";
import type { BatchSummary, FsCatalog, FsLine, FsPucMapping, FsSectionKey, Movement } from "../../../types/fs";
import { checklist } from "../generator/checks";
import { buildStatements } from "../generator/engine";
import { purchaseData, saleData, decision, model, stored, upload } from "./domain/testkit";
import { blocking } from "./domain/problems";
import { buildEeffBatch, cryptoOutsideRange, eeffSyncState, staleCryptoYears } from "./eeffBatch";

/**
 * Integración Transacciones Cripto → Generador. El lote de cripto fecha sus movimientos en el corte; el Generador solo cuenta
 * movimientos dentro de su rango. Caso real: corte 2026-12-31 (OTC) y Generador 2026-01-01 → 2026-05-31: el lote quedaba
 * «al día» pero Ventas y Costo de ventas salían en cero sin ninguna alerta.
 */
const SEED: [number, FsSectionKey, string, FsLine["role"]][] = [[18, "income", "Ventas", "sales"], [19, "income", "Ingresos para terceros", "third_party_income"], [21, "costs", "Costo de Ventas", "cost_of_sales"], [22, "costs", "Costo de terceros", "third_party_cost"]];
const catalog: FsCatalog = { lines: SEED.map(([id, section, name, role], i) => ({ id, section, name, role, sortOrder: i, isActive: true, hasHistory: false })), sections: [] };
const map = (pucCode: string, lineId: number): FsPucMapping => ({ pucCode, lineId, excluded: false, updatedAt: "" });
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
