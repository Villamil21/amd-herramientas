import { describe, expect, it } from "vitest";
import type { FsSectionKey } from "../../../types/fs";
import type { StatementRow, Statements } from "../generator/engine";
import { allocateToPesos, buildNoteGroups, buildNoteItems, capitalTable, entityText, headerPeriod, initialNotesData, noteTableTotal, periodParagraph, pruneEdits, withNoteNumbers, type CompanySnapshot } from "./model";

const line = (label: string, pesos: number, lineId: number, section: FsSectionKey, role: StatementRow["role"] = null): StatementRow => ({ kind: "line", label, pesos, cents: pesos * 100, lineId, section, role });
const header = (label: string): StatementRow => ({ kind: "header", label });

/** Estados completos: todos los grupos con información. */
const fullEsf = (): StatementRow[] => [
  { kind: "title", label: "ACTIVO" },
  header("ACTIVO CORRIENTE"),
  line("Disponible", 5_026_000, 1, "asset_current"),
  line("Activos intangibles", 0, 2, "asset_current"),
  { kind: "subtotal", label: "TOTAL ACTIVO CORRIENTE", pesos: 5_026_000 },
  header("ACTIVO NO CORRIENTE"),
  line("Propiedades, planta y equipo", 3_000_000, 3, "asset_noncurrent"),
  { kind: "total", label: "TOTAL ACTIVO", pesos: 8_026_000 },
  { kind: "gap", label: "" },
  { kind: "title", label: "PASIVO Y PATRIMONIO" },
  header("PASIVO CORRIENTE"),
  line("Cuentas por pagar", 1_000_000, 6, "liability_current"),
  line("Impuestos, gravámenes y tasas", 400_000, 7, "liability_current"),
  line("Pasivos estimados y provisiones", 0, 9, "liability_current"),
  { kind: "subtotal", label: "TOTAL PASIVO CORRIENTE", pesos: 1_400_000 },
  header("PASIVO NO CORRIENTE"),
  line("Otros pasivos", 600_000, 13, "liability_noncurrent"),
  { kind: "subtotal", label: "TOTAL PASIVO NO CORRIENTE", pesos: 600_000 },
  header("PATRIMONIO"),
  line("Capital social", 1_000_000, 14, "equity", "share_capital"),
  line("Reservas", 0, 15, "equity"),
  line("Resultados del ejercicio", 3_026_000, 16, "equity", "period_result"),
  line("Resultados de ejercicios anteriores", 1_000_000, 17, "equity"),
  { kind: "total", label: "TOTAL PATRIMONIO", pesos: 5_026_000 },
];
const fullEerr = (): StatementRow[] => [
  header("INGRESOS DE ACTIVIDADES ORDINARIAS"),
  line("Ventas", 9_000_000, 18, "income", "sales"),
  line("Devoluciones y Descuentos", -500_000, 20, "income"),
  { kind: "subtotal", label: "TOTAL INGRESOS OPERACIONALES", pesos: 8_500_000 },
  header("COSTOS DE ACTIVIDADES ORDINARIAS"),
  line("Costo de Ventas", 1_000_000, 21, "costs", "cost_of_sales"),
  header("GASTOS OPERACIONALES DE ADMINISTRACIÓN"),
  line("Gastos de personal", 2_000_000, 23, "admin_expenses"),
  line("Arrendamientos", 300_000, 25, "admin_expenses"),
  { kind: "subtotal", label: "TOTAL GASTOS OPERACIONALES ADMINISTRACIÓN", pesos: 2_300_000 },
  header("GASTOS OPERACIONALES DE VENTAS"),
  line("Diversos", 100_000, 31, "sales_expenses"),
  { kind: "subtotal", label: "TOTAL GASTOS OPERACIONALES VENTAS", pesos: 100_000 },
  { kind: "result", label: "RESULTADO OPERACIONAL", pesos: 5_000_000 },
  line("Otros Ingresos", 200_000, 32, "other_income"),
  line("Otros Gastos", 50_000, 33, "other_expenses"),
  line("Otros Gastos financieros", 10_000, 34, "other_expenses"),
  { kind: "result", label: "RESULTADO ANTES DE IMPUESTOS", pesos: 5_140_000 },
];

