import { describe, expect, it } from "vitest";
import { loadSeededCatalog } from "./catalogFixture";
import { buildPucIndex, catalogRows, isSelectableCode, leafConcept, leafContext, pucClasses, searchLeaves } from "./pucCatalog";

const index = buildPucIndex(loadSeededCatalog());
const codes = (query: string, limit = 500) => searchLeaves(index, query, limit).results.map((r) => r.code);

describe("catálogo PUC sembrado", () => {
  it("conserva el orden y los puntos de control de la fuente", () => {
    expect(index.all).toHaveLength(2517);
    expect(index.all.slice(0, 5)).toEqual([
      { code: "1", concept: "ACTIVO" },
      { code: "11", concept: "DISPONIBLE" },
      { code: "1105", concept: "CAJA" },
      { code: "110505", concept: "CAJA GENERAL" },
      { code: "110510", concept: "CAJAS MENORES" },
    ]);
    expect(index.all[index.all.length - 1]).toEqual({ code: "96", concept: "ACREEDORAS DE CONTROL POR CONTRA (DB)" });
    expect(index.concepts.get("1110")).toBe("BANCOS");
    expect(index.concepts.get("111005")).toBe("MONEDA NACIONAL");
    expect(pucClasses(index).map((c) => c.code)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("solo los códigos de 6 dígitos son asignables", () => {
    expect(index.leaves).toHaveLength(2119);
    expect(index.leaves.every((l) => isSelectableCode(l.code))).toBe(true);
    expect(leafConcept(index, "110505")).toBe("CAJA GENERAL");
    for (const code of ["1", "11", "1105", "", undefined, "999999", "11050"]) expect(leafConcept(index, code)).toBeUndefined();
    expect(leafContext(index, "110505")).toBe("1105 CAJA · DISPONIBLE");
  });

  it("no expande rangos ni carga notas legales", () => {
    // «126001 a 126098»: la cuenta existe, sus números intermedios no.
    expect(index.concepts.get("1260")).toBe("CUENTAS EN PARTICIPACION");
    for (const code of ["126001", "126050", "126098", "9601", "960101"]) expect(index.concepts.has(code)).toBe(false);
    expect(index.all.filter((c) => /D\.R\.|ART\.|REPLANTEAD|ADICIONAD|ELIMINAD|REDENOMINAD/i.test(c.concept))).toEqual([]);
  });
});

describe("searchLeaves: buscador del campo Código PUC", () => {
  it("un código de 4 dígitos es un prefijo: nunca se ofrece la cuenta", () => {
    expect(codes("1105")).toEqual(["110505", "110510", "110515"]);
    expect(codes("1110")).toEqual(["111005", "111010"]);
    expect(searchLeaves(index, "1105").exact).toBeUndefined();
    expect(codes("11").every((c) => c.startsWith("11") && c.length === 6)).toBe(true);
    expect(codes("5105").length).toBeGreaterThan(10);
    expect(codes("5105").every((c) => c.startsWith("5105"))).toBe(true);
  });

  it("clase, grupo y cuenta solo sirven de prefijo o de contexto: todo lo que se ofrece tiene 6 dígitos", () => {
    for (const q of ["5", "51", "5105", "1", "11", "1105", "caja", "gastos de personal", "disponible", "otros"]) {
      const found = searchLeaves(index, q, 5000);
      expect(found.results.length, q).toBeGreaterThan(0);
      expect(found.results.every((r) => isSelectableCode(r.code) && leafConcept(index, r.code) === r.concept), q).toBe(true);
      expect(found.exact, q).toBeUndefined();
    }
    // «5105 — GASTOS DE PERSONAL» nunca es un resultado: solo sus subcuentas reales, todas las del catálogo.
    expect(codes("5105")).toEqual(index.all.filter((c) => c.code.length === 6 && c.code.startsWith("5105")).map((c) => c.code));
    expect(codes("5105")).not.toContain("5105");
    // La cuenta aparece solo como encabezado de sus subcuentas.
    expect(leafContext(index, codes("5105")[0])).toBe(`5105 ${index.concepts.get("5105")} · ${index.concepts.get("51")}`);
    // «caja»: las subcuentas de 1105 CAJA, no la cuenta.
    expect(codes("caja")).toEqual(expect.arrayContaining(["110505", "110510"]));
  });

  it("un código de 6 dígitos existente se muestra directamente", () => {
    const found = searchLeaves(index, " 110505 ");
    expect(found.results).toEqual([{ code: "110505", concept: "CAJA GENERAL" }]);
    expect(found.exact).toEqual({ code: "110505", concept: "CAJA GENERAL" });
  });

  it("un código que no existe no devuelve nada que confirmar", () => {
    for (const q of ["999999", "110599", "1105055", "zzzz no existe"]) {
      const found = searchLeaves(index, q);
      expect(found.results).toEqual([]);
      expect(found.exact).toBeUndefined();
    }
    // Cuenta que solo tiene un rango en la fuente: se explica por qué no hay opciones.
    expect(searchLeaves(index, "2820")).toEqual({ results: [], total: 0, note: "2820 — CUENTAS DE OPERACION CONJUNTA no tiene subcuentas de 6 dígitos en el catálogo." });
    // «126001 a 126098» no existe; de la cuenta 1260 solo es asignable su subcuenta explícita.
    expect(codes("1260")).toEqual(["126099"]);
    expect(searchLeaves(index, "").results).toEqual([]);
  });

  it("busca por parte del código cuando ningún código empieza así", () => {
    expect(codes("0505").length).toBeGreaterThan(0);
    expect(codes("0505").every((c) => c.includes("0505"))).toBe(true);
  });

  it("busca por concepto o parte del concepto, sin tildes ni mayúsculas, y solo devuelve subcuentas", () => {
    for (const q of ["BANCOS", "bancos", "servicios", "arrendamientos", "transporte", "Tránsito"]) {
      const found = codes(q);
      expect(found.length, q).toBeGreaterThan(0);
      expect(found.every(isSelectableCode), q).toBe(true);
    }
    // Por su propio concepto (112005 BANCOS) y por el de su cuenta (1110 BANCOS → 111005, 111010).
    const bancos = codes("bancos");
    expect(bancos).toContain("112005");
    expect(bancos).toContain("111005");
    expect(bancos.indexOf("112005")).toBeLessThan(bancos.indexOf("111005"));
    expect(codes("caja gen")).toEqual(["110505"]);
  });

  it("limita los resultados e informa el total", () => {
    const found = searchLeaves(index, "otros", 10);
    expect(found.results).toHaveLength(10);
    expect(found.total).toBeGreaterThan(10);
  });
});

describe("catalogRows: Tabla de Códigos PUC", () => {
  it("muestra una clase con su jerarquía grupo → cuenta → subcuenta", () => {
    const rows = catalogRows(index, { classCode: "1" });
    expect(rows.slice(0, 6).map((r) => [r.level, r.code, r.concept])).toEqual([
      ["class", "1", "ACTIVO"],
      ["group", "11", "DISPONIBLE"],
      ["account", "1105", "CAJA"],
      ["leaf", "110505", "CAJA GENERAL"],
      ["leaf", "110510", "CAJAS MENORES"],
      ["leaf", "110515", "MONEDA EXTRANJERA"],
    ]);
    expect(rows.every((r) => r.code.startsWith("1"))).toBe(true);
  });

  it("al buscar muestra coincidencias en todo el catálogo, con su contexto y lo que cuelga de ellas", () => {
    expect(catalogRows(index, { classCode: "5", query: "1105" }).map((r) => r.code)).toEqual(["1", "11", "1105", "110505", "110510", "110515"]);
    const bancos = catalogRows(index, { query: "bancos" }).map((r) => r.code);
    for (const code of ["1", "11", "1110", "111005", "111010", "1120", "112005"]) expect(bancos).toContain(code);
    expect(bancos).not.toContain("110505");
    expect(catalogRows(index, { query: "no existe xyz" })).toEqual([]);
  });

  it("un nivel que falta en la fuente queda como encabezado sin concepto (no se inventa)", () => {
    // El PDF perdió el grupo 32 y la cuenta 3205: sus códigos no quedan sueltos.
    const rows = catalogRows(index, { query: "3205" });
    expect(rows.map((r) => [r.level, r.code, r.concept])).toEqual([
      ["class", "3", "PATRIMONIO"],
      ["group", "32", undefined],
      ["account", "3205", undefined],
      ["leaf", "320515", "PRIMA EN COLOCACION DE CUOTAS O PARTES DE INTERES SOCIAL"],
    ]);
    const all = catalogRows(index);
    expect(all.filter((r) => r.concept !== undefined)).toHaveLength(2517);
    expect(new Set(all.map((r) => r.code)).size).toBe(all.length);
  });
});
