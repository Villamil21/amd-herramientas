/**
 * Texto de un PDF con su posición. Coordenadas del PDF: x crece hacia la
 * derecha y y hacia arriba (y es la línea base del texto).
 */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  /** Alto aproximado de la letra (tamaño de fuente efectivo). */
  height: number;
  /** Texto girado 90° (encabezados verticales). Solo existe si se pidió conservarlo; x/width describen su caja en la hoja. */
  rotated?: boolean;
}

export interface PdfPageText {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

export interface PdfDocumentText {
  pageCount: number;
  pages: PdfPageText[];
}
