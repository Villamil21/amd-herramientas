/// <reference types="node" />
/**
 * Prueba con extractos reales. Los PDF contienen datos de clientes, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   BANCOOMEVA_PDF="/ruta/extracto.pdf" npx vitest run bancoomevaParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * Las reglas y los controles se verifican en todos los archivos; los valores
 * concretos solo en el extracto de referencia (junio de 2026, 7 páginas).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../shared/pdf/pdfText";
import { analyzeBancoomeva } from "../services/analysis";
import { buildBancoomevaSheets } from "../services/excelExport";

const files = (process.env.BANCOOMEVA_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("extracto Bancoomeva real", () => {
  for (const file of files) {
    it(`procesa ${file.split("/").pop()}`, async () => {
      const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      let lastPage = 0;
      const text = await readDocumentText(doc, (page) => (lastPage = page));
      const { statement: s, groups, summary, validation } = analyzeBancoomeva(text);

      // Todas las páginas leídas y todas con tabla y movimientos.
      expect(lastPage).toBe(text.pageCount);
      expect(Object.keys(s.movementsByPage).length).toBe(text.pageCount);
      for (const count of Object.values(s.movementsByPage)) expect(count).toBeGreaterThan(0);
      for (const m of s.movements) {
        // Ni encabezados, ni totales, ni textos legales, ni la oficina dentro de la descripción.
        expect(m.description).not.toMatch(/DESCRIPCION|VALOR DEBITO|TOTAL|SALDO|\$|LABORATORIO|www|http/i);
        expect(m.date).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        expect(m.amountCents).toBeGreaterThan(0);
        expect(m.transactionType === "credit" ? m.debitCents : m.creditCents).toBe(0);
        expect(m.balanceCents).toBeDefined();
      }
      expect(s.issues).toEqual([]);
      expect(s.anomalies).toEqual([]);
      expect(s.totalsMismatchPages).toEqual([]);
      for (const check of validation.checks) expect(check, check.detail).toMatchObject({ status: "ok" });
      expect(validation.validated).toBe(true);

      if (s.periodTo !== "2026/06/30" || s.totals.totalDebitsCents !== 114_521_542_800) return;

      // Casos 7 y 10: 7 páginas; totales del extracto tomados una sola vez.
      expect(s.pageCount).toBe(7);
      expect(s.totals).toEqual({ openingBalanceCents: 0, totalDebitsCents: 114_521_542_800, totalCreditsCents: 119_642_000_000, closingBalanceCents: 5_120_457_200 });
      expect(summary.totalDebitsCents).toBe(114_521_542_800);
      expect(summary.totalCreditsCents).toBe(119_642_000_000);
      expect(summary.netCents).toBe(5_120_457_200);
      // Caso 5: primera transacción.
      expect(s.movements[0]).toMatchObject({ date: "04-06-2026", office: "LABORATORIO - CORE", description: "N/CNC TRANSFERENCIA ACH-000009", transactionType: "credit", creditCents: 2_840_000_000, debitCents: 0, balanceCents: 2_840_000_000, page: 1 });
      // Caso 6: débito.
      expect(s.movements[1]).toMatchObject({ description: "N/DND TRANSACCIONES BRE-B MONO", transactionType: "debit", debitCents: 888_000_000, creditCents: 0 });
      // Caso 4: descripciones parecidas, grupos distintos.
      expect(groups.map((g) => [g.description, g.transactionType])).toEqual([
        ["N/CNC TRANSACCIONES BRE-B MONO", "credit"],
        ["N/CNC TRANSFERENCIA ACH-000009", "credit"],
        ["N/DND TRANSACCIONES BRE-B MONO", "debit"],
      ]);
      expect(s.accountNumber).toBe("30520000000275");
      expect(s.periodFrom).toBe("2026/06/01");
      // Caso 11: exportación con todos los movimientos.
      const [resumen, movimientos] = buildBancoomevaSheets(s, groups);
      expect(resumen.rows).toHaveLength(groups.length);
      expect(movimientos.rows).toHaveLength(s.movements.length);
      expect(movimientos.rows[0]).toEqual(["04-06-2026", "LABORATORIO - CORE", "N/CNC TRANSFERENCIA ACH-000009", 0, 28_400_000, "Crédito", 28_400_000, 28_400_000, 1]);

      if (process.env.BANCOOMEVA_PDF_REPORT) {
        console.log({ pages: s.pageCount, byPage: s.movementsByPage, summary, totals: s.totals, account: s.accountNumber, period: [s.periodFrom, s.periodTo] });
        console.table(groups.map((g) => ({ descripcion: g.description, tipo: g.transactionType, cantidad: g.count, total: g.totalCents / 100 })));
      }
    });
  }
});
