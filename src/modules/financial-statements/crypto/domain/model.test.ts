import { describe, expect, it } from "vitest";
import { defaultSettings, readSettings, reconcileRows } from "./model";
import { blocking } from "./problems";
import { decision, model, purchaseData, saleData, stored, upload } from "./testkit";

const buy = (uploadId: number, row: number, month: number, amount: number, doc: string) =>
  stored(uploadId, "purchase", row, purchaseData({ amount, date: `2026-${String(month).padStart(2, "0")}-10`, docType: "CC", doc, firstName: "N", firstSurname: doc, city: "Cali" }));
const sell = (uploadId: number, row: number, amount: number, doc: string) => stored(uploadId, "sale", row, saleData({ amount, docType: "NIT", doc, business: `E${doc}` }));

describe("cargas acumulativas y cobertura mensual", () => {
  const uploads = [upload(1, "enero-marzo.xlsx"), upload(2, "abril.xlsx"), upload(3, "mayo-septiembre.xlsx")];
  const rows = [
    buy(1, 2, 1, 100, "1"), buy(1, 3, 3, 100, "2"), sell(1, 2, 500, "10"),
    buy(2, 2, 4, 100, "3"), sell(2, 2, 200, "11"),
    buy(3, 2, 5, 100, "4"), buy(3, 3, 9, 100, "5"), sell(3, 2, 900, "12"),
  ];

  it("importar enero–marzo, abril y mayo–septiembre agrega operaciones sin reiniciar lo ya importado", () => {
    const m = model({ uploads, rows });
    expect(m.counts).toMatchObject({ files: 3, accepted: 8, acceptedPurchases: 5, acceptedSales: 3, pending: 0 });
    expect(m.counts.purchasesCents).toBe(50_000);
    expect(m.counts.salesCents).toBe(160_000);
    expect(m.counts.coveredMonths).toBe(5);
    expect(m.matrix.filter((x) => x.uploads.length).map((x) => [x.month, x.uploads.map((u) => u.fileName)])).toEqual([
      ["2026-01", ["enero-marzo.xlsx"]],
      ["2026-03", ["enero-marzo.xlsx"]],
      ["2026-04", ["abril.xlsx"]],
      ["2026-05", ["mayo-septiembre.xlsx"]],
      ["2026-09", ["mayo-septiembre.xlsx"]],
    ]);
    expect(m.missing).toContain("2026-02");
  });

  it("una superposición entre archivos no es un error: ambos aportan el mes", () => {
    const m = model({ uploads: [upload(1, "a.xlsx"), upload(2, "b.xlsx")], rows: [buy(1, 2, 3, 10, "1"), buy(2, 2, 3, 20, "2")] });
    expect(m.matrix.find((x) => x.month === "2026-03")?.uploads).toHaveLength(2);
    expect(m.counts.pending).toBe(0);
  });

  it("reemplazar un archivo: lo que ya no está en la nueva versión deja de alimentar los cálculos", () => {
    // Versión nueva de abril.xlsx sin su venta: las filas son las que quedan guardadas tras el reemplazo.
    const replaced = rows.filter((r) => !(r.uploadId === 2 && r.kind === "sale"));
    const m = model({ uploads, rows: replaced });
    expect(m.counts.salesCents).toBe(140_000);
    expect(m.counts.acceptedSales).toBe(2);
  });

  it("una carga retirada deja de aportar cobertura y operaciones", () => {
    const m = model({ uploads: [uploads[0], { ...uploads[1], status: "retired" }, uploads[2]], rows });
    expect(m.counts.files).toBe(2);
    expect(m.matrix.find((x) => x.month === "2026-04")?.uploads).toHaveLength(0);
  });

  it("las compras de otro año no cuentan para la cobertura hasta resolverse", () => {
    const m = model({ uploads: [upload(1, "a.xlsx")], rows: [buy(1, 2, 2, 10, "1"), stored(1, "purchase", 3, purchaseData({ amount: 10, date: "2025-06-01", docType: "CC", doc: "2" }))] });
    expect(m.coverages[0].months).toEqual(["2026-02"]);
    expect(m.counts.pending).toBe(1);
    expect(blocking(m.problems.eeff).some((p) => p.kind === "year")).toBe(true);
  });

  it("trazabilidad y conciliación: cada resultado se explica contra el origen", () => {
    const m = model({ uploads, rows });
    expect(m.reconciliation.f1007).toMatchObject({ originCents: 160_000, proposedCents: 160_000, differenceCents: 0 });
    expect(m.reconciliation.f1647).toMatchObject({ originCents: 50_000, distributedCents: 50_000, differenceCents: 0 });
    expect(m.reconciliation.eeff.differenceCents).toBe(0);
    expect(m.reconciliation.uploads.map((u) => [u.fileName, u.rows, u.coverage])).toEqual([
      ["enero-marzo.xlsx", 0, "2026-01 a 2026-03"],
      ["abril.xlsx", 0, "2026-04 a 2026-04"],
      ["mayo-septiembre.xlsx", 0, "2026-05 a 2026-09"],
    ]);
    expect(m.reconciliation.eeff.ownIncomeCents).toBe(160_000 - 50_000);
  });

  it("con PUC faltante el dato queda pendiente y el resultado no puede estar listo", () => {
    const m = model({ uploads, rows, puc: () => ({ code: undefined, valid: false, located: false }) });
    expect(blocking(m.problems.eeff).some((p) => p.kind === "puc")).toBe(true);
    expect(m.reconciliation.pending.puc).toBeGreaterThan(0);
    // El dato importado se conserva.
    expect(m.counts.accepted).toBe(8);
  });

  it("los pendientes de duplicados y de formato se cuentan por separado", () => {
    const dup = model({ uploads: [upload(1, "a.xlsx"), upload(2, "b.xlsx")], rows: [buy(1, 2, 1, 10, "1"), buy(2, 2, 1, 10, "1")] });
    expect(dup.reconciliation.pending.duplicates).toBe(1);
    expect(blocking(dup.problems.eeff).some((p) => p.kind === "duplicate")).toBe(true);
  });
});

