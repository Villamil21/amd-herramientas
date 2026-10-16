import type { jsPDF as JsPDF } from "jspdf";
import { formatStatementPesos } from "../shared/money";
import type { PdfImage } from "../generator/pdf";
import { headerPeriod, periodParagraph, type NoteEdit, type NoteItem } from "./model";
import { POLICY_BLOCKS } from "./policies";

/**
 * PDF de las Notas a los Estados Financieros: hoja Carta, encabezado en cada página (logo, empresa, NIT, título, período y cifras),
 * texto corrido en varias páginas con numeración al pie. Notas generales (ente económico, objeto social y políticas fijas) y notas
 * específicas numeradas como la columna NOTA de los estados.
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
}

const PAGE = { width: 612, height: 792 };
const MX = 54;
const RIGHT = PAGE.width - MX;
const WIDTH = RIGHT - MX;
const TOP = 148;
const BOTTOM = PAGE.height - 56;
const COLORS = { text: "#222222", muted: "#555555", line: "#9a9a9a", head: "#e9eef6", title: "#111111", accent: "#1f3a6e" };
const SIZE = 9.5;
const LEADING = 1.38;

const imageFormat = (dataUrl: string) => (dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG");

function fitImage(image: PdfImage, box: { x: number; y: number; w: number; h: number }) {
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return { x: box.x, y: box.y + (box.h - h) / 2, w, h };
}

class Writer {
  y = TOP;
  constructor(
    readonly pdf: JsPDF,
    readonly model: NotesPdfModel,
  ) {
    this.header();
  }

  private header() {
    const { pdf, model } = this;
    if (model.logo) {
      const r = fitImage(model.logo, { x: MX - 8, y: 24, w: 96, h: 64 });
      pdf.addImage(model.logo.dataUrl, imageFormat(model.logo.dataUrl), r.x, r.y, r.w, r.h, undefined, "FAST");
    }
    const cx = PAGE.width / 2;
    this.put(model.companyName.toUpperCase(), cx, 50, { size: 12, bold: true, align: "center", color: COLORS.title });
    this.put(`NIT ${model.nit}${model.dv ? `-${model.dv}` : ""}`, cx, 64, { size: 9.5, align: "center", color: COLORS.muted });
    this.put("NOTAS A LOS ESTADOS FINANCIEROS", cx, 92, { size: 12, bold: true, align: "center", color: COLORS.title });
    this.put(headerPeriod(model.startDate, model.endDate), cx, 107, { size: 9, align: "center", color: COLORS.muted });
    this.put("(CIFRAS EXPRESADAS EN PESOS COLOMBIANOS)", cx, 120, { size: 8, align: "center", color: COLORS.muted });
    pdf.setDrawColor(COLORS.line);
    pdf.setLineWidth(0.6);
    pdf.line(MX, TOP - 14, RIGHT, TOP - 14);
    this.y = TOP;
  }

  put(value: string, x: number, y: number, o: { size: number; bold?: boolean; color?: string; align?: "left" | "right" | "center" }) {
    this.pdf.setFont("helvetica", o.bold ? "bold" : "normal");
    this.pdf.setFontSize(o.size);
    this.pdf.setTextColor(o.color ?? COLORS.text);
    this.pdf.text(value, x, y, { align: o.align ?? "left", baseline: "alphabetic" });
  }

  /** Salta de página si lo que sigue no cabe. */
  ensure(height: number) {
    if (this.y + height <= BOTTOM) return;
    this.pdf.addPage([PAGE.width, PAGE.height], "portrait");
    this.header();
  }

  space(h: number) {
    this.y += h;
  }

  lines(text: string, width: number, size: number, bold = false): string[] {
    this.pdf.setFont("helvetica", bold ? "bold" : "normal");
    this.pdf.setFontSize(size);
    return this.pdf.splitTextToSize(text, width) as string[];
  }

  heading(text: string, o: { size?: number; center?: boolean; color?: string; before?: number } = {}) {
    const size = o.size ?? 10.5;
    this.ensure((o.before ?? 8) + size * LEADING * 2.2);
    this.space(o.before ?? 8);
    const parts = this.lines(text, WIDTH, size, true);
    for (const part of parts) {
      this.y += size * LEADING;
      this.put(part, o.center ? PAGE.width / 2 : MX, this.y, { size, bold: true, align: o.center ? "center" : "left", color: o.color ?? COLORS.title });
    }
    this.space(3);
  }

  paragraph(text: string, o: { indent?: number; bullet?: boolean; gap?: number } = {}) {
    const indent = o.indent ?? 0;
    const parts = this.lines(text, WIDTH - indent - (o.bullet ? 12 : 0), SIZE);
    parts.forEach((part, i) => {
      this.ensure(SIZE * LEADING);
      this.y += SIZE * LEADING;
      if (o.bullet && i === 0) this.put("•", MX + indent, this.y, { size: SIZE });
      this.put(part, MX + indent + (o.bullet ? 12 : 0), this.y, { size: SIZE });
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

  table(columns: [string, string], rows: [string, string][], o: { totalRow?: [string, string]; rightWidth?: number } = {}) {
    const rightW = o.rightWidth ?? 130;
    const leftW = WIDTH - rightW;
    const rowH = SIZE * LEADING + 4;
    const all: { cells: [string, string]; head?: boolean; total?: boolean }[] = [{ cells: columns, head: true }, ...rows.map((r) => ({ cells: r })), ...(o.totalRow ? [{ cells: o.totalRow, total: true }] : [])];
    const heights = all.map((r) => Math.max(1, this.lines(r.cells[0], leftW - 10, SIZE, !!r.head || !!r.total).length) * (SIZE * LEADING) + 4);
    this.ensure(Math.min(heights.reduce((a, b) => a + b, 0), 120) + 4);
    all.forEach((r, i) => {
      const h = heights[i];
      this.ensure(h);
      const top = this.y;
      if (r.head) {
        this.pdf.setFillColor(COLORS.head);
        this.pdf.rect(MX, top, WIDTH, h, "F");
      }
      this.pdf.setDrawColor(COLORS.line);
      this.pdf.setLineWidth(0.4);
      this.pdf.rect(MX, top, WIDTH, h);
      this.pdf.line(MX + leftW, top, MX + leftW, top + h);
      const bold = !!r.head || !!r.total;
      this.lines(r.cells[0], leftW - 10, SIZE, bold).forEach((part, k) => this.put(part, MX + 5, top + 2 + (k + 1) * SIZE * LEADING - 3, { size: SIZE, bold }));
      this.put(r.cells[1], r.head ? MX + leftW + rightW / 2 : MX + WIDTH - 6, top + 2 + SIZE * LEADING - 3, { size: SIZE, bold, align: r.head ? "center" : "right", color: r.cells[1].startsWith("(") ? "#c62828" : COLORS.text });
      this.y = top + h;
    });
    void rowH;
    this.space(8);
  }
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
    else w.table(block.columns, block.rows, { rightWidth: 110 });
  }

  w.heading("NOTAS DE CARÁCTER ESPECÍFICO", { size: 11, center: true, before: 14 });
  const year = model.endDate.slice(0, 4);
  for (const item of model.items) {
    w.ensure(110);
    w.heading(`${item.number}. ${item.title.toUpperCase()}`, { size: 10, before: 8 });
    w.paragraph("Se compone de la siguiente forma:", { gap: 4 });
    const amount = item.pesos === 0 ? "$ -" : formatStatementPesos(item.pesos);
    w.table([" ", year], [[item.title, amount]], { totalRow: ["TOTAL", amount] });
    for (const text of model.edits[item.key]?.paragraphs ?? []) if (text.trim()) w.multiline(text);
  }

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
