/// <reference types="node" />
/**
 * Prueba de regresión con el Excel real de facturación DIAN (tiene datos de
 * clientes, por eso NO se guarda en el repositorio). Primero se vuelca a JSON
 * con el mismo lector de la app (calamine) y luego se analiza:
 *
 *   cd src-tauri && EXCEL_DUMP_IN="../../Sources/Facturacion DIAN 09 2026 Digicort SAS.xlsx" EXCEL_DUMP_OUT=/tmp/ventas.json cargo test dump_workbook_json
 *   SALES_WITHHOLDING_JSON=/tmp/ventas.json npx vitest run salesWithholding.realFile
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Company, SelfWithholdingRate } from "../../../../types/models";
import type { Workbook } from "../../../../types/excel";
import { analyzeSales, type TypeRules } from "./analysis";
import { microToCents } from "./decimal";
import { buildSalesSheets } from "./excelExport";
import { readSalesWorkbook } from "./workbookReader";

const path = process.env.SALES_WITHHOLDING_JSON;

const rules: TypeRules = new Map([
  ["factura electronica", "invoice"],
  ["nota de credito electronica", "credit_note"],
]);
const rate: SelfWithholdingRate = { id: 1, ciiuCode: "6201", normalizedCode: "6201", economicActivity: "", rateBp: 110, source: "", createdAt: "", updatedAt: "" };
const digicort = { id: 1, razonSocial: "DIGICORT SAS", nit: "900738791", dv: "", ciiuCode: "6201" } as Company;

describe.skipIf(!path)("Facturación DIAN real (Digicort 09 2026)", () => {
  // Solo se lee si la suite corre (el cuerpo de describe se evalúa aunque se omita).
  const load = () => JSON.parse(readFileSync(path!, "utf8")) as Workbook;

  it("usa la hoja Ventas y produce exactamente las bases de referencia", () => {
    const result = readSalesWorkbook(load());
    if (result.kind !== "ok") throw new Error("se esperaba una sola hoja Ventas");
    const { file } = result;
    expect(file.sheetName).toBe("Ventas");
    expect(file.ignoredSheets).toEqual(["Compras"]);
    expect(file.rows).toHaveLength(158);

    const a = analyzeSales(file.rows, { rules, companies: [digicort], rates: [rate] });
    expect(a.issuer).toMatchObject({ nit: "900738791", name: "DIGICORT SAS", rows: 158 });
    expect(a.company?.razonSocial).toBe("DIGICORT SAS");
    expect(a.invoices.count).toBe(151);
    expect(microToCents(a.invoices.base)).toBe(3_135_591_900); // $31.355.919,00
    expect(a.creditNotes.count).toBe(7);
    expect(microToCents(a.creditNotes.base)).toBe(6_490_000); // $64.900,00
    expect(a.pending).toEqual([]);
    expect(a.complete).toBe(true);
    // Bases exactas en centavos: no hubo redondeo.
    expect(a.invoices.base % 10_000n).toBe(0n);

    // 1,10 %: 31.355.919 × 1,1 % = 344.915,109 → 344.915,11; 64.900 × 1,1 % = 713,90.
    expect(a.invoices.withholdingCents).toBe(34_491_511);
    expect(a.creditNotes.withholdingCents).toBe(71_390);
    expect(a.totals).toEqual({ netCents: 34_420_121, netRoundedCents: 34_400_000 });

    const [summary, detail] = buildSalesSheets(a);
    expect(summary.rows[0].slice(4, 11)).toEqual([151, 31_355_919, 344_915.11, 7, 64_900, 713.9, 344_201.21]);
    expect(detail.rows).toHaveLength(158);
  });

  it("sin empresa registrada no calcula tarifa pero sí las bases", () => {
    const result = readSalesWorkbook(load());
    if (result.kind !== "ok") throw new Error();
    const a = analyzeSales(result.file.rows, { rules, companies: [], rates: [rate] });
    expect(a.pending.map((p) => p.kind)).toEqual(["company_missing"]);
    expect(a.totals).toBeUndefined();
    expect(microToCents(a.invoices.base)).toBe(3_135_591_900);
  });
});
