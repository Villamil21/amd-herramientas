/// <reference types="node" />
/**
 * Prueba con RUT y certificados de Cámara de Comercio reales. Contienen datos de terceros, por eso NO se
 * guardan en el repositorio: se indican con variables de entorno (varios archivos separados por ":").
 *
 *   COMPANY_RUT_PDF="/ruta/RUT.pdf" COMPANY_CAMARA_PDF="/ruta/Camara.pdf" npx vitest run companyDocuments.realPdf
 *
 * Sin las variables, la prueba se omite. Solo se verifican reglas generales (formato de lo extraído).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../modules/bank-analysis/shared/pdf/pdfText";
import { parseCamara } from "./camaraParser";
import { parseRut } from "./rutParser";

const list = (name: string) => (process.env[name] ?? "").split(":").filter(Boolean);
const read = async (path: string) => readDocumentText(await getDocument({ data: new Uint8Array(readFileSync(path)), useWasm: false, verbosity: 0 }).promise);

describe.skipIf(list("COMPANY_RUT_PDF").length === 0)("RUT real", () => {
  for (const path of list("COMPANY_RUT_PDF")) {
    it(`lee ${path.split("/").pop()}`, async () => {
      const rut = parseRut(await read(path));
      expect(rut.nit).toMatch(/^\d{6,10}$/);
      expect(rut.dv).toMatch(/^\d$/);
      expect(rut.razonSocial).toBeTruthy();
      if (rut.ciiu) expect(rut.ciiu).toMatch(/^\d{4}$/);
      for (const p of rut.representatives) expect(p.documentNumber).toMatch(/^\d+$/);
    });
  }
});

describe.skipIf(list("COMPANY_CAMARA_PDF").length === 0)("Cámara de Comercio real", () => {
  for (const path of list("COMPANY_CAMARA_PDF")) {
    it(`lee ${path.split("/").pop()}`, async () => {
      const camara = parseCamara(await read(path));
      expect(camara.razonSocial).toBeTruthy();
      for (const c of [camara.subscribed, camara.paid]) {
        if (c.shares !== null) expect(Number.isInteger(c.shares) && c.shares > 0).toBe(true);
        if (c.nominal !== null) expect(Number.isInteger(c.nominal) && c.nominal > 0).toBe(true);
      }
      expect(camara.principals.length + camara.alternates.length).toBeGreaterThan(0);
      for (const p of [...camara.principals, ...camara.alternates]) expect(p.documentNumber).toMatch(/^\d+$/);
    });
  }
});
