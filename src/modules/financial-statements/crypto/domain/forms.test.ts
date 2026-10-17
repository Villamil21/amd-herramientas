import { describe, expect, it } from "vitest";
import { rowOf } from "../../../exogena/domain/exportWorkbook";
import { blocking } from "./problems";
import { isPending, NOT_APPLICABLE, PENDING } from "./parties";
import { decision, model, purchaseData, saleData, stored, upload } from "./testkit";

const U = [upload(1, "ene.xlsx"), upload(2, "feb.xlsx")];
const buy = (uploadId: number, row: number, o: Parameters<typeof purchaseData>[0]) => stored(uploadId, "purchase", row, purchaseData(o));
const sell = (uploadId: number, row: number, o: Parameters<typeof saleData>[0]) => stored(uploadId, "sale", row, saleData(o));

const ANA = { docType: "CC", doc: "1018423456", firstName: "ANA", firstSurname: "PEREZ", city: "Cali" };
const LUIS = { docType: "CC", doc: "79123456", firstName: "LUIS", firstSurname: "GOMEZ", city: "Medellín" };
const ACME = { docType: "NIT", doc: "900642307", business: "ACME SAS" };
const BETA = { docType: "NIT", doc: "800197268", business: "BETA SAS" };

describe("formato 1007", () => {
  it("agrupa Ventas por tipo documental e identificación, concepto 4001, DV de NIT y país 169", () => {
    const m = model({ uploads: U, rows: [sell(1, 2, { ...ACME, amount: 1_000_000 }), sell(1, 3, { ...ACME, amount: 2_500_000.4, firstName: undefined }), sell(2, 2, { docType: "CC", doc: "1018423456", firstName: "ANA", firstSurname: "PEREZ", amount: 300_000 })] });
    const records = m.form1007.records;
    expect(records).toHaveLength(2);
    const acme = records.find((r) => r.data.docNumber === "900642307")!;
    expect(acme.data).toMatchObject({ concept: "4001", docTypeCode: "31", dv: "5", countryCode: "169", businessName: "ACME SAS", grossIncome: 3_500_000, returns: 0 });
    // Persona jurídica: lo que no aplica se rellena, nunca queda vacío.
    expect(acme.data).toMatchObject({ firstSurname: NOT_APPLICABLE, firstName: NOT_APPLICABLE, secondSurname: NOT_APPLICABLE, otherNames: NOT_APPLICABLE });
    const ana = records.find((r) => r.data.docNumber === "1018423456")!;
    expect(ana.data).toMatchObject({ docTypeCode: "13", dv: NOT_APPLICABLE, businessName: NOT_APPLICABLE, firstName: "ANA", countryCode: "169", grossIncome: 300_000 });
    expect(m.form1007.originCents).toBe(380_000_040);
  });

  it("un tipo distinto de 11–15 y 31 exige confirmar el país; al confirmarlo se completa", () => {
    const rows = [sell(1, 2, { docType: "PA", doc: "AB123", firstName: "JOHN", firstSurname: "DOE", amount: 100 })];
    const pending = model({ uploads: U, rows });
    expect(pending.form1007.records[0].data.countryCode).toBe(PENDING);
    expect(blocking(pending.problems.f1007).some((p) => p.kind === "country")).toBe(true);
    const done = model({ uploads: U, rows, decisions: [decision("country", "41|AB123", "249")] });
    expect(done.form1007.records[0].data.countryCode).toBe("249");
    expect(blocking(done.problems.f1007)).toHaveLength(0);
  });

  it("no propone filas sin tipo clasificado o sin identificación y lo dice con precisión", () => {
    const m = model({ uploads: U, rows: [sell(1, 2, { docType: "XYZ", doc: "1", amount: 100 }), sell(1, 3, { docType: "NIT", amount: 200 }), sell(1, 4, { ...ACME, amount: 300 })] });
    expect(m.form1007.records).toHaveLength(1);
    expect(m.form1007.unproposedCents).toBe(30_000);
    const kinds = m.problems.f1007.map((p) => p.kind);
    expect(kinds).toEqual(expect.arrayContaining(["document_type", "identification", "unproposed"]));
    expect(m.problems.f1007.find((p) => p.kind === "identification")?.message).toMatch(/Ventas, ene\.xlsx, fila 3/);
  });

  it("la homologación de un tipo desconocido se guarda y vale para las siguientes filas", () => {
    const rows = [sell(1, 2, { docType: "XYZ", doc: "123", firstName: "A", firstSurname: "B", amount: 100 })];
    expect(model({ uploads: U, rows }).form1007.records).toHaveLength(0);
    const m = model({ uploads: U, rows, homologations: [{ kind: "document", sourceKey: "XYZ", value: "13" }] });
    expect(m.form1007.records[0].data.docTypeCode).toBe("13");
  });

  it("solo cuentan las Ventas aceptadas: un duplicado sin decidir no entra", () => {
    const m = model({ uploads: U, rows: [sell(1, 2, { ...ACME, amount: 100 }), sell(2, 2, { ...ACME, amount: 100 })] });
    expect(m.form1007.records).toHaveLength(0);
    expect(m.form1007.originCents).toBe(0);
  });

  it("una exportación lista no tiene columnas vacías", () => {
    const m = model({ uploads: U, rows: [sell(1, 2, { ...ACME, amount: 1000 }), sell(1, 3, { docType: "CC", doc: "1018423456", firstName: "ANA", firstSurname: "PEREZ", amount: 500 })] });
    expect(blocking(m.problems.f1007)).toHaveLength(0);
    for (const r of m.form1007.records) for (const cell of rowOf("1007", r)) expect(cell === null || cell === "").toBe(false);
  });
});

