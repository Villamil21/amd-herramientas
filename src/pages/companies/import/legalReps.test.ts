import { describe, expect, it } from "vitest";
import type { CamaraData } from "./camaraParser";
import { assignRole, camaraRepWarnings, findShareholder, planRepresentatives, selectedRep, type RepFormState } from "./legalReps";
import type { RutData } from "./rutParser";

const form = (extra: Partial<RepFormState> = {}): RepFormState => ({
  shareholders: [
    { name: "SHADYA SAMPAYO BITAR", identityDocument: "CC 1020713259", legalRole: null },
    { name: "LUIS RUIZ", identityDocument: "CC 2030", legalRole: null },
  ],
  legalRepName: "",
  legalRepDocument: "",
  legalRepManual: false,
  legalRepAltName: "",
  legalRepAltDocument: "",
  legalRepAltManual: false,
  ...extra,
});

const camara = (principal?: [string, string], alternate?: [string, string]): CamaraData => ({
  subscribed: { shares: null, nominal: null },
  paid: { shares: null, nominal: null },
  principals: principal ? [{ name: principal[0], documentType: "CC", documentNumber: principal[1], cargo: "REPRESENTANTE LEGAL" }] : [],
  alternates: alternate ? [{ name: alternate[0], documentType: "CC", documentNumber: alternate[1], cargo: "REPRESENTANTE LEGAL SUPLENTE" }] : [],
  notes: [],
});

const rut = (reps: RutData["representatives"]): RutData => ({ isNaturalPerson: false, representatives: reps, notes: [] });

describe("selección de representantes entre los socios", () => {
  it("el rol es único: asignarlo a otro socio se lo quita al anterior", () => {
    const first = assignRole(form().shareholders, "principal", 0);
    expect(first.map((s) => s.legalRole)).toEqual(["principal", null]);
    const moved = assignRole(first, "principal", 1);
    expect(moved.map((s) => s.legalRole)).toEqual([null, "principal"]);
    expect(assignRole(moved, "principal", null).map((s) => s.legalRole)).toEqual([null, null]);
  });

  it("el principal y el suplente son roles independientes", () => {
    const both = assignRole(assignRole(form().shareholders, "principal", 0), "alternate", 1);
    expect(both.map((s) => s.legalRole)).toEqual(["principal", "alternate"]);
  });

  it("la persona seleccionada sale del socio vinculado; sin socio solo existe la excepción confirmada", () => {
    const linked = form({ shareholders: assignRole(form().shareholders, "principal", 0) });
    expect(selectedRep(linked, "principal")).toMatchObject({ name: "SHADYA SAMPAYO BITAR", kind: "shareholder" });
    expect(selectedRep(linked, "alternate")).toBeNull();
    const manual = form({ legalRepName: "PEDRO", legalRepDocument: "CC 9", legalRepManual: true });
    expect(selectedRep(manual, "principal")).toMatchObject({ name: "PEDRO", kind: "manual" });
  });

  it("encuentra al socio por documento aunque el nombre difiera, o por nombre normalizado sin documento", () => {
    const { shareholders } = form();
    expect(findShareholder(shareholders, { name: "otro nombre", document: "C.C. 1.020.713.259" })).toBe(0);
    expect(findShareholder(shareholders, { name: "Ruiz Luis", document: "" })).toBe(1);
    expect(findShareholder(shareholders, { name: "Desconocido", document: "CC 5" })).toBe(-1);
  });
});

describe("representantes propuestos por RUT y Cámara", () => {
  it("si RUT y Cámara nombran a la misma persona no hay conflicto", () => {
    const proposals = planRepresentatives(
      rut([{ role: "REPRS LEGAL PRIN", isAlternate: false, name: "SHADYA SAMPAYO BITAR", documentType: "CC", documentNumber: "1020713259" }]),
      camara(["Sampayo Bitar Shadya", "1020713259"]),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ role: "principal", conflict: false, ambiguous: false });
    expect(proposals[0].options.map((o) => o.source)).toEqual(["rut", "camara"]);
  });

  it("si nombran personas distintas es un conflicto que el usuario debe resolver", () => {
    const proposals = planRepresentatives(
      rut([{ role: "REPRS LEGAL PRIN", isAlternate: false, name: "ANA GOMEZ", documentType: "CC", documentNumber: "111" }]),
      camara(["LUIS RUIZ", "2030"], ["PEDRO PEREZ", "333"]),
    );
    expect(proposals.find((p) => p.role === "principal")!.conflict).toBe(true);
    expect(proposals.find((p) => p.role === "alternate")).toMatchObject({ conflict: false });
  });

  it("varios principales en un mismo documento se marcan ambiguos en vez de escoger uno", () => {
    const c = camara(["A B", "1"]);
    c.principals.push({ name: "C D", documentType: "CC", documentNumber: "2", cargo: "GERENTE" });
    expect(planRepresentatives(null, c)[0]).toMatchObject({ ambiguous: true, conflict: true });
  });

  it("sin documentos no propone nada", () => {
    expect(planRepresentatives(null, null)).toEqual([]);
  });
});

describe("advertencia: representantes de la Cámara vs. socios seleccionados", () => {
  it("avisa si no hay principal seleccionado o si es otra persona, y se calla si coincide", () => {
    const c = camara(["SHADYA SAMPAYO BITAR", "1020713259"]);
    expect(camaraRepWarnings(form(), c)).toEqual([{ role: "principal", expected: { name: "SHADYA SAMPAYO BITAR", document: "CC 1020713259" }, selected: null }]);
    const wrong = form({ shareholders: assignRole(form().shareholders, "principal", 1) });
    expect(camaraRepWarnings(wrong, c)[0]).toMatchObject({ role: "principal", selected: { name: "LUIS RUIZ" } });
    const right = form({ shareholders: assignRole(form().shareholders, "principal", 0) });
    expect(camaraRepWarnings(right, c)).toEqual([]);
  });

  it("compara con normalización segura de mayúsculas, tildes y espacios cuando no hay documento", () => {
    const f = form({ shareholders: [{ name: "José  Pérez", identityDocument: "", legalRole: "principal" }] });
    expect(camaraRepWarnings(f, camara(["JOSE PEREZ", ""]))).toEqual([]);
  });

  it("sin Cámara o sin representantes en ella no avisa", () => {
    expect(camaraRepWarnings(form(), null)).toEqual([]);
    expect(camaraRepWarnings(form(), camara())).toEqual([]);
  });

  it("el suplente de la Cámara no reemplaza al principal", () => {
    const c = camara(["SHADYA SAMPAYO BITAR", "1020713259"], ["LUIS RUIZ", "2030"]);
    const f = form({ shareholders: assignRole(form().shareholders, "principal", 0) });
    const warnings = camaraRepWarnings(f, c);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ role: "alternate", selected: null });
  });
});
