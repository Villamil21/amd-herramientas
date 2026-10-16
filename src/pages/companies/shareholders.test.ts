import { describe, expect, it } from "vitest";
import { buildCatalogIndex } from "../../modules/exogena/domain/catalogIndex";
import { CATALOGS, shareholder } from "../../modules/exogena/domain/fixtures";
import { applyRut, compareRut, matchShareholder } from "./shareholders";
import { resolveRutTerritory, type ShareholderRutData } from "./import/shareholderRut";

const index = buildCatalogIndex(CATALOGS);

/** El RUT de referencia: persona natural, cédula (13), Cali (169 / 76 / 001). */
const RUT: ShareholderRutData = {
  personType: "PN",
  docTypeCode: "13",
  docNumber: "1143855024",
  firstSurname: "DIAZ",
  secondSurname: "GARAY",
  firstName: "JULIE",
  otherNames: "KAORI",
  address: "CL 16 B 125 111 CA 10",
  countryCode: "169",
  deptCode: "76",
  muniCode: "001",
  email: "v8181458@gmail.com",
  phone: "3058858084",
  notes: [],
};
const territory = resolveRutTerritory(RUT, CATALOGS, index);

const julie = (over: Partial<Parameters<typeof shareholder>[0]> = {}) =>
  shareholder({ id: 4, name: "DIAZ GARAY JULIE KAORI", identityDocument: "CC 1143855024", docTypeCode: null, personType: null, firstSurname: "", secondSurname: "", firstName: "", otherNames: "", address: "", countryCode: "", deptCode: "", muniCode: "", phone: "", email: "", rutStatus: "pendiente", ...over });

describe("¿a qué socio pertenece el RUT?", () => {
  const list = [shareholder({ id: 1, name: "OTRA PERSONA", identityDocument: "CC 22517821" }), julie()];

  it("primero por documento normalizado", () => {
    expect(matchShareholder(list, RUT)).toEqual({ index: 1, by: "documento" });
    expect(matchShareholder([shareholder({ name: "X", identityDocument: "1.143.855.024" })], RUT)).toEqual({ index: 0, by: "documento" });
  });

  it("si el documento no coincide, por nombre normalizado (sin tildes ni mayúsculas, en cualquier orden)", () => {
    const byName = [shareholder({ name: "Julie Kaori Díaz Garay", identityDocument: "CC 99" })];
    expect(matchShareholder(byName, RUT)).toEqual({ index: 0, by: "nombre" });
  });

  it("sin ningún socio que coincida no se vincula nada (advertencia en pantalla)", () => {
    expect(matchShareholder([shareholder({ name: "OTRA PERSONA", identityDocument: "CC 22517821" })], RUT)).toBeNull();
    expect(matchShareholder([], RUT)).toBeNull();
  });

  it("un RUT de persona jurídica se reconoce por su NIT y su razón social", () => {
    const pj: ShareholderRutData = { personType: "PJ", docTypeCode: "31", docNumber: "901679752", dv: "3", businessName: "NFES SOLUTIONS S.A.S.", notes: [] };
    expect(matchShareholder([shareholder({ name: "NFES SOLUTIONS S.A.S.", identityDocument: "NIT 901679752" })], pj)).toEqual({ index: 0, by: "documento" });
    expect(matchShareholder([shareholder({ name: "nfes solutions s.a.s.", identityDocument: "NIT 1" })], pj)).toEqual({ index: 0, by: "nombre" });
  });
});

describe("comparación «extraído del RUT» vs «dato actual»", () => {
  it("lo que el socio no tenía es nuevo y lo igual coincide", () => {
    const rows = compareRut(julie(), RUT, territory, index);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.docNumber.status).toBe("match");
    expect(by.docTypeCode).toMatchObject({ status: "new", extracted: "13 — Tipo 13" });
    expect(by.firstSurname).toMatchObject({ status: "new", extracted: "DIAZ" });
    expect(by.muniCode.extracted).toBe("001 — Cali");
    expect(rows.map((r) => r.key)).not.toContain("dv");
  });

  it("un valor distinto es un conflicto, ignorando mayúsculas y separadores", () => {
    const rows = compareRut(julie({ address: "cl 16 b 125 111 ca 10", phone: "305 885 8084", email: "OTRO@correo.com", docTypeCode: "13", personType: "PN" }), RUT, territory, index);
    const by = Object.fromEntries(rows.map((r) => [r.key, r.status]));
    expect(by.address).toBe("match");
    expect(by.phone).toBe("match");
    expect(by.email).toBe("conflict");
    expect(by.personType).toBe("match");
  });

  it("un campo que el RUT no trae queda ausente (no se borra el dato actual)", () => {
    const rows = compareRut(julie({ phone: "3001112233" }), { ...RUT, phone: undefined }, territory, index);
    expect(rows.find((r) => r.key === "phone")?.status).toBe("absent");
  });
});

describe("aplicar el RUT", () => {
  it("persona natural: tipo 13, nombres separados, ubicación con ceros y RUT validado", () => {
    const s = julie();
    const { shareholder: next, status } = applyRut(s, RUT, territory, compareRut(s, RUT, territory, index), new Set());
    expect(next).toMatchObject({ personType: "PN", docTypeCode: "13", identityDocument: "CC 1143855024", firstSurname: "DIAZ", secondSurname: "GARAY", firstName: "JULIE", otherNames: "KAORI", name: "DIAZ GARAY JULIE KAORI", countryCode: "169", deptCode: "76", muniCode: "001", address: "CL 16 B 125 111 CA 10", email: "v8181458@gmail.com", phone: "3058858084" });
    expect(status).toBe("validado");
  });

  it("persona jurídica: tipo 31, NIT con DV, razón social y sin nombres", () => {
    const pj: ShareholderRutData = { personType: "PJ", docTypeCode: "31", docNumber: "901679752", dv: "3", businessName: "NFES SOLUTIONS S.A.S.", address: "DG 35 34 29", countryCode: "169", deptCode: "76", muniCode: "001", notes: [] };
    const s = shareholder({ id: 2, name: "NFES", identityDocument: "NIT 901679752", personType: null, docTypeCode: null, firstName: "X" });
    const t = resolveRutTerritory(pj, CATALOGS, index);
    const { shareholder: next } = applyRut(s, pj, t, compareRut(s, pj, t, index), new Set());
    expect(next).toMatchObject({ personType: "PJ", docTypeCode: "31", dv: "3", name: "NFES SOLUTIONS S.A.S.", identityDocument: "NIT 901679752", firstName: "", firstSurname: "" });
  });

  it("si el usuario conserva un dato en conflicto, ese dato no cambia y el RUT queda en «revisar»", () => {
    const s = julie({ email: "otro@correo.com" });
    const rows = compareRut(s, RUT, territory, index);
    const { shareholder: next, status } = applyRut(s, RUT, territory, rows, new Set(["email"]));
    expect(next.email).toBe("otro@correo.com");
    expect(next.firstName).toBe("JULIE");
    expect(status).toBe("revisar");
  });

  it("fuera de Colombia limpia departamento y municipio", () => {
    const abroad: ShareholderRutData = { ...RUT, countryCode: "249", deptCode: undefined, muniCode: undefined };
    const t = resolveRutTerritory(abroad, CATALOGS, index);
    const s = julie({ deptCode: "76", muniCode: "001", countryCode: "169" });
    const { shareholder: next } = applyRut(s, abroad, t, compareRut(s, abroad, t, index), new Set());
    expect([next.countryCode, next.deptCode, next.muniCode]).toEqual(["249", "", ""]);
  });
});
