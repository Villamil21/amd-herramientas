import type { jsPDF as JsPDF } from "jspdf";
import { formatStatementPesos, statementDate } from "../shared/money";
import type { StatementRow } from "./engine";

/**
 * PDF de los Estados Financieros: EXACTAMENTE dos páginas.
 *   Página 1 → Estado de Situación Financiera.  Página 2 → Estado de Resultados.
 * Si un estado tiene muchas líneas se reducen fuente, espaciado y márgenes
 * internos hasta que quepa en su página: nunca se crea una tercera.
 *
 * No aparece «Banco», «OTC» ni la fecha de generación (se guardan solo en el
 * snapshot). Negativos en rojo entre paréntesis; ceros como «-».
 *
 * Títulos y encabezados de sección no tienen NOTA ni Valor y usan todo el
 * ancho; totales y resultados llegan hasta su valor. Un texto solo se parte en
 * dos renglones si no cabe (nunca se reduce la fuente de una fila sola).
 */

export interface PdfImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface StatementsPdfModel {
  companyName: string;
  nit: string;
  dv: string;
  logo: PdfImage | null;
  startDate: string;
  endDate: string;
  esfRows: StatementRow[];
  eerrRows: StatementRow[];
  legalRep: { name: string; document: string };
  accountant: { name: string; title: string; professionalDocument: string; signature: PdfImage | null };
}

/** Hoja Carta, como los demás documentos de AMD Módulos. */
export const PAGE = { width: 612, height: 792 };
const MARGIN_X = 54;
const VALUE_RIGHT = PAGE.width - MARGIN_X;
const NOTE_X = PAGE.width - MARGIN_X - 150;
const COLORS = { text: "#222222", muted: "#555555", line: "#9a9a9a", negative: "#c62828", title: "#111111" };
/** Bloque de notas y firmas al pie (alto fijo). */
const FOOTER_HEIGHT = 150;
const HEADER_BOTTOM = 150;

const NOTES_TEXT = "Las notas descritas son parte integral de los Estados Financieros.";

/** Ancho de la raya sobre el valor de subtotales, totales y resultados. */
const VALUE_RULE = 95;

const indentOf = (row: StatementRow) => (row.kind === "line" ? 14 : row.kind === "subtotal" ? 6 : 0);

/**
 * Ancho disponible para el texto de una fila. Títulos y encabezados no tienen
 * NOTA ni Valor: usan todo el ancho. Totales y resultados llegan hasta su
 * valor (la columna NOTA está vacía). Solo las cuentas se detienen antes de NOTA.
 */
export function labelWidth(row: StatementRow): number {
  const left = MARGIN_X + indentOf(row);
  if (row.kind === "line") return NOTE_X - 18 - left;
  if (row.kind === "subtotal" || row.kind === "total" || row.kind === "result") return VALUE_RIGHT - VALUE_RULE - 10 - left;
  return VALUE_RIGHT - left;
}

/** Alto de una fila según su tipo, para un tamaño de fuente, un interlineado y sus renglones de texto. */
function rowHeight(row: StatementRow, size: number, leading: number, lines = 1): number {
  const extra = (lines - 1) * size * leading;
  if (row.kind === "gap") return size * leading * 0.6;
  if (row.kind === "title") return size * leading * 1.45 + extra;
  if (row.kind === "header") return size * leading * 1.25 + extra;
  if (row.kind === "total" || row.kind === "result") return size * leading * 1.2 + extra;
  return size * leading + extra;
}

/** Renglones del texto de una fila para un tamaño de fuente (1 si cabe en una línea). */
export type LineCounter = (row: StatementRow, size: number) => number;

export interface FitResult {
  size: number;
  leading: number;
  height: number;
}

/**
 * Tamaño de fuente e interlineado más grandes con los que todas las filas caben
 * en el espacio disponible. Primero baja la fuente (hasta 6 pt) y luego el
 * interlineado (hasta 1,15): siempre devuelve algo que cabe en una página.
 */
