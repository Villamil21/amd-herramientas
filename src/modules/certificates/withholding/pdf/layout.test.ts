import { describe, expect, it } from "vitest";
import { FONT_SIZES, LAYOUT, TABLE_MAX_BOTTOM, tableMetrics } from "./layout";

const bottomOf = (lines: number[]) => {
  const m = tableMetrics(lines);
  return LAYOUT.table.firstRowBaseline + lines.reduce((y, n) => y + n * m.lineHeight + m.rowGap, 0);
};

describe("compactación automática del certificado", () => {
  it("pocas filas: letra normal y tabla más corta (menos espacio vacío)", () => {
    const m = tableMetrics([1, 2]);
    expect(m.fontSize).toBe(FONT_SIZES.tableText);
    expect(m.minBottom).toBeLessThan(LAYOUT.table.minBottom);
  });

  it("filas normales: la geometría original", () => {
    expect(tableMetrics([1, 1, 1, 1, 1, 1])).toEqual({ fontSize: FONT_SIZES.tableText, lineHeight: LAYOUT.table.lineHeight, rowGap: LAYOUT.table.rowGap, minBottom: LAYOUT.table.minBottom });
  });

  it("muchas filas: se compacta lo necesario para caber en una hoja, sin bajar de 7 pt", () => {
    const many = Array(24).fill(1);
    const m = tableMetrics(many);
    expect(m.fontSize).toBeLessThan(FONT_SIZES.tableText);
    expect(m.fontSize).toBeGreaterThanOrEqual(7);
    expect(bottomOf(many)).toBeLessThanOrEqual(TABLE_MAX_BOTTOM);
  });
});
