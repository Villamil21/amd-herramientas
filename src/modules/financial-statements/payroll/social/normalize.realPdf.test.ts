/// <reference types="node" />
/**
 * Planillas reales (datos de terceros: no se guardan en el repositorio). Rutas separadas por «|»:
 *   PLANILLAS_PDF="/ruta/GCM.pdf|/ruta/Glowing.pdf|/ruta/NFES.pdf" npx vitest run normalize.realPdf
 * Sin la variable, se omite.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDocumentText } from "../../../bank-analysis/shared/pdf/pdfText";
import { analyzeAportesEnLinea } from "../../../social-security/payroll-summary/aportes-en-linea/services/analysis";
import { detectOperator } from "./detect";
import { normalizePlanilla } from "./normalize";
import { build1001Payroll } from "./exo1001";
import { build1011 } from "./exo1011";
import { WAGES, batchOf } from "./fixtures";
import { buildYearData } from "./year";
import { computeMonth } from "../calc";

const files = (process.env.PLANILLAS_PDF ?? "").split("|").filter(Boolean);

async function load(path: string) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useWasm: false, verbosity: 0 }).promise;
  return readDocumentText(pdf, undefined, { keepRotated: true });
}

describe.skipIf(files.length === 0)("normalización de planillas reales", () => {
  for (const path of files) {
    it(`normaliza ${path.split("/").pop()}`, async () => {
      const doc = await load(path);
      const p = normalizePlanilla(doc);
      expect(detectOperator(doc)).toBe(p.operator);
      expect(p.employer.nit).toMatch(/^\d{6,12}$/);
      expect(p.period).toMatch(/^\d{4}-\d{2}$/);
      expect(p.employees.length).toBeGreaterThan(0);
      expect(p.issues).toEqual([]);
      for (const e of p.employees) {
        expect(e.docType).toMatch(/^[A-Z]{1,4}$/);
        expect(e.docNumber).toMatch(/^[0-9A-Z]+$/);
        expect(e.entityCodes.afp).toBeTruthy();
        expect(e.entityCodes.eps).toBeTruthy();
      }
      // El aporte liquidado por entidad suma lo mismo que el detalle por empleado (mora aparte).
      for (const [kind, key] of [["AFP", "pension"], ["EPS", "health"], ["ARL", "arl"], ["CCF", "ccf"]] as const) {
        const byEntity = p.entities.filter((x) => x.kind === kind).reduce((n, x) => n + x.liquidated, 0);
        const byEmployee = p.employees.reduce((n, e) => n + e.contributions[key], 0);
        if (byEntity) expect(byEntity).toBe(byEmployee);
      }

      // Hechos conocidos de cada planilla de regresión (se comprueban solo para la que corresponde).
      const known: Record<string, { operator: string; nit: string; employees: number; late: number; period?: string }> = {
        "9498222960": { operator: "aportes-en-linea", nit: "901841760", employees: 3, late: 11_700 },
        "9499368247": { operator: "aportes-en-linea", nit: "901741186", employees: 4, late: 8_000 },
        "9498222357": { operator: "aportes-en-linea", nit: "901795718", employees: 7, late: 61_800 },
        "9507790132": { operator: "aportes-en-linea", nit: "901795718", employees: 8, late: 21_500, period: "2026-06" },
        "40724055": { operator: "miplanilla", nit: "901679752", employees: 3, late: 4_400 },
      };
      const k = known[p.planillaNumber ?? ""];
      if (k) {
        expect(p.operator).toBe(k.operator);
        expect(p.employer.nit).toBe(k.nit);
        expect(p.employees).toHaveLength(k.employees);
        expect(p.lateInterest).toBe(k.late);
        expect(p.period).toBe(k.period ?? "2026-01");
        // La mora nunca es aporte: lo liquidado por entidad es exactamente la suma del detalle por empleado.
        const liquidated = p.entities.reduce((n, e) => n + e.liquidated, 0);
        const detail = p.employees.reduce((n, e) => n + e.contributions.pension + e.contributions.health + e.contributions.arl + e.contributions.ccf, 0);
        expect(liquidated).toBe(detail);
        // 1001: el NIT sin DV y sin razón social de la planilla; 1011 con un mes cubierto y el resto sin cubrir.
        const data = buildYearData(2026, [batchOf(p)], WAGES);
        const f1001 = build1001Payroll(data, [], null);
        expect(f1001.groups.every((g) => /^\d{6,10}$/.test(g.nit))).toBe(true);
        expect(f1001.proposals.every((x) => x.data.businessName === "")).toBe(true);
        expect(f1001.proposals.reduce((n, x) => n + (x.data.deductible as number), 0)).toBe(liquidated);
        expect(build1011(data).uncovered).toHaveLength(11);
      }
      if (p.planillaNumber === "9498222960") {
        // Dos EPS con el mismo NIT: una sola fila 5011 por NIT.
        const eps = build1001Payroll(buildYearData(2026, [batchOf(p)], WAGES), [], null).groups.filter((g) => g.nit === "900156264");
        expect(eps).toHaveLength(1);
        expect(eps[0].concept).toBe("5011");
        expect(p.employees.find((e) => e.docType === "PT")?.docNumber).toBe("1030953");
      }
      if (p.planillaNumber === "9498222357") {
        // Variante compacta (encabezados de 4,5 pt en líneas partidas): 7 empleados únicos con el detalle de cada sistema.
        expect(new Set(p.employees.map((e) => `${e.docType} ${e.docNumber}`)).size).toBe(7);
        expect(p.employees.reduce((n, e) => n + e.contributions.pension, 0)).toBe(1_961_400);
        expect(p.employees.reduce((n, e) => n + e.contributions.health, 0)).toBe(490_700);
        expect(p.employees.reduce((n, e) => n + e.contributions.ccf, 0)).toBe(490_700);
        expect(p.employees.reduce((n, e) => n + e.contributions.arl, 0)).toBe(64_400);
        const { summary: s, validation } = analyzeAportesEnLinea(doc);
        expect([s.totalContributions, s.lateInterest, s.paymentAmount]).toEqual([3_007_200, 61_800, 3_069_000]);
        expect(validation.validated).toBe(true);
        expect(p.checks.every((c) => c.status !== "failed")).toBe(true);
        // El resumen por entidades suma el liquidado de los empleados (sin mora).
        expect(p.entities.reduce((n, e) => n + e.liquidated, 0)).toBe(3_007_200);
      }
      if (p.planillaNumber === "9507790132") {
        // 9 filas físicas, 8 personas: CC 16725609 viene en dos tramos (18 + 12 días) y se consolida UNA vez.
        const { summary: s, validation } = analyzeAportesEnLinea(doc);
        expect(s.detectedRows).toBe(9);
        expect(s.employeeCount).toBe(8);
        expect(s.detailTotals.declaredEmployees).toBe(8);
        expect(s.paymentDate).toBe("2026/07/10");
        expect([s.totalContributions, s.lateInterest, s.paymentAmount]).toEqual([7_059_200, 21_500, 7_080_700]);
        expect(validation.validated).toBe(true);
        expect(validation.checks.every((c) => c.status !== "failed")).toBe(true);
        const mine = p.employees.filter((e) => e.docType === "CC" && e.docNumber === "16725609");
        expect(mine).toHaveLength(1);
        expect(mine[0].segments?.map((x) => x.pension.days)).toEqual([18, 12]);
        expect(mine[0].pension.days).toBe(30);
        expect(mine[0].novelties).toEqual(["ige"]);
        expect(new Set(p.employees.map((e) => `${e.docType} ${e.docNumber}`)).size).toBe(8);
        // Totales consolidados = Total Afiliados y Resumen de pago.
        expect(p.employees.reduce((n, e) => n + e.contributions.pension, 0)).toBe(4_681_400);
        expect(p.employees.reduce((n, e) => n + e.contributions.health, 0)).toBe(1_130_800);
        expect(p.employees.reduce((n, e) => n + e.contributions.ccf, 0)).toBe(1_102_700);
        expect(p.employees.reduce((n, e) => n + e.contributions.arl, 0)).toBe(144_300);
        // La consolidación interna no es un empleado duplicado entre planillas.
        expect(buildYearData(2026, [batchOf(p)], WAGES).duplicates).toEqual([]);
      }
      if (p.planillaNumber === "9499368247") {
        // Quien cotizó 29 días: el salario del mes es su IBC (no se asumen 30 días) y la base mensual se proyecta a 30.
        const e = p.employees.find((x) => x.pension.days === 29)!;
        expect(e.pension.ibc).toBe(1_692_542);
        // El IBC de CCF puede diferir del de pensión (aquí dos personas con 1.400.000): cada subsistema conserva el suyo.
        expect(p.employees.filter((x) => x.ccf.ibc === 1_400_000 && x.pension.ibc === 1_750_905)).toHaveLength(2);
        const c = computeMonth(e.pension.ibc!, 29, 1_750_905, 249_095);
        expect(c.salaryCents).toBe(169_254_200);
        expect(Math.round(c.baseSalaryCents / 100)).toBe(1_750_906);
      }
      if (p.planillaNumber === "40724055") {
        expect(p.employees.map((e) => e.name)).toEqual(expect.arrayContaining(["CRUZ RODRIGUEZ GABRIEL ANDRES", "ERICES AUAD FERNANDO ANDRES", "SAMPAYO BITAR SHADYA"]));
        expect(p.employees.some((e) => e.docType === "CE" && e.docNumber === "900754")).toBe(true);
      }
    });
  }
});
