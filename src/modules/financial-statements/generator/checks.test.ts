import { describe, expect, it } from "vitest";
import type { BankAccountLifecycle, BankBalance, BatchSummary, Movement } from "../../../types/fs";
import type { TaxReturn } from "../tax-obligations/types";
import { activeDuplicates, bankCoverage, coverage, maskAccount, taxCoverage } from "./checks";
import { bankBalanceStatus } from "./engine";

const mv = (id: number, date: string, batchId: number, extra: Partial<Movement> = {}) =>
  ({ id, companyId: 1, batchId, accountingDate: date, source: "purchases", documentId: `d${id}`, status: "active", amountCents: 1, pucCode: "513595" }) as Movement & typeof extra;

const batch = (id: number): BatchSummary => ({ id, companyId: 1, source: "purchases", fileName: `lote${id}`, periodLabel: "", periodStart: null, periodEnd: null, dedupeKey: "", recordCount: 1, totalCents: 1, status: "active", replacedBy: null, metadata: null, createdAt: "2026-10-14" });

describe("cobertura mensual", () => {
  it("no supone importación secuencial: muestra exactamente los meses que faltan", () => {
    const movements = [mv(1, "2026-01-15", 1), mv(2, "2026-02-03", 2), mv(3, "2026-04-20", 3), mv(4, "2026-06-30", 4), mv(5, "2026-09-01", 5)];
    const c = coverage("2026-01-01", "2026-08-31", movements, [], [1, 2, 3, 4, 5].map(batch));
    const purchases = c.rows.find((r) => r.source === "purchases")!;
    expect(c.months).toHaveLength(8);
    expect(c.months.filter((m) => purchases.cells[m].loaded)).toEqual(["2026-01", "2026-02", "2026-04", "2026-06"]);
    expect(purchases.missing).toEqual(["2026-03", "2026-05", "2026-07", "2026-08"]);
    expect(purchases.cells["2026-04"].batches.map((b) => b.fileName)).toEqual(["lote3"]);
    expect(c.rows.find((r) => r.source === "payroll")!.empty).toBe(true);
  });

  it("un mes con solo información reemplazada no cuenta como cargado, pero muestra el lote", () => {
    const c = coverage("2026-01-01", "2026-01-31", [{ ...mv(1, "2026-01-15", 1), status: "replaced" }], [], [batch(1)]);
    const cell = c.rows[0].cells["2026-01"];
    expect([cell.loaded, cell.batches.length]).toEqual([false, 1]);
  });
});

const bankBatch = (id: number, bank: string, accountNumber: string, month: string, extra: Partial<BatchSummary> = {}): BatchSummary => ({
  ...batch(id),
  source: "bank",
  periodStart: `${month}-01`,
  periodEnd: `${month}-28`,
  metadata: { bank, accountNumber },
  ...extra,
});
const bankMv = (id: number, batchId: number, date: string, count: number) => ({ ...mv(id, date, batchId), source: "bank", detail: { count } }) as unknown as Movement;
const balance = (batchId: number, date: string, cents: number, active = true): BankBalance => ({ id: batchId, batchId, bank: "", accountNumber: "", balanceDate: date, balanceCents: cents, pucCode: "111005", active });

