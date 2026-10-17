import { describe, expect, it } from "vitest";
import { classifyOperations } from "./classify";
import { buildOperations } from "./operations";
import { decision, purchaseData, saleData, stored, upload } from "./testkit";

const ctx = { year: 2026, docLookup: { stored: new Map<string, string>() } };
const buy = (uploadId: number, row: number, o: Parameters<typeof purchaseData>[0]) => stored(uploadId, "purchase", row, purchaseData(o));
const base = { amount: 1_000_000, docType: "CC", doc: "1018423456", firstName: "ANA", firstSurname: "PEREZ", city: "Cali", date: "2026-01-15", order: "A-1" };

function run(rows: ReturnType<typeof stored>[], decisions: ReturnType<typeof decision>[] = []) {
  const ops = buildOperations([upload(1, "a.xlsx"), upload(2, "b.xlsx")], rows, ctx);
  return classifyOperations(ops, decisions);
}

describe("estado de las operaciones", () => {
  it("una compra válida queda aceptada", () => {
    const { operations } = run([buy(1, 2, base)]);
    expect(operations[0]).toMatchObject({ status: "accepted", amountCents: 100_000_000, date: "2026-01-15", docCode: "13", docNumber: "1018423456" });
  });

  it("una fecha de otro año es un pendiente que no afecta resultados hasta excluirla", () => {
    const rows = [buy(1, 2, base), buy(1, 3, { ...base, date: "2025-12-31", doc: "1" }), buy(1, 4, { ...base, date: "2027-01-01", doc: "2" })];
    const { operations } = run(rows);
    expect(operations.map((o) => o.status)).toEqual(["accepted", "pending", "pending"]);
    expect(operations[1].issues[0]).toMatchObject({ code: "year" });
    const excluded = run(rows, [decision("row_exclude", operations[1].identity, "exclude")]);
    expect(excluded.operations.map((o) => o.status)).toEqual(["accepted", "excluded", "pending"]);
  });

  it("fecha o valor ilegibles quedan pendientes", () => {
    const { operations } = run([buy(1, 2, { ...base, date: "ayer" }), stored(1, "purchase", 3, { ...purchaseData(base), "Valor total de la operación": "mucho" }), stored(1, "sale", 2, { "Tipo de documento de quien se recibe ingreso": "NIT" })]);
    expect(operations[0].issues[0].code).toBe("date");
    expect(operations[1].issues[0].code).toBe("amount");
    expect(operations[2].issues[0].code).toBe("amount");
  });

  it("una carga retirada no alimenta nada", () => {
    const ops = buildOperations([upload(1, "a.xlsx", { status: "retired" })], [buy(1, 2, base)], ctx);
    expect(ops).toHaveLength(0);
  });
});

describe("posibles duplicados", () => {
  it("nunca se omiten: ambas filas quedan pendientes hasta que el usuario decida", () => {
    const { operations, groups } = run([buy(1, 2, base), buy(2, 2, base)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ level: "exact", resolved: false });
    expect(operations.map((o) => o.status)).toEqual(["pending", "pending"]);
    expect(operations[0].issues[operations[0].issues.length - 1]?.code).toBe("duplicate");
  });

  it("«Conservar ambos» incluye las dos operaciones", () => {
    const first = run([buy(1, 2, base), buy(2, 2, base)]).operations;
    const kept = run([buy(1, 2, base), buy(2, 2, base)], first.map((o) => decision("duplicate", o.identity, "keep")));
    expect(kept.operations.map((o) => o.status)).toEqual(["accepted", "accepted"]);
    expect(kept.groups[0].resolved).toBe(true);
  });

  it("«Excluir esta fila» saca solo la elegida y deja la otra aceptada", () => {
    const first = run([buy(1, 2, base), buy(2, 2, base)]).operations;
    const out = run([buy(1, 2, base), buy(2, 2, base)], [decision("duplicate", first[1].identity, "exclude")]);
    expect(out.operations.map((o) => o.status)).toEqual(["accepted", "excluded"]);
    expect(out.operations[1].excludedBy).toBe("duplicate");
  });

  it("dos compras con Orden distinta son operaciones distintas", () => {
    const { groups, operations } = run([buy(1, 2, base), buy(2, 2, { ...base, order: "A-2" })]);
    expect(groups).toHaveLength(0);
    expect(operations.map((o) => o.status)).toEqual(["accepted", "accepted"]);
  });

  it("sin Orden en una de ellas es un duplicado probable cuando cambia el tercero", () => {
    const { groups } = run([buy(1, 2, base), buy(2, 2, { ...base, order: undefined, firstName: "ANITA" })]);
    expect(groups[0].level).toBe("probable");
  });

  it("detecta duplicados dentro de la misma carga y también en Ventas", () => {
    const sale = (row: number) => stored(1, "sale", row, saleData({ amount: 500, docType: "NIT", doc: "800197268", business: "EMPRESA" }));
    const { groups } = run([buy(1, 2, base), buy(1, 3, base), sale(2), sale(3)]);
    expect(groups.map((g) => g.kind).sort()).toEqual(["purchase", "sale"]);
  });

  it("la decisión reaparece si la fila de origen cambia", () => {
    const original = run([buy(1, 2, base), buy(2, 2, base)]).operations;
    const decisions = original.map((o) => decision("duplicate", o.identity, "keep"));
    // La fila de la segunda carga cambia (otro valor): ya no es candidata y su identidad nueva no tiene decisión.
    const changed = run([buy(1, 2, base), buy(2, 2, { ...base, amount: 2_000_000 })], decisions);
    expect(changed.groups).toHaveLength(0);
    // Pero si el cambio la vuelve a hacer candidata contra otra fila, la nueva identidad exige decisión.
    const again = run([buy(1, 2, base), buy(2, 2, { ...base, amount: 2_000_000 }), buy(2, 3, { ...base, amount: 2_000_000 })], decisions);
    expect(again.groups[0].resolved).toBe(false);
  });

  it("filas idénticas dentro de un archivo conservan su decisión aunque cambien de posición", () => {
    const first = run([buy(1, 2, base), buy(1, 3, base)]).operations;
    const decisions = first.map((o) => decision("duplicate", o.identity, "keep"));
    const moved = run([buy(1, 7, base), buy(1, 9, base)], decisions);
    expect(moved.operations.map((o) => o.status)).toEqual(["accepted", "accepted"]);
  });

  it("un tercer duplicado idéntico obliga a revisar de nuevo el grupo", () => {
    const first = run([buy(1, 2, base), buy(2, 2, base)]).operations;
    const decisions = first.map((o) => decision("duplicate", o.identity, "keep"));
    const third = run([buy(1, 2, base), buy(2, 2, base), buy(2, 3, base)], decisions);
    expect(third.groups[0].resolved).toBe(false);
    expect(third.operations.every((o) => o.status === "pending")).toBe(true);
  });
});
