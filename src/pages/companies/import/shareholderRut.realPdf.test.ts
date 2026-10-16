/// <reference types="node" />
/**
 * Prueba con el RUT real de un socio (persona natural). Contiene datos personales, por eso NO se guarda en el repositorio:
 * se indica con una variable de entorno (varios archivos separados por ":").
 *
 *   SHAREHOLDER_RUT_PDF="/ruta/RUT-socio.pdf" npx vitest run shareholderRut.realPdf
 *
 * Sin la variable, la prueba se omite. Se verifican las reglas generales y, para el RUT de referencia de persona natural
 * (cédula, Cali), la separación de nombres, el tipo 13 y la ubicación 169 / 76 / 001.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../modules/bank-analysis/shared/pdf/pdfText";
import { parseShareholderRut } from "./shareholderRut";

const files = (process.env.SHAREHOLDER_RUT_PDF ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("RUT de socio real", () => {
  for (const file of files) {
    it(`lee ${file.split("/").pop()}`, async () => {
      const text = await readDocumentText(await getDocument({ data: new Uint8Array(readFileSync(file)), useWasm: false, verbosity: 0 }).promise);
      const rut = parseShareholderRut(text);
      expect(rut.personType, rut.notes.join(" ")).not.toBeNull();
      expect(rut.docTypeCode).toMatch(/^\d{2}$/);
      expect(rut.docNumber).toMatch(/^\d{6,12}$/);
      expect(rut.countryCode).toMatch(/^\d{3}$/);
      expect(rut.deptCode).toMatch(/^\d{2}$/);
      expect(rut.muniCode).toMatch(/^\d{3}$/);
      expect(rut.address).toBeTruthy();
      if (rut.personType === "PN") {
        expect(rut.firstSurname).toBeTruthy();
        expect(rut.firstName).toBeTruthy();
        expect(rut.businessName).toBeUndefined();
      } else {
        expect(rut.docTypeCode).toBe("31");
        expect(rut.businessName).toBeTruthy();
      }
      // Caso de referencia: persona natural con cédula de Cali.
      if (rut.docNumber === "1143855024") {
        expect(rut).toMatchObject({ personType: "PN", docTypeCode: "13", firstSurname: "DIAZ", secondSurname: "GARAY", firstName: "JULIE", otherNames: "KAORI", countryCode: "169", deptCode: "76", muniCode: "001" });
        expect(rut.address).toBe("CL 16 B 125 111 CA 10");
      }
    });
  }
});