describe("configuración", () => {
  it("corte y presentación guardados; un corte de otro año vuelve al cierre", () => {
    expect(readSettings([], 2026)).toEqual(defaultSettings(2026));
    expect(readSettings([decision("setting", "cutoff", "2026-09-30"), decision("setting", "presentation", "banks")], 2026)).toEqual({ cutoff: "2026-09-30", presentation: "banks" });
    expect(readSettings([decision("setting", "cutoff", "2025-09-30"), decision("setting", "presentation", "otra")], 2026)).toEqual(defaultSettings(2026));
  });
});

describe("conciliación exacta de filas", () => {
  it("cada fila cae en una sola categoría y nada queda sin estado", () => {
    const u = upload(1, "a.xlsx");
    const p = (row: number, amount: number, doc: string, date: string, order: string) => stored(1, "purchase", row, purchaseData({ amount, date, docType: "NIT", doc, business: `E${doc}`, order }));
    const rows = [
      p(2, 100, "900", "2026-01-05", "1"),
      p(3, 200, "901", "2025-01-05", "2"),
      stored(1, "purchase", 4, { ...purchaseData({ amount: 300, date: "2026-01-05", docType: "NIT", doc: "902", business: "C" }), "Valor total de la operación": "xx" }),
      p(5, 400, "903", "2025-02-05", "3"),
      sell(1, 2, 50, "800"),
      sell(1, 3, 50, "800"),
      sell(1, 4, 70, "801"),
    ];
    const m = model({ rows, uploads: [{ ...u, rowCount: rows.length }], decisions: [decision("row_exclude", `a.xlsx|purchase|${rows[3].fingerprint}|0`, "exclude")] });
    const r = m.reconciliation.rows;
    expect(r.total).toBe(7);
    expect(r.accepted).toEqual({ purchase: 1, sale: 1 });
    expect(r.outOfYear).toEqual({ purchase: 1, sale: 0 });
    expect(r.invalid).toEqual({ purchase: 1, sale: 0 });
    expect(r.duplicatesPending).toEqual({ purchase: 0, sale: 2 });
    expect(r.duplicateGroups).toBe(1);
    expect(r.excludedByUser).toEqual({ purchase: 1, sale: 0 });
    expect(r.unexplained).toBe(0);
    // Solo las filas aceptadas alimentan resultados; las pendientes no tocan 1007 ni 1647.
    expect(m.counts.acceptedPurchases).toBe(1);
    expect(m.counts.acceptedSales).toBe(1);
    expect(m.form1007.originCents).toBe(7000);
    expect(m.form1647.originCents).toBe(10000);
  });

  it("una fila sin estado explicable se reporta y bloquea", () => {
    const u = upload(1, "a.xlsx");
    const rows = [stored(1, "sale", 2, saleData({ amount: 5, docType: "NIT", doc: "1", business: "X" }))];
    const m = model({ rows, uploads: [{ ...u, rowCount: 1 }] });
    const weird = { ...m.operations[0], status: "pending" as const, issues: [] };
    const r = reconcileRows([weird], 0, 0);
    expect(r.unexplained).toBe(1);
  });
});

