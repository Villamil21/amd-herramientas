import { describe, expect, it } from "vitest";
import { decision, model, purchaseData, saleData, stored, upload } from "../../financial-statements/crypto/domain/testkit";
import type { CryptoModel } from "../../financial-statements/crypto/domain/model";
import type { CryptoDecision, CryptoStoredRow, CryptoUpload, Homologation } from "../../financial-statements/crypto/domain/types";
import { cityAliasKey } from "../../financial-statements/crypto/domain/places";
import { proposalsFor, type CryptoExoFormat } from "../../financial-statements/crypto/exogenaSync";
import type { ExoRecord, FormatStatus } from "../../../types/exogena";
import { cryptoFormatState, shouldReopen } from "./cryptoFormat";

/**
 * Pantallas 1007 y 1647: el estado «Listo» solo vale mientras lo guardado en Exógena coincide con lo que Transacciones Cripto
 * propone hoy y no hay pendientes. Estas pruebas recorren la misma lógica que usan las pantallas y la guardia de Transacciones
 * Cripto: se sincroniza, se marca «Listo» y se cambia el origen de cada forma posible.
 */

const PAYER_A = "31|800197268";
const buy = (u: number, row: number, amount: number, doc: string, extra: Partial<Parameters<typeof purchaseData>[0]> = {}): CryptoStoredRow =>
  stored(u, "purchase", row, purchaseData({ amount, date: "2026-02-10", docType: "CC", doc, firstName: "Ana", firstSurname: `P${doc}`, city: "Cali", order: `O${doc}`, ...extra }));
const sell = (u: number, row: number, amount: number, doc = "800197268", business = "Pagador A"): CryptoStoredRow => stored(u, "sale", row, saleData({ amount, docType: "NIT", doc, business }));

interface World {
  uploads: CryptoUpload[];
  rows: CryptoStoredRow[];
  decisions?: CryptoDecision[];
  homologations?: Homologation[];
}

const BASE: World = { uploads: [upload(1, "a.xlsx")], rows: [buy(1, 2, 100, "111"), buy(1, 3, 50, "222"), sell(1, 2, 1_000)] };

const asRecords = (m: CryptoModel, format: CryptoExoFormat): ExoRecord[] =>
  proposalsFor(m, format).map((p, i) => ({ id: i + 1, companyId: 1, year: 2026, formatCode: format, sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: p.data, manualFields: [], manuallyModifiedAt: null, syncedAt: "x", createdAt: "x", updatedAt: "x" }));

/** Estado «Listo» sincronizado con `before`; devuelve si la pantalla reabriría el formato frente a `after`. */
function reopens(format: CryptoExoFormat, before: World, after: World, status: FormatStatus = "listo"): boolean {
  const syncedWith = model(before);
  const stateNow = cryptoFormatState(model(after), format, asRecords(syncedWith, format));
  return shouldReopen(status, stateNow.problems);
}

