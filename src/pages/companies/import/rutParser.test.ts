import { describe, expect, it } from "vitest";
import { parseRut } from "./rutParser";
import { at, docFromItems } from "./testDocs";

/** Dígitos de casillas, uno por caja, cada 11 puntos. */
const boxes = (digits: string, x: number, y: number) => [...digits].map((d, i) => at(d, x + i * 11, y));

function page1(overrides: { razon?: string; correo?: string; ciiu?: string } = {}) {
  return [
    at("4. Número de formulario", 328, 704),
    at("5. Número de Identificación Tributaria (NIT)", 28, 616),
    at("6. DV", 185, 616),
    at("12. Dirección seccional", 206, 616),
    at("14. Buzón electrónico", 482, 616),
    ...boxes("900738791", 86, 604),
    at("0", 193, 604),
    at("5", 469, 604),
    at("31. Primer apellido", 28, 532),
    at("32. Segundo apellido", 156, 532),
    at("33. Primer nombre", 283, 532),
    at("34. Otros nombres", 408, 532),
    at("35. Razón social", 28, 508),
    at(overrides.razon ?? "DIGICORT S.A.S", 27, 497),
    at("36. Nombre comercial", 28, 484),
    at("DIGICORT COMERCIAL", 27, 473),
    at("39. Departamento", 201, 447),
    at("40. Ciudad/Municipio", 393, 447),
    ...boxes("169", 168, 437),
    ...boxes("76001", 371, 437),
    at("Valle del Cauca", 201, 437),
    at("Cali", 393, 437),
    at("41. Dirección principal", 28, 424),
    at("CL 10", 27, 412),
    at("23 A 09", 55, 412),
    at("42. Correo electrónico", 28, 400),
    at(overrides.correo ?? "digicortsas@hotmail.com", 106, 400),
    at("44. Teléfono 1", 202, 388),
    at("3 8 0 0 5 4 6", 337, 388),
    at("45. Teléfono 2", 399, 388),
    at("46. Código", 37, 340),
    at("47. Fecha inicio actividad", 83, 340),
    ...boxes(overrides.ciiu ?? "1399", 33, 330),
    ...boxes("20140605", 79, 330),
  ];
}

const repBlock = (top: number, role: string, doc: string, names: [string, string, string, string]) => [
  at("98. Representación", 39, top),
  at("99. Fecha inicio ejercicio representación", 216, top),
  at(role, 41, top - 12),
  at("100. Tipo de documento", 39, top - 24),
  at("101. Número de identificación", 138, top - 24),
  at("102. DV", 407, top - 24),
  at("Cédula de Ciudadanía", 41, top - 36),
  ...boxes("13", 114, top - 36).slice(0, 2),
  ...boxes(doc, 140, top - 36).map((i, k) => ({ ...i, x: 140 + k * 14 })),
  at("104. Primer apellido", 39, top - 48),
  at("105. Segundo apellido", 172, top - 48),
  at("106. Primer nombre", 313, top - 48),
  at("107. Otros nombres", 456, top - 48),
  at(names[0], 38, top - 60),
  at(names[1], 171, top - 60),
  at(names[2], 312, top - 60),
  at(names[3], 455, top - 60),
  at("109. DV", 190, top - 72),
  at("108. Número de Identificación Tributaria (NIT)", 39, top - 72),
];

describe("RUT: lectura por posición del formulario", () => {
  it("extrae NIT, DV, razón social, CIIU, ciudad, dirección, correo y teléfono", () => {
    const data = parseRut(docFromItems(page1()));
    expect(data).toMatchObject({ nit: "900738791", dv: "0", razonSocial: "DIGICORT S.A.S", ciiu: "1399", ciudad: "Cali", departamento: "Valle del Cauca", direccion: "CL 10 23 A 09", correo: "digicortsas@hotmail.com", telefono: "3800546", isNaturalPerson: false });
    expect(data.notes).toEqual([]);
  });

  it("no toma el valor de la casilla vecina cuando una casilla está vacía", () => {
    // 31–34 (persona natural) están vacías: el valor de abajo es la razón social y no debe confundirse.
    const data = parseRut(docFromItems(page1()));
    expect(data.isNaturalPerson).toBe(false);
  });

  it("reconoce a la persona natural por sus nombres y apellidos", () => {
    const items = page1().filter((i) => !/^35\.|DIGICORT S\.A\.S/.test(i.text));
    items.push(at("PEREZ", 28, 520), at("GOMEZ", 156, 520), at("ANA", 283, 520), at("MARIA", 408, 520), at("35. Razón social", 28, 508));
    const data = parseRut(docFromItems(items));
    expect(data.isNaturalPerson).toBe(true);
    expect(data.razonSocial).toBe("ANA MARIA PEREZ GOMEZ");
  });

  it("deja el CIIU vacío y explica por qué si no tiene 4 dígitos", () => {
    const data = parseRut(docFromItems(page1({ ciiu: "13" })));
    expect(data.ciiu).toBeUndefined();
    expect(data.notes.join(" ")).toMatch(/CIIU/);
  });

  it("descarta un correo mal formado en vez de inventarlo", () => {
    expect(parseRut(docFromItems(page1({ correo: "no es correo" }))).correo).toBeUndefined();
  });

  it("lee representante principal y suplente por bloque, sin mezclar columnas", () => {
    const page3 = [...repBlock(580, "REPRS LEGAL PRIN", "15957185", ["JIMENEZ", "JIMENEZ", "JUAN", "ALBERTO"]), ...repBlock(484, "REPRS LEGAL SUPL", "1151948610", ["JIMENEZ", "RAMIREZ", "JUAN", "CAMILO"]), ...repBlock(388, "", "", ["", "", "", ""])];
    const data = parseRut(docFromItems(page1(), page3));
    expect(data.representatives).toEqual([
      { role: "REPRS LEGAL PRIN", isAlternate: false, name: "JUAN ALBERTO JIMENEZ JIMENEZ", documentType: "CC", documentNumber: "15957185" },
      { role: "REPRS LEGAL SUPL", isAlternate: true, name: "JUAN CAMILO JIMENEZ RAMIREZ", documentType: "CC", documentNumber: "1151948610" },
    ]);
  });

  it("ignora quien no es representante legal (apoderado, revisor fiscal)", () => {
    const page3 = repBlock(580, "APODERADO GENERAL", "123456", ["A", "B", "C", "D"]);
    expect(parseRut(docFromItems(page1(), page3)).representatives).toEqual([]);
  });

  it("avisa cuando el PDF no es un RUT", () => {
    const data = parseRut(docFromItems([at("Factura de venta", 30, 700)]));
    expect(data.notes[0]).toMatch(/no parece un RUT/);
    expect(data.nit).toBeUndefined();
  });
});
