/// <reference types="node" />
/**
 * Prueba con extractos reales. Los PDF contienen datos de clientes, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   COOPCENTRAL_PDF="/ruta/extracto.pdf" npx vitest run coopcentralParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * No se fija el número de movimientos: se verifican las reglas y los
 * controles contra el propio extracto.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../shared/pdf/pdfText";
import { analyzeCoopcentral } from "../services/analysis";

const files = (process.env.COOPCENTRAL_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("extracto Coopcentral real", () => {
  for (const file of files) {
    it(`procesa ${file.split("/").pop()}`, async () => {
      const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      const text = await readDocumentText(doc);
      const { statement, groups, summary, validation } = analyzeCoopcentral(text);

      // Todas las páginas con tabla aportan movimientos.
      expect(Object.keys(statement.movementsByPage).length).toBe(text.pageCount);
      for (const count of Object.values(statement.movementsByPage)) expect(count).toBeGreaterThan(0);
      // Saldos de apertura y cierre leídos; nunca como movimiento.
      expect(statement.openingBalanceCents).toBeDefined();
      expect(statement.closingBalanceCents).toBeDefined();
      for (const m of statement.movements) {
        expect(m.concept).not.toMatch(/^(SALDO INICIAL|SALDO FINAL)$|CONCEPTO|CREDITOS|DEBITOS|TOTALES|P[AÁ]G\./);
        // Exactamente una columna con valor, y el tipo sale de esa columna.
        expect((m.creditCents > 0) !== (m.debitCents > 0)).toBe(true);
        expect(m.transactionType).toBe(m.creditCents > 0 ? "credit" : "debit");
        expect(m.applicationDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      }
      // Ninguna fila procesada dos veces (misma página y mismas celdas, incluido TRANS. ELECTRONICA y el saldo).
      const keys = statement.movements.map((m) => `${m.page}|${m.concept}|${m.document}|${m.electronicTransfer}|${m.transactionType}|${m.amountCents}|${m.balanceCents}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(statement.issues).toEqual([]);
      expect(statement.anomalies).toEqual([]);
      // Controles: conciliación, secuencia de saldos (detecta filas omitidas), agrupación y bloque de totales.
      for (const check of validation.checks) expect(check, check.detail).toMatchObject({ status: "ok" });
      expect(validation.validated).toBe(true);

      if (process.env.COOPCENTRAL_PDF_REPORT) {
        console.log({ pages: statement.pageCount, byPage: statement.movementsByPage, summary, opening: statement.openingBalanceCents, closing: statement.closingBalanceCents, totals: statement.periodTotals, account: statement.accountNumber, period: [statement.periodFrom, statement.periodTo] });
        console.table(groups.map((g) => ({ concepto: g.concept, tipo: g.transactionType, cantidad: g.count, total: g.totalCents / 100 })));
      }
    });
  }
});
