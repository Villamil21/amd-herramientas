import type { jsPDF as JsPDF } from "jspdf";
import { formatPdfNit } from "../shared/money";
import { accountantSignName, legalRepSignName, splitPesos, type PdfImage } from "../generator/pdf";
import { headerPeriod, longDate, noteTableTotal, NO_BALANCES_TEXT, periodParagraph, type CapitalTable, type NoteEdit, type NoteItem, type NoteTableRow } from "./model";
import { POLICY_BLOCKS } from "./policies";

/**
 * PDF de las Notas a los Estados Financieros: hoja Carta, encabezado en cada página (logo, empresa, NIT, título, período y cifras),
 * texto corrido en varias páginas con numeración al pie. Notas generales (ente económico, objeto social y políticas fijas), notas
 * específicas por grupo contable (siempre en página nueva) y, como última página, la certificación a los estados financieros.
 */

export interface NotesPdfModel {
  companyName: string;
  nit: string;
  dv: string;
  logo: PdfImage | null;
  startDate: string;
  endDate: string;
  entityNarrative: string;
  corporatePurpose: string;
  items: NoteItem[];
  edits: Record<string, NoteEdit>;
  /** Ciudad de la empresa y fecha REAL de generación del PDF (para la certificación). */
  city: string;
  generatedAt: Date;
  legalRep: { name: string; document: string; parts?: { firstName?: string; otherNames?: string; firstSurname?: string; secondSurname?: string } | null };
  accountant: { name: string; title: string; identification: string; professionalDocument: string; signature: PdfImage | null };
}

const PAGE = { width: 612, height: 792 };
const MX = 54;
const RIGHT = PAGE.width - MX;
const WIDTH = RIGHT - MX;
const TOP = 148;
const BOTTOM = PAGE.height - 56;
const COLORS = { text: "#222222", muted: "#555555", line: "#9a9a9a", hair: "#c9c9c9", total: "#f1f1f1", negative: "#c62828", title: "#111111" };
const SIZE = 9.5;
const LEADING = 1.38;
/** Columna de valores de las tablas de una partida: el «$» en su espacio fijo y la cifra alineada a la derecha. */
const VALUE_W = 130;

