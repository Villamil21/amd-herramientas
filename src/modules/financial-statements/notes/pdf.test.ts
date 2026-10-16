import { describe, expect, it } from "vitest";
import { notesFileName, renderNotesPdf, type NotesPdfModel } from "./pdf";

const model = (count: number): NotesPdfModel => ({
  companyName: "D&P Capital Inversiones SAS",
  nit: "901709567",
  dv: "7",
  logo: null,
  startDate: "2026-01-01",
  endDate: "2026-08-31",
  entityNarrative: "D&P Capital Inversiones SAS con domicilio en Medellín es una entidad privada, está representada por Jonathan Márquez.",
  corporatePurpose: "El desarrollo de actividades relacionadas con el procesamiento de datos.\nEl comercio al por mayor.",
  items: Array.from({ length: count }, (_, i) => ({ key: `esf:${i}`, number: i + 1, section: "esf" as const, title: `Partida ${i + 1}`, pesos: i === 1 ? 0 : 1_000_000 * (i + 1) })),
  edits: { "esf:0": { paragraphs: ["No existen restricciones para la utilización de los saldos."] } },
});

describe("PDF de Notas Financieras", () => {
  it("genera un PDF de varias páginas con las notas generales y las específicas", async () => {
    const { bytes, pages } = await renderNotesPdf(model(6));
    expect(bytes.length).toBeGreaterThan(5000);
    expect(pages).toBeGreaterThan(3);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
  it("con muchas notas sigue paginando sin fallar", async () => {
    const few = await renderNotesPdf(model(2));
    const many = await renderNotesPdf(model(80));
    expect(many.pages).toBeGreaterThan(few.pages);
  });
  it("nombre del archivo: Notas EEFF (mes final) (año) - (empresa).pdf", () => {
    expect(notesFileName("D&P Capital Inversiones SAS", "2026-08-31")).toBe("Notas EEFF 08 2026 - D&P Capital Inversiones SAS.pdf");
  });
});