describe("cobertura de extractos por banco y cuenta", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];

  it("separa bancos y cuentas del mismo banco; la fila global no se marca con un solo banco", () => {
    const batches = [
      ...months.map((m, i) => bankBatch(i + 1, "Bancolombia", "123-456789-01", m)),
      bankBatch(10, "BBVA", "0013007491", "2026-01"),
      bankBatch(11, "BBVA", "0013007491", "2026-02"),
      bankBatch(12, "BBVA", "0013007491", "2026-04"),
      bankBatch(20, "BBVA", "0013002258", "2026-01"),
    ];
    const c = bankCoverage(months, [], [], batches);
    expect(c.banks.map((b) => [b.bank, b.accounts.length])).toEqual([["Bancolombia", 1], ["BBVA", 2]]);
    const [b7491, b2258] = [c.banks[1].accounts.find((a) => a.accountNumber.endsWith("7491"))!, c.banks[1].accounts.find((a) => a.accountNumber.endsWith("2258"))!];
    expect(b7491.missing).toEqual(["2026-03"]);
    expect(b2258.missing).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(b7491.lastMonth).toBe("2026-04");
    expect([c.missingCount, c.accountsWithMissing]).toEqual([4, 2]);
    expect(c.cells["2026-01"]).toMatchObject({ loaded: 3, total: 3 });
    expect(c.cells["2026-03"]).toMatchObject({ loaded: 1, total: 3 });

    const row = coverage("2026-01-01", "2026-04-30", [], [], batches).rows.find((r) => r.source === "bank")!;
    expect(row.missing).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(row.empty).toBe(false);
  });

  it("solo cuenta el extracto activo; el reemplazado sigue en el detalle con su saldo", () => {
    const batches = [bankBatch(1, "BBVA", "7491", "2026-01", { status: "replaced", replacedBy: 2 }), bankBatch(2, "BBVA", "7491", "2026-01"), bankBatch(3, "BBVA", "7491", "2026-02", { status: "replaced", replacedBy: null })];
    const c = bankCoverage(months, [bankMv(1, 2, "2026-01-28", 12), bankMv(2, 2, "2026-01-28", 3)], [balance(1, "2026-01-28", 100, false), balance(2, "2026-01-28", 250)], batches);
    const a = c.banks[0].accounts[0];
    expect(a.missing).toEqual(["2026-02", "2026-03", "2026-04"]);
    const jan = a.cells["2026-01"];
    expect([jan.loaded, jan.hasReplaced, jan.statements.length]).toEqual([1, true, 2]);
    const active = jan.statements.find((s) => s.batch.id === 2)!;
    expect([active.movementCount, active.closingBalanceCents, active.replaced.map((b) => b.id)]).toEqual([15, 250, [1]]);
  });

  it("no muestra cuentas con todo anulado ni bancos que la empresa no usa", () => {
    const c = bankCoverage(months, [], [], [bankBatch(1, "Davivienda", "1", "2026-01", { status: "voided" }), batch(2)]);
    expect(c.banks).toEqual([]);
    expect(coverage("2026-01-01", "2026-04-30", [], [], [batch(2)]).rows.find((r) => r.source === "bank")!.empty).toBe(true);
  });

  it("el mes final sin saldo deja la cuenta pendiente y la fuente bancaria incompleta", () => {
    const sep = ["2026-08", "2026-09"];
    const batches = [bankBatch(1, "Bancolombia", "1234", "2026-08"), bankBatch(2, "Bancolombia", "1234", "2026-09"), bankBatch(3, "BBVA", "7491", "2026-08"), bankBatch(4, "BBVA", "7491", "2026-09")];
    const own = (b: BankBalance, bank: string, accountNumber: string) => ({ ...b, bank, accountNumber });
    // BBVA envió el extracto de septiembre pero sin saldo final: sigue pendiente.
    const balances = [own(balance(1, "2026-08-28", 1), "Bancolombia", "1234"), own(balance(2, "2026-09-28", 2), "Bancolombia", "1234"), own(balance(3, "2026-08-28", 3), "BBVA", "7491")];
    const c = bankCoverage(sep, [], balances, batches);
    expect(c.banks.map((b) => [b.bank, b.accounts[0].finalBalanceMissing])).toEqual([["Bancolombia", false], ["BBVA", true]]);
    expect([c.missingCount, c.finalBalanceMissing]).toEqual([0, 1]);
    const row = coverage("2026-08-01", "2026-09-30", [], balances, batches).rows.find((r) => r.source === "bank")!;
    expect(row.missing).toEqual(["2026-09"]);
  });

  it("enmascara la cuenta con sus últimos cuatro dígitos", () => {
    expect([maskAccount("001-300-7491"), maskAccount("")]).toEqual(["••••7491", "Sin número de cuenta"]);
  });
});

