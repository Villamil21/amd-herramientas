import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfDocumentText, PdfPageText, PdfTextItem } from "./pdfTypes";

/**
 * Lee el texto de TODAS las páginas conservando la posición de cada
 * fragmento. No depende del orden en que el PDF guarda el texto (a veces por
 * filas, a veces columna por columna): los parsers reconstruyen las filas
 * con las coordenadas.
 *
 * `onPage` avisa cada página leída (para mostrar el avance en PDF largos).
 */
export async function readDocumentText(doc: PDFDocumentProxy, onPage?: (page: number, total: number) => void): Promise<PdfDocumentText> {
  const pages: PdfPageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      const [a, b, c, d, e, f] = raw.transform as number[];
      // Texto rotado (sellos verticales como "VIGILADO") no forma parte de tablas.
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) continue;
      items.push({ text: raw.str, x: e, y: f, width: raw.width, height: raw.height || Math.abs(d) });
    }
    pages.push({ pageNumber: n, width: viewport.width, height: viewport.height, items });
    page.cleanup();
    onPage?.(n, doc.numPages);
  }
  return { pageCount: doc.numPages, pages };
}
