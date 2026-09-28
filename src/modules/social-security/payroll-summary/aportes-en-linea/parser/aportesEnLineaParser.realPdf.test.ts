/// <reference types="node" />
/**
 * Prueba con planillas reales. Los PDF contienen datos personales, por eso
 * NO se guardan en el repositorio: se indican con una variable de entorno.
 *
 *   APORTES_EN_LINEA_PDF="/ruta/planilla.pdf" npx vitest run aportesEnLineaParser.realPdf
 *
 * Varios archivos se separan con ":". Sin la variable, la prueba se omite.
 * Las reglas generales se verifican en todos los archivos; los valores
 * concretos solo en las planillas de referencia del periodo 2026-01: la de
 * 2 páginas (pago $1,684,000) y la de 1 página con encabezados partidos
 * y documento PT (pago $1,300,500).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../../bank-analysis/shared/pdf/pdfText";
import { analyzeAportesEnLinea } from "../services/analysis";

const files = (process.env.APORTES_EN_LINEA_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("planilla Aportes en Línea real", () => {
  for (const file of files) {
    it(`procesa ${file.split("/").pop()}`, async () => {
      const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise;
      const text = await readDocumentText(doc);
      const { summary: s, validation } = analyzeAportesEnLinea(text);

      expect(s.period).toMatch(/^\d{4}-\d{2}$/);
      expect(s.paymentDate).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
      expect(s.issues).toEqual([]);
      // Sin duplicados ni filas falsas: una fila por número y por identificación.
      expect(new Set(s.employees.map((e) => e.identification)).size).toBe(s.employees.length);
      expect(s.employees.map((e) => e.rowNumber)).toEqual(s.employees.map((_, i) => i + 1));
      for (const e of s.employees) {
        expect(e.identification).toMatch(/^[A-Z]{1,3} [A-Z0-9-]+$/);
        expect(e.name).toMatch(/^[A-ZÁÉÍÓÚÑÜ .'-]+$/);
        expect(e.name.split(" ").length).toBeGreaterThanOrEqual(2);
      }
      for (const check of validation.checks) expect(check, check.detail).toMatchObject({ status: "ok" });
      expect(validation.validated).toBe(true);

      if (s.period === "2026-01" && s.paymentAmount === 1_300_500) {
        const values = { pensionDays: 30, pensionIbc: 1_750_905, pensionContribution: 280_200, healthContribution: 70_100, ccfContribution: 70_100, riskContribution: 9_200, totalContribution: 429_600 };
        expect(s.pageCount).toBe(1);
        expect(s.paymentDate).toBe("2026/02/27");
        expect(s.employees.map((e) => [e.identification, e.name])).toEqual([
          ["CC 29435823", "CADENA VALLEJO CONSUELO"],
          ["CC 1112881168", "RODRIGUEZ RODRIGUEZ JUAN DAVID"],
          ["PT 1030953", "TENEFE ZABALA ALAN ARDITHYS"],
        ]);
        for (const e of s.employees) expect(e).toMatchObject(values);
        expect(s.totalContributions).toBe(1_288_800);
        expect(s.lateInterest).toBe(11_700);
        expect(s.detailTotals.declaredEmployees).toBe(3);
        expect(s.paymentSummary).toMatchObject({ liquidated: 1_288_800, lateInterest: 11_700, toPay: 1_300_500 });
        return;
      }
      if (s.period !== "2026-01" || s.paymentAmount !== 1_684_000) return;

      // Casos 1–3: Periodo desde Pensión, Fecha desde Fecha Pago, Pago desde Valor.
      expect(s.period).toBe("2026-01");
      expect(s.paymentDate).toBe("2026/02/26");
      expect(s.paymentAmount).toBe(1_684_000);
      // Caso 4: ANGARITA LOPEZ RONALDO.
      expect(s.employees.find((e) => e.name === "ANGARITA LOPEZ RONALDO")).toMatchObject({
        identification: "CC 1192816998",
        name: "ANGARITA LOPEZ RONALDO",
        pensionDays: 30,
        pensionIbc: 1_750_905,
        pensionContribution: 280_200,
        healthContribution: 70_100,
        ccfContribution: 70_100,
        riskContribution: 9_200,
        totalContribution: 429_600,
      });
      // Caso 5 y 11: los 4 afiliados con sus nombres completos.
      expect(s.employeeCount).toBe(4);
      expect(s.employees.map((e) => e.name)).toEqual(["ANGARITA LOPEZ RONALDO", "FONTALVO ALTAMAR YURLYS JOHANA", "MARTINEZ ORTIZ HUGO ALFREDO", "RUIZ CASSIANI RAYNEL RAFAEL"]);
      expect(s.joinedNames).toBe(4);
      // Caso 6: empleado con 29 días.
      expect(s.employees.find((e) => e.name === "MARTINEZ ORTIZ HUGO ALFREDO")).toMatchObject({ pensionDays: 29, pensionIbc: 1_692_542, totalContribution: 415_400 });
      // Caso de CCF IBC distinto al de pensión: el aporte CCF sale de su columna.
      expect(s.employees.find((e) => e.name === "FONTALVO ALTAMAR YURLYS JOHANA")).toMatchObject({ pensionIbc: 1_750_905, ccfContribution: 56_000, totalContribution: 415_500 });
      // Casos 7–9: total, intereses y suma por empleado.
      expect(s.totalContributions).toBe(1_676_000);
      expect(s.lateInterest).toBe(8_000);
      expect(s.employees.map((e) => e.totalContribution)).toEqual([429_600, 415_500, 415_400, 415_500]);
      // Caso 10: segunda página.
      expect(s.paymentSummary).toMatchObject({ liquidated: 1_676_000, lateInterest: 8_000, toPay: 1_684_000 });
      expect(s.paymentSummary?.liquidatedByRisk).toEqual({ AFP: 1_111_500, ARL: 36_500, CCF: 249_900, EPS: 278_100 });
    });
  }
});
