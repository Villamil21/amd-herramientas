import { describe, expect, it } from "vitest";
import type { EinvoiceCustomer, EinvoiceDoc } from "../../../types/einvoice";
import type { ExoRecord, FormatStatusRow } from "../../../types/exogena";
import type { CompanyVatEntry } from "../../../types/purchases";
import type { CryptoModel } from "../../financial-statements/crypto/domain/model";
import type { PurchasesModel } from "../../financial-statements/purchases/domain/model";
import { cryptoFormatState } from "./cryptoFormat";
import { buildPurchasesAudit } from "./purchasesAudit";
import { buildEinvoiceContribution, isEinvoiceKey, mergeByThird, receiverIdentity } from "./einvoiceSales";
import { buildExportWorkbook } from "./exportWorkbook";
import { pendingChanges } from "./pending";
import { blocking } from "./problems";
import { purchasesFormatState } from "./purchasesFormat";
import { computeNitDv } from "./thirdParty";

let seq = 0;
const doc = (p: Partial<EinvoiceDoc> & Pick<EinvoiceDoc, "category" | "issueDate" | "totalCents" | "ivaCents">): EinvoiceDoc => {
  seq += 1;
  return {
    id: seq,
    companyId: 1,
    documentId: `doc-${seq}`,
    year: Number(p.issueDate.slice(0, 4)),
    docType: p.category === "sale" ? "Factura electrónica" : "Nota de crédito electrónica",
    docTypeKey: p.category === "sale" ? "factura electronica" : "nota de credito electronica",
    number: `N${seq}`,
    fileName: "ventas.xlsx",
    sheet: "Ventas",
    rowNumber: seq + 1,
    status: "Aprobado",
    receiverNitRaw: "900.111.222-5",
    receiverName: "CLIENTE UNO SAS",
    eeffBaseCents: p.totalCents - p.ivaCents,
    eeffColumns: ["IVA", "ICUI", "Rete Fuente"],
    exoBaseCents: p.totalCents - p.ivaCents,
    exoColumns: ["IVA", "ICUI"],
    importedAt: "x",
    updatedAt: "x",
    ...p,
  };
};
const RESPONSIBLE: CompanyVatEntry[] = [{ companyId: 1, effectiveDate: "2020-01-01", responsible: true, source: "manual", note: "", createdAt: "x" }];
const build = (docs: EinvoiceDoc[], extra: { customers?: EinvoiceCustomer[]; vat?: CompanyVatEntry[]; year?: number } = {}) => buildEinvoiceContribution({ docs, customers: extra.customers ?? [], companyVat: extra.vat ?? RESPONSIBLE, year: extra.year ?? 2026 });
const customer = (p: Partial<EinvoiceCustomer>): EinvoiceCustomer => ({ companyId: 1, docNumber: "1020304050", docTypeCode: "13", dv: "", firstSurname: "PEREZ", secondSurname: "", firstName: "ANA", otherNames: "", businessName: "", ...p });

describe("identidad del cliente receptor", () => {
  it("NIT de 9 dígitos que empieza por 90: tipo 31, DV calculado, razón social exacta y sin nombres", () => {
    const id = receiverIdentity("900.111.222-5", "  Cliente Uno S.A.S -", new Map());
    expect(id).toMatchObject({ status: "ready", origin: "nit90", docTypeCode: "31", number: "900111222", dv: computeNitDv("900111222"), businessName: "  Cliente Uno S.A.S -", firstSurname: "", secondSurname: "", firstName: "", otherNames: "" });
  });
  it("cualquier otro identificador queda pendiente hasta confirmarlo y luego se reutiliza la ficha", () => {
    expect(receiverIdentity("1020304050", "PEREZ ANA", new Map())).toMatchObject({ status: "pending", docTypeCode: "" });
    expect(receiverIdentity("800123456", "OTRO", new Map())).toMatchObject({ status: "pending" });
    expect(receiverIdentity("1.020.304.050", "PEREZ ANA", new Map([["1020304050", customer({})]]))).toMatchObject({ status: "ready", origin: "confirmed", docTypeCode: "13", firstSurname: "PEREZ", firstName: "ANA" });
    expect(receiverIdentity("", "SIN NIT", new Map()).status).toBe("missing");
  });
});

