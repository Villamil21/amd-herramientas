import type { jsPDF as JsPDF } from "jspdf";
import type { CertificateDocument } from "../logic/certificateModel";
import { COLORS, FONT_SIZES, LAYOUT, PAGE } from "./layout";

export interface LogoImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Dimensiones reales del logo para escalarlo sin deformarlo. */
export function loadLogo(dataUrl: string | null): Promise<LogoImage | null> {
  if (!dataUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Rectángulo que conserva la proporción dentro de la caja del logo. */
export function fitContain(width: number, height: number, box = LAYOUT.logo) {
  const scale = Math.min(box.w / width, box.h / height);
  const w = width * scale;
  const h = height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function text(pdf: JsPDF, value: string, x: number, y: number, opts: { size: number; color: string; bold?: boolean; align?: "left" | "right" | "center" }) {
  pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
  pdf.setFontSize(opts.size);
  pdf.setTextColor(opts.color);
  pdf.text(value, x, y, { align: opts.align ?? "left", baseline: "alphabetic" });
}

/**
 * Genera el PDF del certificado. jsPDF se carga solo al generar,
 * para no aumentar el tiempo de inicio de la aplicación.
 */
export async function renderWithholdingPdf(
  doc: CertificateDocument,
  preloadedLogo?: LogoImage | null,
): Promise<Uint8Array> {
  const [{ jsPDF }, logo] = await Promise.all([
    import("jspdf"),
    preloadedLogo !== undefined ? preloadedLogo : loadLogo(doc.issuer.logoDataUrl),
  ]);
  const pdf = new jsPDF({ unit: "pt", format: [PAGE.width, PAGE.height], compress: true });
  pdf.setProperties({ title: doc.title, subject: doc.info[1]?.value ?? "", creator: "AMD Herramientas" });

  // Logo
  if (logo) {
    const r = fitContain(logo.width, logo.height);
    const format = logo.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    pdf.addImage(logo.dataUrl, format, r.x, r.y, r.w, r.h, undefined, "FAST");
  }

  // Datos de la empresa emisora (derecha)
  const issuerLines = [
    doc.issuer.razonSocial,
    doc.issuer.nit ? `NIT ${doc.issuer.nit}` : "",
    doc.issuer.telefono,
    doc.issuer.direccion,
  ].filter(Boolean);
  issuerLines.forEach((line, i) =>
    text(pdf, line, LAYOUT.issuer.right, LAYOUT.issuer.firstBaseline + i * LAYOUT.issuer.lineHeight, {
      size: FONT_SIZES.issuer, color: COLORS.issuer, align: "right",
    }),
  );

  // Título
  text(pdf, doc.title, PAGE.width / 2, LAYOUT.title.baseline, {
    size: FONT_SIZES.title, color: COLORS.title, bold: true, align: "center",
  });

  // Información general
  doc.info.forEach((item, i) => {
    const y = LAYOUT.info.firstBaseline + i * LAYOUT.info.lineHeight;
    text(pdf, item.label, LAYOUT.info.labelX, y, { size: FONT_SIZES.info, color: COLORS.label, bold: true });
    text(pdf, item.value, LAYOUT.info.valueX, y, { size: FONT_SIZES.info, color: COLORS.value });
  });

  // Tabla
  const t = LAYOUT.table;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(FONT_SIZES.tableText);
  let y = t.firstRowBaseline;
  const rows = doc.rows.map((row) => {
    const lines: string[] = pdf.splitTextToSize(row.concepto, t.concept.maxWidth);
    const baseline = y;
    y += lines.length * t.lineHeight + t.rowGap;
    return { row, lines, baseline };
  });
  const bottom = Math.max(t.minBottom, y);

  pdf.setDrawColor(COLORS.line);
  pdf.setLineWidth(0.6);
  pdf.line(t.left, t.top, t.right, t.top);
  pdf.line(t.left, t.headerBottom, t.right, t.headerBottom);
  pdf.line(t.left, bottom, t.right, bottom);
  t.columns.forEach((x) => pdf.line(x, t.headerBottom, x, bottom));

  const header = { size: FONT_SIZES.tableHeader, color: COLORS.tableHeader, bold: true };
  text(pdf, "CONCEPTO", t.concept.numberX, t.headerBaseline, header);
  text(pdf, doc.rateHeader, t.rateX, t.headerBaseline, header);
  text(pdf, "BASE DE RETENCIÓN", t.baseX, t.headerBaseline, header);
  text(pdf, "VALOR RETENIDO", t.valueRight, t.headerBaseline, { ...header, align: "right" });

  const cell = { size: FONT_SIZES.tableText, color: COLORS.tableText };
  for (const { row, lines, baseline } of rows) {
    text(pdf, `${row.index}.`, t.concept.numberX, baseline, cell);
    lines.forEach((line, i) => text(pdf, line, t.concept.textX, baseline + i * t.lineHeight, cell));
    text(pdf, row.tasa, t.rateX, baseline, cell);
    text(pdf, row.base, t.baseX, baseline, cell);
    text(pdf, row.valor, t.valueRight, baseline, { ...cell, align: "right" });
  }

  // Pie
  text(pdf, doc.footer, LAYOUT.footer.x, bottom + LAYOUT.footer.gapAfterTable, {
    size: FONT_SIZES.footer, color: COLORS.footer, bold: true,
  });

  return new Uint8Array(pdf.output("arraybuffer"));
}
