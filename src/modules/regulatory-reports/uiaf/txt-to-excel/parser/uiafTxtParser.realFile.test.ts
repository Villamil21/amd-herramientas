/// <reference types="node" />
/**
 * Prueba con reportes reales. Contienen datos personales, por eso NO se
 * guardan en el repositorio: se indican con una variable de entorno.
 *
 *   UIAF_TXT="/ruta/reporte.txt" npx vitest run uiafTxtParser.realFile
 *
 * Varios archivos se separan con ":". Con UIAF_SHEETS_OUT=/ruta/hojas.json
 * se escriben las hojas del primer archivo para compararlas en Rust con el
 * Excel de referencia (ver xlsx_export.rs, matches_reference_workbook).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeUiafTxt } from "../services/analysis";
import { buildUiafSheets } from "../services/excelExport";
import { UIAF_FIELD_COUNT } from "../types";

const files = (process.env.UIAF_TXT ?? "").split(":").filter(Boolean);

describe.skipIf(files.length === 0)("reporte UIAF real", () => {
  files.forEach((path, n) => {
    it(`convierte ${path.split("/").pop()}`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const { report, validation } = analyzeUiafTxt(bytes);
      for (const check of validation.checks) expect(check, (check.details ?? []).join(" ")).toMatchObject({ status: "ok" });
      expect(report.invalid).toEqual([]);

      // Cada detalle del TXT es una fila, campo por campo y en el mismo orden.
      const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
      const details = lines.filter((l) => l.includes("|"));
      expect(report.records.map((r) => r.values)).toEqual(details.map((l) => l.split("|")));
      expect(report.records.every((r) => r.values.length === UIAF_FIELD_COUNT)).toBe(true);
      const total = report.groups.reduce((s, g) => s + g.records.length, 0);
      expect(total).toBe(details.length);
      expect(report.header?.parsed?.declaredCount).toBe(details.length);
      expect(report.footer?.parsed?.declaredCount).toBe(details.length);

      const sheets = buildUiafSheets(report);
      const exported = sheets.flatMap((s) => s.rows);
      expect(exported).toHaveLength(details.length);
      expect(exported.flat().every((v) => typeof v === "string")).toBe(true);

      // Valores concretos del reporte de referencia (enero de 2026).
      if (report.header?.parsed?.reportDate === "2026-01-31" && details.length === 641) {
        expect(report.header.parsed.entityCode).toBe("21001265");
        expect(report.groups.map((g) => [g.sheetName, g.records.length])).toEqual([
          ["Transacciones", 477],
          ["Sheet1", 164],
        ]);
        const byNumber = (n: string) => report.records.find((r) => r.values[0] === n)!.values;
        expect(sheets[0].rows[0]).toEqual(details[0].split("|"));
        expect(byNumber("1").slice(0, 3)).toEqual(["1", "2026-01-02", "2"]);
        expect(byNumber("1")[11]).toBe("22840405102029406208");
        expect(sheets[1].rows[0]).toEqual(byNumber("15"));
        expect(byNumber("15")[6]).toBe("JOSE DANIEL ");
        expect(byNumber("6")[9]).toBe("05045");
        expect(byNumber("20")[11]).toBe("TCLGK89ANXBC9REWVHNB9UGXCC2QJJPBXH");
        expect(byNumber("57").slice(19)).toEqual(["-1", "-1", "-1", "-1", "-1", "-1", "CO"]);
        expect(byNumber("224")[3]).toBe("PPT 7706338");
      }

      if (n === 0 && process.env.UIAF_SHEETS_OUT) writeFileSync(process.env.UIAF_SHEETS_OUT, JSON.stringify(sheets));
    });
  });
});
