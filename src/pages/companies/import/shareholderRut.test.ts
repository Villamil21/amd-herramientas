import { describe, expect, it } from "vitest";
import { buildCatalogIndex } from "../../../modules/exogena/domain/catalogIndex";
import { CATALOGS } from "../../../modules/exogena/domain/fixtures";
import { resolveRutTerritory, parseShareholderRut } from "./shareholderRut";
import { at, docFromItems } from "./testDocs";

/** Dígitos de casillas, uno por caja, cada 11 puntos. */
const boxes = (digits: string, x: number, y: number) => [...digits].map((d, i) => at(d, x + i * 11, y));

/** Persona natural (cédula): tipo 13, cuatro casillas de nombres y ubicación con códigos separados (76 / 001). */
function naturalPerson(location: "separate" | "full" = "separate") {
  return [
    at("4. Número de formulario", 328, 704),
    at("5. Número de Identificación Tributaria (NIT)", 28, 616),
    at("6. DV", 185, 616),
    at("12. Dirección seccional", 206, 616),
    ...boxes("1143855024", 30, 604),
    at("6", 193, 604),
    at("24. Tipo de contribuyente", 28, 580),
    at("25. Tipo de documento", 206, 580),
    at("26. Número de Identificación", 360, 580),
    at("Persona natural", 30, 570),
    at("Cédula de Ciudadanía", 208, 570),
    ...boxes("13", 300, 570),
    ...boxes("1143855024", 362, 570),
    at("31. Primer apellido", 28, 532),
    at("32. Segundo apellido", 156, 532),
    at("33. Primer nombre", 283, 532),
    at("34. Otros nombres", 408, 532),
    at("DIAZ", 28, 520),
    at("GARAY", 156, 520),
    at("JULIE", 283, 520),
    at("KAORI", 408, 520),
    at("35. Razón social", 28, 508),
    at("36. Nombre comercial", 28, 484),
    at("38. País", 28, 447),
    at("39. Departamento", 201, 447),
    at("40. Ciudad/Municipio", 393, 447),
    at("COLOMBIA", 30, 437),
    ...boxes("169", 100, 437),
    at("Valle del Cauca", 203, 437),
    ...(location === "separate" ? [...boxes("76", 300, 437), at("Cali", 395, 437), ...boxes("001", 450, 437)] : [...boxes("76", 300, 437), at("Cali", 395, 437), ...boxes("76001", 440, 437)]),
    at("41. Dirección principal", 28, 424),
    at("cl 16 b", 27, 412),
    at("125", 70, 412),
    at("42. Correo electrónico", 28, 400),
    at("julie@correo.com", 106, 400),
    at("44. Teléfono 1", 202, 388),
    at("3 0 5 8 8 5 8 0 8 4", 300, 388),
    at("45. Teléfono 2", 450, 388),
  ];
}

/** Persona jurídica: razón social y NIT con DV. */
function legalPerson() {
  return [
    at("5. Número de Identificación Tributaria (NIT)", 28, 616),
    at("6. DV", 185, 616),
    at("12. Dirección seccional", 206, 616),
    ...boxes("901679752", 30, 604),
    at("3", 193, 604),
    at("31. Primer apellido", 28, 532),
    at("32. Segundo apellido", 156, 532),
    at("33. Primer nombre", 283, 532),
    at("34. Otros nombres", 408, 532),
    at("35. Razón social", 28, 508),
    at("NFES SOLUTIONS S.A.S.", 27, 497),
    at("36. Nombre comercial", 28, 484),
    at("38. País", 28, 447),
    at("39. Departamento", 201, 447),
    at("40. Ciudad/Municipio", 393, 447),
    at("COLOMBIA", 30, 437),
    ...boxes("169", 100, 437),
    at("Sucre", 203, 437),
    ...boxes("70", 300, 437),
    at("Sincelejo", 395, 437),
    ...boxes("001", 450, 437),
    at("41. Dirección principal", 28, 424),
    at("DG 35 34 29", 27, 412),
  ];
}

describe("RUT de un socio", () => {
  it("persona natural: tipo de documento por su código (13), nombres en su campo y ubicación con ceros", () => {
    const rut = parseShareholderRut(docFromItems(naturalPerson()));
    expect(rut).toMatchObject({ personType: "PN", docTypeCode: "13", docNumber: "1143855024", firstSurname: "DIAZ", secondSurname: "GARAY", firstName: "JULIE", otherNames: "KAORI", countryCode: "169", deptCode: "76", muniCode: "001", address: "CL 16 B 125", email: "julie@correo.com", phone: "3058858084" });
    expect(rut.businessName).toBeUndefined();
    expect(rut.dv).toBeUndefined();
    expect(rut.notes).toEqual([]);
  });

  it("el código de municipio de cinco dígitos («76001») se descompone en departamento 76 y municipio 001", () => {
    const rut = parseShareholderRut(docFromItems(naturalPerson("full")));
    expect([rut.deptCode, rut.muniCode]).toEqual(["76", "001"]);
  });

  it("persona jurídica: tipo 31, NIT con DV y razón social; sin nombres", () => {
    const rut = parseShareholderRut(docFromItems(legalPerson()));
    expect(rut).toMatchObject({ personType: "PJ", docTypeCode: "31", docNumber: "901679752", dv: "3", businessName: "NFES SOLUTIONS S.A.S.", deptCode: "70", muniCode: "001" });
    expect(rut.firstName).toBeUndefined();
  });

  it("un PDF que no es un RUT avisa y no inventa nada", () => {
    const rut = parseShareholderRut(docFromItems([at("Factura de venta", 30, 700)]));
    expect(rut.personType).toBeNull();
    expect(rut.docNumber).toBeUndefined();
    expect(rut.notes.join(" ")).toMatch(/no parece un RUT/);
  });
});

describe("territorio del RUT contra los catálogos", () => {
  const index = buildCatalogIndex(CATALOGS);

  it("valida código y, si falta, resuelve por nombre sin tildes ni mayúsculas", () => {
    expect(resolveRutTerritory({ countryCode: "169", deptCode: "76", muniCode: "001" }, CATALOGS, index)).toEqual({ countryCode: "169", deptCode: "76", muniCode: "001", warnings: [] });
    expect(resolveRutTerritory({ countryName: "colombia", deptName: "VALLE DEL CAUCA", muniName: "cali" }, CATALOGS, index)).toMatchObject({ countryCode: "169", deptCode: "76", muniCode: "001" });
    expect(resolveRutTerritory({ countryName: "Colombia", deptName: "Bogotá D.C.", muniName: "Bogota, D.C." }, CATALOGS, index)).toMatchObject({ deptCode: "11", muniCode: "001" });
  });

  it("un municipio que no pertenece al departamento no se acepta y se avisa", () => {
    const out = resolveRutTerritory({ countryCode: "169", deptCode: "05", muniCode: "999" }, CATALOGS, index);
    expect(out.muniCode).toBe("");
    expect(out.warnings.join(" ")).toMatch(/municipio/);
  });

  it("fuera de Colombia no hay departamento ni municipio", () => {
    expect(resolveRutTerritory({ countryCode: "249", deptCode: "76", muniCode: "001" }, CATALOGS, index)).toEqual({ countryCode: "249", deptCode: "", muniCode: "", warnings: [] });
  });
});
