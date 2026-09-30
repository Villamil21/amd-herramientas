import { BACKGROUNDS } from "./backgrounds";
import type { IncomeDocument, Run } from "./model";

type PDF = import("jspdf").jsPDF;

/**
 * El PDF de referencia es Carta, pero los membretes (1055×1491 px) tienen
 * proporción A4: se usa A4 para que el fondo cubra la página sin deformarse.
 */
const PAGE = { width: 595.28, height: 841.89, margin: 60 };
/** Debajo del logo del membrete. */
const TITLE_BASELINE = 124;
/** Por encima de la onda inferior del membrete (y de los datos de contacto). */
const CONTENT_BOTTOM = 736;
const MIN_SCALE = 0.7;

type Asset = { data: string; width: number; height: number; format: "PNG" | "JPEG" };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo cargar una imagen del certificado."));
    image.src = src;
  });
}

const backgroundCache = new Map<string, Promise<Asset>>();

/**
 * El membrete se incrusta sin pérdida (PNG, los mismos píxeles del archivo original).
 * El canvas solo sirve para obtener los bytes: la CSP no permite fetch a los assets.
 */
function loadBackground(url: string): Promise<Asset> {
  let cached = backgroundCache.get(url);
  if (!cached) {
    cached = loadImage(url).then((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo preparar el fondo del certificado.");
      context.drawImage(image, 0, 0);
      return { data: canvas.toDataURL("image/png"), width: image.naturalWidth, height: image.naturalHeight, format: "PNG" as const };
    });
    cached.catch(() => backgroundCache.delete(url));
    backgroundCache.set(url, cached);
  }
  return cached;
}

/** La firma se usa tal cual (PNG con transparencia). */
async function loadSignature(data: string): Promise<Asset> {
  const image = await loadImage(data);
  return { data, width: image.naturalWidth, height: image.naturalHeight, format: data.startsWith("data:image/png") ? "PNG" : "JPEG" };
}

type Piece = { text: string; bold: boolean; width: number };
type Word = { pieces: Piece[]; width: number };
type Line = { words: Word[]; width: number; /** Última línea del párrafo o antes de un salto forzado: no se justifica. */ last: boolean };
type Align = "justify" | "center";

function setFont(pdf: PDF, size: number, bold: boolean) {
  pdf.setFont("helvetica", bold ? "bold" : "normal");
  pdf.setFontSize(size);
}

/** Parte los textos en palabras (una palabra puede mezclar negrita y normal, ej. "ESCOBAR,") y luego en líneas. */
function layoutLines(pdf: PDF, runs: Run[], size: number, maxWidth: number): Line[] {
  const words: Array<Word | "break"> = [];
  let current: Piece[] = [];
  const flush = () => {
    if (current.length) words.push({ pieces: current, width: current.reduce((sum, p) => sum + p.width, 0) });
    current = [];
  };
  for (const run of runs) {
    // El espacio no separable (\u00a0) une palabras: no se parte la línea ahí.
    for (const token of run.text.split(/([^\S\u00a0]+)/)) {
      if (!token) continue;
      if (/^[^\S\u00a0]+$/.test(token)) {
        flush();
        for (let i = 0; i < (token.match(/\n/g)?.length ?? 0); i++) words.push("break");
        continue;
      }
      setFont(pdf, size, !!run.bold);
      // Se dibuja como espacio normal: la fuente estándar de jsPDF no mide bien el \u00a0.
      const text = token.replace(/\u00a0/g, " ");
      current.push({ text, bold: !!run.bold, width: pdf.getTextWidth(text) });
    }
  }
  flush();

  setFont(pdf, size, false);
  const space = pdf.getTextWidth(" ");
  const lines: Line[] = [];
  let line: Word[] = [];
  let width = 0;
  const push = (last: boolean) => {
    lines.push({ words: line, width, last });
    line = [];
    width = 0;
  };
  for (const word of words) {
    if (word === "break") {
      push(true);
      continue;
    }
    const next = line.length ? width + space + word.width : word.width;
    if (line.length && next > maxWidth) push(false);
    width = line.length ? width + space + word.width : word.width;
    line.push(word);
  }
  if (line.length || !lines.length) push(true);
  return lines;
}

/** Dibuja líneas ya calculadas. Justificado real: el espacio sobrante se reparte entre las palabras. */
function drawLines(pdf: PDF, lines: Line[], x: number, firstBaseline: number, maxWidth: number, lineHeight: number, size: number, align: Align) {
  setFont(pdf, size, false);
  const space = pdf.getTextWidth(" ");
  lines.forEach((line, index) => {
    const gaps = line.words.length - 1;
    const justify = align === "justify" && !line.last && gaps > 0;
    const gap = justify ? (maxWidth - line.words.reduce((sum, w) => sum + w.width, 0)) / gaps : space;
    let cursor = align === "center" ? x + (maxWidth - line.width) / 2 : x;
    const y = firstBaseline + index * lineHeight;
    for (const word of line.words) {
      for (const piece of word.pieces) {
        setFont(pdf, size, piece.bold);
        pdf.text(piece.text, cursor, y);
        cursor += piece.width;
      }
      cursor += gap;
    }
  });
}

/** Ajusta una imagen dentro de una caja sin deformarla. */
function contain(asset: Asset, maxWidth: number, maxHeight: number) {
  const factor = Math.min(maxWidth / asset.width, maxHeight / asset.height);
  return { width: asset.width * factor, height: asset.height * factor };
}

/**
 * Recorre todo el certificado a una escala dada. Con `draw = false` solo mide:
 * así se elige la mayor escala con la que todo cabe en una página.
 */
