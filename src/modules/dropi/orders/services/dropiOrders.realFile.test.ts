/// <reference types="node" />
/**
 * Prueba con reportes reales de Dropi. Tienen datos de clientes, por eso NO
 * se guardan en el repositorio. Primero se vuelca cada Excel a JSON con el
 * mismo lector de la app (calamine) y luego se analiza:
 *
 *   cd src-tauri && EXCEL_DUMP_IN="/ruta/Ordenes.xlsx" EXCEL_DUMP_OUT=/tmp/ordenes.json cargo test dump_workbook_json
 *   DROPI_WORKBOOK_JSON=/tmp/kaes.json:/tmp/skglam.json npx vitest run dropiOrders.realFile
 *
 * Se verifica contra un cálculo independiente sobre las celdas crudas y, si el
 * libro trae una tabla dinámica por ESTATUS (como Sheet2 de SK Glam), contra ella.
 * Los archivos de agosto 2026 tienen además sus totales esperados.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cell, Workbook } from "../../../../types/excel";
import type { ConfigurableCategory } from "../types";
import { analyzeOrders } from "./analysis";
import { buildDropiSheets } from "./excelExport";
import { statusKey } from "./statuses";
import { readOrdersWorkbook } from "./workbookReader";

const files = (process.env.DROPI_WORKBOOK_JSON ?? "").split(":").filter(Boolean);

/** Totales calculados aparte (Python sobre el volcado) para los archivos de referencia. */
const EXPECTED: Record<string, { rows: number; statuses: number; pending: number; values: Record<string, number>; orders: [number, number, number] }> = {
  "Ordenes Dropi 08 2026 KAES SAS.xlsx": {
    rows: 4373,
    statuses: 15,
    pending: 9,
    values: {
      billedCents: 54614499700,
      cancelledRejectedVoidCents: 12499482400,
      returnsCents: 7996736700,
      indemnityCents: 9990000,
      deliveredCents: 33328868800,
      unclassifiedCents: 779421800,
      deliveredProductCostCents: 8153596500,
      deliveredFreightCostCents: 4531110206,
      returnFreightCostCents: 908632744,
    },
    orders: [3521, 2798, 852],
  },
  "Ordenes Dropi 08 2026 SK Glam SAS.xlsx": {
    rows: 2727,
    statuses: 10,
    pending: 4,
    values: {
      billedCents: 33361069500,
      cancelledRejectedVoidCents: 4665730000,
      returnsCents: 5608069700,
      indemnityCents: 11990000,
      deliveredCents: 23015839800,
      unclassifiedCents: 59440000,
      deliveredProductCostCents: 5857386400,
      deliveredFreightCostCents: 2908553483,
      returnFreightCostCents: 541232316,
    },
    orders: [2334, 1870, 393],
  },
};

const text = (c: Cell | undefined) => (c && (c.t === "s" || c.t === "n") ? String(c.v).trim() : "");
const num = (c: Cell | undefined) => (c?.t === "n" ? c.v : 0);