describe("notas específicas por grupo contable", () => {
  it("construye primero los grupos y los numera de 1 en adelante en el orden contable, sin números fijos", () => {
    const groups = buildNoteGroups(fullEsf(), fullEerr());
    expect(groups.map((g) => [g.number, g.id])).toEqual([
      [1, "disponible"],
      [2, "ppe"],
      [3, "liab_current"],
      [4, "liab_noncurrent"],
      [5, "capital"],
      [6, "results"],
      [7, "income"],
      [8, "admin"],
      [9, "sales"],
      [10, "other_expenses"],
    ]);
  });
  it("un grupo que no existe no reserva número: la numeración se reasigna sin huecos", () => {
    const esf = fullEsf().filter((r) => r.section !== "asset_noncurrent" && r.section !== "liability_noncurrent" && r.label !== "ACTIVO NO CORRIENTE" && r.label !== "PASIVO NO CORRIENTE");
    const groups = buildNoteGroups(esf, fullEerr().filter((r) => r.section !== "sales_expenses" && r.label !== "GASTOS OPERACIONALES DE VENTAS"));
    expect(groups.map((g) => [g.number, g.id])).toEqual([
      [1, "disponible"],
      [2, "liab_current"],
      [3, "capital"],
      [4, "results"],
      [5, "income"],
      [6, "admin"],
      [7, "other_expenses"],
    ]);
  });
  it("el número va en el encabezado del grupo; las partidas sin encabezado propio (Resultados, Otros ingresos, Otros gastos) comparten el número de su grupo", () => {
    const numbered = withNoteNumbers(fullEsf(), fullEerr());
    const marked = [...numbered.esf, ...numbered.eerr].filter((r) => r.note !== undefined).map((r) => [r.note, r.label]);
    expect(marked).toEqual([
      [1, "Disponible"],
      [2, "Propiedades, planta y equipo"],
      [3, "PASIVO CORRIENTE"],
      [4, "PASIVO NO CORRIENTE"],
      [5, "Capital social"],
      [6, "Resultados del ejercicio"],
      [6, "Resultados de ejercicios anteriores"],
      [7, "INGRESOS DE ACTIVIDADES ORDINARIAS"],
      [8, "GASTOS OPERACIONALES DE ADMINISTRACIÓN"],
      [9, "GASTOS OPERACIONALES DE VENTAS"],
      [7, "Otros Ingresos"],
      [10, "Otros Gastos"],
      [10, "Otros Gastos financieros"],
    ]);
    // Nunca repetido en las sublíneas ni en subtotales, totales o resultados.
    expect(numbered.esf.filter((r) => r.kind === "line" && r.label === "Impuestos, gravámenes y tasas")[0].note).toBeUndefined();
  });
  it("la numeración de las notas coincide con la columna NOTA de los estados", () => {
    const items = buildNoteItems(fullEsf(), fullEerr());
    const numbered = withNoteNumbers(fullEsf(), fullEerr());
    expect([...new Set([...numbered.esf, ...numbered.eerr].flatMap((r) => (r.note === undefined ? [] : [r.note])))]).toEqual(items.map((i) => i.number));
  });
  it("las tres parejas comparten número en los estados y en la nota, y cada nota cuadra exactamente con las partidas de los estados", () => {
    const numbered = withNoteNumbers(fullEsf(), fullEerr());
    const noteOf = (label: string) => [...numbered.esf, ...numbered.eerr].find((r) => r.kind === "line" && r.label === label)?.note;
    expect(noteOf("Resultados del ejercicio")).toBeDefined();
    expect(noteOf("Resultados de ejercicios anteriores")).toBe(noteOf("Resultados del ejercicio"));
    expect(noteOf("Otros Gastos financieros")).toBe(noteOf("Otros Gastos"));
    expect(noteOf("Otros Ingresos")).toBe(numbered.eerr.find((r) => r.kind === "header" && r.label === "INGRESOS DE ACTIVIDADES ORDINARIAS")?.note);
    // Mismas cifras: la nota suma exactamente las partidas del grupo tal como las muestran los estados (valor, signo y redondeo).
    for (const item of buildNoteItems(fullEsf(), fullEerr())) {
      if (item.body.kind === "table") expect(noteTableTotal(item.body.rows)).toBe(item.pesos);
    }
  });
  it("estados cerrados antiguos (sin sección en las filas) se agrupan con el catálogo guardado", () => {
    const strip = (rows: StatementRow[]) => rows.map(({ section: _s, role: _r, ...rest }) => rest);
    const catalog = { lines: [], sections: [] };
    const a = buildNoteGroups(strip(fullEsf()), strip(fullEerr()), catalog).map((g) => g.id);
    expect(a).toEqual(buildNoteGroups(fullEsf(), fullEerr()).map((g) => g.id));
  });
  it("el pasivo corriente detalla sus partidas con saldo (sin ceros) y suma el grupo", () => {
    const item = buildNoteItems(fullEsf(), fullEerr()).find((i) => i.id === "liab_current")!;
    expect(item.body).toEqual({ kind: "table", rows: [{ label: "Cuentas por pagar", pesos: 1_000_000 }, { label: "Impuestos, gravámenes y tasas", pesos: 400_000 }] });
    expect(item.pesos).toBe(1_400_000);
  });
  it("Ingresos incluye Otros ingresos y descuenta las devoluciones (negativo)", () => {
    const item = buildNoteItems(fullEsf(), fullEerr()).find((i) => i.id === "income")!;
    if (item.body.kind !== "table") throw new Error("tabla");
    expect(item.body.rows.map((r) => r.label)).toEqual(["Ventas", "Devoluciones y Descuentos", "Otros Ingresos"]);
    expect(noteTableTotal(item.body.rows)).toBe(8_700_000);
  });
  it("Otros gastos agrupa Otros gastos y Otros gastos financieros", () => {
    const item = buildNoteItems(fullEsf(), fullEerr()).find((i) => i.id === "other_expenses")!;
    if (item.body.kind !== "table") throw new Error("tabla");
    expect(item.body.rows.map((r) => r.label)).toEqual(["Otros Gastos", "Otros Gastos financieros"]);
  });
  it("un grupo sin saldos no genera tabla: la nota queda «vacía» (se imprime el texto aprobado)", () => {
    const esf = fullEsf().map((r) => (r.section === "liability_noncurrent" && r.kind === "line" ? { ...r, pesos: 0, cents: 0 } : r));
    const item = buildNoteItems(esf, fullEerr()).find((i) => i.id === "liab_noncurrent")!;
    expect(item.body).toEqual({ kind: "empty" });
    // Sigue numerado: conserva su lugar porque aparece en los estados.
    expect(item.number).toBe(4);
  });
  it("el Disponible se desglosa por cuenta principal con su nombre, no con el código PUC", () => {
    const statements = {
      sections: {
        asset_current: {
          lines: [
            {
              line: { id: 1, section: "asset_current", name: "Disponible" },
              cents: 502_600_000,
              byYear: [],
              contributions: [
                { pucCode: "110505", concept: "CAJA GENERAL", cents: 100_400_000, count: 1 },
                { pucCode: "111005", concept: "MONEDA NACIONAL", cents: 402_200_000, count: 1 },
              ],
            },
          ],
        },
      },
    } as unknown as Statements;
    const concepts = new Map([["1105", "CAJA"], ["1110", "BANCOS"]]);
    const item = buildNoteItems(fullEsf(), fullEerr(), { statements, pucConcepts: concepts }).find((i) => i.id === "disponible")!;
    expect(item.body).toEqual({ kind: "table", rows: [{ label: "Caja", pesos: 1_004_000 }, { label: "Bancos", pesos: 4_022_000 }] });
    if (item.body.kind === "table") expect(noteTableTotal(item.body.rows)).toBe(5_026_000);
  });
  it("Resultados discrimina los ejercicios anteriores por año y cuadra con el estado", () => {
    const statements = {
      sections: {
        equity: {
          lines: [
            { line: { id: 17, section: "equity", name: "Resultados de ejercicios anteriores" }, cents: 100_000_000, contributions: [], byYear: [{ year: "2024", cents: 40_000_000 }, { year: "2025", cents: 60_000_000 }] },
          ],
        },
      },
    } as unknown as Statements;
    const item = buildNoteItems(fullEsf(), fullEerr(), { statements }).find((i) => i.id === "results")!;
    expect(item.body).toEqual({
      kind: "table",
      rows: [
        { label: "Resultados del ejercicio", pesos: 3_026_000 },
        { label: "Resultados de ejercicios anteriores — 2024", pesos: 400_000 },
        { label: "Resultados de ejercicios anteriores — 2025", pesos: 600_000 },
      ],
    });
  });
  it("el reparto al millar siempre suma lo que muestra el estado", () => {
    const pesos = allocateToPesos([50_050_000, 50_050_000, 50_050_000], 1_502_000);
    expect(pesos.reduce((a, b) => a + b, 0)).toBe(1_502_000);
  });
  it("la tabla de capital sale del perfil de la empresa y cuadra con el capital suscrito", () => {
    const company = { subscribedTotalShares: 1000, subscribedNominalValue: 1000, shareholders: [{ name: "Ana", identityDocument: "1", percentage: 60, sortOrder: 1 }, { name: "Luis", identityDocument: "2", percentage: 40, sortOrder: 2 }] };
    expect(capitalTable(company)).toEqual({
      rows: [
        { number: 1, name: "Ana", nominalValue: 1000, shares: 600, total: 600_000 },
        { number: 2, name: "Luis", nominalValue: 1000, shares: 400, total: 400_000 },
      ],
      totalShares: 1000,
      total: 1_000_000,
    });
    expect(capitalTable({ ...company, subscribedTotalShares: null })).toBeNull();
  });
  it("las ediciones guardadas por partida pasan a la nota de su grupo; las que ya no existen se descartan", () => {
    const items = buildNoteItems(fullEsf(), fullEerr());
    const data = { ...initialNotesData(snap(), { start: "2026-01-01", end: "2026-08-31" }, "bank"), notes: { "esf:6": { paragraphs: ["a"] }, "esf:7": { paragraphs: ["b"] }, "esf:999": { paragraphs: ["x"] } } };
    expect(pruneEdits(data, items).notes).toEqual({ "group:liab_current": { paragraphs: ["a", "b"] } });
  });
  it("Disponible no existe si los estados no tienen esa partida (no reserva número)", () => {
    const esf = fullEsf().filter((r) => r.label !== "Disponible");
    expect(buildNoteGroups(esf, fullEerr())[0].id).toBe("ppe");
    expect(buildNoteGroups(esf, fullEerr())[0].number).toBe(1);
  });
});

