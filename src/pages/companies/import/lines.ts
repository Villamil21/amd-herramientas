import { buildRows } from "../../../modules/bank-analysis/shared/pdf/rows";
import type { PdfDocumentText } from "../../../modules/bank-analysis/shared/pdf/pdfTypes";

/** Líneas de texto de cada página, reconstruidas por posición (no dependen del orden interno del PDF). */
export function pageLines(doc: PdfDocumentText): string[][] {
  return doc.pages.map((page) =>
    buildRows(page.items)
      .map((row) => row.words.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
}

const PAGE_NUMBER = /^p[aá]gina\s+\d+\s+de\s+\d+$/i;

/** Cuántas líneas iniciales comparten (idénticas y en el mismo lugar) las páginas: el encabezado repetido. */
function headerLength(pages: string[][]): number {
  // Con 3 o más páginas la primera puede traer un título propio: el encabezado se mide en las demás.
  const sample = pages.length >= 3 ? pages.slice(1) : pages;
  if (sample.length < 2) return 0;
  let n = 0;
  while (sample.every((lines) => lines[n] !== undefined && lines[n] === sample[0][n])) n++;
  return n;
}

/**
 * Une las páginas quitando el encabezado y el pie que el certificado repite en cada hoja («Fecha
 * expedición…», código de verificación, «Página 2 de 6»). Así una sección que continúa en la página
 * siguiente queda contigua, sin importar de qué Cámara sea el formato. Solo se quita lo que está
 * repetido al inicio de cada página: un renglón legítimo que se repite en el cuerpo se conserva.
 */
export function joinPages(pages: string[][]): string[] {
  const header = headerLength(pages);
  const prefix = pages[pages.length - 1]?.slice(0, header) ?? [];
  return pages.flatMap((lines) => {
    const hasHeader = header > 0 && prefix.every((line, i) => lines[i] === line);
    return (hasHeader ? lines.slice(header) : lines).filter((line) => !PAGE_NUMBER.test(line));
  });
}

/** Número con formato colombiano («1.000,00», «$ 50.000.000,00») → entero; `null` si no es un entero inequívoco. */
export function parseWholeNumber(raw: string): number | null {
  const t = raw.replace(/[$\s]/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  let intPart = t;
  let fraction = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = Math.max(lastDot, lastComma);
    intPart = t.slice(0, decimal);
    fraction = t.slice(decimal + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const groups = t.split(sep);
    const tail = groups[groups.length - 1];
    // «1.000» y «1.000.000» son miles; «50,5» o «12.50» son decimales.
    if (!(groups.length > 2 || tail.length === 3)) {
      intPart = groups.slice(0, -1).join("");
      fraction = tail;
    }
  }
  if (/[1-9]/.test(fraction)) return null;
  const whole = Number(intPart.replace(/[.,]/g, ""));
  return Number.isSafeInteger(whole) && whole > 0 ? whole : null;
}
