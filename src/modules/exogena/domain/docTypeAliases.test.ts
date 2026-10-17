import { describe, expect, it } from "vitest";
import { docTypeKey, resolveDocTypeCode } from "./thirdParty";

const TYPES = [
  { code: "13", description: "Cédula de ciudadanía", isActive: true },
  { code: "22", description: "Cédula de extranjería", isActive: true },
  { code: "31", description: "NIT", isActive: true },
  { code: "41", description: "Pasaporte", isActive: true },
  { code: "47", description: "Permiso especial de permanencia (PEP)", isActive: true },
  { code: "48", description: "Permiso por protección temporal (PPT)", isActive: true },
  { code: "12", description: "Tarjeta de identidad", isActive: false },
];
const alias = (aliasKey: string, target: string) => ({ kind: "document_type", aliasKey, target });
// Mismas denominaciones que siembra la migración 029.
const SEEDED = [alias("CC", "13"), alias("CE", "22"), alias("NIT", "31"), alias("PPT", "48"), alias("PEP", "47"), alias("PA", "41"), alias("TI", "12")];

describe("alias de tipos de documento de identificación", () => {
  it("la clave ignora tildes, puntos, espacios y mayúsculas", () => {
    expect(docTypeKey("C.C.")).toBe("CC");
    expect(docTypeKey(" Cédula de  Ciudadanía ")).toBe("CEDULADECIUDADANIA");
    expect(docTypeKey("N.I.T.")).toBe("NIT");
  });

  it("reconoce la denominación esperada (nombre oficial) sin necesitar alias", () => {
    expect(resolveDocTypeCode("Cédula de ciudadanía", TYPES, [])).toBe("13");
    expect(resolveDocTypeCode("Permiso por protección temporal (PPT)", TYPES, [])).toBe("48");
    expect(resolveDocTypeCode("13", TYPES, [])).toBe("13");
  });

  it("resuelve CC, CE, NIT, PPT y demás por alias cuando la factura no usa la denominación esperada", () => {
    for (const [text, code] of [["CC", "13"], ["C.C.", "13"], ["cc", "13"], ["CE", "22"], ["NIT", "31"], ["N.I.T", "31"], ["PPT", "48"], ["P.P.T.", "48"], ["PEP", "47"], ["PA", "41"]] as const) {
      expect(resolveDocTypeCode(text, TYPES, SEEDED), text).toBe(code);
    }
    // Sin alias, la sigla no se adivina.
    expect(resolveDocTypeCode("PPT", TYPES, [])).toBeUndefined();
  });

  it("un alias propio agregado en Catálogos se aplica y uno a un código inexistente o inactivo no inventa nada", () => {
    expect(resolveDocTypeCode("Ced. Extranjería", TYPES, [...SEEDED, alias("CEDEXTRANJERIA", "22")])).toBe("22");
    expect(resolveDocTypeCode("TI", TYPES, SEEDED)).toBeUndefined(); // 12 está inactivo
    expect(resolveDocTypeCode("XYZ", TYPES, [alias("XYZ", "99")])).toBeUndefined();
    expect(resolveDocTypeCode(undefined, TYPES, SEEDED)).toBeUndefined();
  });
});
