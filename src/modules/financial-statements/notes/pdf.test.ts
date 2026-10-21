import { describe, expect, it } from "vitest";
import { certificationParagraphs, notesFileName, renderNotesPdf, type NotesPdfModel } from "./pdf";

/** Texto de cada página del PDF (pdf.js, sin render). */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
  return out;
}

const model = (count: number): NotesPdfModel => ({
  companyName: "D&P Capital Inversiones SAS",
  nit: "901709567",
  dv: "7",
  logo: null,
  startDate: "2026-01-01",
  endDate: "2026-08-31",
  entityNarrative: "D&P Capital Inversiones SAS con domicilio en Medellín es una entidad privada, está representada por Jonathan Márquez.",
  corporatePurpose: "El desarrollo de actividades relacionadas con el procesamiento de datos.\nEl comercio al por mayor.",
  items: Array.from({ length: count }, (_, i) => ({
    key: `group:g${i}`,
    id: "disponible" as const,
    number: i + 1,
    section: "esf" as const,
    title: `Grupo ${i + 1}`,
    pesos: i === 1 ? 0 : 1_000_000 * (i + 1),
    lineIds: [],
    body: i === 1 ? { kind: "empty" as const } : { kind: "table" as const, rows: [{ label: "Caja", pesos: 400_000 * (i + 1) }, { label: "Bancos", pesos: 600_000 * (i + 1) }] },
  })),
  edits: { "group:g0": { paragraphs: ["No existen restricciones para la utilización de los saldos."] } },
  city: "Medellín",
  generatedAt: new Date(2026, 9, 21),
  legalRep: { name: "JONATHAN MÁRQUEZ", document: "CC 1.000.000" },
  accountant: { name: "Ana Pérez", title: "Contadora Pública", identification: "CC 52.000.000", professionalDocument: "TP 123456-T", signature: null },
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
  it("las notas específicas empiezan siempre en página nueva, con su primera nota", async () => {
    const { bytes } = await renderNotesPdf(model(3));
    const pages = await pageTexts(bytes);
    const first = pages.findIndex((t) => t.includes("NOTAS DE CARÁCTER ESPECÍFICO"));
    expect(first).toBeGreaterThan(0);
    expect(pages[first]).toContain("1. GRUPO 1");
    expect(pages[first - 1]).not.toContain("NOTAS DE CARÁCTER ESPECÍFICO");
    expect(pages[first - 1]).not.toContain("1. GRUPO 1");
  });
  it("una nota sin saldos imprime el texto aprobado y no una tabla vacía ni «$ -»", async () => {
    const { bytes } = await renderNotesPdf(model(3));
    const text = (await pageTexts(bytes)).join(" ");
    expect(text).toContain("Durante el período no se registraron saldos en esta partida.");
    expect(text).not.toContain("$ -");
  });
  it("el NIT va como 901.709.567 - 7 y la cifra de cada tabla lleva su año y la fila TOTAL", async () => {
    const text = (await pageTexts((await renderNotesPdf(model(3))).bytes)).join(" ");
    expect(text).toContain("NIT 901.709.567 - 7");
    expect(text).toContain("TOTAL");
    expect(text).toContain("2026");
  });
  it("la certificación es la última página, con los datos de la empresa, el representante y el contador", async () => {
    const { bytes, pages } = await renderNotesPdf(model(3));
    const texts = await pageTexts(bytes);
    expect(texts).toHaveLength(pages);
    const last = texts[texts.length - 1];
    expect(last).toContain("CERTIFICACIÓN A LOS ESTADOS FINANCIEROS");
    expect(last).toContain("NOTAS A LOS ESTADOS FINANCIEROS");
    expect(last).toContain("(CIFRAS EXPRESADAS EN PESOS COLOMBIANOS)");
    expect(last).toContain("NIT 901.709.567 - 7");
    expect(last).toContain("D&P Capital Inversiones SAS");
    expect(last).toContain("Ley 1314 de 2009");
    expect(last).toContain("2420 y 2496 de 2015");
    expect(last).toContain("JONATHAN MÁRQUEZ");
    expect(last).toContain("ANA PÉREZ");
    expect(last).toContain("T.P. 123456-T");
    expect(last).toContain("Se expide en Medellín, el 21 de octubre de 2026.");
    expect(texts.slice(0, -1).some((t) => t.includes("CERTIFICACIÓN A LOS ESTADOS FINANCIEROS"))).toBe(false);
  });
  it("la certificación nombra el período y la fecha de corte de las notas", () => {
    const text = certificationParagraphs({ companyName: "X SAS", nit: "901795718", dv: "9", startDate: "2026-01-01", endDate: "2026-08-31" }).join(" ");
    expect(text).toContain("con corte al 31 de agosto de 2026");
    expect(text).toContain("entre el 01 de enero de 2026 y el 31 de agosto de 2026");
    expect(text).toContain("NIT 901.795.718 - 9");
    expect(text).toContain("Estado de Situación Financiera");
    expect(text).toContain("Estado de Resultados Integral");
  });
  it("nombre del archivo: Notas EEFF (mes final) (año) - (empresa).pdf", () => {
    expect(notesFileName("D&P Capital Inversiones SAS", "2026-08-31")).toBe("Notas EEFF 08 2026 - D&P Capital Inversiones SAS.pdf");
  });
});
