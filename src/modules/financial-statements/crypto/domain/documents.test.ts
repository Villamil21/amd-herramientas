import { describe, expect, it } from "vitest";
import { cleanDocumentNumber, countryByDocument, exportedDv, nitDv, resolveDocumentType, documentTypeKey } from "./documents";
import { buildPlaceLookup, resolveCity, searchCities } from "./places";
import { CATALOGS_EXTRA } from "./testkit";

describe("dígito de verificación", () => {
  it.each([
    ["800197268", "4"],
    ["900642307", "5"],
    ["1018423456", "7"],
  ])("NIT %s → DV %s", (nit, dv) => {
    expect(nitDv(nit)).toBe(dv);
    expect(exportedDv("31", nit)).toBe(dv);
  });

  it("limpia espacios, puntos, comas, letras y guiones; el DV de la fuente solo se conserva como auditoría", () => {
    expect(cleanDocumentNumber(" 800.197.268 ", "31")).toEqual({ number: "800197268", sourceDv: "" });
    expect(cleanDocumentNumber("900.642.307-5", "31")).toEqual({ number: "900642307", sourceDv: "5" });
    expect(cleanDocumentNumber("NIT 1,018,423,456", "31").number).toBe("1018423456");
    expect(cleanDocumentNumber("1.018.423.456", "13").number).toBe("1018423456");
    expect(cleanDocumentNumber("ab-123456", "41").number).toBe("AB123456");
  });

  it("solo el tipo 31 exporta DV", () => {
    expect(exportedDv("13", "1018423456")).toBe("");
  });
});

describe("tipos de documento", () => {
  const lookup = { stored: new Map<string, string>() };

  it("homologa los iniciales por valor original", () => {
    for (const [raw, code] of [["CC", "13"], ["c.c.", "13"], ["CE", "22"], ["NIT", "31"], ["PA", "41"], ["PPT", "42"], ["PT", "42"]]) expect(resolveDocumentType(raw, lookup).code).toBe(code);
  });

  it("un tipo desconocido queda sin código hasta que el usuario lo clasifica, y la equivalencia persiste", () => {
    expect(resolveDocumentType("TI-X", lookup).code).toBeNull();
    expect(resolveDocumentType("TI-X", lookup).key).toBe(documentTypeKey("TI-X"));
    const learned = { stored: new Map([[documentTypeKey("TI-X"), "12"]]) };
    expect(resolveDocumentType("ti x", learned).code).toBe("12");
  });

  it("acepta un código DIAN válido del catálogo, no cualquier número", () => {
    const catalog = { stored: new Map<string, string>(), catalogCodes: new Set(["13", "31"]) };
    expect(resolveDocumentType("13", catalog).code).toBe("13");
    expect(resolveDocumentType("99", catalog).code).toBeNull();
  });

  it("país por tipo de documento", () => {
    for (const t of ["11", "12", "13", "14", "15", "31"]) expect(countryByDocument(t)).toBe("169");
    for (const t of ["22", "41", "42", null]) expect(countryByDocument(t)).toBeUndefined();
  });
});

describe("ciudades", () => {
  const lookup = buildPlaceLookup(CATALOGS_EXTRA, []);

  it("reconoce una ciudad ignorando mayúsculas, tildes y espacios", () => {
    const r = resolveCity("  MEDELLÍN ", lookup);
    expect(r).toMatchObject({ status: "resolved", option: { code: "05001", deptCode: "05", muniCode: "001" } });
    expect(resolveCity("bogota d.c.", lookup)).toMatchObject({ status: "resolved", option: { code: "11001" } });
    expect(resolveCity("Bogotá", lookup)).toMatchObject({ status: "resolved", option: { code: "11001" } });
  });

  it("acepta el código DANE, aun sin el cero inicial", () => {
    expect(resolveCity("76001", lookup)).toMatchObject({ status: "resolved", via: "code" });
    expect(resolveCity("5001", lookup)).toMatchObject({ status: "resolved", option: { code: "05001" } });
    expect(resolveCity("99999", lookup).status).toBe("unknown");
  });

  it("una ciudad con varios municipios es ambigua: nunca se elige sola", () => {
    const r = resolveCity("San Antonio", lookup);
    expect(r.status).toBe("ambiguous");
    expect(r.status === "ambiguous" && r.candidates.map((c) => c.code).sort()).toEqual(["05647", "73675"]);
  });

  it("una abreviatura no se reconoce hasta guardar su alias, que luego se aplica solo", () => {
    expect(resolveCity("stgo de Cali", lookup).status).toBe("unknown");
    const withAlias = buildPlaceLookup(CATALOGS_EXTRA, [{ kind: "city", sourceKey: "STGO DE CALI", value: "76001" }]);
    expect(resolveCity("Stgo. de Cali", withAlias)).toMatchObject({ status: "resolved", via: "alias", option: { name: "Cali" } });
  });

  it("vacío y buscador", () => {
    expect(resolveCity("   ", lookup).status).toBe("empty");
    expect(searchCities(lookup, "cali", 5)[0].code).toBe("76001");
    expect(searchCities(lookup, "tolima").map((c) => c.code)).toContain("73675");
  });
});
