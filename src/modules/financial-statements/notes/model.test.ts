import { describe, expect, it } from "vitest";
import type { StatementRow } from "../generator/engine";
import { buildNoteItems, entityText, headerPeriod, periodParagraph, pruneEdits, withNoteNumbers, initialNotesData, type CompanySnapshot } from "./model";

const line = (label: string, pesos: number, lineId: number): StatementRow => ({ kind: "line", label, pesos, cents: pesos * 100, lineId });
const esf: StatementRow[] = [
  { kind: "title", label: "ACTIVO" },
  { kind: "header", label: "ACTIVO CORRIENTE" },
  line("Disponible", 5_026_000, 1),
  line("Cuentas por cobrar", 0, 2),
  { kind: "subtotal", label: "TOTAL ACTIVO CORRIENTE", pesos: 5_026_000 },
  { kind: "gap", label: "" },
  { kind: "total", label: "TOTAL ACTIVO", pesos: 5_026_000 },
];
const eerr: StatementRow[] = [
  { kind: "header", label: "INGRESOS" },
  line("Ingresos", 100, 9),
  { kind: "result", label: "RESULTADO BRUTO", pesos: 100 },
];

describe("notas específicas", () => {
  it("una nota por partida visible, en orden de aparición y empezando en 1", () => {
    const items = buildNoteItems(esf, eerr);
    expect(items.map((i) => [i.number, i.title])).toEqual([[1, "Disponible"], [2, "Cuentas por cobrar"], [3, "Ingresos"]]);
  });
  it("una partida visible con saldo $0 conserva su nota", () => {
    expect(buildNoteItems(esf, eerr).find((i) => i.title === "Cuentas por cobrar")?.pesos).toBe(0);
  });
  it("una partida que no aparece en los estados no tiene nota", () => {
    const without = esf.filter((r) => r.label !== "Cuentas por cobrar");
    expect(buildNoteItems(without, eerr).map((i) => i.title)).toEqual(["Disponible", "Ingresos"]);
  });
  it("encabezados, subtotales, totales y resultados no llevan nota", () => {
    const numbered = withNoteNumbers(esf, eerr);
    for (const row of [...numbered.esf, ...numbered.eerr]) if (row.kind !== "line") expect(row.note).toBeUndefined();
  });
  it("la columna NOTA de los estados coincide con la numeración de las notas", () => {
    const numbered = withNoteNumbers(esf, eerr);
    const items = buildNoteItems(esf, eerr);
    const shown = [...numbered.esf, ...numbered.eerr].filter((r) => r.kind === "line").map((r) => r.note);
    expect(shown).toEqual(items.map((i) => i.number));
  });
  it("las ediciones de una nota que desapareció se descartan; las demás se conservan", () => {
    const items = buildNoteItems(esf, eerr);
    const data = { ...initialNotesData(snap(), { start: "2026-01-01", end: "2026-08-31" }, "bank"), notes: { [items[0].key]: { paragraphs: ["a"] }, "esf:99": { paragraphs: ["b"] } } };
    expect(Object.keys(pruneEdits(data, items).notes)).toEqual([items[0].key]);
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