describe("1007 · Ingresos recibidos", () => {
  it("agrupa por cliente y tipo, usa la base IVA … ICUI y no netea facturas contra notas crédito", () => {
    const out = build([
      doc({ category: "sale", issueDate: "2026-03-01", totalCents: 119_000_00, ivaCents: 19_000_00 }),
      doc({ category: "sale", issueDate: "2026-04-01", totalCents: 238_000_00, ivaCents: 38_000_00, exoBaseCents: 199_000_00 }),
      doc({ category: "return", issueDate: "2026-05-01", totalCents: 59_500_00, ivaCents: 9_500_00 }),
    ]);
    const rows = out.proposals["1007"];
    expect(rows).toHaveLength(2);
    const sale = rows.find((r) => r.data.grossIncome !== 0)!;
    const ret = rows.find((r) => r.data.returns !== 0)!;
    expect(sale.data).toMatchObject({ concept: "4001", docTypeCode: "31", docNumber: "900111222", countryCode: "169", grossIncome: 100_000 + 199_000, returns: 0, firstSurname: "", businessName: "CLIENTE UNO SAS" });
    expect(ret.data).toMatchObject({ concept: "4001", grossIncome: 0, returns: 50_000, countryCode: "169" });
    expect(sale.originRef).toContain("2 documentos");
    expect(rows.every((r) => isEinvoiceKey(r.sourceKey))).toBe(true);
    expect(out.bases).toMatchObject({ exoSale: 299_000_00, exoReturn: 50_000_00, eeffSale: 300_000_00, eeffReturn: 50_000_00 });
  });

  it("la nota crédito aporta el valor absoluto de su base", () => {
    const out = build([doc({ category: "return", issueDate: "2026-05-01", totalCents: -59_500_00, ivaCents: -9_500_00, exoBaseCents: -50_000_00 })]);
    expect(out.proposals["1007"][0].data.returns).toBe(50_000);
  });

  it("sin alcance ICUI el documento no entra y el 1007 queda bloqueado", () => {
    const out = build([doc({ category: "sale", issueDate: "2026-03-01", totalCents: 119_000_00, ivaCents: 19_000_00, exoBaseCents: null, exoColumns: [] })]);
    expect(out.proposals["1007"]).toHaveLength(0);
    expect(blocking(out.problems["1007"]).some((p) => p.message.includes("ICUI"))).toBe(true);
    expect(blocking(out.problems["1005"])).toHaveLength(0);
  });
});

