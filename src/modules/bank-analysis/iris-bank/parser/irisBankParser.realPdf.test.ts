/// <reference types="node" />
/**
 * Prueba con extractos reales. Los PDF contienen datos de clientes, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   IRIS_BANK_PDF="/ruta/extracto.pdf" npx vitest run irisBankParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * No se fija el número de movimientos: se verifican las reglas y los
 * controles contra el propio extracto.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../shared/pdf/pdfText";
import { analyzeIrisBank } from "../services/analysis";

const files = (process.env.IRIS_BANK_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("extracto Iris Bank real", () => {
  for (const file of files) {
    it(`procesa ${file.split("/").pop()}`, async () => {
      const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      let lastPage = 0;
      const text = await readDocumentText(doc, (page) => (lastPage = page));
      const { statement, groups, summary, validation } = analyzeIrisBank(text);

      // Todas las páginas leídas y todas con tabla y movimientos.
      expect(lastPage).toBe(text.pageCount);
      expect(Object.keys(statement.movementsByPage).length).toBe(text.pageCount);
      for (const count of Object.values(statement.movementsByPage)) expect(count).toBeGreaterThan(0);
      // Resumen de la primera página leído completo.
      expect(statement.totals.previousBalanceCents).toBeDefined();
      expect(statement.totals.totalCreditsCents).toBeDefined();
      expect(statement.totals.totalDebitsCents).toBeDefined();
      expect(statement.totals.currentBalanceCents).toBeDefined();
      for (const m of statement.movements) {
        // Ni encabezados, ni bloque de tasas, ni pie de página, ni importes dentro de la descripción.
        expect(m.description).not.toMatch(/DESCRIPCIÓN|MOVIMIENTOS|PLAN ACTUAL|TASA E\.A\.|página \d+ de|\$/);
        expect(m.sign).not.toBe("zero");
        expect(m.fullDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        expect(m.document).toMatch(/^\d+$/);
        expect(m.balanceCents).toBeDefined();
      }
      // Sin movimientos duplicados: cada referencia aparece una sola vez.
      expect(new Set(statement.movements.map((m) => m.document)).size).toBe(statement.movements.length);
      expect(statement.issues).toEqual([]);
      // Agrupación, secuencia de saldos, Total Abonos, Total Cargos, resumen y Saldo Actual.
      for (const check of validation.checks) expect(check, check.detail).toMatchObject({ status: "ok" });
      expect(validation.validated).toBe(true);

      if (process.env.IRIS_BANK_PDF_REPORT) {
        console.log({ pages: statement.pageCount, movements: summary.movementCount, joined: statement.joinedLines, summary, totals: statement.totals, account: statement.accountNumber, period: [statement.periodFrom, statement.periodTo] });
        console.table(groups.map((g) => ({ descripcion: g.description, tipo: g.sign, cantidad: g.count, total: g.totalCents / 100 })));
        console.table(statement.movements.filter((m) => m.description.length > 40));
      }
    });
  }
});
