/// <reference types="node" />
/**
 * Prueba con extractos reales. Los PDF contienen datos de clientes, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   BBVA_PDF="/ruta/extracto.pdf" npx vitest run bbvaParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * Las reglas y los controles se verifican en todos los archivos; los valores
 * concretos solo en el extracto de referencia (agosto de 2026, 3 páginas).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../shared/pdf/pdfText";
import { analyzeBbva } from "../services/analysis";
import { buildBbvaSheets, suggestedBbvaName } from "../services/excelExport";

const files = (process.env.BBVA_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("extracto BBVA real", () => {
  for (const file of files) {
    it(`procesa ${file.split("/").pop()}`, async () => {
      const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      let lastPage = 0;
      const text = await readDocumentText(doc, (page) => (lastPage = page));
      const { statement: s, groups, summary, validation } = analyzeBbva(text);

      // Todas las páginas leídas y todas con movimientos.
      expect(lastPage).toBe(text.pageCount);
      expect(Object.keys(s.movementsByPage).length).toBe(text.pageCount);
      for (const m of s.movements) {
        // Ni el resumen, ni los datos de la cuenta, ni el pie de página dentro del concepto.
        expect(m.concept).not.toMatch(/SALDO CIERRE|SALDO FINAL|INTERESES RECIBIDOS|PER[IÍ]ODO|N[UÚ]MERO DE CUENTA|P[áa]gina \d+ de/i);
        expect(m.operationDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        expect(m.valueDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        expect(m.transactionType === "credit" ? m.chargeCents : m.creditCents).toBe(0);
        expect(m.amountCents).toBe(m.transactionType === "credit" ? m.creditCents : m.chargeCents);
        expect(m.balanceCents).toBeDefined();
      }
      expect(s.issues).toEqual([]);
      expect(s.anomalies).toEqual([]);
      for (const check of validation.checks) expect(check, check.detail).toMatchObject({ status: "ok" });
      expect(validation.validated).toBe(true);
      expect(s.accountNumber).toMatch(/^\d{18}$/);
      expect(s.clientName).toBeTruthy();
      expect(s.cutoffDate).toBe(s.periodTo);
      // Cambio de página: el primer saldo de cada página continúa el último de la anterior.
      for (let i = 1; i < s.movements.length; i++) {
        const [prev, m] = [s.movements[i - 1], s.movements[i]];
        if (m.page !== prev.page) expect(m.balanceCents, `página ${m.page}`).toBe(prev.balanceCents! - m.chargeCents + m.creditCents);
      }

      if (process.env.BBVA_PDF_REPORT) {
        console.log({ file: file.split("/").pop(), pages: s.pageCount, byPage: s.movementsByPage, summary, account: s.accountNumber, client: s.clientName, period: [s.periodFrom, s.periodTo], cutoff: s.cutoffDate });
        console.table(groups.map((g) => ({ concepto: g.concept, tipo: g.transactionType, cantidad: g.count, total: g.totalCents / 100 })));
      }

      if (s.accountNumber !== "001308610200007491" || s.periodTo !== "2026/08/31") return;

      // Extracto de referencia: 3 páginas, 105 movimientos (los dos últimos sin número).
      expect(s.pageCount).toBe(3);
      expect(s.movementsByPage).toEqual({ 1: 30, 2: 72, 3: 3 });
      expect(s.clientName).toBe("KAES S.A.S");
      expect(s.periodFrom).toBe("2026/08/01");
      expect(s.totals).toEqual({
        openingBalanceCents: 15_607_063_575,
        credits: { count: 13, cents: 32_234_911_183 },
        interest: { count: 1, cents: 11_214_000 },
        charges: { count: 40, cents: 21_190_105_800 },
        vat: { count: 5, cents: 3_497_300 },
        fourPerThousand: { count: 45, cents: 84_774_300 },
        withholdings: { count: 1, cents: 785_000 },
        closingBalanceCents: 26_574_026_358,
      });
      expect(summary).toMatchObject({ movementCount: 105, totalCreditsCents: 32_246_125_183, totalChargesCents: 21_279_162_400, netCents: 10_966_962_783 });
      expect(s.totals.openingBalanceCents! + summary.netCents).toBe(26_574_026_358);
      // Primera fila, un abono, el cambio de página y las filas sin número.
      expect(s.movements[0]).toMatchObject({ movementNumber: "985", operationDate: "01-08-2026", valueDate: "03-08-2026", concept: "CARGO POR IMPUESTO 4X1.000", transactionType: "debit", chargeCents: 8_190_700, creditCents: 0, balanceCents: 15_598_872_875, page: 1, row: 1 });
      expect(s.movements[1]).toMatchObject({ concept: "PAGO POR PSE A Banco de Bogota", transactionType: "debit", chargeCents: 2_047_673_200 });
      expect(s.movements[8]).toMatchObject({ movementNumber: "993", concept: "ABONO DEPOSITARIO CUENTAS CENTRO COMERCIAL BUE", transactionType: "credit", creditCents: 210_000_000, chargeCents: 0 });
      expect(s.movements[30]).toMatchObject({ movementNumber: "1015", operationDate: "07-08-2026", valueDate: "10-08-2026", concept: "PAGO POR PSE A Davivienda", chargeCents: 259_864_400, balanceCents: 8_664_105_075, page: 2, row: 1 });
      expect(s.movements.slice(-2)).toMatchObject([
        { movementNumber: undefined, concept: "ABONO POR INTERESES DE CUENTA", transactionType: "credit", creditCents: 11_214_000, balanceCents: 26_574_811_358, page: 3 },
        { movementNumber: undefined, concept: "CARGO RETEFUENTE INTERESES", transactionType: "debit", chargeCents: 785_000, balanceCents: 26_574_026_358, page: 3 },
      ]);
      // Agrupación exacta por concepto + tipo.
      const group = (concept: string) => groups.filter((g) => g.concept === concept).map((g) => [g.transactionType, g.count, g.totalCents]);
      expect(group("CARGO POR IMPUESTO 4X1.000")).toEqual([["debit", 45, 84_774_300]]);
      expect(group("ABONO OPERACION")).toEqual([["credit", 4, 16_600]]);
      expect(group("ABONO DOMI. 901183029 EMPRESAS SPARK")).toEqual([["credit", 3, 823_923_604]]);
      expect(group("ABONO POR INTERESES DE CUENTA")).toEqual([["credit", 1, 11_214_000]]);
      expect(group("CARGO DOMI. 901748281")).toHaveLength(1);
      expect(group("ABONO DOMI. 901748281")).toEqual([]);
      for (const concept of ["PAGO POR PSE A Davivienda", "PAGO POR PSE A Banco de Bogota", "COMISION POR DOMICILIACION", "IVA POR COMISION POR DOMICILIACION", "COMISION ADMON NET CASH", "IVA COMISION ADMON NET CASH", "CARGO RETEFUENTE INTERESES"]) {
        expect(group(concept).map((g) => g[0]), concept).toEqual(["debit"]);
      }
      // Los conceptos del resumen coinciden con sus líneas (comprobación del modelo, no una regla de la app).
      const total = (pattern: RegExp) => groups.filter((g) => pattern.test(g.concept)).reduce((n, g) => n + g.totalCents, 0);
      expect(total(/^CARGO POR IMPUESTO 4X1\.000$/)).toBe(s.totals.fourPerThousand!.cents);
      expect(total(/^IVA /)).toBe(s.totals.vat!.cents);
      expect(total(/^CARGO RETEFUENTE/)).toBe(s.totals.withholdings!.cents);
      // Exportación.
      const [resumen, movimientos] = buildBbvaSheets(s, groups);
      expect(resumen.rows).toHaveLength(groups.length);
      expect(movimientos.rows).toHaveLength(105);
      expect(movimientos.rows[0]).toEqual(["985", "01-08-2026", "03-08-2026", "CARGO POR IMPUESTO 4X1.000", 81_907, null, 155_988_728.75, 1]);
      expect(movimientos.rows[104]).toEqual([null, "31-08-2026", "31-08-2026", "CARGO RETEFUENTE INTERESES", 7_850, null, 265_740_263.58, 3]);
      expect(suggestedBbvaName(s, "Extracto BBVA Agosto.pdf")).toBe("Analisis_BBVA_7491_2026-08");
    });
  }
});