describe.each<CryptoExoFormat>(["1007", "1647"])("formato %s — estado «Listo»", (format) => {
  it("sincronizado y sin pendientes se queda «Listo»", () => {
    const m = model(BASE);
    const s = cryptoFormatState(m, format, asRecords(m, format));
    expect(s.problems).toEqual([]);
    expect(s.changes).toEqual([]);
    expect(shouldReopen("listo", s.problems)).toBe(false);
    expect(proposalsFor(m, format).length).toBeGreaterThan(0);
  });

  it("solo se reabre un formato «Listo»: otros estados no cambian", () => {
    for (const status of ["en_preparacion", "requiere_actualizacion", "no_aplica"] as const) expect(reopens(format, BASE, { ...BASE, rows: [...BASE.rows, sell(1, 3, 5, "900642307", "B")] }, status)).toBe(false);
  });

  it("una carga nueva reabre el formato", () => {
    const extra = format === "1007" ? sell(2, 2, 7, "900642307", "Otro pagador") : buy(2, 2, 10, "333");
    expect(reopens(format, BASE, { ...BASE, uploads: [...BASE.uploads, upload(2, "b.xlsx")], rows: [...BASE.rows, extra] })).toBe(true);
  });

  it("reemplazar una carga con otros valores reabre el formato", () => {
    const rows = BASE.rows.map((r) => (r.kind === (format === "1007" ? "sale" : "purchase") && r.rowNumber === 2 ? { ...r, data: { ...r.data, [format === "1007" ? "Ingresos brutos recibidos" : "Valor total de la operación"]: 777 } } : r));
    expect(reopens(format, BASE, { ...BASE, rows })).toBe(true);
  });

  it("retirar una carga reabre el formato", () => {
    expect(reopens(format, BASE, { ...BASE, uploads: [{ ...BASE.uploads[0], status: "retired" }] })).toBe(true);
  });

  it("excluir una fila fuera del año o con error reabre el formato", () => {
    const withBad: World = { ...BASE, rows: [...BASE.rows, stored(1, "purchase", 9, purchaseData({ amount: 5, date: "2025-03-01", docType: "CC", doc: "999", firstName: "X", firstSurname: "Y", city: "Cali" }))] };
    // Con la fila pendiente ya hay un bloqueo; al sincronizar tras excluirla, deja de haberlo y todo coincide.
    const target = model(withBad).operations.find((o) => o.rowNumber === 9)!;
    const excluded: World = { ...withBad, decisions: [decision("row_exclude", target.identity, "exclude")] };
    const m = model(excluded);
    expect(cryptoFormatState(m, format, asRecords(m, format)).problems).toEqual([]);
    expect(reopens(format, excluded, withBad)).toBe(true);
  });

  it("una decisión de duplicado reabre el formato", () => {
    // Dos filas candidatas a duplicado: mientras no se decide, no cuentan; al excluir una, la otra cuenta.
    const kind = format === "1007" ? "sale" : "purchase";
    const dupRows = format === "1007" ? [sell(1, 3, 1_000)] : [buy(1, 4, 100, "111")];
    const world: World = { ...BASE, rows: [...BASE.rows, ...dupRows] };
    const pendingModel = model(world);
    const groups = pendingModel.groups.filter((g) => g.kind === kind && !g.resolved);
    expect(groups.length).toBeGreaterThan(0);
    const decided: World = { ...world, decisions: groups[0].members.slice(1).map((o) => decision("duplicate", o.identity, "exclude")) };
    // Sincronizado con la decisión; luego el usuario la cambia a «Conservar ambos».
    const keepBoth: World = { ...world, decisions: groups[0].members.map((o) => decision("duplicate", o.identity, "keep")) };
    expect(reopens(format, decided, keepBoth)).toBe(true);
    // Y desde «sin decidir» (con sus filas pendientes) hasta decidir también cambia lo propuesto.
    expect(reopens(format, world, decided)).toBe(true);
  });

  it("un tipo de documento clasificado a mano reabre el formato", () => {
    const rows = format === "1007" ? [...BASE.rows, stored(1, "sale", 3, saleData({ amount: 300, docType: "RARO", doc: "555", business: "Raro SAS" }))] : [...BASE.rows, buy(1, 4, 30, "444", { docType: "RARO" })];
    const world: World = { ...BASE, rows };
    const before = model(world);
    expect([...before.problems.f1007, ...before.problems.f1647].some((p) => p.kind === "document_type")).toBe(true);
    const classified: World = { ...world, homologations: [{ kind: "document", sourceKey: "RARO", value: "13" }] };
    expect(reopens(format, classified, world)).toBe(true);
  });

  it("confirmar el país de un documento extranjero reabre el formato", () => {
    const foreign = format === "1007" ? sell(1, 3, 300, "P123", "Extranjero") : null;
    if (!foreign) return;
    const rows = [...BASE.rows, { ...foreign, data: { ...foreign.data, "Tipo de documento de quien se recibe ingreso": "PA" } }];
    const world: World = { ...BASE, rows };
    const withCountry: World = { ...world, decisions: [decision("country", "41|P123", "249")] };
    expect(reopens(format, withCountry, { ...world, decisions: [decision("country", "41|P123", "840")] })).toBe(true);
  });
});

