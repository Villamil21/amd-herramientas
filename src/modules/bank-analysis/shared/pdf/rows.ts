import type { PdfTextItem } from "./pdfTypes";

/** Una palabra con su posición horizontal (inicio y fin) y su línea base. */
export interface Word {
  text: string;
  x: number;
  right: number;
  y: number;
  height: number;
  charWidth: number;
}

/** Palabras que comparten línea base, ordenadas de izquierda a derecha. */
export interface TextRow {
  y: number;
  words: Word[];
}

export const center = (w: Word) => (w.x + w.right) / 2;

/**
 * Divide un fragmento en palabras. La posición de cada palabra se estima por
 * la proporción de caracteres: exacto en fuentes monoespaciadas (las tablas
 * de los extractos) y suficiente en las demás.
 */
export function splitWords(item: PdfTextItem): Word[] {
  const len = item.text.length;
  if (len === 0) return [];
  const charWidth = item.width / len;
  const words: Word[] = [];
  for (const m of item.text.matchAll(/\S+/g)) {
    const x = item.x + (m.index ?? 0) * charWidth;
    words.push({ text: m[0], x, right: x + m[0].length * charWidth, y: item.y, height: item.height, charWidth });
  }
  return words;
}

/**
 * Reconstruye las filas visuales de una página agrupando palabras con línea
 * base similar, sin importar el orden en que vienen dentro del PDF.
 * Devuelve las filas de arriba hacia abajo.
 */
export function buildRows(items: PdfTextItem[]): TextRow[] {
  const words = items.flatMap(splitWords).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextRow[] = [];
  for (const w of words) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(1.5, 0.35 * Math.max(w.height, row?.words[0].height ?? 0));
    if (row && Math.abs(row.y - w.y) <= tolerance) row.words.push(w);
    else rows.push({ y: w.y, words: [w] });
  }
  for (const row of rows) row.words.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * Une palabras en un texto: separa con un espacio cuando hay hueco entre
 * ellas y colapsa espacios repetidos (normalización técnica mínima; no se
 * cambia ninguna palabra ni carácter).
 */
export function joinWords(words: Word[]): string {
  const sorted = [...words].sort((a, b) => a.x - b.x);
  let out = "";
  sorted.forEach((w, i) => {
    if (i > 0) {
      const prev = sorted[i - 1];
      const gap = w.x - prev.right;
      if (gap > 0.3 * Math.min(prev.charWidth, w.charWidth)) out += " ";
    }
    out += w.text;
  });
  return out.replace(/\s+/g, " ").trim();
}
