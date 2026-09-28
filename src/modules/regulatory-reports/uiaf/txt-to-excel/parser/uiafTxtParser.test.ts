import { describe, expect, it } from "vitest";
import { StatementError } from "../../../../bank-analysis/shared/types";
import { buildUiafSheets, suggestedUiafName } from "../services/excelExport";
import { validateUiaf } from "../services/validation";
import { UIAF_COLUMNS } from "../types";
import { decodeUiafText, parseUiafBytes, parseUiafFooter, parseUiafHeader, parseUiafText, UIAF_MESSAGES } from "./uiafTxtParser";

// Registros con la forma del reporte real (datos inventados).
const TIPO2 = "1|2026-01-02|2|41958607|13|41958607|CLAUDIA MILENA|CAPERA GUTIERREZ|CO|63001|2|22840405102029406208|22840405102029406208|USDT|4005|15000000|4005|15000000|22840405102029406208|31|901418451|BINANCE|COLOMBIA SAS|CO|BINANCE|CO";
const TIPO3 = "2|2026-01-02|3|1004364239|13|1004364239|JOSE DANIEL |SANCHEZ PALOMINO|CO|05045|2|TCLGK89ANXBC9REWVHNB9UGXCC2QJJPBXH|2a86069e4fcf7f53ab60e1d86fe031b5416d206b1f6514cf6c93d9a744f71e10|USDT|793|3000000|26989|101342826|22840524880647782400|-1|-1|-1|-1|-1|-1|CO";
const PPT = "3|2026-01-16|3|PPT 7706338|42|PPT 7706338|GLEYDA LILIANA|FLORES PERDOMO|CO|11001|2|22845543537895383040|22845543537895383040|USDT|539|2000000|46989|193174652|22845543537895383040|31|901418451|BINANCE|COLOMBIA SAS|CO|BINANCE|CO";

const pad = (n: number | string) => String(n).padStart(10, " ");
const header = (count: number, code = "21001265", date = "2026-01-31") => `${pad(0)}${code}${date}${pad(count)}X`;
const footer = (count: number, code = "21001265") => `${pad(0)}${code}${pad(count)}XXXXXXXXXXX`;
const file = (details: string[], o: { headerCount?: number; footerCount?: number; eol?: string } = {}) =>
  [header(o.headerCount ?? details.length), ...details, footer(o.footerCount ?? details.length)].join(o.eol ?? "\r\n") + (o.eol ?? "\r\n");

const renumber = (line: string, n: number) => `${n}${line.slice(line.indexOf("|"))}`;

describe("controles UIAF", () => {
  it("lee el encabezado y el cierre de ancho fijo", () => {
    expect(parseUiafHeader("         0210012652026-01-31       641X")).toEqual({ entityCode: "21001265", reportDate: "2026-01-31", declaredCount: 641 });
    expect(parseUiafFooter("         021001265       641XXXXXXXXXXX")).toEqual({ entityCode: "21001265", declaredCount: 641 });
    expect(parseUiafHeader("ENCABEZADO")).toBeUndefined();
  });
});

