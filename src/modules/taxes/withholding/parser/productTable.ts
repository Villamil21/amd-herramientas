import { joinWords, type TextRow, type Word } from "../../../bank-analysis/shared/pdf/rows";
import { isHeaderRow } from "../../invoice-vat/parser/invoiceParser";
import { isCopAmount, parseRate } from "../../invoice-vat/parser/amounts";
import type { ProductTable } from "../types";

/**
 * Tabla «Detalles de Productos» con todas sus columnas.
 *
 * - Las columnas salen de la fila de encabezado que tiene «IVA» y «%», más
 *   las filas vecinas sin importes (encabezados en varias líneas, como
 *   «Precio / unitario de / venta» o «Descuento / detalle»). Los rótulos de
 *   grupo que abarcan varias columnas («IMPUESTOS») se ignoran.
 * - Cada fila con importes es un producto. El texto de las celdas va centrado:
 *   las palabras se agrupan en frases y cada frase va a la columna cuyo
 *   centro está más cerca.
 * - Las líneas solo de texto (descripción partida en varias líneas) se unen
 *   al producto más cercano en vertical. La plantilla parte el texto por
 *   caracteres, así que las líneas se concatenan sin agregar espacios.
 * - Se omiten IVA, IVA %, INC e INC %.
 */

interface Column {
  x: number;
  right: number;
  words: Word[];
}

/** Importe o tarifa: siempre es una celda propia aunque quede pegada a otra. */
const isNumberCell = (w: Word) => w.text !== "$" && (isCopAmount(w.text) || parseRate(w.text) !== null);
const isDecimalAmount = (w: Word) => /,\d{2}$/.test(w.text) && isCopAmount(w.text);

/** Agrupa palabras contiguas (separadas por un espacio normal) en frases. */
function phrases(words: Word[]): Word[][] {
  const out: Word[][] = [];
  for (const w of [...words].sort((a, b) => a.x - b.x)) {
    const current = out[out.length - 1];
    const prev = current?.[current.length - 1];
    const gap = prev ? w.x - prev.right : Infinity;
    if (prev && !isNumberCell(w) && !isNumberCell(prev) && gap <= 1.5 * Math.min(prev.charWidth, w.charWidth)) current.push(w);
    else out.push([w]);
  }
  return out;
}

const overlaps = (w: { x: number; right: number }, c: { x: number; right: number }, pad = 1) => w.x < c.right + pad && w.right > c.x - pad;

/**
 * Índices de las filas del encabezado: la fila con «IVA» y «%» y las
 * vecinas sin importes que siguen pegadas a ella (interlineado del
 * encabezado). La primera línea de una descripción queda más separada.
 */
function headerBand(rows: TextRow[], headerIndex: number): number[] {
  const band = [headerIndex];
  const header = rows[headerIndex];
  const close = (a: TextRow, b: TextRow) => Math.abs(a.y - b.y) <= 1.35 * Math.max(a.words[0].height, b.words[0].height);
  for (let i = headerIndex - 1; i >= 0 && rows[i].y - header.y <= 24 && !rows[i].words.some(isDecimalAmount) && close(rows[i], rows[i + 1]); i--) band.push(i);
  for (let i = headerIndex + 1; i < rows.length && header.y - rows[i].y <= 24 && !rows[i].words.some(isDecimalAmount) && close(rows[i], rows[i - 1]); i++) band.push(i);
  return band;
}

const span = (words: Word[]) => ({ x: Math.min(...words.map((w) => w.x)), right: Math.max(...words.map((w) => w.right)) });

function buildColumns(rows: TextRow[], headerIndex: number): Column[] {
  const columns: Column[] = phrases(rows[headerIndex].words).map((p) => ({ ...span(p), words: [...p] }));
  let orphans: Column[] = [];
  for (const i of headerBand(rows, headerIndex).slice(1)) {
    for (const p of phrases(rows[i].words)) {
      if (p.every((w) => /^impuestos$/i.test(w.text))) continue;
      const unit = span(p);
      const hits = columns.filter((c) => overlaps(unit, c));
      if (hits.length === 1) hits[0].words.push(...p);
      else if (hits.length === 0) orphans.push({ ...unit, words: [...p] });
      // Más de una columna: rótulo de grupo.
    }
  }
  // Fragmentos de un mismo encabezado en varias líneas («Precio / unitario de / venta»).
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let a = 0; a < orphans.length; a++) {
      for (let b = a + 1; b < orphans.length; b++) {
        if (orphans[a].x < orphans[b].right + 3 && orphans[a].right > orphans[b].x - 3) {
          const words = [...orphans[a].words, ...orphans[b].words];
          orphans = [...orphans.filter((_, k) => k !== a && k !== b), { ...span(words), words }];
          merged = true;
          break outer;
        }
      }
    }
  }
  return [...columns, ...orphans].sort((a, b) => a.x - b.x);
}

