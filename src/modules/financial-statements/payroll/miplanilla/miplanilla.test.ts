import { describe, expect, it } from "vitest";
import { StatementError } from "../../../bank-analysis/shared/types";
import { analyzeMiPlanilla } from "./analysis";
import { parseMiPlanilla } from "./parser";
import { miPlanillaDoc, REFERENCE, type DocSpec } from "./testDoc";
import { cotizacionOf } from "./types";

const spec = (extra: Partial<DocSpec> = {}): DocSpec => ({ ...REFERENCE, ...extra });

describe("parser de MiPlanilla", () => {
  const summary = parseMiPlanilla(miPlanillaDoc(spec()));

  it("lee los datos del aportante y de la planilla", () => {
    expect(summary).toMatchObject({ employerNit: "901679752", employerDv: "3", employerName: "NFES SOLUTIONS SAS", planillaNumber: "40724055", paymentDate: "2026-02-17", planillaType: "E", declaredEmployees: 3, totalPayroll: 5_252_715, totalToPay: 1_280_100 });
  });

  it("el período es el de PENSIÓN, no el de salud", () => {
    expect(summary.pensionPeriod).toBe("2026-01");
    expect(summary.healthPeriod).toBe("2026-02");
  });

  it("lee el detalle por cotizante por la posición de cada columna, con nombres de 1 a 3 líneas", () => {
    expect(summary.employees.map((e) => [e.identification, e.name])).toEqual([
      ["CC 1020713259", "SAMPAYO BITAR SHADYA"],
      ["CC 1111545619", "CRUZ RODRIGUEZ GABRIEL ANDRES"],
      ["CE 900754", "ERICES AUAD FERNANDO ANDRES"],
    ]);
    expect(summary.employees[0]).toMatchObject({ pensionDays: 30, pensionIbc: 1_750_905, pensionContribution: 280_200, healthContribution: 70_100, riskContribution: 9_200, ccfContribution: 57_000, pensionExtras: 0 });
    expect(summary.employees[0].parafiscales).toEqual({ sena: 0, icbf: 0, esap: 0, men: 0 });
    expect(summary.issues).toEqual([]);
    expect(summary.detectedRows).toBe(3);
  });

  it("lee los totales por subsistema y las filas de administradoras", () => {
    expect(summary.totals.subsystems.pension).toEqual({ administrators: 1, contribution: 840_600, toPay: 843_300 });
    expect(summary.totals.subsystems.ccf?.contribution).toBe(197_200);
    expect(summary.totals.parafiscales.sena?.contribution).toBe(0);
    expect(summary.totals.grand).toMatchObject({ contribution: 1_275_700, toPay: 1_280_100 });
    expect(summary.administrators.health).toEqual({ rows: 2, contribution: 210_300, toPay: 211_100 });
    expect(summary.administrators.risk?.rows).toBe(1);
  });

  it("separa SENA, ICBF, ESAP y MEN por empleado", () => {
    const withPara = parseMiPlanilla(miPlanillaDoc(spec({ employees: [{ ...REFERENCE.employees[0], sena: 7_000, icbf: 10_500, esap: 1, men: 2 }, ...REFERENCE.employees.slice(1)] })));
    expect(withPara.employees[0].parafiscales).toEqual({ sena: 7_000, icbf: 10_500, esap: 1, men: 2 });
  });

  it("falla con un mensaje claro si no es MiPlanilla o falta el período de pensión", () => {
    expect(() => parseMiPlanilla({ pageCount: 1, pages: [{ pageNumber: 1, width: 1, height: 1, items: [{ text: "Planilla Resumen", x: 0, y: 0, width: 5, height: 5 }] }] })).toThrow(StatementError);
    expect(() => parseMiPlanilla(miPlanillaDoc(spec({ pensionPeriod: null })))).toThrow(/período de pensión/);
  });

  it("informa la fila que no se pudo interpretar sin inventar valores", () => {
    const doc = miPlanillaDoc(spec());
    // Se borra la cotización de salud de la segunda persona.
    doc.pages[1].items = doc.pages[1].items.filter((i) => !(i.text === "70.100" && Math.abs(i.y - 349.3) < 1 && i.x + i.width / 2 > 480 && i.x + i.width / 2 < 510));
    const result = parseMiPlanilla(doc);
    expect(result.employees).toHaveLength(2);
    expect(result.issues).toEqual([expect.objectContaining({ page: 2, text: expect.stringContaining("Fila 2"), reason: expect.stringContaining("cotización de salud") })]);
  });

  it("explica qué columna falta si el formato no trae los encabezados esperados", () => {
    const result = parseMiPlanilla(miPlanillaDoc(spec({ omitHeader: "Días" })));
    expect(result.employees).toEqual([]);
    expect(result.issues[0].reason).toMatch(/4 columnas «Días»/);
  });
});