describe("cobertura mensual solo con filas aceptadas", () => {
  const p = (row: number, month: number, amount: number, doc: string, order: string) => stored(1, "purchase", row, purchaseData({ amount, date: `2026-${String(month).padStart(2, "0")}-10`, docType: "NIT", doc, business: `E${doc}`, order }));
  // Marzo: dos compras idénticas (duplicado sin decidir) + Abril: una compra con valor ilegible; Enero y Febrero limpias.
  const bad = stored(1, "purchase", 6, { ...purchaseData({ amount: 1, date: "2026-04-10", docType: "NIT", doc: "9", business: "E9" }), "Valor total de la operación": "xx" });
  const rows = [p(2, 1, 100, "1", "a"), p(3, 2, 200, "2", "b"), p(4, 3, 300, "3", "c"), p(5, 3, 300, "3", "c"), bad, sell(1, 2, 10, "800")];
  const uploads = [{ ...upload(1, "a.xlsx"), rowCount: rows.length }];

  it("un mes con pendientes no se marca cubierto y los muestra con cantidad y motivo", () => {
    const m = model({ rows, uploads });
    expect(m.coverages[0].months).toEqual(["2026-01", "2026-02"]);
    expect(m.coverages[0].derived).toEqual(["2026-01", "2026-02"]);
    expect(m.counts.coveredMonths).toBe(2);
    const march = m.matrix.find((x) => x.month === "2026-03")!;
    expect(march.uploads).toHaveLength(0);
    expect(march.pending[0].pending).toEqual({ month: "2026-03", count: 2, reasons: [{ reason: "posible duplicado", count: 2 }] });
    const april = m.matrix.find((x) => x.month === "2026-04")!;
    expect(april.pending[0].pending.reasons).toEqual([{ reason: "valor ilegible o vacío", count: 1 }]);
  });

  it("queda cubierto al excluir o aceptar sus filas", () => {
    const decisions = [decision("duplicate", rows[3].fingerprint && `a.xlsx|purchase|${rows[3].fingerprint}|1`, "exclude"), decision("row_exclude", `a.xlsx|purchase|${bad.fingerprint}|0`, "exclude")];
    const m = model({ rows, uploads, decisions });
    expect(m.coverages[0].months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(m.matrix.every((x) => x.pending.length === 0)).toBe(true);
  });

  it("un ajuste manual tampoco cubre un mes con pendientes, pero conserva lo elegido", () => {
    const m = model({ rows, uploads: [{ ...uploads[0], coverageOverride: ["2026-01", "2026-03", "2026-05"] }] });
    expect(m.coverages[0].selected).toEqual(["2026-01", "2026-03", "2026-05"]);
    expect(m.coverages[0].months).toEqual(["2026-01", "2026-05"]);
  });

  it("las ventas pendientes se listan sin mes", () => {
    const m = model({ rows: [...rows, sell(1, 3, 10, "800")], uploads });
    expect(m.coverages[0].unmonthed.sales).toBe(2);
  });
});
