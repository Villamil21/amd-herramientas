/// <reference types="node" />
/**
 * Prueba con extractos reales. Los PDF contienen datos de clientes, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   BANCOLOMBIA_PDF="/ruta/extracto.pdf" npx vitest run bancolombiaParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * No se fija el número de movimientos: se verifican las reglas y los
 * controles contra el propio extracto.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../shared/pdf/pdfText";
import { groupMovements } from "../../shared/groupingService";
import { summarize } from "../../shared/summaryService";
import { validateStatement } from "../../shared/movementValidator";
import { parseBancolombiaStatement } from "./bancolombiaParser";

const files = (process.env.BANCOLOMBIA_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("extracto Bancolombia real", () => {
  for (const file of files) {
    it(`procesa ${file.split("/").pop()}`, async () => {
      const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      const text = await readDocumentText(doc);
      const statement = parseBancolombiaStatement(text);
      const groups = groupMovements(statement.movements);
      const summary = summarize(statement.movements, groups);
      const validation = validateStatement(statement, groups, summary);

      // Todas las páginas con tabla aportan movimientos.
      expect(Object.keys(statement.movementsByPage).length).toBe(text.pageCount);
      for (const count of Object.values(statement.movementsByPage)) expect(count).toBeGreaterThan(0);
      // Ningún encabezado ni cierre convertido en movimiento.
      for (const m of statement.movements) {
        expect(m.description).not.toMatch(/FECHA|DESCRIPCI|FIN ESTADO DE CUENTA|P[AÁ]GINA/);
        expect(m.fullDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      }
      expect(statement.issues).toEqual([]);
      // Controles: secuencia de saldos, RESUMEN y agrupación.
      for (const check of validation.checks) expect(check, check.detail).toMatchObject({ status: "ok" });
      expect(validation.validated).toBe(true);

      if (process.env.BANCOLOMBIA_PDF_REPORT) {
        console.log({ pages: statement.pageCount, byPage: statement.movementsByPage, summary, totals: statement.totals, account: statement.accountNumber, period: [statement.periodFrom, statement.periodTo] });
        console.table(groups.map((g) => ({ descripcion: g.description, tipo: g.sign, cantidad: g.count, total: g.totalCents / 100 })));
      }
    });
  }
});