const label = (c: Column) =>
  [...c.words]
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((w) => w.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** Índices de IVA, INC y el «%» que sigue a cada uno. */
function hiddenColumns(labels: string[]): Set<number> {
  const hidden = new Set<number>();
  labels.forEach((l, i) => {
    if (/^(iva|inc)$/i.test(l)) {
      hidden.add(i);
      if (labels[i + 1] === "%") hidden.add(i + 1);
    }
  });
  return hidden;
}

const nearest = (x: number, centers: number[]) => centers.reduce((best, c, i) => (Math.abs(c - x) < Math.abs(centers[best] - x) ? i : best), 0);

/** Textos por columna de una línea visual. */
type LineCells = string[][];

interface Draft {
  page: number;
  y: number;
  above: LineCells[];
  main: LineCells;
  below: LineCells[];
}

interface FullTable {
  labels: string[];
  /** `y` es la posición vertical de la fila con importes del producto. */
  rows: { page: number; y: number; cells: string[] }[];
}

/** Todas las columnas de la tabla, sin ocultar ninguna. */
function readAllColumns(pages: { page: number; rows: TextRow[] }[]): FullTable {
  let columns: Column[] | undefined;
  const drafts: Draft[] = [];

  for (const { page, rows } of pages) {
    const skip = new Set<number>();
    rows.forEach((r, i) => {
      if (!isHeaderRow(r)) return;
      columns = buildColumns(rows, i);
      for (const k of headerBand(rows, i)) skip.add(k);
    });
    if (!columns) continue;
    const centers = columns.map((c) => (c.x + c.right) / 2);
    const assign = (row: TextRow) => {
      const cellsText: LineCells = centers.map(() => []);
      for (const p of phrases(row.words.filter((w) => w.text !== "$"))) {
        const cx = (p[0].x + p[p.length - 1].right) / 2;
        cellsText[nearest(cx, centers)].push(joinWords(p));
      }
      return cellsText;
    };

    const pageDrafts: Draft[] = [];
    const loose: TextRow[] = [];
    rows.forEach((r, i) => {
      if (skip.has(i)) return;
      if (r.words.some(isDecimalAmount)) pageDrafts.push({ page, y: r.y, above: [], main: assign(r), below: [] });
      else loose.push(r);
    });
    for (const r of loose) {
      if (pageDrafts.length === 0) continue;
      // Producto más cercano en vertical; en empate, el de abajo (la descripción centrada empieza arriba de su fila).
      const target = pageDrafts.reduce((best, d) => (Math.abs(d.y - r.y) <= Math.abs(best.y - r.y) ? d : best), pageDrafts[0]);
      const cellsText = assign(r);
      if (r.y > target.y) target.above.push(cellsText);
      else target.below.push(cellsText);
    }
    drafts.push(...pageDrafts);
  }

  if (!columns) return { labels: [], rows: [] };
  return {
    labels: columns.map(label),
    rows: drafts.map((d) => ({
      page: d.page,
      y: d.y,
      cells: columns!.map((_, i) => {
        const lines = [...d.above, d.main, ...d.below].map((c) => c[i].join(" ")).filter(Boolean);
        return lines.join("").trim();
      }),
    })),
  };
}

/**
 * Lee la tabla a partir de las filas que quedan entre el título «Detalles de
 * Productos» y la siguiente sección (ya sin pies de página ni encabezados de
 * página repetidos), en el orden de las páginas.
 */
export function readProductTable(pages: { page: number; rows: TextRow[] }[]): ProductTable {
  const { labels, rows } = readAllColumns(pages);
  const hidden = hiddenColumns(labels);
  const keep = labels.map((_, i) => i).filter((i) => !hidden.has(i));
  return {
    columns: keep.map((i) => labels[i]),
    rows: rows.map((r) => ({ page: r.page, cells: keep.map((i) => r.cells[i]) })),
  };
}

export const productRowKey = (page: number, y: number) => `${page}|${y}`;

/**
 * Texto de la columna «Descripción» de cada producto (ya unido si ocupa
 * varias líneas), por página y posición vertical de su fila: lo usa el
 * análisis de IVA para mostrar sus líneas con la misma descripción.
 */
export function readProductDescriptions(pages: { page: number; rows: TextRow[] }[]): Map<string, string> {
  const { labels, rows } = readAllColumns(pages);
  const index = labels.findIndex((l) => /^descripci[oó]n/i.test(l));
  const out = new Map<string, string>();
  if (index !== -1) for (const r of rows) out.set(productRowKey(r.page, r.y), r.cells[index]);
  return out;
}
