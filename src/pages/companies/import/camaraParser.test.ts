import { describe, expect, it } from "vitest";
import { parseCamara } from "./camaraParser";
import { parseWholeNumber } from "./lines";
import { docFromLines } from "./testDocs";

const header = () => ["CÁMARA DE COMERCIO DE PRUEBA", "CERTIFICADO DE EXISTENCIA Y REPRESENTACIÓN LEGAL", "Fecha expedición: 13/01/2026 - 19:47:19", `Recibo No. S000, Valor 12100`];
const footer = (n: number, total: number) => `Página ${n} de ${total}`;

describe("números con formato colombiano", () => {
  it("lee enteros con miles y decimales en cero", () => {
    expect(parseWholeNumber("1.000,00")).toBe(1000);
    expect(parseWholeNumber("$ 50.000.000,00")).toBe(50_000_000);
    expect(parseWholeNumber("10.000")).toBe(10_000);
    expect(parseWholeNumber("2000")).toBe(2000);
  });
  it("no inventa cuando hay fracción u otro texto", () => {
    expect(parseWholeNumber("12,50")).toBeNull();
    expect(parseWholeNumber("0,00")).toBeNull();
    expect(parseWholeNumber("abc")).toBeNull();
  });
});

describe("Cámara de Comercio: capital", () => {
  it("lee acciones y valor nominal del suscrito y del pagado, sin tomar el valor total", () => {
    const doc = docFromLines([
      [...header(), "CAPITAL", "* CAPITAL AUTORIZADO *", "Valor $ 500.000.000,00", "No. Acciones 500.000,00", "Valor Nominal Acciones $ 1.000,00", "* CAPITAL SUSCRITO *", "Valor $ 50.000.000,00", "No. Acciones 50.000,00", "Valor Nominal Acciones $ 1.000,00", "* CAPITAL PAGADO *", "Valor $ 10.000.000,00", "No. Acciones 10.000,00", "Valor Nominal Acciones $ 1.000,00", footer(1, 1)],
    ]);
    const data = parseCamara(doc);
    expect(data.subscribed).toEqual({ shares: 50_000, nominal: 1000 });
    expect(data.paid).toEqual({ shares: 10_000, nominal: 1000 });
    expect(JSON.stringify(data)).not.toContain("50000000");
  });

  it("tolera otra maqueta: rótulos distintos y el bloque cortado por un salto de página", () => {
    const doc = docFromLines([
      [...header(), "CAPITAL", "** Capital Autorizado **", "Valor : $1.000.000,00", "Número de acciones : 1.000,00", "Valor nominal : 1.000,00", "** Capital Suscrito/Social **", "Valor : $2.000.000,00", "Número de acciones : 2.000,00", footer(1, 2)],
      [...header(), "Valor nominal : 1.000,00", "** Capital Pagado **", "Valor : $1.000.000,00", "Número de acciones : 1.000,00", "Valor nominal : 1.000,00", "ÓRGANOS DE ADMINISTRACIÓN Y DIRECCIÓN", footer(2, 2)],
    ]);
    const data = parseCamara(doc);
    expect(data.subscribed).toEqual({ shares: 2000, nominal: 1000 });
    expect(data.paid).toEqual({ shares: 1000, nominal: 1000 });
    expect(data.notes.filter((n) => /capital/i.test(n))).toEqual([]);
  });

  it("no confunde un capital citado dentro de las reformas con la sección de capital", () => {
    const doc = docFromLines([[...header(), "(AUMENTO DE CAPITAL SUSCRITO)", "CAPITAL", "* CAPITAL SUSCRITO *", "No. Acciones 10,00", "Valor Nominal Acciones $ 100,00", "* CAPITAL PAGADO *", "No. Acciones 5,00", "Valor Nominal Acciones $ 100,00"]]);
    const data = parseCamara(doc);
    expect(data.subscribed).toEqual({ shares: 10, nominal: 100 });
    expect(data.paid).toEqual({ shares: 5, nominal: 100 });
  });

  it("si falta un dato o no cuadra con el total, no lo inventa y explica qué faltó", () => {
    const missing = parseCamara(docFromLines([[...header(), "* CAPITAL SUSCRITO *", "No. Acciones 50.000,00", "* CAPITAL PAGADO *", "No. Acciones 10,00", "Valor Nominal Acciones $ 1.000,00"]]));
    expect(missing.subscribed).toEqual({ shares: 50_000, nominal: null });
    expect(missing.notes.join(" ")).toMatch(/Capital suscrito: no se pudo leer el valor nominal/);

    const mismatch = parseCamara(docFromLines([[...header(), "* CAPITAL SUSCRITO *", "Valor $ 99.000.000,00", "No. Acciones 50.000,00", "Valor Nominal Acciones $ 1.000,00"]]));
    expect(mismatch.subscribed).toEqual({ shares: null, nominal: null });
    expect(mismatch.notes.join(" ")).toMatch(/valor total distinto/);
    expect(mismatch.notes.join(" ")).toMatch(/No se encontró la sección de capital pagado/);
  });
});

