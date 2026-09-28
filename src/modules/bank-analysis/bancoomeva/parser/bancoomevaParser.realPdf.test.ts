/// <reference types="node" />
/**
 * Prueba con extractos reales. Los PDF contienen datos de clientes, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   BANCOOMEVA_PDF="/ruta/extracto.pdf" npx vitest run bancoomevaParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * Las reglas y los controles se verifican en todos los archivos; los valores
 * concretos solo en los extractos de referencia (junio de 2026, 7 páginas, y
 * julio de 2026, 50 páginas).
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

      if (s.periodTo === "2026/07/31" && s.totals.totalDebitsCents === 945_413_590_200) {
        // Totales globales (tomados una sola vez aunque se repiten en las 50 páginas).
        expect(s.pageCount).toBe(50);
        expect(s.totals).toEqual({ openingBalanceCents: 5_120_457_200, totalDebitsCents: 945_413_590_200, totalCreditsCents: 950_302_510_000, closingBalanceCents: 10_009_377_000 });
        expect(summary.totalDebitsCents).toBe(945_413_590_200);
        expect(summary.totalCreditsCents).toBe(950_302_510_000);
        // Primeras filas: 51,204,572 − 10,000,000 − 2,830,000 − 3,384,774.
        expect(s.movements.slice(0, 3).map((m) => [m.debitCents, m.balanceCents])).toEqual([
          [1_000_000_000, 4_120_457_200],
          [283_000_000, 3_837_457_200],
          [338_477_400, 3_498_979_800],
        ]);
        // Página 1: el banco imprime …589 → …389 → …489 → …289 (comprobado en la página
        // renderizada). Se conserva el orden visual (de arriba hacia abajo) y los valores.
        const p1 = s.movements.filter((m) => m.page === 1);
        const at = p1.findIndex((m) => m.balanceCents === 3_458_979_800);
        expect(p1.slice(at, at + 4).map((m) => m.balanceCents)).toEqual([3_458_979_800, 3_438_979_800, 3_448_979_800, 3_428_979_800]);
        expect(p1.slice(at, at + 4).every((m, i, a) => i === 0 || m.y < a[i - 1].y)).toBe(true);
        expect(validation.checks.find((c) => c.id === "balances")?.detail).toMatch(/tramo\(s\) de movimientos idénticos/);
        // Cambio de página: el primer saldo de cada página continúa el último de la anterior.
        for (let i = 1; i < s.movements.length; i++) {
          const [prev, m] = [s.movements[i - 1], s.movements[i]];
          if (m.page !== prev.page) expect(m.balanceCents, `página ${m.page}`).toBe(prev.balanceCents! - m.debitCents + m.creditCents);
        }
        // Crédito de 10,000 del 03-07-2026 y débito de 12,000,000: mueven el saldo exactamente.
        for (const probe of [{ date: "03-07-2026", creditCents: 1_000_000 }, { debitCents: 1_200_000_000 }]) {
          const i = s.movements.findIndex((m, k) => k > 0 && Object.entries(probe).every(([key, v]) => m[key as keyof typeof m] === v));
          expect(i, JSON.stringify(probe)).toBeGreaterThan(0);
          const m = s.movements[i];
          expect(m.balanceCents).toBe(s.movements[i - 1].balanceCents! - m.debitCents + m.creditCents);
        }
        expect(s.movements.find((m) => m.date === "03-07-2026" && m.creditCents === 1_000_000)?.description).toBe("N/CNC TRANSACCIONES BRE-B MONO");
        // Última fila (página 50): débito de 2,552,000 que deja el saldo final.
        expect(s.movements[s.movements.length - 1]).toMatchObject({ page: 50, date: "31-07-2026", description: "N/DND TRANSACCIONES BRE-B MONO", debitCents: 255_200_000, creditCents: 0, balanceCents: 10_009_377_000 });
        // Grupos: DESCRIPCIÓN + TIPO; los totales de los grupos igualan a los del extracto.
        const byType = (t: string) => groups.filter((g) => g.transactionType === t).reduce((n, g) => n + g.totalCents, 0);
        expect([byType("debit"), byType("credit")]).toEqual([945_413_590_200, 950_302_510_000]);
        expect(groups.find((g) => g.description === "N/DND TRANSACCIONES BRE-B MONO")?.transactionType).toBe("debit");
        expect(groups.find((g) => g.description === "N/CNC TRANSACCIONES BRE-B MONO")?.transactionType).toBe("credit");
        if (process.env.BANCOOMEVA_PDF_REPORT) {
          console.log({ movements: s.movements.length, byPage: s.movementsByPage, balances: validation.checks.find((c) => c.id === "balances")?.detail });
          console.table(groups.map((g) => ({ descripcion: g.description, tipo: g.transactionType, cantidad: g.count, total: g.totalCents / 100 })));
        }
      }

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