function layout(pdf: PDF, doc: IncomeDocument, signature: Asset, scale: number, draw: boolean): number {
  const S = (value: number) => value * scale;
  const { width, margin } = PAGE;
  const contentWidth = width - margin * 2;
  const bodySize = S(11.5), lineHeight = S(15.6), paragraphGap = S(15.6);
  let y = TITLE_BASELINE;

  if (draw) {
    setFont(pdf, S(14), true);
    pdf.text("CERTIFICADO DE INGRESOS", width / 2, y, { align: "center" });
  }
  y += S(26);

  const paragraph = (runs: Run[]) => {
    const lines = layoutLines(pdf, runs, bodySize, contentWidth);
    if (draw) drawLines(pdf, lines, margin, y, contentWidth, lineHeight, bodySize, "justify");
    y += (lines.length - 1) * lineHeight;
  };
  const next = () => (y += lineHeight + paragraphGap);

  paragraph(doc.intro); next();
  paragraph(doc.holder); next();
  paragraph(doc.activity); next();
  paragraph(doc.incomeIntro);

  // Tabla CONCEPTO | VALOR
  const tableSize = S(10.5), tableLine = S(15), pad = S(12), cellPad = S(10);
  const top = y + S(24);
  const split = margin + contentWidth * 0.28;
  const headerHeight = S(32);
  const conceptLines = layoutLines(pdf, doc.concept, tableSize, split - margin - cellPad * 2);
  const valueLines = layoutLines(pdf, doc.value, tableSize, margin + contentWidth - split - cellPad * 2);
  const rows = Math.max(conceptLines.length, valueLines.length);
  const bodyHeight = rows * tableLine + pad * 2;
  const bottom = top + headerHeight + bodyHeight;
  if (draw) {
    pdf.setFillColor(25, 25, 25);
    pdf.rect(margin, top, contentWidth, headerHeight, "F");
    pdf.setTextColor(255, 255, 255);
    setFont(pdf, tableSize, true);
    const headerBaseline = top + headerHeight / 2 + tableSize * 0.35;
    pdf.text("CONCEPTO", (margin + split) / 2, headerBaseline, { align: "center" });
    pdf.text("VALOR", (split + margin + contentWidth) / 2, headerBaseline, { align: "center" });
    pdf.setTextColor(0, 0, 0);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(1.2);
    pdf.rect(margin, top, contentWidth, headerHeight + bodyHeight);
    pdf.line(split, top, split, bottom);
    // Cada celda centrada vertical y horizontalmente.
    const cell = (lines: Line[], left: number, right: number) => {
      const blockTop = top + headerHeight + (bodyHeight - lines.length * tableLine) / 2;
      drawLines(pdf, lines, left + cellPad, blockTop + tableLine * 0.72, right - left - cellPad * 2, tableLine, tableSize, "center");
    };
    cell(conceptLines, margin, split);
    cell(valueLines, split, margin + contentWidth);
  }
  y = bottom + S(34);

  paragraph(doc.supports); next();
  paragraph(doc.closing);

  // Firma sobre la línea, luego nombre / identificación / matrícula.
  const box = contain(signature, S(170), S(64));
  const lineY = y + S(30) + box.height;
  if (draw) {
    pdf.addImage(signature.data, signature.format, margin + S(8), lineY - box.height + S(6), box.width, box.height, undefined, "FAST");
    pdf.setLineWidth(1.2);
    pdf.line(margin, lineY, margin + S(190), lineY);
  }
  y = lineY + S(13);
  doc.signerLines.forEach((text, index) => {
    if (draw) {
      setFont(pdf, bodySize, false);
      pdf.text(text, margin, y);
    }
    if (index < doc.signerLines.length - 1) y += lineHeight;
  });
  return y + S(4);
}

type StreamKey = { key: string; value: unknown };
type StreamOptions = { additionalKeyValues?: StreamKey[] };

/**
 * jsPDF no escribe /Interpolate en las imágenes. Sin esa marca, pdf.js y otros
 * visores amplían el membrete sin suavizado y se ve pixelado al hacer zoom.
 */
function smoothImages(pdf: PDF) {
  const internal = pdf.internal as unknown as { putStream: (options: StreamOptions) => unknown };
  const putStream = internal.putStream;
  internal.putStream = (options) => {
    const keys = options.additionalKeyValues;
    if (keys?.some((k) => k.key === "Subtype" && k.value === "/Image") && !keys.some((k) => k.key === "Interpolate")) keys.push({ key: "Interpolate", value: "true" });
    return putStream(options);
  };
}

/**
 * `withBackground: false` solo para la vista previa: allí el membrete se muestra
 * como imagen del navegador (nítida) debajo del contenido dibujado por pdf.js.
 */
export async function renderIncomePdf(doc: IncomeDocument, { withBackground = true } = {}): Promise<Uint8Array> {
  const [{ jsPDF }, background, signature] = await Promise.all([
    import("jspdf"),
    withBackground ? loadBackground(BACKGROUNDS[doc.background].url) : null,
    loadSignature(doc.signature),
  ]);
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  smoothImages(pdf);
  pdf.setTextColor(0, 0, 0);
  if (background) pdf.addImage(background.data, background.format, 0, 0, PAGE.width, PAGE.height, "membrete", "FAST");

  // Mayor escala con la que todo cabe en una página (1 = diseño normal).
  let scale = 1;
  while (scale > MIN_SCALE && layout(pdf, doc, signature, scale, false) > CONTENT_BOTTOM) scale = Math.max(MIN_SCALE, scale - 0.02);
  layout(pdf, doc, signature, scale, true);
  return new Uint8Array(pdf.output("arraybuffer"));
}