describe("1006 y 1005", () => {
  const docs = [
    doc({ category: "sale", issueDate: "2026-03-01", totalCents: 119_000_00, ivaCents: 19_000_00 }),
    doc({ category: "sale", issueDate: "2026-03-02", totalCents: 59_500_00, ivaCents: 9_500_00 }),
    doc({ category: "return", issueDate: "2026-05-01", totalCents: 11_900_00, ivaCents: 1_900_00 }),
  ];

  it("la factura aporta el IVA solo a 1006 / Impuesto generado y la nota crédito solo a 1005 / IVA por devoluciones en ventas", () => {
    const out = build(docs);
    expect(out.proposals["1006"]).toHaveLength(1);
    expect(out.proposals["1006"][0].data).toMatchObject({ docTypeCode: "31", docNumber: "900111222", dv: computeNitDv("900111222"), generated: 28_500, purchaseReturns: 0, consumption: 0 });
    expect(out.proposals["1005"]).toHaveLength(1);
    expect(out.proposals["1005"][0].data).toMatchObject({ salesReturns: 1_900, discountable: 0, costIva: 0 });
    expect(out.reconciliation).toEqual({ invoiceIvaCents: 28_500_00, generatedCents: 28_500_00, creditNoteIvaCents: 1_900_00, salesReturnsCents: 1_900_00 });
    expect(out.audit[out.proposals["1006"][0].sourceKey]).toHaveLength(2);
    expect(out.audit[out.proposals["1006"][0].sourceKey][0]).toMatchObject({ fileName: "ventas.xlsx", sheet: "Ventas", subtractedColumns: ["IVA", "ICUI"], contributions: { generated: 19_000_00 } });
  });

  it("conservan los aportes de compras y no mezclan las conciliaciones de compras y de ventas", () => {
    const purchases = [
      { sourceKey: "third:900111222", origin: "estados_financieros" as const, originRef: "Compras · 3 facturas", data: { docTypeCode: "31", docNumber: "900111222", discountable: 77_000, salesReturns: 0, costIva: 0, exactCents: { discountable: 77_000_00 } } },
      { sourceKey: "third:800999888", origin: "estados_financieros" as const, originRef: "Compras · 1 factura", data: { docTypeCode: "31", docNumber: "800999888", discountable: 5, salesReturns: 0, costIva: 0, exactCents: { discountable: 500 } } },
    ];
    const merged = mergeByThird(purchases, build(docs).proposals["1005"], ["salesReturns"]);
    expect(merged).toHaveLength(2);
    expect(merged[0].sourceKey).toBe("third:900111222");
    expect(merged[0].data).toMatchObject({ discountable: 77_000, salesReturns: 1_900, exactCents: { discountable: 77_000_00, salesReturns: 1_900_00 } });
    expect(merged[0].originRef).toMatch(/Compras.*Facturación electrónica/);
    // La función no modifica las propuestas de entrada.
    expect(purchases[0].data.salesReturns).toBe(0);

    const model = { notApplicable: {}, proposals: { "1001": [], "1005": purchases, "1006": [] }, alerts: [], reconciliation: { applicable: true, discountableCents: 77_500_00, recoveredCents: 0, vat1001Cents: 77_500_00, differenceCents: 0 } } as unknown as PurchasesModel;
    const state = purchasesFormatState(model, "1005", [], undefined, build(docs));
    expect(state.proposals.find((p) => p.data.docNumber === "900111222")!.data).toMatchObject({ discountable: 77_000, salesReturns: 1_900 });
    expect(model.reconciliation.differenceCents).toBe(0);
    expect(purchasesFormatState(model, "1005", [], undefined, null).proposals).toHaveLength(2);
    // Sin pendientes ni diferencias, volver a proponer lo mismo no genera cambios.
    const stored = state.proposals.map((p, i): ExoRecord => ({ id: i, companyId: 1, year: 2026, formatCode: "1005", sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: p.data, manualFields: [], manuallyModifiedAt: null, syncedAt: null, createdAt: "x", updatedAt: "x" }));
    expect(pendingChanges(stored, state.proposals)).toEqual([]);
  });

  it("la empresa no responsable de IVA no aporta a 1005 ni 1006 y «No aplica» se respeta", () => {
    const out = build(docs, { vat: [{ companyId: 1, effectiveDate: "2020-01-01", responsible: false, source: "manual", note: "", createdAt: "x" }] });
    expect(out.proposals["1006"]).toHaveLength(0);
    expect(out.proposals["1005"]).toHaveLength(0);
    expect(out.proposals["1007"]).toHaveLength(2);
    const model = { notApplicable: { "1006": "No responsable" }, proposals: { "1001": [], "1005": [], "1006": [] }, alerts: [] } as unknown as PurchasesModel;
    const withSales = purchasesFormatState(model, "1006", [], undefined, build(docs));
    expect(withSales).toMatchObject({ proposals: [], problems: [], notApplicableReason: "No responsable" });
  });

  it("la responsabilidad 48 se aplica por fecha del documento, incluyendo cambios de vigencia", () => {
    const vat: CompanyVatEntry[] = [
      { companyId: 1, effectiveDate: "2020-01-01", responsible: false, source: "manual", note: "", createdAt: "x" },
      { companyId: 1, effectiveDate: "2026-04-01", responsible: true, source: "rut", note: "", createdAt: "x" },
    ];
    const out = build(docs, { vat });
    // Las facturas de marzo (no responsable) no cuentan; la nota crédito de mayo (responsable) sí.
    expect(out.proposals["1006"]).toHaveLength(0);
    expect(out.proposals["1005"][0].data.salesReturns).toBe(1_900);
    // Un documento sin ningún perfil vigente en su fecha bloquea 1005 y 1006 en vez de suponer.
    const early = build(docs, { vat: [{ companyId: 1, effectiveDate: "2026-04-15", responsible: true, source: "manual", note: "", createdAt: "x" }] });
    expect(blocking(early.problems["1006"]).some((p) => p.message.includes("responsabilidad de IVA (48)"))).toBe(true);
    expect(blocking(early.problems["1005"])).toHaveLength(0);
  });
});

