import { describe, expect, it } from "vitest";
import type { Company, Shareholder } from "../../../types/models";
import type { ExoRecord } from "../../../types/exogena";
import { EMPTY_REGISTRAL } from "../../../pages/companies/companyDefaults";
import { buildCatalogIndex } from "./catalogIndex";
import { buildProposals1008, check1008, CONCEPT_SOCIOS, reconcile1008, rowOrigin1008, SYSTEM_CONCEPTS_1008 } from "./form1008";
import { exportInteger, formatPesosPlain } from "./numbers";
import { rowOf } from "./exportWorkbook";
import { buildExportWorkbook } from "./exportWorkbook";

const person = (id: number, name: string, pct: number, extra: Partial<Shareholder> = {}): Shareholder => ({ id, name, identityDocument: `CC ${1000 + id}`, percentage: pct, sortOrder: id, legalRole: null, rutStatus: "validado", documents: [], personType: "PN", docTypeCode: "13", firstSurname: name, firstName: "JUAN", address: "CL 1", countryCode: "169", deptCode: "05", muniCode: "001", ...extra });

const company = (subscribed: number, paid: number, shareholders: Shareholder[]): Company => ({
  id: 1, razonSocial: "ACME SAS", nit: "900", dv: "1", direccion: "", ciudad: "", telefono: "", correo: "", infoAdicional: "", logoFile: null, ciiuCode: "", createdAt: "", updatedAt: "", documents: [],
  subscribedTotalShares: subscribed ? subscribed / 1000 : null, subscribedNominalValue: subscribed ? 1000 : null, paidTotalShares: paid ? paid / 1000 : null, paidNominalValue: paid ? 1000 : null,
  legalRepName: "", legalRepDocument: "", legalRepAltName: "", legalRepAltDocument: "", legalRepManual: false, legalRepAltManual: false, ...EMPTY_REGISTRAL, shareholders,
});

const catalog = buildCatalogIndex({ version: "t", source: "t", documentTypes: [{ code: "13", description: "CC", isSystem: true, isActive: true }, { code: "31", description: "NIT", isSystem: true, isActive: true }], countries: [{ code: "169", name: "Colombia", isSystem: true, isActive: true }], departments: [{ code: "05", name: "Antioquia", isSystem: true, isActive: true }], municipalities: [{ deptCode: "05", code: "001", name: "Medellín", isSystem: true, isActive: true }] });
const concepts = SYSTEM_CONCEPTS_1008.map((c) => ({ ...c, isActive: true }));
const asRecord = (p: ReturnType<typeof buildProposals1008>[number], id = 1): ExoRecord => ({ id, companyId: 1, year: 2025, formatCode: "1008", sourceKey: p.sourceKey, origin: p.origin, originRef: p.originRef, data: p.data, manualFields: [], manuallyModifiedAt: null, syncedAt: null, createdAt: "", updatedAt: "" }) as ExoRecord;

describe("1008 · CxC a socios", () => {
  it("un solo socio recibe el 100 % de suscrito − pagado, con concepto 1316", () => {
    const p = buildProposals1008(company(10_000_000, 4_000_000, [person(1, "PEREZ", 100)]));
    expect(p).toHaveLength(1);
    expect(p[0].data.balance).toBe(6_000_000);
    expect(p[0].data.concept).toBe("1316");
  });
  it("reparte entre varios socios y la suma es exactamente la CxC", () => {
    const p = buildProposals1008(company(10_000_001, 0, [person(1, "A", 33.33), person(2, "B", 33.33), person(3, "C", 33.34)]));
    expect(p.reduce((n, x) => n + (x.data.balance as number), 0)).toBe(10_000_001);
  });
  it("sin diferencia suscrito/pagado o sin capital no propone nada", () => {
    expect(buildProposals1008(company(5_000_000, 5_000_000, [person(1, "A", 100)]))).toEqual([]);
    expect(buildProposals1008(company(0, 0, [person(1, "A", 100)]))).toEqual([]);
  });
  it("copia identidad PN y PJ (DV solo en NIT)", () => {
    const pj = person(2, "INVERSIONES SAS", 50, { personType: "PJ", docTypeCode: "31", identityDocument: "NIT 900123456", dv: "7", firstSurname: "", firstName: "" });
    const [a, b] = buildProposals1008(company(2_000_000, 0, [person(1, "PEREZ", 50), pj]));
    expect(a.data.dv).toBe("");
    expect(a.data.firstSurname).toBe("PEREZ");
    expect(b.data.businessName).toBe("INVERSIONES SAS");
    expect(b.data.dv).toBe("7");
    expect(b.data.firstName).toBe("");
  });
  it("concilia y bloquea cuando el total difiere; el concepto sigue siendo editable", () => {
    const c = company(10_000_000, 0, [person(1, "A", 100)]);
    const records = buildProposals1008(c).map((p) => asRecord(p));
    expect(reconcile1008(records, c).difference).toBe(0);
    expect(check1008(records, c, catalog, concepts)).toEqual([]);
    const edited = [{ ...records[0], data: { ...records[0].data, concept: "1317" } }];
    expect(check1008(edited, c, catalog, concepts).some((x) => /no coincide/.test(x.message))).toBe(true);
    const unknown = [{ ...records[0], data: { ...records[0].data, concept: "9999" } }];
    expect(check1008(unknown, c, catalog, concepts).some((x) => /no existe/.test(x.message))).toBe(true);
  });
  it("rotula el origen de cada fila", () => {
    expect(rowOrigin1008({ origin: "empresas", manualFields: [] })).toBe("Calculado desde capital");
    expect(rowOrigin1008({ origin: "empresas", manualFields: ["balance"] })).toBe("Modificado manualmente");
    expect(rowOrigin1008({ origin: "manual", manualFields: [] })).toBe("Manual");
  });
  it("exporta enteros sin separadores y muestra miles; 1000000,5 → 1000001", () => {
    expect(exportInteger(1000000.5)).toBe(1000001);
    expect(formatPesosPlain(1000001)).toBe("1.000.001");
  });
  it("sin registros pide sincronizar o «No aplica»", () => {
    expect(check1008([], company(1_000_000, 0, [person(1, "A", 100)]), catalog, concepts)[0].message).toMatch(/No aplica/);
  });
  it("la hoja 1008 sale en el Excel solo si está lista, con las columnas del formato", () => {
    const c = company(3_000_000, 0, [person(1, "A", 100)]);
    const rec = buildProposals1008(c).map((p) => asRecord(p));
    const row = rowOf("1008", rec[0]);
    expect(row).toHaveLength(14);
    expect(row[0]).toBe(CONCEPT_SOCIOS);
    expect(row[13]).toBe(3_000_000);
    const status = { formatCode: "1008", status: "listo" as const, notApplicableReason: "", lastSyncedAt: null, sourceFingerprint: "", updatedAt: "", recordCount: 1 };
    const wb = buildExportWorkbook({ company: c, year: 2025, statuses: { "1008": status }, records: { "1008": rec } });
    expect(wb.sheets.map((s) => s.name)).toEqual(["1008"]);
    expect(wb.sheets[0].columns[2].header).toBe("Número identificación deudor");
    const off = buildExportWorkbook({ company: c, year: 2025, statuses: { "1008": { ...status, status: "no_aplica" } }, records: { "1008": rec } });
    expect(off.sheets).toEqual([]);
  });
});