describe("validación de MiPlanilla", () => {
  it("la planilla de referencia cuadra: subtotales, total a pagar y mora global", () => {
    const analysis = analyzeMiPlanilla(miPlanillaDoc(spec()));
    expect(analysis.validated).toBe(true);
    expect(analysis.checks.filter((c) => c.status === "failed")).toEqual([]);
    expect(analysis.lateInterest).toBe(4_400);
    expect(analysis.warnings).toEqual([]);
  });

  it("Cotización = pensión + salud + riesgos + CCF; ni los parafiscales ni la mora entran", () => {
    const { employees } = analyzeMiPlanilla(miPlanillaDoc(spec())).summary;
    expect(employees.map(cotizacionOf)).toEqual([416_500, 429_600, 429_600]);
    expect(employees.reduce((n, e) => n + cotizacionOf(e), 0)).toBe(1_275_700);
  });

  it("una diferencia entre el detalle y el resumen bloquea y dice cuánto", () => {
    const analysis = analyzeMiPlanilla(miPlanillaDoc(spec({ totals: { ...REFERENCE.totals, pension: [840_700, 843_400] } })));
    expect(analysis.validated).toBe(false);
    const failed = analysis.checks.find((c) => c.id === "detail-pension")!;
    expect(failed.status).toBe("failed");
    expect(failed.detail).toContain("$840.600");
    expect(failed.detail).toContain("$100");
    expect(analysis.summary.issues.some((i) => i.text.includes("Pensión"))).toBe(true);
  });

  it("la cantidad de empleados del encabezado debe coincidir con el detalle", () => {
    const analysis = analyzeMiPlanilla(miPlanillaDoc(spec({ declaredEmployees: 4 })));
    expect(analysis.checks.find((c) => c.id === "count")!.status).toBe("failed");
  });

  it("un total a pagar menor que lo liquidado es un error, no una mora negativa", () => {
    const analysis = analyzeMiPlanilla(miPlanillaDoc(spec({ totalToPay: "$1.000.000" })));
    expect(analysis.checks.find((c) => c.id === "mora")!.status).toBe("failed");
    expect(analysis.lateInterest).toBe(0);
  });

  it("aportes voluntarios o al FSP se informan y bloquean: no tienen tratamiento contable", () => {
    const employees = [{ ...REFERENCE.employees[0], extras: [0, 0, 5_000, 0] as [number, number, number, number] }, ...REFERENCE.employees.slice(1)];
    const analysis = analyzeMiPlanilla(miPlanillaDoc(spec({ employees })));
    expect(analysis.summary.employees[0].pensionExtras).toBe(5_000);
    expect(analysis.validated).toBe(false);
    expect(analysis.summary.issues.some((i) => i.reason.includes("FSP"))).toBe(true);
  });

  it("el total de nómina distinto de la suma de IBC es informativo: no bloquea", () => {
    const analysis = analyzeMiPlanilla(miPlanillaDoc(spec({ totalPayroll: "$5,000,000" })));
    expect(analysis.validated).toBe(true);
    expect(analysis.warnings.join(" ")).toMatch(/total de nómina/);
  });
});