describe("clientes pendientes", () => {
  const rows = () => [
    doc({ category: "sale", issueDate: "2026-03-01", totalCents: 119_000_00, ivaCents: 19_000_00, receiverNitRaw: "1020304050", receiverName: "PEREZ ANA" }),
    doc({ category: "return", issueDate: "2026-03-05", totalCents: 11_900_00, ivaCents: 0, receiverNitRaw: "1020304050", receiverName: "PEREZ ANA" }),
    doc({ category: "sale", issueDate: "2026-03-06", totalCents: 119_000_00, ivaCents: 19_000_00 }),
  ];
  it("un cliente sin identidad confirmada bloquea solo los formatos que requieren ese tercero", () => {
    const out = build(rows());
    expect(out.pendingCustomers).toEqual([{ number: "1020304050", names: ["PEREZ ANA"], rawNits: ["1020304050"], documents: 2, formats: ["1007", "1006"] }]);
    expect(blocking(out.problems["1007"]).length).toBe(1);
    expect(blocking(out.problems["1006"]).length).toBe(1);
    // La nota crédito de ese cliente no tiene IVA: no detiene el 1005.
    expect(blocking(out.problems["1005"])).toHaveLength(0);
    // El tercero NIT 90 sí se propone; el pendiente no.
    expect(out.proposals["1007"]).toHaveLength(1);
    expect(out.proposals["1006"]).toHaveLength(1);
  });
  it("confirmado el cliente, entra a los tres formatos con su ficha", () => {
    const out = build(rows(), { customers: [customer({})] });
    expect(out.pendingCustomers).toEqual([]);
    expect(blocking(out.problems["1007"])).toHaveLength(0);
    const own = out.proposals["1007"].find((p) => p.data.docNumber === "1020304050")!;
    expect(own.data).toMatchObject({ docTypeCode: "13", firstSurname: "PEREZ", firstName: "ANA", businessName: "", dv: "" });
    expect(out.proposals["1006"].find((p) => p.data.docNumber === "1020304050")!.data).toMatchObject({ docTypeCode: "13", generated: 19_000 });
  });
  it("un documento sin NIT receptor bloquea y no se propone", () => {
    const out = build([doc({ category: "sale", issueDate: "2026-03-01", totalCents: 100, ivaCents: 10, receiverNitRaw: "" })]);
    expect(out.proposals["1007"]).toHaveLength(0);
    expect(blocking(out.problems["1007"])[0].message).toContain("NIT receptor");
  });
});

describe("años y reimportación", () => {
  it("cada documento queda disponible solo en el año de su fecha de emisión", () => {
    const docs = [doc({ category: "sale", issueDate: "2025-12-20", totalCents: 100_00, ivaCents: 0 }), doc({ category: "sale", issueDate: "2026-01-02", totalCents: 200_00, ivaCents: 0 })];
    expect(build(docs, { year: 2025 }).proposals["1007"][0].data.grossIncome).toBe(100);
    expect(build(docs, { year: 2026 }).proposals["1007"][0].data.grossIncome).toBe(200);
    expect(build(docs, { year: 2024 }).proposals["1007"]).toHaveLength(0);
  });
  it("calcular dos veces desde los mismos documentos produce las mismas claves y valores (sin duplicados)", () => {
    const docs = [doc({ category: "sale", issueDate: "2026-03-01", totalCents: 119_000_00, ivaCents: 19_000_00 })];
    const first = build(docs).proposals["1007"];
    const second = build(docs).proposals["1007"];
    expect(second.map((p) => p.sourceKey)).toEqual(first.map((p) => p.sourceKey));
    const stored = first.map((p, i): ExoRecord => ({ id: i, companyId: 1, year: 2026, formatCode: "1007", sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: p.data, manualFields: [], manuallyModifiedAt: null, syncedAt: null, createdAt: "x", updatedAt: "x" }));
    expect(pendingChanges(stored, second)).toEqual([]);
  });
});

