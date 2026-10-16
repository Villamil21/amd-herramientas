import { describe, expect, it } from "vitest";
import { composeIdentityDocument, computeNitDv, docTypeFromPrefix, documentNumber, EMPTY_THIRD_PARTY, missingFields, parseIdentityDocument, personName, splitMunicipalityCode, thirdPartyOf } from "./thirdParty";

const complete = { ...EMPTY_THIRD_PARTY, docTypeCode: "31", dv: "9", personType: "PJ" as const, address: "CL 77B 57 103", countryCode: "169", deptCode: "08", muniCode: "001" };

describe("normalización de identificadores", () => {
  it("quita espacios, puntos y guiones del documento y respeta el tipo", () => {
    expect(documentNumber("901.741.186-9", "31")).toBe("901741186");
    expect(documentNumber("1.192.816.998", "13")).toBe("1192816998");
    expect(documentNumber(" ab-123 456 ", "41")).toBe("AB123456");
    expect(documentNumber("9 0 0", null)).toBe("900");
  });

  it("separa el prefijo del documento de un socio y propone el código DIAN solo para prefijos conocidos", () => {
    expect(parseIdentityDocument("CC 1192729629")).toEqual({ prefix: "CC", number: "1192729629" });
    expect(parseIdentityDocument("1192729629")).toEqual({ prefix: "", number: "1192729629" });
    expect(parseIdentityDocument("NIT 900123456")).toEqual({ prefix: "NIT", number: "900123456" });
    expect(docTypeFromPrefix("CC")).toBe("13");
    expect(docTypeFromPrefix("nit")).toBe("31");
    expect(docTypeFromPrefix("XYZ")).toBeUndefined();
    expect(composeIdentityDocument("13", "1.192.729.629")).toBe("CC 1192729629");
    expect(composeIdentityDocument("31", "900.123.456")).toBe("NIT 900123456");
    expect(composeIdentityDocument(null, "12 34")).toBe("1234");
  });

  it("calcula el DV de un NIT (módulo 11)", () => {
    expect(computeNitDv("901741186")).toBe("9");
    expect(computeNitDv("800197268")).toBe("4"); // DIAN
    expect(computeNitDv("890.903.938")).toBe("8"); // Bancolombia
    expect(computeNitDv("")).toBe("");
  });

  it("«76001» se descompone en departamento 76 y municipio 001 (con sus ceros)", () => {
    expect(splitMunicipalityCode("76001")).toEqual({ deptCode: "76", muniCode: "001" });
    expect(splitMunicipalityCode("05001")).toEqual({ deptCode: "05", muniCode: "001" });
    expect(splitMunicipalityCode("7601")).toBeNull();
    expect(splitMunicipalityCode("760011")).toBeNull();
  });

  it("thirdPartyOf completa lo que falta con vacíos (nunca inventa)", () => {
    expect(thirdPartyOf({})).toEqual(EMPTY_THIRD_PARTY);
    expect(thirdPartyOf({ docTypeCode: "", deptCode: "05" }).docTypeCode).toBeNull();
    expect(personName({ firstSurname: "DIAZ", secondSurname: "GARAY", firstName: "JULIE", otherNames: "KAORI" })).toBe("DIAZ GARAY JULIE KAORI");
  });
});

describe("completo / requiere datos (mismas reglas que el backend)", () => {
  it("PJ completa", () => expect(missingFields(complete, "901741186", "GLOWING DIGITAL CLOUD S.A.S.")).toEqual([]));

  it("PJ necesita razón social y NIT necesita DV", () => {
    expect(missingFields(complete, "901741186", "")).toEqual(["Razón social"]);
    expect(missingFields({ ...complete, dv: "" }, "901741186", "X")).toEqual(["DV"]);
  });

  it("PN necesita primer apellido y primer nombre; nunca razón social", () => {
    const pn = { ...complete, docTypeCode: "13", dv: "", personType: "PN" as const };
    expect(missingFields(pn, "1192816998", "ANGARITA LOPEZ RONALDO")).toEqual(["Primer apellido", "Primer nombre"]);
    expect(missingFields({ ...pn, firstSurname: "ANGARITA", firstName: "RONALDO" }, "1192816998", "")).toEqual([]);
  });

  it("sin tipo de documento ni tipo de persona queda pendiente (no se inventa el 13)", () => {
    const missing = missingFields({ ...complete, docTypeCode: null, personType: null }, "1192816998", "ANGARITA");
    expect(missing).toContain("Tipo de documento");
    expect(missing).toContain("Persona natural o jurídica");
  });

  it("fuera de Colombia no se piden departamento ni municipio; en Colombia sí", () => {
    expect(missingFields({ ...complete, countryCode: "249", deptCode: "", muniCode: "" }, "1", "X")).toEqual([]);
    expect(missingFields({ ...complete, deptCode: "", muniCode: "" }, "1", "X")).toEqual(["Departamento", "Municipio"]);
  });
});