describe("parser UIAF", () => {
  it("separa encabezado, 26 campos por registro y cierre; agrupa por Código Tipo en orden", () => {
    const report = parseUiafText(file([TIPO2, TIPO3, PPT]));
    expect(report.header?.parsed).toEqual({ entityCode: "21001265", reportDate: "2026-01-31", declaredCount: 3 });
    expect(report.footer).toMatchObject({ line: 5, parsed: { declaredCount: 3 } });
    expect(report.detailLines).toBe(3);
    expect(report.records.map((r) => r.values.length)).toEqual([26, 26, 26]);
    expect(report.groups.map((g) => [g.sheetName, g.label, g.records.map((r) => r.line)])).toEqual([
      ["Transacciones", "Código Tipo 2", [2]],
      ["Sheet1", "Código Tipo 3", [3, 4]],
    ]);
    expect(validateUiaf(report).valid).toBe(true);
  });

  it("conserva todo como texto, tal cual (ceros, identificadores largos, -1, PPT, espacios)", () => {
    const [a, b, c] = parseUiafText(file([TIPO2, TIPO3, PPT])).records;
    expect(a.values).toEqual(TIPO2.split("|"));
    expect(a.values[11]).toBe("22840405102029406208");
    expect(b.values[6]).toBe("JOSE DANIEL ");
    expect(b.values[9]).toBe("05045");
    expect(b.values.slice(19, 25)).toEqual(["-1", "-1", "-1", "-1", "-1", "-1"]);
    expect(b.values[12]).toBe("2a86069e4fcf7f53ab60e1d86fe031b5416d206b1f6514cf6c93d9a744f71e10");
    expect(c.values[3]).toBe("PPT 7706338");
  });

  it("acepta fin de línea LF y archivos Windows-1252", () => {
    expect(parseUiafText(file([TIPO2], { eol: "\n" })).records[0].values).toEqual(TIPO2.split("|"));
    const latin = TIPO2.replace("CLAUDIA MILENA", "MUÑOZ");
    const bytes = Uint8Array.from([...file([latin])].map((ch) => (ch === "Ñ" ? 0xd1 : ch.charCodeAt(0))));
    expect(decodeUiafText(bytes).encoding).toBe("windows-1252");
    expect(parseUiafBytes(bytes).records[0].values[6]).toBe("MUÑOZ");
    expect(parseUiafBytes(new TextEncoder().encode(`﻿${file([latin])}`)).records[0].values[6]).toBe("MUÑOZ");
  });

  it("marca filas con más o menos de 26 campos sin desplazar columnas", () => {
    const short = TIPO2.split("|").slice(0, 25).join("|");
    const long = `${renumber(TIPO2, 3)}|EXTRA`;
    const report = parseUiafText(file([TIPO2, renumber(short, 2), long]));
    expect(report.records).toHaveLength(1);
    expect(report.invalid.map((i) => i.reason)).toEqual(["Línea 3: se esperaban 26 campos y se encontraron 25.", "Línea 4: se esperaban 26 campos y se encontraron 27."]);
    const v = validateUiaf(report);
    expect(v.valid).toBe(false);
    expect(v.checks.find((c) => c.id === "fields")?.status).toBe("failed");
    // Las líneas inválidas cuentan como registros declarados.
    expect(v.checks.find((c) => c.id === "counts")?.status).toBe("ok");
    const sheets = buildUiafSheets(report);
    expect(sheets.map((s) => s.name)).toEqual(["Transacciones", "Sheet1", "Filas inválidas"]);
    expect(sheets[2].rows[0]).toEqual(["3", "25", "Línea 3: se esperaban 26 campos y se encontraron 25.", renumber(short, 2)]);
  });

  it("compara la cantidad declarada con la real", () => {
    const v = validateUiaf(parseUiafText(file([TIPO2, renumber(TIPO3, 2)], { headerCount: 3 })));
    expect(v.checks.find((c) => c.id === "counts")).toMatchObject({ status: "failed", details: ["El encabezado indica 3 registros, pero se encontraron 2."] });
  });

  it("advierte un Código Tipo no reconocido y lo exporta en su propia hoja", () => {
    const tipo4 = renumber(TIPO2, 2).replace("|2026-01-02|2|", "|2026-01-02|4|");
    const report = parseUiafText(file([TIPO2, tipo4]));
    expect(report.groups.map((g) => g.sheetName)).toEqual(["Transacciones", "Sheet1", "Tipo 4"]);
    const v = validateUiaf(report);
    expect(v.checks.find((c) => c.id === "types")?.details).toEqual(["Se encontró un Código Tipo no reconocido: 4 (1 registro); se exportan en la hoja «Tipo 4»."]);
    expect(buildUiafSheets(report)[2].rows).toEqual([tipo4.split("|")]);
  });

  it("detecta N° Registro vacío, duplicado y saltos sin cambiarlos", () => {
    const lines = [TIPO2, renumber(TIPO2, 2), renumber(TIPO2, 2), renumber(TIPO2, 5), `${TIPO2.slice(TIPO2.indexOf("|"))}`];
    const report = parseUiafText(file(lines));
    expect(report.records.map((r) => r.values[0])).toEqual(["1", "2", "2", "5", ""]);
    expect(validateUiaf(report).checks.find((c) => c.id === "numbers")?.details).toEqual([
      "N° Registro 2 duplicado (líneas 3 y 4).",
      "Línea 5: después del N° Registro 2 sigue el 5.",
      "Línea 6: el N° Registro está vacío.",
    ]);
  });

  it("informa encabezado o cierre ausentes", () => {
    const v = validateUiaf(parseUiafText([TIPO2, renumber(TIPO2, 2)].join("\r\n")));
    expect(v.checks.find((c) => c.id === "structure")?.details).toEqual([
      "No se encontró el encabezado de control en la primera línea.",
      "No se encontró el registro final de control en la última línea.",
    ]);
    expect(v.checks.find((c) => c.id === "counts")?.status).toBe("unavailable");
  });

  it("rechaza archivos sin registros separados por |", () => {
    for (const [text, message] of [
      ["", UIAF_MESSAGES.empty],
      ["\r\n\r\n", UIAF_MESSAGES.empty],
      ["Hola\r\nMundo", UIAF_MESSAGES.format],
    ]) {
      expect(() => parseUiafText(text)).toThrow(StatementError);
      expect(() => parseUiafText(text)).toThrow(message);
    }
  });
});

describe("exportación UIAF", () => {
  it("26 columnas de texto con los encabezados del Excel de referencia", () => {
    const [transacciones, sheet1] = buildUiafSheets(parseUiafText(file([TIPO2, TIPO3])));
    expect(transacciones.columns.map((c) => c.header)).toEqual([...UIAF_COLUMNS]);
    expect(transacciones.columns.every((c) => c.kind === "text")).toBe(true);
    expect(transacciones.rows).toEqual([TIPO2.split("|")]);
    expect(sheet1.rows).toEqual([TIPO3.split("|")]);
    expect(sheet1.rows.flat().every((v) => typeof v === "string")).toBe(true);
    expect(suggestedUiafName("TPSV210012650126.txt")).toBe("TPSV210012650126");
    expect(suggestedUiafName("reporte.TXT")).toBe("reporte");
  });
});
