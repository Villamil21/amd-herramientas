import { describe, expect, it } from "vitest";
import { parseCamara } from "./camaraParser";
import { composeEntityNarrative, isoToSpanishLong, parseRegistral, spanishDateToIso, titleCase } from "./registral";
import { docFromLines } from "./testDocs";

const head = (chamber: string) => [chamber, "CERTIFICADO DE EXISTENCIA Y REPRESENTACIÓN LEGAL", "Fecha de expedición: 21/02/2025 - 8:52:29 AM", "Recibo No.: 0027749870 Valor: $00", "CÓDIGO DE VERIFICACIÓN: RavcTZIiKmhbjjcg"];

/** Texto con la forma de un certificado real (Cámara de Medellín): constitución inscrita antes en otra Cámara. */
const medellin = () =>
  docFromLines([
    [...head("Cámara de Comercio de Medellín para Antioquia"), "NOMBRE, IDENTIFICACIÓN Y DOMICILIO", "Razón social: D&P CAPITAL INVERSIONES S.A.S.", "Nit: 901850718-4", "Domicilio principal: MEDELLÍN, ANTIOQUIA, COLOMBIA", "Página: 1 de 2"],
    [
      ...head("Cámara de Comercio de Medellín para Antioquia"),
      "CONSTITUCIÓN",
      "Por Documento Privado del 05 de julio de 2024 de la Constitución, inscrito (a) inicialmente en la Cámara de Comercio de Cucuta el 15 de",
      "julio de 2024 y posteriormente inscrita en esta Cámara de Comercio el 20",
      "de febrero de 2025, con el No. 5955 del Libro IX, se constituyó la sociedad de naturaleza Comercial denominada D&P CAPITAL INVERSIONES S.A.S.",
      "REFORMAS ESPECIALES",
      "Por Acta No. 003 del 29 de enero de 2025 de la Asamblea de Accionistas, trasladó su domicilio",
      "TERMINO DE DURACIÓN",
      "La persona jurídica no se encuentra disuelta y su duración es indefinida.",
      "OBJETO SOCIAL",
      "La sociedad tendrá por objeto, el desarrollo de las siguientes actividades:",
      "A) Procesamiento de datos, alojamiento (hosting) y actividades relacionadas.",
      "B) Comercio al por mayor a cambio de una retribución o por contrata.",
      "C) Comercio al por menor realizado a través de internet.",
      "CAPITAL",
      "Página: 2 de 2",
    ],
  ]);

describe("datos registrales de la Cámara de Comercio", () => {
  it("lee Cámara, constitución, inscripción en esta Cámara, libro y objeto social", () => {
    const { registral } = parseCamara(medellin());
    const v = registral.values;
    expect(v.registryChamber).toBe("Cámara de Comercio de Medellín");
    expect(v.registryCity).toBe("Medellín");
    expect(v.constitutionDocType).toBe("Documento privado");
    expect(v.constitutionDate).toBe("2024-07-05");
    expect(v.registryNumber).toBe("5955");
    expect(v.registryBook).toBe("IX");
    // La inscripción inicial en otra Cámara (15/07/2024) no se confunde con la de esta Cámara.
    expect(v.registryDate).toBe("2025-02-20");
    expect(v.corporatePurpose).toBe("La sociedad tendrá por objeto, el desarrollo de las siguientes actividades:\nA) Procesamiento de datos, alojamiento (hosting) y actividades relacionadas.\nB) Comercio al por mayor a cambio de una retribución o por contrata.\nC) Comercio al por menor realizado a través de internet.");
    expect(v.entityNarrative).toBe("D&P Capital Inversiones S.A.S. con domicilio en Medellín es una entidad privada, constituida ante la Cámara de Comercio de Medellín, el día 05 de julio de 2024 con el No. 5955 del Libro IX");
    expect(registral.review).toEqual([]);
  });

  it("marca «Revisar» lo que el certificado no permite confirmar y no inventa nada", () => {
    const doc = docFromLines([[...head("CÁMARA DE COMERCIO DE SINCELEJO"), "OBJETO SOCIAL", "texto corto", "Página 1 de 1"]]);
    const { registral } = parseCamara(doc);
    expect(registral.values.registryChamber).toBe("Cámara de Comercio de Sincelejo");
    expect(registral.values.constitutionDate).toBeUndefined();
    expect(registral.values.corporatePurpose).toBeUndefined();
    expect(registral.values.entityNarrative).toBeUndefined();
    expect(registral.review).toEqual(expect.arrayContaining(["entityNarrative", "corporatePurpose", "constitutionDate", "registryNumber", "registryBook", "registryDate"]));
    expect(registral.review).not.toContain("registryChamber");
  });

  it("no toma un número de inscripción ambiguo cuando hay varios distintos en la constitución", () => {
    const lines = ["CONSTITUCIÓN", "Por escritura pública No. 12 del 01 de febrero de 2023 de la Notaría 5, inscrito en esta Cámara de Comercio el 07 de febrero de 2023, con el No. 33898 del Libro IX, y con el No. 40000 del Libro VI.", "OBJETO SOCIAL", "REFORMAS"];
    const { values } = parseRegistral([lines], lines, {});
    expect(values.constitutionDocType).toBe("Escritura pública");
    expect(values.constitutionDate).toBe("2023-02-01");
    expect(values.registryDate).toBe("2023-02-07");
    expect(values.registryNumber).toBeUndefined();
  });
});

describe("fechas y textos", () => {
  it("convierte fechas en español y rechaza las inexistentes", () => {
    expect(spanishDateToIso("05", "julio", "2024")).toBe("2024-07-05");
    expect(spanishDateToIso("5", "Septiembre", "2020")).toBe("2020-09-05");
    expect(spanishDateToIso("31", "febrero", "2024")).toBeNull();
    expect(spanishDateToIso("1", "brumario", "2024")).toBeNull();
    expect(isoToSpanishLong("2024-07-05")).toBe("05 de julio de 2024");
  });
  it("pone en tipo título conservando siglas societarias", () => {
    expect(titleCase("D&P CAPITAL INVERSIONES SAS")).toBe("D&P Capital Inversiones SAS");
    expect(titleCase("CÁMARA DE COMERCIO DE SINCELEJO")).toBe("Cámara de Comercio de Sincelejo");
  });
  it("no compone el ente económico si falta un dato esencial", () => {
    expect(composeEntityNarrative({ name: "X SAS", domicileCity: "", chamber: "", constitutionDate: "2024-01-01", registryNumber: "", registryBook: "" })).toBe("");
    expect(composeEntityNarrative({ name: "X SAS", domicileCity: "Cali", chamber: "Cámara de Comercio de Cali", constitutionDate: "2024-01-01", registryNumber: "", registryBook: "" })).toBe("X SAS con domicilio en Cali es una entidad privada, constituida ante la Cámara de Comercio de Cali, el día 01 de enero de 2024");
  });
});
