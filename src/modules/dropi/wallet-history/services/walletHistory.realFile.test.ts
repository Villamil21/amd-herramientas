/// <reference types="node" />
/**
 * Prueba con historiales de cartera reales de Dropi. Tienen datos de clientes,
 * por eso NO se guardan en el repositorio. Primero se vuelca cada Excel a JSON
 * con el mismo lector de la app (calamine) y luego se analiza:
 *
 *   cd src-tauri && EXCEL_DUMP_IN="/ruta/Historial cartera.xlsx" EXCEL_DUMP_OUT=/tmp/historial.json cargo test dump_workbook_json
 *   DROPI_WALLET_JSON=/tmp/historial.json npx vitest run walletHistory.realFile
 *
 * Se verifica contra un cálculo independiente sobre las celdas crudas; el
 * archivo de agosto 2026 de SK Glam tiene además sus valores esperados.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cell, Workbook } from "../../../../types/excel";
import { analyzeWallet, EXPECTED_DESCRIPTION } from "./analysis";
import { buildWalletSheets } from "./excelExport";
import { readWalletWorkbook } from "./workbookReader";

const files = (process.env.DROPI_WALLET_JSON ?? "").split(":").filter(Boolean);

const text = (c: Cell | undefined) => (c && (c.t === "s" || c.t === "n") ? String(c.v).trim() : "");

describe.skipIf(files.length === 0)("historiales de cartera reales", () => {
  for (const path of files) {
    const book = JSON.parse(readFileSync(path, "utf8")) as Workbook;

    it(`resume ${book.fileName}`, () => {
      const result = readWalletWorkbook(book);
      if (result.kind !== "ok") throw new Error("no se pudo elegir la hoja");
      const { file } = result;
      const analysis = analyzeWallet(file.movements, { checkType: file.hasType });

      // Cálculo independiente sobre las celdas crudas de la hoja elegida.
      const sheet = book.sheets.find((s) => s.name === file.sheetName)!;
      const header = sheet.rows[0].map(text);
      const col = (name: string) => header.indexOf(name);
      const data = sheet.rows.slice(1).filter((r) => r.some((c) => c.t !== "e"));
      expect(file.movements).toHaveLength(data.length);
      data.forEach((r, i) => {
        const m = analysis.movements[i];
        const amount = r[col("MONTO")];
        expect(m.id).toBe(text(r[col("ID")]));
        expect(m.concept.trim()).toBe(text(r[col("CONCEPTO DE RETIRO")]));
        if (amount.t === "n") {
          const cents = Math.round(amount.v * 100);
          expect(m.amountCents).toBe(cents);
          // MONTO = valor pagado × 1,004 (con redondeo al centavo) y las partes suman el MONTO.
          expect(Math.abs(m.paidCents! - cents / 1.004)).toBeLessThanOrEqual(0.5);
          expect(m.paidCents! + m.gmfCents!).toBe(cents);
        }
      });
      const t = analysis.totals;
      expect(t.paidCents + t.gmfCents).toBe(t.amountCents);

      if (book.fileName === "Historial cartera Dropi 08 2026 SK Glam SAS.xlsx") {
        expect(file.sheetName).toBe("HISTORIAL DE CARTERA");
        expect(file.movements).toHaveLength(12);
        expect(file.movements.every((m) => m.type === "SALIDA" && m.description === EXPECTED_DESCRIPTION)).toBe(true);
        expect(analysis.review.count).toBe(0);
        expect(t.count).toBe(12);
        // MONTO PREVIO ignorado: el total es la suma de MONTO (Python sobre el volcado: 131.628.633).
        expect(t.amountCents).toBe(13162863300);
        // Python (Decimal, MONTO / 1,004 al centavo por fila): 131.104.216,14 pagado y 524.416,86 de 4x1000.
        expect(t.paidCents).toBe(13110421614);
        expect(t.gmfCents).toBe(52441686);
        expect(file.movements[0]).toMatchObject({ date: "31/08/2026", time: "10:19", concept: "pago nomina Sevicio al clienta + bono julio" });
        expect(analysis.movements[0]).toMatchObject({ amountCents: 116465900, paidCents: 116001892, gmfCents: 464008 });
        // Dos retiros idénticos (04/08, 5.020.080, «Pago Salario - Junio») con IDs distintos: ambos cuentan.
        expect(analysis.movements.filter((m) => m.concept === "Pago Salario - Junio" && m.incidents.length === 0)).toHaveLength(2);
        expect(file.period).toBe("Agosto 2026");
      }

      const sheets = buildWalletSheets(analysis);
      expect(sheets[0].rows.slice(0, file.movements.length).map((r) => r[4])).toEqual(analysis.movements.map((m) => (m.incidents.length ? expect.any(String) : "Validado")));
    });
  }
});