describe("formato 1647", () => {
  it("agrupa Compras por tercero, concepto 4070, ciudad, dirección y valores", () => {
    const m = model({
      uploads: U,
      rows: [buy(1, 2, { ...ANA, amount: 400, date: "2026-01-05", order: "1" }), buy(1, 3, { ...ANA, amount: 600, date: "2026-01-09", order: "2" }), buy(1, 4, { ...LUIS, amount: 200, date: "2026-01-07", order: "3" }), sell(1, 2, { ...ACME, amount: 5000 })],
      address: "CL 10 # 20-30",
    });
    const f = m.form1647;
    expect(f.records).toHaveLength(2);
    const ana = f.records.find((r) => r.data.docNumber === "1018423456")!.data;
    expect(ana).toMatchObject({ concept: "4070", docTypeCode: "13", deptCode: "76", muniCode: "001", countryCode: "169", address: "CL 10 # 20-30", totalValue: 1000, reintegratedValue: 1000, withholdingValue: 0 });
    expect(ana).toMatchObject({ recipientDocNumber: "900642307", recipientDv: "5", recipientBusinessName: "ACME SAS", recipientCountryCode: "169", recipientDocTypeCode: "31" });
    expect(f.originCents).toBe(120_000);
    expect(f.assignedCents).toBe(120_000);
  });

  it("orden cronológico por primera operación y luego Orden", () => {
    const m = model({ uploads: U, rows: [buy(1, 2, { ...LUIS, amount: 10, date: "2026-02-01", order: "9" }), buy(1, 3, { ...ANA, amount: 10, date: "2026-01-01", order: "5" }), sell(1, 2, { ...ACME, amount: 1000 })] });
    expect(m.form1647.thirds.map((t) => t.docCode + t.number)).toEqual(["131018423456", "1379123456"]);
  });

  it("asigna el primer pagador con saldo para el valor completo y nunca divide un tercero", () => {
    // Ventas: ACME 500, BETA 1000. Terceros: ANA 800 (no cabe en ACME → BETA), LUIS 400 (cabe en ACME).
    const m = model({
      uploads: U,
      rows: [buy(1, 2, { ...ANA, amount: 800, date: "2026-01-01" }), buy(1, 3, { ...LUIS, amount: 400, date: "2026-01-02" }), sell(1, 2, { ...ACME, amount: 500 }), sell(1, 3, { ...BETA, amount: 1000 })],
    });
    const byThird = Object.fromEntries(m.form1647.thirds.map((t) => [t.number, t.payerKey]));
    expect(byThird["1018423456"]).toBe("31|800197268");
    expect(byThird["79123456"]).toBe("31|900642307");
    expect(m.form1647.payers.map((p) => [p.number, p.remainingCents])).toEqual([["900642307", 10_000], ["800197268", 20_000]]);
    expect(blocking(m.problems.f1647)).toHaveLength(0);
  });

  it("un pagador nunca excede su ingreso: con saldo individual insuficiente el tercero queda pendiente y se muestran los saldos", () => {
    const m = model({ uploads: U, rows: [buy(1, 2, { ...ANA, amount: 800, date: "2026-01-01" }), sell(1, 2, { ...ACME, amount: 500 }), sell(1, 3, { ...BETA, amount: 400 })] });
    expect(m.form1647.thirds[0].payerKey).toBeNull();
    expect(m.form1647.unassignedCents).toBe(80_000);
    expect(m.form1647.unusedSalesCents).toBe(90_000);
    expect(m.problems.f1647.find((p) => p.kind === "assignment")?.message).toMatch(/sin dividirlo/);
    expect(m.form1647.records[0].data.recipientDocNumber).toBe(PENDING);
  });

  it("la reasignación manual manda sobre la propuesta y se valida contra el saldo", () => {
    const rows = [buy(1, 2, { ...ANA, amount: 300, date: "2026-01-01" }), sell(1, 2, { ...ACME, amount: 500 }), sell(1, 3, { ...BETA, amount: 400 })];
    const auto = model({ uploads: U, rows });
    expect(auto.form1647.thirds[0].payerKey).toBe("31|900642307");
    const manual = model({ uploads: U, rows, decisions: [decision("assignment", "13|1018423456", "31|800197268")] });
    expect(manual.form1647.thirds[0]).toMatchObject({ payerKey: "31|800197268", assignedBy: "manual" });
    const tooBig = model({ uploads: U, rows: [buy(1, 2, { ...ANA, amount: 450, date: "2026-01-01" }), sell(1, 2, { ...ACME, amount: 500 }), sell(1, 3, { ...BETA, amount: 400 })], decisions: [decision("assignment", "13|1018423456", "31|800197268")] });
    expect(tooBig.form1647.thirds[0].assignedBy).toBe("auto");
    expect(tooBig.problems.f1647.some((p) => p.kind === "assignment_invalid")).toBe(true);
  });

  it("la asignación cuadra: lo asignado a un pagador nunca supera sus ventas y todo es trazable contra Compras", () => {
    const m = model({
      uploads: U,
      rows: [buy(1, 2, { ...ANA, amount: 700, date: "2026-01-01" }), buy(1, 3, { ...LUIS, amount: 200, date: "2026-01-02" }), buy(1, 4, { ...LUIS, amount: 100, date: "2026-01-03", order: "z" }), sell(1, 2, { ...ACME, amount: 800 }), sell(1, 3, { ...BETA, amount: 600 })],
    });
    for (const p of m.form1647.payers) expect(p.remainingCents).toBeGreaterThanOrEqual(0);
    expect(m.form1647.assignedCents + m.form1647.unassignedCents).toBe(m.form1647.groupedCents);
    expect(m.reconciliation.f1647.differenceCents).toBe(m.form1647.originCents - m.form1647.assignedCents);
  });

  it("ciudad reconocida, ambigua, no reconocida y alias persistente", () => {
    const rows = (city: string) => [buy(1, 2, { ...ANA, city, amount: 10, date: "2026-01-01" }), sell(1, 2, { ...ACME, amount: 100 })];
    expect(model({ uploads: U, rows: rows("CALI") }).form1647.records[0].data).toMatchObject({ deptCode: "76", muniCode: "001" });
    const ambiguous = model({ uploads: U, rows: rows("San Antonio") });
    expect(ambiguous.form1647.records[0].data.muniCode).toBe(PENDING);
    expect(ambiguous.problems.f1647.find((p) => p.kind === "city_ambiguous")).toBeTruthy();
    const unknown = model({ uploads: U, rows: rows("stgo de Cali") });
    expect(unknown.problems.f1647.find((p) => p.kind === "city_unknown")?.payload?.raw).toBe("stgo de Cali");
    const aliased = model({ uploads: U, rows: rows("stgo de Cali"), homologations: [{ kind: "city", sourceKey: "STGO DE CALI", value: "76001" }] });
    expect(aliased.form1647.records[0].data).toMatchObject({ deptCode: "76", muniCode: "001" });
    const chosen = model({ uploads: U, rows: rows("San Antonio"), decisions: [decision("city", "13|1018423456", "73675")] });
    expect(chosen.form1647.records[0].data).toMatchObject({ deptCode: "73", muniCode: "675" });
  });

  it("un tercero con varias ciudades obliga a elegir una", () => {
    const rows = [buy(1, 2, { ...ANA, city: "Cali", amount: 10, date: "2026-01-01" }), buy(1, 3, { ...ANA, city: "Buenaventura", amount: 10, date: "2026-01-02" }), sell(1, 2, { ...ACME, amount: 100 })];
    const m = model({ uploads: U, rows });
    expect(m.form1647.thirds[0].city.state).toBe("multiple");
    expect(m.form1647.thirds[0].city.candidates.map((c) => c.name).sort()).toEqual(["Buenaventura", "Cali"]);
    expect(m.problems.f1647.some((p) => p.kind === "city_multiple")).toBe(true);
    const chosen = model({ uploads: U, rows, decisions: [decision("city", "13|1018423456", "76109")] });
    expect(chosen.form1647.records[0].data.muniCode).toBe("109");
  });

  it("sin dirección de la empresa el formato queda pendiente (no se inventa)", () => {
    const m = model({ uploads: U, rows: [buy(1, 2, { ...ANA, amount: 10, date: "2026-01-01" }), sell(1, 2, { ...ACME, amount: 100 })], address: "  " });
    expect(m.form1647.records[0].data.address).toBe(PENDING);
    expect(m.problems.f1647.some((p) => p.kind === "address")).toBe(true);
  });

  it("una exportación lista no tiene columnas vacías ni pendientes", () => {
    const m = model({ uploads: U, rows: [buy(1, 2, { ...ANA, amount: 10, date: "2026-01-01" }), buy(1, 3, { ...ACME, city: "Medellín", amount: 50, date: "2026-01-02" }), sell(1, 2, { ...BETA, amount: 100 })] });
    expect(blocking(m.problems.f1647)).toHaveLength(0);
    for (const r of m.form1647.records) for (const cell of rowOf("1647", r)) {
      expect(cell === null || cell === "").toBe(false);
      expect(isPending(cell)).toBe(false);
    }
  });
});