const imageFormat = (dataUrl: string) => (dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG");

function fitImage(image: PdfImage, box: { x: number; y: number; w: number; h: number }, align: "left" | "center" = "left") {
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return { x: align === "center" ? box.x + (box.w - w) / 2 : box.x, y: box.y + (box.h - h) / 2, w, h };
}

type FontStyle = "normal" | "bold" | "italic" | "bolditalic";
const fontStyle = (bold?: boolean, italic?: boolean): FontStyle => (bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal");

/** Una celda de tabla: texto o importe (el «$» va en una columna fija a la izquierda de la cifra). */
interface Cell {
  text: string;
  align?: "left" | "right" | "center";
  /** Importe en pesos: se imprime con «$» fijo y la cifra a la derecha. */
  pesos?: number;
}

class Writer {
  y = TOP;
  constructor(
    readonly pdf: JsPDF,
    readonly model: NotesPdfModel,
  ) {
    this.header();
  }

  header(title = "NOTAS A LOS ESTADOS FINANCIEROS", figures = true) {
    const { pdf, model } = this;
    if (model.logo) {
      // Misma posición y proporción que el PDF de Estados Financieros: un poco abajo y a la derecha, sin tocar bordes ni deformarlo.
      const r = fitImage(model.logo, { x: MX + 6, y: 32, w: 96, h: 64 });
      pdf.addImage(model.logo.dataUrl, imageFormat(model.logo.dataUrl), r.x, r.y, r.w, r.h, undefined, "FAST");
    }
    const cx = PAGE.width / 2;
    this.put(model.companyName.toUpperCase(), cx, 50, { size: 12, bold: true, align: "center", color: COLORS.title });
    this.put(`NIT ${formatPdfNit(model.nit, model.dv)}`, cx, 64, { size: 9.5, align: "center", color: COLORS.muted });
    this.put(title, cx, 92, { size: 12, bold: true, align: "center", color: COLORS.title });
    this.put(headerPeriod(model.startDate, model.endDate), cx, 107, { size: 9, align: "center", color: COLORS.muted });
    if (figures) this.put("(CIFRAS EXPRESADAS EN PESOS COLOMBIANOS)", cx, 120, { size: 8, align: "center", color: COLORS.muted });
    pdf.setDrawColor(COLORS.line);
    pdf.setLineWidth(0.6);
    pdf.line(MX, TOP - 14, RIGHT, TOP - 14);
    this.y = TOP;
  }

  put(value: string, x: number, y: number, o: { size: number; bold?: boolean; italic?: boolean; color?: string; align?: "left" | "right" | "center" }) {
    this.pdf.setFont("helvetica", fontStyle(o.bold, o.italic));
    this.pdf.setFontSize(o.size);
    this.pdf.setTextColor(o.color ?? COLORS.text);
    this.pdf.text(value, x, y, { align: o.align ?? "left", baseline: "alphabetic" });
  }

  addPage(title?: string, figures?: boolean) {
    this.pdf.addPage([PAGE.width, PAGE.height], "portrait");
    this.header(title, figures);
  }

  /** Salta de página si lo que sigue no cabe. */
  ensure(height: number) {
    if (this.y + height <= BOTTOM) return;
    this.addPage();
  }

  space(h: number) {
    this.y += h;
  }

  lines(text: string, width: number, size: number, bold = false, italic = false): string[] {
    this.pdf.setFont("helvetica", fontStyle(bold, italic));
    this.pdf.setFontSize(size);
    return this.pdf.splitTextToSize(text, width) as string[];
  }

  heading(text: string, o: { size?: number; center?: boolean; color?: string; before?: number; keepWith?: number } = {}) {
    const size = o.size ?? 10.5;
    this.ensure((o.before ?? 8) + size * LEADING * 2.2 + (o.keepWith ?? 0));
    this.space(o.before ?? 8);
    const parts = this.lines(text, WIDTH, size, true);
    for (const part of parts) {
      this.y += size * LEADING;
      this.put(part, o.center ? PAGE.width / 2 : MX, this.y, { size, bold: true, align: o.center ? "center" : "left", color: o.color ?? COLORS.title });
    }
    this.space(3);
  }

  /** Una línea de texto justificada: el espacio sobrante se reparte entre las palabras. */
  justified(line: string, x: number, y: number, width: number, size: number, last: boolean) {
    const words = line.split(/\s+/).filter(Boolean);
    this.pdf.setFont("helvetica", "normal");
    this.pdf.setFontSize(size);
    this.pdf.setTextColor(COLORS.text);
    if (last || words.length < 2) return this.put(line, x, y, { size });
    const widths = words.map((w) => this.pdf.getTextWidth(w));
    const gap = (width - widths.reduce((a, b) => a + b, 0)) / (words.length - 1);
    // Una línea casi vacía no se estira (evita huecos enormes).
    if (gap > size * 1.6) return this.put(line, x, y, { size });
    let cx = x;
    words.forEach((w, i) => {
      this.pdf.text(w, cx, y, { baseline: "alphabetic" });
      cx += widths[i] + gap;
    });
  }

  /** Párrafo de cuerpo: texto justificado (los títulos y encabezados conservan su alineación). */
  paragraph(text: string, o: { indent?: number; bullet?: boolean; gap?: number; size?: number; leading?: number } = {}) {
    const indent = o.indent ?? 0;
    const size = o.size ?? SIZE;
    const leading = o.leading ?? LEADING;
    const bulletW = o.bullet ? 12 : 0;
    const width = WIDTH - indent - bulletW;
    const parts = this.lines(text, width, size);
    parts.forEach((part, i) => {
      this.ensure(size * leading);
      this.y += size * leading;
      if (o.bullet && i === 0) this.put("•", MX + indent, this.y, { size });
      this.justified(part, MX + indent + bulletW, this.y, width, size, i === parts.length - 1);
    });
    this.space(o.gap ?? 5);
  }

  /** Párrafos separados por saltos de línea (objeto social con viñetas o varios párrafos). */
  multiline(text: string) {
    for (const raw of text.split(/\n+/)) {
      const line = raw.trim();
      if (!line) continue;
      this.paragraph(line);
    }
  }

  /**
   * Tabla sin cuadrícula: líneas horizontales finas, encabezado sin relleno, una división vertical discreta antes de la última
   * columna, nombres en cursiva y fila TOTAL con fondo gris muy claro en negrita y cursiva.
   */
  grid(o: { widths: number[]; head: Cell[]; rows: { cells: Cell[]; italic?: boolean; bold?: boolean; indent?: number }[]; total?: Cell[]; dividerBefore?: number }) {
    const { widths } = o;
    const lefts = widths.map((_, i) => MX + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const pad = 5;
    const divider = o.dividerBefore ?? widths.length - 1;
    const height = (cells: Cell[], bold: boolean, italic: boolean, indent = 0) => {
      const n = Math.max(1, ...cells.map((c, i) => (c.pesos === undefined && (c.align ?? "left") === "left" ? this.lines(c.text, widths[i] - pad * 2 - indent, SIZE, bold, italic).length : 1)));
      return n * SIZE * LEADING + 5;
    };
    const draw = (cells: Cell[], opts: { bold?: boolean; italic?: boolean; fill?: boolean; indent?: number; rule: string; ruleWidth: number }) => {
      const bold = !!opts.bold;
      const italic = !!opts.italic;
      const h = height(cells, bold, italic, opts.indent);
      this.ensure(h);
      const top = this.y;
      if (opts.fill) {
        this.pdf.setFillColor(COLORS.total);
        this.pdf.rect(MX, top, WIDTH, h, "F");
      }
      cells.forEach((c, i) => {
        const base = top + 2 + SIZE * LEADING - 3;
        const left = lefts[i];
        if (c.pesos !== undefined) {
          const { symbol, number } = splitPesos(c.pesos);
          const color = c.pesos < 0 ? COLORS.negative : COLORS.text;
          if (symbol) this.put("$", left + pad + 2, base, { size: SIZE, bold, italic, color });
          this.put(number, left + widths[i] - pad - 2, base, { size: SIZE, bold, italic, align: "right", color });
        } else if ((c.align ?? "left") === "left") {
          this.lines(c.text, widths[i] - pad * 2 - (i === 0 ? (opts.indent ?? 0) : 0), SIZE, bold, italic).forEach((part, k) => this.put(part, left + pad + (i === 0 ? (opts.indent ?? 0) : 0), base + k * SIZE * LEADING, { size: SIZE, bold, italic }));
        } else if (c.align === "center") this.put(c.text, left + widths[i] / 2, base, { size: SIZE, bold, italic, align: "center" });
        else this.put(c.text, left + widths[i] - pad - 2, base, { size: SIZE, bold, italic, align: "right" });
      });
      this.pdf.setDrawColor(opts.rule);
      this.pdf.setLineWidth(opts.ruleWidth);
      this.pdf.line(MX, top + h, RIGHT, top + h);
      // División vertical discreta antes de la columna de valores.
      this.pdf.setDrawColor(COLORS.hair);
      this.pdf.setLineWidth(0.4);
      this.pdf.line(lefts[divider], top, lefts[divider], top + h);
      this.y = top + h;
    };
    const first = height(o.head, true, false) + (o.rows[0] ? height(o.rows[0].cells, !!o.rows[0].bold, !!o.rows[0].italic) : 0);
    this.ensure(first + 4);
    draw(o.head, { bold: true, rule: COLORS.line, ruleWidth: 0.6 });
    for (const r of o.rows) draw(r.cells, { bold: r.bold, italic: r.italic, indent: r.indent, rule: COLORS.hair, ruleWidth: 0.3 });
    if (o.total) draw(o.total, { bold: true, italic: true, fill: true, rule: COLORS.line, ruleWidth: 0.5 });
    this.space(8);
  }

  /** Tabla de una partida: nombre | año. */
  noteTable(year: string, rows: NoteTableRow[]) {
    this.grid({
      widths: [WIDTH - VALUE_W, VALUE_W],
      head: [{ text: "" }, { text: year, align: "right" }],
      rows: rows.map((r) => ({ cells: [{ text: r.label }, r.pesos === undefined ? { text: "" } : { text: "", pesos: r.pesos }], italic: true, indent: r.indent ? 14 : 0 })),
      total: [{ text: "TOTAL" }, { text: "", pesos: noteTableTotal(rows) }],
    });
  }

  /** Capital social: No., Accionista, Valor nominal, Número de acciones y Total. */
  capital(table: CapitalTable) {
    const money = (n: number): Cell => ({ text: "", pesos: n });
    const count = (n: number): Cell => ({ text: n.toLocaleString("es-CO"), align: "right" });
    this.grid({
      widths: [34, WIDTH - 34 - 100 - 118 - 106, 100, 118, 106],
      dividerBefore: 2,
      head: [{ text: "No.", align: "center" }, { text: "Accionista" }, { text: "Valor nominal", align: "right" }, { text: "Número de acciones", align: "right" }, { text: "Total", align: "right" }],
      rows: table.rows.map((r) => ({ cells: [{ text: String(r.number), align: "center" }, { text: r.name }, money(r.nominalValue), count(r.shares), money(r.total)], italic: true })),
      total: [{ text: "" }, { text: "TOTAL" }, { text: "" }, count(table.totalShares), money(table.total)],
    });
  }
}

/** Tabla de vidas útiles de las políticas: dos columnas de texto con el mismo estilo. */
function policyTable(w: Writer, columns: [string, string], rows: [string, string][]) {
  w.grid({ widths: [WIDTH - 110, 110], head: [{ text: columns[0] }, { text: columns[1], align: "center" }], rows: rows.map((r) => ({ cells: [{ text: r[0] }, { text: r[1], align: "center" }], italic: true })) });
}

/** Texto de la certificación (párrafos de cuerpo, justificados). */
export function certificationParagraphs(model: Pick<NotesPdfModel, "companyName" | "nit" | "dv" | "startDate" | "endDate">): string[] {
  const company = model.companyName.trim();
  const lower = (iso: string) => longDate(iso).replace(/ de (\S+) de /, (_m, month: string) => ` de ${month.toLowerCase()} de `);
  return [
    `Los suscritos Representante Legal y Contador(a) Público(a) de ${company}, identificada con NIT ${formatPdfNit(model.nit, model.dv)}, certificamos que los Estados Financieros de la entidad, con corte al ${lower(model.endDate)}, correspondientes al período comprendido entre el ${lower(model.startDate)} y el ${lower(model.endDate)}, han sido preparados de conformidad con la Ley 1314 de 2009 y los Decretos 2420 y 2496 de 2015, con sus modificaciones, y con el marco técnico normativo de información financiera aplicable a la entidad.`,
    "Los Estados Financieros certificados comprenden el Estado de Situación Financiera y el Estado de Resultados Integral del período, y las notas que forman parte integral de ellos y constituyen sus revelaciones.",
    "Certificamos, además, que los Estados Financieros reflejan razonablemente la situación financiera de la entidad a la fecha de corte, y que los hechos económicos han sido clasificados, descritos y revelados correctamente en dichos estados y en sus notas.",
  ];
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function certification(w: Writer) {
  const { model, pdf } = w;
  // Mismo encabezado de las notas (título, período, cifras y línea); el título de la certificación va debajo de la línea.
  w.addPage();
  w.heading("CERTIFICACIÓN A LOS ESTADOS FINANCIEROS", { size: 11, center: true, before: 0 });
  w.space(10);
  for (const p of certificationParagraphs(model)) w.paragraph(p, { size: 10.5, leading: 1.6, gap: 10 });
  const d = model.generatedAt;
  const city = model.city.trim();
  w.paragraph(`${city ? `Se expide en ${city}, el` : "Se expide el"} ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}.`, { size: 10.5, leading: 1.6, gap: 0 });

  const lineY = Math.max(w.y + 120, 470);
  const colW = 210;
  const left = { x: MX + 6, center: MX + 6 + colW / 2 };
  const right = { x: RIGHT - 6 - colW, center: RIGHT - 6 - colW / 2 };
  if (model.accountant.signature) {
    const r = fitImage(model.accountant.signature, { x: right.x, y: lineY - 56, w: colW, h: 52 }, "center");
    pdf.addImage(model.accountant.signature.dataUrl, imageFormat(model.accountant.signature.dataUrl), r.x, r.y, r.w, r.h, undefined, "FAST");
  }
  pdf.setDrawColor(COLORS.text);
  pdf.setLineWidth(0.6);
  pdf.line(left.x, lineY, left.x + colW, lineY);
  pdf.line(right.x, lineY, right.x + colW, lineY);
  const block = (center: number, values: string[]) => values.filter(Boolean).forEach((v, i) => w.put(v, center, lineY + 13 + i * 11.5, { size: 9, bold: i === 0, align: "center" }));
  block(left.center, [legalRepSignName(model.legalRep.name, model.legalRep.parts), "Representante Legal", model.legalRep.document]);
  const tp = model.accountant.professionalDocument ? `T.P. ${model.accountant.professionalDocument.replace(/^T\.?P\.?[\s-]*/i, "")}` : "";
  block(right.center, [accountantSignName(model.accountant.name), model.accountant.title, model.accountant.identification, tp]);
}

/** jsPDF se carga solo al generar, para no pesar en el inicio de la aplicación. */
export async function renderNotesPdf(model: NotesPdfModel): Promise<{ bytes: Uint8Array; pages: number }> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: [PAGE.width, PAGE.height], compress: true });
  pdf.setProperties({ title: `Notas a los Estados Financieros ${model.companyName}`, creator: "AMD Módulos" });
  const w = new Writer(pdf, model);

  w.heading("NOTAS DE CARÁCTER GENERAL", { size: 11, center: true, before: 0 });
  w.heading("ENTE ECONÓMICO", { size: 10 });
  w.multiline(model.entityNarrative || "—");
  w.heading("OBJETO SOCIAL", { size: 10 });
  w.multiline(model.corporatePurpose || "—");
  w.heading("RESUMEN DE POLÍTICAS CONTABLES", { size: 10 });
  for (const block of POLICY_BLOCKS) {
    if (block.type === "heading") w.heading(block.text, { size: 9.5, before: 5 });
    else if (block.type === "paragraph") w.paragraph(block.text);
    else if (block.type === "bullet") w.paragraph(block.text, { bullet: true, indent: 10, gap: 3 });
    else if (block.type === "period") w.paragraph(periodParagraph(model.startDate, model.endDate));
    else policyTable(w, block.columns, block.rows);
  }

  // Las notas específicas siempre empiezan en página nueva, con la primera nota en esa misma página (el título nunca queda solo).
  w.addPage();
  w.heading("NOTAS DE CARÁCTER ESPECÍFICO", { size: 11, center: true, before: 0 });
  const year = model.endDate.slice(0, 4);
  model.items.forEach((item, i) => {
    w.heading(`${item.number}. ${item.title.toUpperCase()}`, { size: 10, before: i === 0 ? 4 : 10, keepWith: 90 });
    if (item.body.kind === "empty") w.paragraph(NO_BALANCES_TEXT);
    else {
      w.paragraph("Se compone de la siguiente forma:", { gap: 4 });
      if (item.body.kind === "capital") {
        if (item.body.table) w.capital(item.body.table);
        else w.paragraph("El capital suscrito no está configurado en el perfil de la empresa.");
      } else w.noteTable(year, item.body.rows);
    }
    for (const text of model.edits[item.key]?.paragraphs ?? []) if (text.trim()) w.multiline(text);
  });

  // La certificación es siempre la última página.
  certification(w);

  // Numeración al pie.
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(COLORS.muted);
    pdf.text(`${i}`, PAGE.width / 2, PAGE.height - 30, { align: "center" });
  }
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), pages: total };
}

/** «Notas EEFF 08 2026 - Empresa.pdf» (mes y año de la fecha final). */
export function notesFileName(companyName: string, endDate: string): string {
  const clean = companyName.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `Notas EEFF ${endDate.slice(5, 7)} ${endDate.slice(0, 4)} - ${clean}.pdf`;
}