const snap = (extra: Partial<CompanySnapshot> = {}): CompanySnapshot => ({ companyId: 1, takenAt: "", razonSocial: "D&P CAPITAL INVERSIONES SAS", nit: "9", dv: "7", ciudad: "Medellín", logoFile: null, legalRepName: "JONATHAN MÁRQUEZ", legalRepDocument: "1", entityNarrative: "", corporatePurpose: "", registryChamber: "", registryCity: "", constitutionDocType: "", constitutionDate: "", registryNumber: "", registryDate: "", registryBook: "", registralReview: [], ...extra });

describe("datos de Empresas en las notas", () => {
  it("el período se redacta con las fechas del período elegido", () => {
    expect(headerPeriod("2026-01-01", "2026-08-31")).toBe("DE 01 ENERO A 31 AGOSTO DE 2026");
    expect(periodParagraph("2026-01-01", "2026-08-31")).toContain("al 31 de Agosto de 2026");
    expect(periodParagraph("2026-01-01", "2026-08-31")).toContain("entre 01 de Enero de 2026 y 31 de Agosto de 2026");
  });
  it("sin datos registrales el ente económico y el objeto social quedan en «Revisar»", () => {
    const d = initialNotesData(snap(), { start: "2026-01-01", end: "2026-08-31" }, "bank");
    expect(d.review).toEqual(["entityNarrative", "corporatePurpose"]);
  });
  it("con datos completos agrega el representante y no marca revisión", () => {
    const s = snap({ entityNarrative: "X SAS con domicilio en Medellín es una entidad privada, constituida ante la Cámara de Comercio de Medellín", corporatePurpose: "Objeto largo suficiente para el texto." });
    expect(entityText(s)).toBe("X SAS con domicilio en Medellín es una entidad privada, constituida ante la Cámara de Comercio de Medellín, está representada por Jonathan Márquez.");
    expect(initialNotesData(s, { start: "2026-01-01", end: "2026-08-31" }, "bank").review).toEqual([]);
  });
  it("un dato marcado «Revisar» en Empresas sigue marcado en las notas", () => {
    const s = snap({ entityNarrative: "Texto", corporatePurpose: "Objeto social completo y largo.", registralReview: ["corporatePurpose"] });
    expect(initialNotesData(s, { start: "2026-01-01", end: "2026-08-31" }, "bank").review).toEqual(["corporatePurpose"]);
  });
});