describe("formato 1647 — asignación y ciudad", () => {
  const TWO_PAYERS: World = {
    uploads: [upload(1, "a.xlsx")],
    rows: [buy(1, 2, 100, "111"), buy(1, 3, 50, "222"), sell(1, 2, 120, "800197268", "Pagador A"), sell(1, 3, 500, "900642307", "Pagador B")],
  };

  it("el reparto automático es first-fit: cada tercero va completo al primer pagador con saldo", () => {
    const m = model(TWO_PAYERS);
    const byThird = Object.fromEntries(m.form1647.thirds.map((t) => [t.key, t.payerKey]));
    expect(byThird["13|111"]).toBe(PAYER_A);
    expect(byThird["13|222"]).toBe("31|900642307");
  });

  it("una asignación manual reabre el formato", () => {
    const manual: World = { ...TWO_PAYERS, decisions: [decision("assignment", "13|111", "31|900642307")] };
    expect(model(manual).form1647.thirds.find((t) => t.key === "13|111")?.assignedBy).toBe("manual");
    expect(reopens("1647", TWO_PAYERS, manual)).toBe(true);
  });

  it("cambiar o quitar una asignación manual reabre el formato", () => {
    const manual: World = { ...TWO_PAYERS, decisions: [decision("assignment", "13|111", "31|900642307")] };
    expect(reopens("1647", manual, TWO_PAYERS)).toBe(true);
  });

  it("una ciudad elegida entre varias reabre el formato", () => {
    const rows = [buy(1, 2, 100, "111", { city: "Cali" }), buy(1, 3, 50, "111", { city: "Buenaventura", order: "O2" }), sell(1, 2, 1_000)];
    const world: World = { uploads: [upload(1, "a.xlsx")], rows };
    const blocked = model(world);
    expect(blocked.problems.f1647.some((p) => p.kind === "city_multiple" && p.level === "blocking")).toBe(true);
    const cali: World = { ...world, decisions: [decision("city", "13|111", "76001")] };
    const bue: World = { ...world, decisions: [decision("city", "13|111", "76109")] };
    expect(cryptoFormatState(model(cali), "1647", asRecords(model(cali), "1647")).problems).toEqual([]);
    expect(reopens("1647", cali, bue)).toBe(true);
    // El 1007 no depende de la ciudad.
    expect(reopens("1007", cali, bue)).toBe(false);
  });

  it("una ciudad ambigua bloquea hasta que se guarda su alias, y el alias reabre el formato", () => {
    const rows = [buy(1, 2, 100, "111", { city: "San Antonio" }), sell(1, 2, 1_000)];
    const world: World = { uploads: [upload(1, "a.xlsx")], rows };
    const ambiguous = model(world);
    expect(ambiguous.problems.f1647.some((p) => p.kind === "city_ambiguous" && p.level === "blocking")).toBe(true);
    const aliased: World = { ...world, homologations: [{ kind: "city", sourceKey: cityAliasKey("San Antonio"), value: "05647" }] };
    expect(model(aliased).problems.f1647.some((p) => p.kind.startsWith("city_"))).toBe(false);
    expect(reopens("1647", aliased, world)).toBe(true);
  });

  it("una ciudad ambigua mantiene el formato fuera de «Listo»: el pendiente bloquea", () => {
    const rows = [buy(1, 2, 100, "111", { city: "San Antonio" }), sell(1, 2, 1_000)];
    const m = model({ uploads: [upload(1, "a.xlsx")], rows });
    expect(shouldReopen("listo", cryptoFormatState(m, "1647", asRecords(m, "1647")).problems)).toBe(true);
  });
});