describe.skipIf(files.length === 0)("reportes Dropi reales", () => {
  const books = files.map((path) => JSON.parse(readFileSync(path, "utf8")) as Workbook);

  books.forEach((book) => {
    it(`cierra ${book.fileName}`, () => {
      const result = readOrdersWorkbook(book);
      if (result.kind !== "ok") throw new Error("no se pudo elegir la hoja");
      const { file } = result;
      expect(file.invalidMoney).toEqual([]);
      expect(file.rowsWithoutId).toEqual([]);
      expect(file.rowsWithoutStatus).toEqual([]);

      // Cálculo independiente sobre las celdas crudas de la hoja elegida.
      const sheet = book.sheets.find((s) => s.name === file.sheetName)!;
      const header = sheet.rows[0].map(text);
      const col = (name: string) => header.indexOf(name);
      const data = sheet.rows.slice(1).filter((r) => r.length > 0);
      const sum = (column: string, where: (status: string) => boolean) =>
        Math.round(data.filter((r) => where(text(r[col("ESTATUS")]))).reduce((s, r) => s + num(r[col(column)]), 0) * 100);
      const all = () => true;
      const is = (...st: string[]) => (s: string) => st.includes(s);
      const distinct = (where: (status: string) => boolean) => new Set(data.filter((r) => where(text(r[col("ESTATUS")]))).map((r) => text(r[col("ID")]))).size;

      const empty = analyzeOrders(file.rows, new Map());
      const { summary } = empty;
      expect(file.rows).toHaveLength(data.length);
      expect(summary.billedCents).toBe(sum("VALOR DE COMPRA EN PRODUCTOS", all));
      expect(summary.cancelledRejectedVoidCents).toBe(sum("VALOR DE COMPRA EN PRODUCTOS", is("CANCELADO", "RECHAZADO", "GUIA_ANULADA")));
      expect(summary.returnsCents).toBe(sum("VALOR DE COMPRA EN PRODUCTOS", is("DEVOLUCION")));
      expect(summary.deliveredProductCostCents).toBe(sum("TOTAL EN PRECIOS DE PROVEEDOR", is("ENTREGADO")));
      expect(summary.deliveredFreightCostCents).toBe(sum("PRECIO FLETE", is("ENTREGADO")));
      expect(summary.returnFreightCostCents).toBe(sum("COSTO DEVOLUCION FLETE", is("DEVOLUCION")));
      expect(summary.uniqueOrders).toBe(distinct(all));
      expect(summary.dispatchedOrders).toBe(distinct((s) => !["CANCELADO", "RECHAZADO"].includes(s)));
      expect(summary.deliveredOrders).toBe(distinct(is("ENTREGADO")));
      expect(summary.cancelledRejectedOrders).toBe(distinct(is("CANCELADO", "RECHAZADO")));

      // Tabla dinámica del propio libro (Row Labels / Sum of …), si existe.
      for (const other of book.sheets.filter((s) => s.name !== file.sheetName)) {
        const labelsRow = other.rows.findIndex((r) => r.some((c) => text(c) === "Row Labels"));
        if (labelsRow < 0) continue;
        const labels = other.rows[labelsRow].map(text);
        const labelCol = labels.indexOf("Row Labels");
        for (const r of other.rows.slice(labelsRow + 1)) {
          const status = text(r[labelCol]);
          if (!status || status === "Grand Total") continue;
          const detail = empty.statuses.find((d) => d.key === statusKey(status))!;
          expect(detail.purchaseCents).toBe(Math.round(num(r[labels.indexOf("Sum of VALOR DE COMPRA EN PRODUCTOS")]) * 100));
          expect(detail.supplierCents).toBe(Math.round(num(r[labels.indexOf("Sum of TOTAL EN PRECIOS DE PROVEEDOR")]) * 100));
          expect(detail.freightCents).toBe(Math.round(num(r[labels.indexOf("Sum of PRECIO FLETE")]) * 100));
          expect(detail.returnFreightCents).toBe(Math.round(num(r[labels.indexOf("Sum of COSTO DEVOLUCION FLETE")]) * 100));
          expect(detail.rows).toBe(num(r[labels.indexOf("Count of ID")]));
        }
      }

      const expected = EXPECTED[book.fileName];
      if (expected) {
        expect(file.sheetName).toBe("Sheet1");
        expect(summary.totalRows).toBe(expected.rows);
        expect(empty.statuses).toHaveLength(expected.statuses);
        expect(empty.pending).toHaveLength(expected.pending);
        for (const [k, v] of Object.entries(expected.values)) expect(summary[k as keyof typeof summary], k).toBe(v);
        expect([summary.dispatchedOrders, summary.deliveredOrders, summary.cancelledRejectedOrders]).toEqual(expected.orders);
      }

      // Al clasificar todo, el cierre queda completo y cuadra con el valor facturado.
      const rules = new Map(empty.pending.map((p, i) => [p.key, (i % 2 ? "claim" : "in_process") as ConfigurableCategory]));
      const closed = analyzeOrders(file.rows, rules);
      const s = closed.summary;
      expect(closed.complete).toBe(true);
      expect(s.inProcessCents + s.claimCents).toBe(summary.unclassifiedCents);
      expect(s.deliveredCents + s.cancelledRejectedVoidCents + s.returnsCents + s.inProcessCents + s.claimCents + s.indemnityCents).toBe(s.billedCents);

      const sheets = buildDropiSheets(file, closed, rules);
      expect(sheets.map((x) => x.name)).toEqual(["Resumen", "Estados", "Datos"]);
      expect(sheets[2].rows).toHaveLength(file.rows.length);
    });
  });

  it("las clasificaciones de un archivo se reutilizan en el siguiente", () => {
    const parsed = books.map((b) => {
      const r = readOrdersWorkbook(b);
      if (r.kind !== "ok") throw new Error("no se pudo elegir la hoja");
      return r.file;
    });
    const rules = new Map<string, ConfigurableCategory>();
    for (const [i, file] of parsed.entries()) {
      const before = analyzeOrders(file.rows, rules);
      // Nunca se vuelve a preguntar por un estado ya clasificado.
      for (const p of before.pending) expect(rules.has(p.key)).toBe(false);
      if (i > 0 && parsed[0].fileName.includes("KAES") && file.fileName.includes("SK Glam")) {
        expect(before.pending.map((p) => p.display)).toEqual(["RECLAME EN OFICINA"]);
      }
      for (const p of before.pending) rules.set(p.key, "in_process");
      expect(analyzeOrders(file.rows, rules).complete).toBe(true);
    }
  });

  it("un estado nuevo en un archivo real se detecta y se recalcula al clasificarlo", () => {
    const r = readOrdersWorkbook(books[0]);
    if (r.kind !== "ok") throw new Error("no se pudo elegir la hoja");
    const known = new Map(analyzeOrders(r.file.rows, new Map()).pending.map((p) => [p.key, "in_process" as ConfigurableCategory]));
    const rows = [...r.file.rows, { ...r.file.rows[0], rowNumber: 99999, id: "X-1", status: "ESTADO_NUEVO_DROPI", statusKey: statusKey("ESTADO_NUEVO_DROPI") }];
    const before = analyzeOrders(rows, known);
    expect(before.pending.map((p) => p.display)).toEqual(["ESTADO_NUEVO_DROPI"]);
    expect(before.complete).toBe(false);
    const after = analyzeOrders(rows, new Map([...known, ["ESTADO NUEVO DROPI", "claim"]]));
    expect(after.complete).toBe(true);
    expect(after.summary.claimCents).toBe(r.file.rows[0].purchaseCents);
  });
});
