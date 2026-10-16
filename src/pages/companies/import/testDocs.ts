import type { PdfDocumentText, PdfTextItem } from "../../../modules/bank-analysis/shared/pdf/pdfTypes";

/** PDF sintético: cada línea es un texto en su propia fila, de arriba hacia abajo (una lista por página). */
export function docFromLines(pages: string[][]): PdfDocumentText {
  return {
    pageCount: pages.length,
    pages: pages.map((lines, n) => ({
      pageNumber: n + 1,
      width: 612,
      height: 792,
      items: lines.map((text, i): PdfTextItem => ({ text, x: 40, y: 760 - i * 14, width: text.length * 5, height: 10 })),
    })),
  };
}

/** Un fragmento del formulario RUT en una posición concreta. */
export const at = (text: string, x: number, y: number): PdfTextItem => ({ text, x, y, width: text.length * 2.7, height: 8 });

export function docFromItems(...pages: PdfTextItem[][]): PdfDocumentText {
  return { pageCount: pages.length, pages: pages.map((items, n) => ({ pageNumber: n + 1, width: 612, height: 792, items })) };
}
