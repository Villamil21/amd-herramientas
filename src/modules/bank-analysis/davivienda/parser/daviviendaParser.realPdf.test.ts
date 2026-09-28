/// <reference types="node" />
/**
 * Prueba con extractos reales. Los PDF contienen datos de clientes, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   DAVIVIENDA_PDF="/ruta/extracto.pdf" npx vitest run daviviendaParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * No se fija el número de movimientos: se verifican las reglas y los
 * controles contra el propio extracto.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../shared/pdf/pdfText";
import { analyzeDavivienda } from "../services/analysis";

const files = (process.env.DAVIVIENDA_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("extracto Davivienda real", () => {
  for (const file of files) {
    it(`procesa ${file.split("/").pop()}`, async () => {
      const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      const text = await readDocumentText(doc);
      const { statement, groups, summary, validation } = analyzeDavivienda(text);

      // Todas las páginas con tabla aportan movimientos.
      expect(Object.keys(statement.movementsByPage).length).toBe(text.pageCount);
      for (const count of Object.values(statement.movementsByPage)) expect(count).toBeGreaterThan(0);
      // Resumen de la primera página leído completo.
      expect(statement.totals.previousBalanceCents).toBeDefined();
      expect(statement.totals.currentBalanceCents).toBeDefined();
      for (const m of statement.movements) {
        // Ni encabezados, ni textos institucionales, ni la Oficina dentro de la clase.
        expect(m.description).not.toMatch(/Clase de Movimiento|Fecha|Defensor|NIT\.|Compras y Pagos PSE|PORTAL PYMES|App Davivienda/);
        expect(m.sign).not.toBe("zero");
        expect(m.fullDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        expect(m.branch).toBeTruthy();
        expect(m.document).toMatch(/^\d+$/);
      }
      expect(statement.issues).toEqual([]);
      // Controles: agrupación, Más Créditos, Menos Débitos, coherencia del resumen y Nuevo Saldo.
      for (const check of validation.checks) expect(check, check.detail).toMatchObject({ status: "ok" });
      expect(validation.validated).toBe(true);

      if (process.env.DAVIVIENDA_PDF_REPORT) {
        console.log({ pages: statement.pageCount, byPage: statement.movementsByPage, joined: statement.joinedLines, summary, totals: statement.totals, account: statement.accountNumber, period: [statement.periodFrom, statement.periodTo] });
        console.table(groups.map((g) => ({ clase: g.description, tipo: g.sign, cantidad: g.count, total: g.totalCents / 100 })));
        console.table(statement.movements.map((m) => ({ f: m.fullDate, v: m.valueCents / 100, doc: m.document, clase: m.description, of: m.branch, p: m.page })));
      }
    });
  }
});
