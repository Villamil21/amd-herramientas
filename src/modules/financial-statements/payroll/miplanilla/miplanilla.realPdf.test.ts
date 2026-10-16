/// <reference types="node" />
/**
 * Prueba con una planilla real de MiPlanilla. Contiene datos de terceros, por eso NO se guarda en el
 * repositorio: se indica con una variable de entorno (varios archivos separados por ":").
 *
 *   MIPLANILLA_PDF="/ruta/planilla.pdf" npx vitest run miplanilla.realPdf
 *
 * Sin la variable, la prueba se omite. Solo se verifican reglas generales.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../bank-analysis/shared/pdf/pdfText";
import { analyzeMiPlanilla } from "./analysis";
import { cotizacionOf } from "./types";

const files = (process.env.MIPLANILLA_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("planilla real de MiPlanilla", () => {
  for (const path of files) {
    it(`procesa ${path.split("/").pop()}`, async () => {
      const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useWasm: false, verbosity: 0 }).promise;
      const analysis = analyzeMiPlanilla(await readDocumentText(pdf, undefined, { keepRotated: true }));
      const { summary } = analysis;
      expect(summary.employerNit).toMatch(/^\d{6,12}$/);
      expect(summary.pensionPeriod).toMatch(/^\d{4}-\d{2}$/);
      expect(summary.paymentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(summary.employees.length).toBeGreaterThan(0);
      for (const e of summary.employees) expect(e.identification).toMatch(/^[A-Z]{2,4} \d+$/);
      // El detalle cuadra con el resumen y la mora es global.
      expect(analysis.validated, JSON.stringify(summary.issues)).toBe(true);
      const total = summary.employees.reduce((n, e) => n + cotizacionOf(e), 0);
      expect(total).toBe(summary.totals.grand?.contribution);
      expect(analysis.lateInterest).toBe((summary.totalToPay ?? 0) - total);
      // Cada administradora con su NIT y su valor ANTES de mora: sumadas dan el total del subsistema.
      for (const [sub, admin] of Object.entries(summary.administrators)) {
        expect(admin?.entities?.length, `administradoras de ${sub}`).toBe(admin?.rows);
        expect(admin?.entities?.reduce((n, e) => n + e.contribution, 0)).toBe(admin?.contribution);
        for (const e of admin?.entities ?? []) {
          expect(e.nit).toMatch(/^\d{5,12}$/);
          expect(e.dv).toMatch(/^\d$/);
          expect(e.name.length).toBeGreaterThan(2);
        }
      }
    });
  }
});