describe("coexistencia con Transacciones Cripto y exportación", () => {
  const cryptoRecord = { sourceKey: "ingresos:31|900111222", originRef: "Transacciones Cripto · Ventas", data: { concept: "4001", docTypeCode: "31", docNumber: "900111222", grossIncome: 5_000, returns: 0 } };
  const cryptoModel = { form1007: { records: [cryptoRecord] }, form1647: { records: [] }, problems: { f1007: [], f1647: [] } } as unknown as CryptoModel;

  it("el 1007 suma ambos orígenes sin reemplazar los de Cripto y avisa del posible cruce", () => {
    const sales = build([doc({ category: "sale", issueDate: "2026-03-01", totalCents: 119_000_00, ivaCents: 19_000_00 })]);
    const state = cryptoFormatState(cryptoModel, "1007", [], sales);
    expect(state.proposals.map((p) => p.sourceKey)).toEqual(["ingresos:31|900111222", expect.stringContaining("fe-ventas:1007:")]);
    expect(state.problems.some((p) => p.level === "warning" && p.message.includes("Transacciones Cripto y en Facturación electrónica"))).toBe(true);
    // Con nada guardado todavía, lo único que detiene es «desactualizado»; no hay pendientes de identidad ni de alcance.
    expect(blocking(state.problems).map((p) => p.message)).toEqual([expect.stringContaining("desactualizados")]);
    // Sin ventas, el 1007 de Cripto queda exactamente como estaba.
    expect(cryptoFormatState(cryptoModel, "1007", []).proposals).toHaveLength(1);
  });

  it("la exportación única incluye 1005, 1006 y 1007 con las nuevas fuentes", () => {
    const sales = build([
      doc({ category: "sale", issueDate: "2026-03-01", totalCents: 119_000_00, ivaCents: 19_000_00 }),
      doc({ category: "return", issueDate: "2026-05-01", totalCents: 11_900_00, ivaCents: 1_900_00 }),
    ]);
    const asRecords = (format: string, proposals: ReturnType<typeof build>["proposals"]["1007"]): ExoRecord[] => proposals.map((p, i) => ({ id: i, companyId: 1, year: 2026, formatCode: format, sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: p.data, manualFields: [], manuallyModifiedAt: null, syncedAt: null, createdAt: "x", updatedAt: "x" }));
    const listo = (code: string): FormatStatusRow => ({ formatCode: code, status: "listo", notApplicableReason: "", lastSyncedAt: null, sourceFingerprint: "", updatedAt: "", recordCount: 0 });
    const wb = buildExportWorkbook({
      company: { razonSocial: "MI EMPRESA SAS", nit: "901000111", dv: "5" },
      year: 2026,
      statuses: { "1007": listo("1007"), "1005": listo("1005"), "1006": listo("1006") },
      records: { "1007": [...asRecords("1007", [{ ...cryptoRecord, origin: "estados_financieros" }]), ...asRecords("1007", sales.proposals["1007"])], "1005": asRecords("1005", sales.proposals["1005"]), "1006": asRecords("1006", sales.proposals["1006"]) },
    });
    const sheet = (name: string) => wb.sheets.find((s) => s.name === name)!;
    expect(sheet("1007").rows).toHaveLength(3);
    const col = (name: string, header: string) => sheet(name).columns.findIndex((c) => c.header === header);
    expect(sheet("1005").rows[0][col("1005", "IVA resultante por devoluciones en ventas anuladas, rescindidas o resueltas")]).toBe(1_900);
    expect(sheet("1006").rows[0][col("1006", "Impuesto generado")]).toBe(19_000);
    const gross = col("1007", "Ingresos brutos recibidos");
    const returns = col("1007", "Devoluciones, rebajas y descuentos");
    expect(sheet("1007").rows.map((r) => [r[gross], r[returns]])).toEqual(expect.arrayContaining([[5_000, 0], [100_000, 0], [0, 10_000]]));
  });
});

describe("auditoría interna de 1005 / 1006", () => {
  it("traza los documentos de ventas hasta archivo, hoja y fila y rotula la conciliación de ventas aparte", () => {
    const sales = build([doc({ category: "sale", issueDate: "2026-03-01", totalCents: 119_000_00, ivaCents: 19_000_00 })]);
    const model = { docs: [], coverage: [], reconciliation: { applicable: false }, totals: { documents: 0, lines: 0, pendingLines: 0 } } as unknown as PurchasesModel;
    const state = { proposals: sales.proposals["1006"], changes: [], problems: [], notApplicableReason: null };
    const records = sales.proposals["1006"].map((p, i): ExoRecord => ({ id: i, companyId: 1, year: 2026, formatCode: "1006", sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: p.data, manualFields: [], manuallyModifiedAt: null, syncedAt: null, createdAt: "x", updatedAt: "x" }));
    const audit = buildPurchasesAudit({ model, format: "1006", state, records, company: { razonSocial: "E", nit: "1" }, year: 2026, statusLabel: "Listo", sales });
    expect(audit.records[0].trace).toHaveLength(1);
    expect(audit.records[0].trace[0]).toMatchObject({ file: "ventas.xlsx", amountCents: 19_000_00 });
    expect(audit.records[0].trace[0].invoice).toContain("Ventas fila");
    expect(audit.records[0].values.map((v) => v.label)).toContain("IVA generado (ventas)");
    expect(audit.reconciliation).toBeNull();
    expect(audit.salesReconciliation?.[0].label).toContain("1006 / Impuesto generado");
  });
});
