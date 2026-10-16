/// <reference types="node" />
/**
 * Prueba con declaraciones reales. Contienen datos de terceros, por eso NO se
 * guardan en el repositorio: se indican con una variable de entorno.
 *
 *   TAX_RETURN_PDF="/ruta/DR 2025.pdf:/ruta/IVA.pdf" npx vitest run taxReturnParser.realPdf
 *
 * Con TAX_RETURN_DUMP=/ruta/salida.jsonl se escribe la lectura de cada archivo.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../bank-analysis/shared/pdf/pdfText";
import { whBreakdown } from "../withholding/detail";
import { parseTaxReturn } from "./taxReturnParser";

const files = (process.env.TAX_RETURN_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("declaraciones reales", () => {
  for (const path of files) {
    it(`lee ${path.split("/").pop()}`, async () => {
      const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useWasm: false, verbosity: 0 }).promise;
      const r = parseTaxReturn(await readDocumentText(pdf));
      if (process.env.TAX_RETURN_DUMP)
        appendFileSync(
          process.env.TAX_RETURN_DUMP,
          JSON.stringify({ ...r, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, `${v!.cents / 100} c${v!.casilla}/${v!.expectedCasilla} ${v!.foundBy}`])), equity: r.equity.map((e) => `${e.key}=${e.value ? e.value.cents / 100 : "?"} c${e.value?.casilla}`), file: path.split("/").pop() }) + "\n",
        );
      expect(r.nit).toMatch(/^\d{9,10}$/);
      expect(r.formNumber).toMatch(/^\d{12,14}$/);
      expect(r.year).toBeGreaterThan(2015);
      // Formulario 350: retenciones positivas − casilla 129 + sanciones = casilla 138.
      if (r.withholdingCasillas) expect(whBreakdown(r.withholdingCasillas).differenceCents).toBe(0);
      for (const v of Object.values(r.values)) if (v.casilla && v.expectedCasilla) expect(v.casilla).toBe(v.expectedCasilla);
    });
  }
});