export function fitRows(rows: StatementRow[], available: number, count: LineCounter = () => 1): FitResult {
  const height = (size: number, leading: number) => rows.reduce((s, r) => s + rowHeight(r, size, leading, count(r, size)), 0);
  const fits = (size: number, leading: number) => height(size, leading) <= available - 0.01;
  // Pasos enteros (cuartos de punto, centésimas de interlineado): sin errores de acumulación.
  for (let quarter = 38; quarter >= 24; quarter--) {
    if (fits(quarter / 4, 1.65)) return { size: quarter / 4, leading: 1.65, height: height(quarter / 4, 1.65) };
  }
  for (let hundredth = 160; hundredth >= 115; hundredth -= 5) {
    if (fits(6, hundredth / 100)) return { size: 6, leading: hundredth / 100, height: height(6, hundredth / 100) };
  }
  // Último recurso: escala proporcional (sigue en una página).
  const size = (6 * (available - 0.01)) / height(6, 1.15);
  return { size, leading: 1.15, height: height(size, 1.15) };
}

function text(pdf: JsPDF, value: string, x: number, y: number, opts: { size: number; bold?: boolean; color?: string; align?: "left" | "right" | "center" }) {
  pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
  pdf.setFontSize(opts.size);
  pdf.setTextColor(opts.color ?? COLORS.text);
  pdf.text(value, x, y, { align: opts.align ?? "left", baseline: "alphabetic" });
}

function fit(image: PdfImage, box: { x: number; y: number; w: number; h: number }, align: "left" | "center" = "left") {
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return { x: align === "center" ? box.x + (box.w - w) / 2 : box.x, y: box.y + (box.h - h) / 2, w, h };
}

