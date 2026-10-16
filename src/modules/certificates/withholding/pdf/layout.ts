/**
 * Geometría del certificado en puntos PDF (hoja Carta 612 × 792, igual que el
 * documento de referencia). La comparten el PDF y la vista previa HTML.
 */
export const PAGE = { width: 612, height: 792 };

export const COLORS = {
  title: "#333333",
  label: "#111111",
  value: "#6b6b6b",
  issuer: "#6b6b6b",
  tableHeader: "#444444",
  tableText: "#444444",
  line: "#cfcfcf",
  footer: "#777777",
};

export const FONT_SIZES = {
  issuer: 10,
  title: 17,
  info: 8,
  tableHeader: 7.5,
  tableText: 8,
  footer: 7,
};

export const LAYOUT = {
  logo: { x: 46, y: 19, w: 71, h: 71 },
  issuer: { right: 588, firstBaseline: 51.5, lineHeight: 10 },
  title: { baseline: 129 },
  info: { labelX: 30, valueX: 180, firstBaseline: 162, lineHeight: 15.8 },
  table: {
    left: 26,
    right: 588,
    top: 253,
    headerBaseline: 267,
    headerBottom: 275,
    minBottom: 608,
    columns: [320, 410, 509], // divisores verticales
    firstRowBaseline: 296,
    rowGap: 8,
    lineHeight: 10,
    concept: { numberX: 40, textX: 56, maxWidth: 256 },
    rateX: 328,
    baseX: 416,
    valueRight: 588,
  },
  footer: { x: 30, gapAfterTable: 65 },
};

/** Último punto donde puede terminar la tabla para que el pie quepa en la hoja (margen inferior 30 pt). */
export const TABLE_MAX_BOTTOM = PAGE.height - 30 - LAYOUT.footer.gapAfterTable;

export interface TableMetrics {
  fontSize: number;
  lineHeight: number;
  rowGap: number;
  /** Alto mínimo de la tabla (hasta dónde llega aunque haya pocas filas). */
  minBottom: number;
}

/** Densidades de la tabla, de la normal a la más compacta (nunca por debajo de 7 pt: legible). */
const DENSITIES: Omit<TableMetrics, "minBottom">[] = [
  { fontSize: FONT_SIZES.tableText, lineHeight: LAYOUT.table.lineHeight, rowGap: LAYOUT.table.rowGap },
  { fontSize: 7.5, lineHeight: 9, rowGap: 5 },
  { fontSize: 7, lineHeight: 8.5, rowGap: 3 },
];

/**
 * Compactación automática según las filas (líneas de texto de cada concepto):
 * con pocas filas la tabla no reserva el alto completo (menos espacio vacío);
 * con muchas, se reduce el interlineado y la letra lo necesario para que todo
 * quepa en una hoja. Función pura: la usan el PDF y la vista previa.
 */
export function tableMetrics(lineCounts: number[]): TableMetrics {
  const t = LAYOUT.table;
  const minBottom = lineCounts.length <= 4 ? 470 : t.minBottom;
  for (const d of DENSITIES) {
    const bottom = t.firstRowBaseline + lineCounts.reduce((y, n) => y + Math.max(1, n) * d.lineHeight + d.rowGap, 0);
    if (bottom <= TABLE_MAX_BOTTOM) return { ...d, minBottom };
  }
  return { ...DENSITIES[DENSITIES.length - 1], minBottom };
}