describe("pagadores elegibles para una asignación manual del 1647", () => {
  // Importación diferida para no alterar el resto del archivo.
  it("solo se ofrecen pagadores cuyo saldo cubre el tercero completo", async () => {
    const { payerOptions } = await import("./form1647");
    const { model, purchaseData, saleData, stored, upload } = await import("./testkit");
    const m = model({
      uploads: [upload(1, "a.xlsx")],
      rows: [
        stored(1, "purchase", 2, purchaseData({ amount: 100, date: "2026-01-10", docType: "CC", doc: "111", firstName: "A", firstSurname: "B", city: "Cali" })),
        stored(1, "sale", 2, saleData({ amount: 60, docType: "NIT", doc: "800197268", business: "Chico" })),
        stored(1, "sale", 3, saleData({ amount: 500, docType: "NIT", doc: "900642307", business: "Grande" })),
      ],
    });
    const options = payerOptions(m.form1647, "13|111");
    expect(Object.fromEntries(options.map((o) => [o.payer.label, o.selectable]))).toEqual({ Chico: false, Grande: true });
  });

  it("al reasignar un tercero ya asignado a mano, su propio valor cuenta como disponible", async () => {
    const { payerOptions } = await import("./form1647");
    const { decision, model, purchaseData, saleData, stored, upload } = await import("./testkit");
    const m = model({
      uploads: [upload(1, "a.xlsx")],
      rows: [
        stored(1, "purchase", 2, purchaseData({ amount: 100, date: "2026-01-10", docType: "CC", doc: "111", firstName: "A", firstSurname: "B", city: "Cali" })),
        stored(1, "purchase", 3, purchaseData({ amount: 400, date: "2026-01-11", docType: "CC", doc: "222", firstName: "A", firstSurname: "C", city: "Cali" })),
        stored(1, "sale", 2, saleData({ amount: 500, docType: "NIT", doc: "900642307", business: "Grande" })),
      ],
      decisions: [decision("assignment", "13|222", "31|900642307")],
    });
    // Grande ya tiene 400 asignados a mano al tercero 222: queda 100, que alcanza justo para el 111.
    expect(payerOptions(m.form1647, "13|111")[0]).toMatchObject({ availableCents: 10_000, selectable: true });
    // Para el propio 222 el pagador sigue siendo elegible (su valor se libera al reasignar).
    expect(payerOptions(m.form1647, "13|222")[0].selectable).toBe(true);
  });
});