const imageFormat = (dataUrl: string) => (dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG");

function header(pdf: JsPDF, model: StatementsPdfModel, title: string) {
  // Logo arriba a la izquierda, sin deformar.
  if (model.logo) {
    const r = fit(model.logo, { x: MARGIN_X - 8, y: 24, w: 96, h: 64 });
    pdf.addImage(model.logo.dataUrl, imageFormat(model.logo.dataUrl), r.x, r.y, r.w, r.h, undefined, "FAST");
  }
  const cx = PAGE.width / 2;
  text(pdf, model.companyName.toUpperCase(), cx, 50, { size: 12, bold: true, align: "center", color: COLORS.title });
  text(pdf, `NIT ${model.nit}${model.dv ? `-${model.dv}` : ""}`, cx, 64, { size: 9.5, align: "center", color: COLORS.muted });
  text(pdf, title, cx, 92, { size: 12, bold: true, align: "center", color: COLORS.title });
  text(pdf, `DE ${statementDate(model.startDate)} A ${statementDate(model.endDate)}`, cx, 107, { size: 9, align: "center", color: COLORS.muted });
  text(pdf, "(CIFRAS EXPRESADAS EN PESOS COLOMBIANOS)", cx, 120, { size: 8, align: "center", color: COLORS.muted });
  // Encabezado de columnas
  text(pdf, "NOTA", NOTE_X, 140, { size: 7.5, bold: true, align: "center", color: COLORS.muted });
  pdf.setDrawColor(COLORS.line);
  pdf.setLineWidth(0.6);
  pdf.line(MARGIN_X, HEADER_BOTTOM - 4, VALUE_RIGHT, HEADER_BOTTOM - 4);
}

/** Texto de la fila partido en renglones: una sola línea siempre que quepa en su ancho. */
function wrapLabel(pdf: JsPDF, row: StatementRow, size: number): string[] {
  if (row.kind === "gap") return [];
  pdf.setFont("helvetica", row.kind === "line" ? "normal" : "bold");
  pdf.setFontSize(row.kind === "title" ? size + 1 : size);
  return pdf.splitTextToSize(row.label, labelWidth(row)) as string[];
}

function table(pdf: JsPDF, rows: StatementRow[]) {
  const top = HEADER_BOTTOM + 6;
  const available = PAGE.height - FOOTER_HEIGHT - top;
  const { size, leading } = fitRows(rows, available, (row, s) => Math.max(1, wrapLabel(pdf, row, s).length));
  let y = top;
  for (const row of rows) {
    const label = wrapLabel(pdf, row, size);
    const h = rowHeight(row, size, leading, Math.max(1, label.length));
    // Baseline del último renglón: el valor va alineado con él.
    const baseline = y + h - size * 0.35;
    if (row.kind !== "gap") {
      const bold = row.kind !== "line";
      label.forEach((part, i) => text(pdf, part, MARGIN_X + indentOf(row), baseline - (label.length - 1 - i) * size * leading, { size: row.kind === "title" ? size + 1 : size, bold }));
      if (row.pesos !== undefined) {
        const value = formatStatementPesos(row.pesos);
        text(pdf, value, VALUE_RIGHT, baseline, { size, bold, align: "right", color: row.pesos < 0 ? COLORS.negative : COLORS.text });
        if (row.kind === "subtotal" || row.kind === "total" || row.kind === "result") {
          pdf.setDrawColor(COLORS.line);
          pdf.setLineWidth(row.kind === "subtotal" ? 0.4 : 0.7);
          pdf.line(VALUE_RIGHT - VALUE_RULE, y + size * 0.15, VALUE_RIGHT, y + size * 0.15);
        }
      }
    }
    y += h;
  }
}

function footer(pdf: JsPDF, model: StatementsPdfModel) {
  const top = PAGE.height - FOOTER_HEIGHT;
  text(pdf, NOTES_TEXT, MARGIN_X, top + 22, { size: 7.5, color: COLORS.muted });
  const lineY = top + 98;
  const colW = 200;
  const left = { x: MARGIN_X + 10, center: MARGIN_X + 10 + colW / 2 };
  const right = { x: PAGE.width - MARGIN_X - 10 - colW, center: PAGE.width - MARGIN_X - 10 - colW / 2 };
  // Contador: firma PNG sobre la línea. Representante legal: espacio de firma vacío.
  if (model.accountant.signature) {
    const r = fit(model.accountant.signature, { x: right.x, y: lineY - 52, w: colW, h: 48 }, "center");
    pdf.addImage(model.accountant.signature.dataUrl, imageFormat(model.accountant.signature.dataUrl), r.x, r.y, r.w, r.h, undefined, "FAST");
  }
  pdf.setDrawColor(COLORS.text);
  pdf.setLineWidth(0.6);
  pdf.line(left.x, lineY, left.x + colW, lineY);
  pdf.line(right.x, lineY, right.x + colW, lineY);
  const lines = (center: number, values: string[]) => values.filter(Boolean).forEach((v, i) => text(pdf, v, center, lineY + 12 + i * 10.5, { size: 8, bold: i === 0, align: "center" }));
  lines(left.center, [model.legalRep.name, "Representante Legal", model.legalRep.document]);
  lines(right.center, [model.accountant.name, model.accountant.title, model.accountant.professionalDocument ? `TP ${model.accountant.professionalDocument.replace(/^TP[\s-]*/i, "")}` : ""]);
}

/** jsPDF se carga solo al generar, para no pesar en el inicio de la aplicación. */
export async function renderStatementsPdf(model: StatementsPdfModel): Promise<{ bytes: Uint8Array; pages: number }> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: [PAGE.width, PAGE.height], compress: true });
  pdf.setProperties({ title: `Estados Financieros ${model.companyName}`, creator: "AMD Módulos" });
  header(pdf, model, "ESTADO DE SITUACIÓN FINANCIERA");
  table(pdf, model.esfRows);
  footer(pdf, model);
  pdf.addPage([PAGE.width, PAGE.height], "portrait");
  header(pdf, model, "ESTADO DE RESULTADOS");
  table(pdf, model.eerrRows);
  footer(pdf, model);
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), pages: pdf.getNumberOfPages() };
}

/** «EEFF 08 2026 - Gesap ERP INC SAS.pdf»: mes y año de la fecha final. */
export function statementsFileName(companyName: string, endDate: string): string {
  const clean = companyName.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `EEFF ${endDate.slice(5, 7)} ${endDate.slice(0, 4)} - ${clean}.pdf`;
}