describe("cuentas abiertas o cerradas durante el año", () => {
  const year = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const life = (openedPeriod: string | null, closedPeriod: string | null): BankAccountLifecycle => ({
    companyId: 1,
    bank: "Bancolombia",
    accountNumber: "1234",
    openedPeriod,
    closedPeriod,
    status: closedPeriod ? "closed" : "active",
    updatedAt: "",
    events: [],
  });
  const sent = (months: string[]) => months.map((m, i) => bankBatch(i + 1, "Bancolombia", "1234", m));
  const own = (b: BankBalance): BankBalance => ({ ...b, bank: "Bancolombia", accountNumber: "1234" });

  it("prueba 22 — cierre confirmado en junio: julio a septiembre «No aplica» y no bloquean", () => {
    const batches = sent(year.slice(0, 6));
    const balances = [own(balance(6, "2026-06-28", 0))];
    const c = bankCoverage(year, [], balances, batches, [life(null, "2026-06")]);
    const a = c.banks[0].accounts[0];
    expect(a.missing).toEqual([]);
    expect(year.slice(6).map((m) => [a.cells[m].total, a.cells[m].notApplicable])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    expect([c.missingCount, c.finalBalanceMissing]).toEqual([0, 0]);
    expect(coverage("2026-01-01", "2026-09-30", [], balances, batches, [life(null, "2026-06")]).rows.find((r) => r.source === "bank")!.missing).toEqual([]);
    // ESF de septiembre: la cuenta cerrada no deja el saldo pendiente.
    const status = bankBalanceStatus(balances, "2026-09-30", [life(null, "2026-06")]);
    expect(status[0]).toMatchObject({ balance: null, closedPeriod: "2026-06" });
  });

  it("prueba 23 — saldo 0 sin cierre («sigue activa»): abril y mayo siguen siendo requeridos", () => {
    const months = year.slice(0, 5);
    const c = bankCoverage(months, [], [], sent(months.slice(0, 3)), []);
    expect(c.banks[0].accounts[0].missing).toEqual(["2026-04", "2026-05"]);
    expect(bankBalanceStatus([own(balance(3, "2026-03-28", 0))], "2026-05-31", [])[0].closedPeriod).toBeUndefined();
  });

  it("prueba 24 — apertura confirmada en abril: enero a marzo «No aplica»", () => {
    const months = year.slice(0, 4);
    const c = bankCoverage(months, [], [], sent(["2026-04"]), [life("2026-04", null)]);
    const a = c.banks[0].accounts[0];
    expect(a.missing).toEqual([]);
    expect(months.map((m) => (a.cells[m].notApplicable ? "N/A" : a.cells[m].loaded ? "✓" : "—"))).toEqual(["N/A", "N/A", "N/A", "✓"]);
  });

  it("sin apertura confirmada se usa la regla general (todos los meses del rango)", () => {
    const c = bankCoverage(year.slice(0, 4), [], [], sent(["2026-04"]), []);
    expect(c.banks[0].accounts[0].missing).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});

describe("duplicados activos", () => {
  it("detecta un documento activo en dos importaciones", () => {
    expect(activeDuplicates([mv(1, "2026-01-01", 1), { ...mv(2, "2026-01-01", 2), documentId: "d1" }, { ...mv(3, "2026-01-01", 3), documentId: "d1", status: "replaced" }])).toEqual([{ source: "purchases", documentId: "d1", batchIds: [1, 2] }]);
  });
});

describe("cobertura de obligaciones tributarias", () => {
  const r = (id: number, taxType: TaxReturn["taxType"], year: number, period: number | null, periodicity: TaxReturn["periodicity"], periodStart: string, extra: Partial<TaxReturn> = {}) =>
    ({ id, taxType, year, period, periodicity, periodStart, supersededBy: null, ...extra }) as TaxReturn;
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

  it("Retefuente por mes, IVA por periodo (sin partirlo en meses) y Renta por año", () => {
    const returns = [
      r(1, "withholding", 2026, 9, "monthly", "2026-09-01"),
      r(2, "withholding", 2026, 8, "monthly", "2026-08-01", { supersededBy: 9 }),
      r(3, "vat", 2026, 4, "bimonthly", "2026-07-01"),
      r(4, "income", 2023, null, "annual", "2023-01-01"),
      r(5, "income", 2025, null, "annual", "2025-01-01"),
    ];
    const t = taxCoverage(months, returns, "bimonthly", "2026-09-30");
    expect(months.filter((m) => t.withholding[m].length)).toEqual(["2026-09"]);
    expect(t.vat.periods.map((p) => [p.period, p.months.length, p.returns.length])).toEqual([[1, 2, 0], [2, 2, 0], [3, 2, 0], [4, 2, 1], [5, 1, 0]]);
    expect(t.income.map((y) => [y.year, y.returns.length])).toEqual([[2023, 1], [2024, 0], [2025, 1]]);
    expect(taxCoverage(months, returns, "four_monthly", "2026-09-30").vat.periods.map((p) => p.months.length)).toEqual([4, 4, 1]);
  });
});