describe("Cámara de Comercio: representantes legales", () => {
  it("distingue principal y suplente y deja fuera junta directiva y revisor fiscal", () => {
    const doc = docFromLines([
      [...header(), "NOMBRAMIENTOS", "REPRESENTANTES LEGALES", "Por Acta No. 5 se designó a:", "CARGO NOMBRE IDENTIFICACION", "GERENTE JORGE IVAN VERGARA MENESES C.C. No. 1.144.034.455", "GERENTE SUPLENTE HERNAN EMILIO VERGARA BARCENA C.C. No. 14.238.491", "JUNTA DIRECTIVA", "CARGO NOMBRE IDENTIFICACION", "PRIMER RENGLON LUZ AMPARO MENESES LUGO C.C. No. 38.241.244", "REVISORES FISCALES", "CARGO NOMBRE IDENTIFICACION", "REVISOR FISCAL PRINCIPAL JOSE LUIS GARCIA CARREÑO C.C. No. 16.729.668"],
    ]);
    const data = parseCamara(doc);
    expect(data.principals.map((p) => [p.name, p.documentNumber])).toEqual([["JORGE IVAN VERGARA MENESES", "1144034455"]]);
    expect(data.alternates.map((p) => [p.name, p.documentNumber])).toEqual([["HERNAN EMILIO VERGARA BARCENA", "14238491"]]);
  });

  it("lee el cargo en una línea y el nombre con el documento en la siguiente, y el documento sin espacio", () => {
    const doc = docFromLines([[...header(), "NOMBRAMIENTO(S) REPRESENTACIÓN LEGAL", "Nombramiento realizado mediante Documento Privado", "Cargo/Nombre Identificación", "Representante Legal", "Lopez Escorcia Harold Enrique CC 72335426", "REFORMAS DE ESTATUTOS"]]);
    const data = parseCamara(doc);
    expect(data.principals).toEqual([{ name: "Lopez Escorcia Harold Enrique", documentType: "CC", documentNumber: "72335426", cargo: "Representante Legal" }]);
  });

  it("une el cargo partido en dos líneas y la sección que sigue tras el salto de página", () => {
    const doc = docFromLines([
      [...header(), "REPRESENTANTES LEGALES", footer(1, 2)],
      [...header(), "CARGO NOMBRE IDENTIFICACIÓN", "GERENTE Y REPRESENTANTE SUSANA VALLEJO VILLEGAS C.C.1143850832", "LEGAL", "RECURSOS CONTRA LOS ACTOS", footer(2, 2)],
    ]);
    const data = parseCamara(doc);
    expect(data.principals[0]).toMatchObject({ name: "SUSANA VALLEJO VILLEGAS", documentNumber: "1143850832", cargo: "GERENTE Y REPRESENTANTE LEGAL" });
  });

  it("no inventa representantes si el certificado no los trae", () => {
    const data = parseCamara(docFromLines([[...header(), "REPRESENTACIÓN LEGAL", "La administración estará a cargo del Representante Legal.", "RECURSOS CONTRA LOS ACTOS"]]));
    expect(data.principals).toEqual([]);
    expect(data.notes.join(" ")).toMatch(/representantes legales/);
  });
});

describe("Cámara de Comercio: identificación", () => {
  it("lee razón social y NIT en los formatos de varias cámaras", () => {
    const a = parseCamara(docFromLines([[...header(), "Razón Social : NFES SOLUTIONS S.A.S.", "Nit : 901679752-3"]]));
    expect([a.razonSocial, a.nit, a.dv]).toEqual(["NFES SOLUTIONS S.A.S.", "901679752", "3"]);
    const b = parseCamara(docFromLines([[...header(), "Razón Social:", "LOTO CONSULTING S.A.S.", "Sigla:", "Nit: 901.709.572 - 4"]]));
    expect([b.razonSocial, b.nit, b.dv]).toEqual(["LOTO CONSULTING S.A.S.", "901709572", "4"]);
    const c = parseCamara(docFromLines([[...header(), "Razón social: CLEVER INNOVACODE SAS", "Nit: 901849928 2 Administración : Direccion Seccional"]]));
    expect([c.nit, c.dv]).toEqual(["901849928", "2"]);
  });

  it("advierte cuando el PDF no parece una Cámara de Comercio", () => {
    expect(parseCamara(docFromLines([["Factura de venta", "Total 100"]])).notes[0]).toMatch(/no parece un certificado/);
  });
});
