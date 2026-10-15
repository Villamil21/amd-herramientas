import { describe, expect, it } from "vitest";
import type { Employee, PayrollRow } from "../../../types/fs";
import { areaFor, computeMonth, employeeMovements, findAbsences, parseIdentification, primaPaymentDate, requiredKeys, type EmployeeMonth } from "./calc";

const SMMLV = 1_750_905;
const AUX = 249_095;

const employee = (id: number, doc: string, extra: Partial<Employee> = {}): Employee => ({
  id,
  companyId: 1,
  docType: "CC",
  docNumber: doc,
  name: `Empleado ${id}`,
  areas: [{ area: "admin", effectiveFrom: "2026-01" }],
  employments: [{ id: id * 10, number: 1, hireDate: "2026-01-01", endDate: null }],
  liquidations: [],
  justifications: [],
  ...extra,
});

describe("cálculo mensual", () => {
  it("sueldo base = IBC × 30 / días; sueldo del mes = IBC", () => {
    const c = computeMonth(1_692_542, 29, SMMLV, AUX);
    expect(Math.round(c.baseSalaryCents / 100)).toBe(1_750_906);
    expect(Math.floor(c.baseSalaryCents / 100)).toBe(1_750_905);
    expect(c.salaryCents).toBe(169_254_200);
    expect(c.days).toBe(29);
  });

  it("auxilio de transporte hasta 2 SMMLV, proporcional a los días, sin redondeo especial", () => {
    expect(computeMonth(3_501_810, 30, SMMLV, AUX).transportApplies).toBe(true);
    expect(computeMonth(3_501_811, 30, SMMLV, AUX).transportApplies).toBe(false);
    const c = computeMonth(1_692_542, 29, SMMLV, AUX);
    expect(c.transportCents).toBe(Math.round((AUX * 100 * 29) / 30));
  });

  it("prestaciones: prima mensual de 166.667 con salario mínimo y 30 días", () => {
    const c = computeMonth(SMMLV, 30, SMMLV, AUX);
    expect(Math.round(c.primaCents / 100)).toBe(166_667);
    expect(c.cesantiasCents).toBe(c.primaCents);
    expect(c.interesesCents).toBe(Math.round((((SMMLV + AUX) * 100 * 30) / 360) * 30 * 0.12 / 360));
    expect(c.vacacionesCents).toBe(Math.round((SMMLV * 100 * 30) / 720));
  });
});

describe("movimientos", () => {
  const e = employee(1, "1192816998");
  const row: EmployeeMonth = {
    source: { identification: "CC 1192816998", name: "Empleado 1", pensionDays: 30, pensionIbc: SMMLV, pensionContribution: 280_200, healthContribution: 0, riskContribution: 9_200, ccfContribution: 70_100 },
    docType: "CC",
    docNumber: "1192816998",
    employee: e,
    employmentId: 10,
    area: "admin",
    calc: computeMonth(SMMLV, 30, SMMLV, AUX),
    social: { pension: 28_020_000, health: 0, arl: 920_000, ccf: 7_010_000 },
    parafiscalesCents: 0,
  };
  const puc = new Map(requiredKeys([row], 0).map((k) => [k, k.includes("payable") ? "251010" : "510506"]));

  it("salario y auxilio solo gasto; seguridad social con CxP hasta la fecha de pago; prima hasta junio", () => {
    const moves = employeeMovements(row, "2026-08", "2026-09-05", puc);
    const by = (key: string) => moves.filter((m) => m.conceptKey === key);
    expect(by("payroll.salary.payable")).toHaveLength(0);
    expect(by("payroll.transport.payable")).toHaveLength(0);
    expect(by("payroll.pension.payable")[0]).toMatchObject({ amountCents: 28_020_000, settlesOn: "2026-09-05", accountingDate: "2026-08-31" });
    expect(by("payroll.health.expense")).toHaveLength(0);
    expect(by("payroll.prima.payable")[0].settlesOn).toBe("2026-12-31");
    expect(by("payroll.cesantias.payable")[0].settlesOn).toBeNull();
    expect(moves.every((m) => m.pucCode && m.employmentId === 10)).toBe(true);
  });

  it("la prima se paga en junio y diciembre", () => {
    expect(primaPaymentDate("2026-01")).toBe("2026-06-30");
    expect(primaPaymentDate("2026-06")).toBe("2026-06-30");
    expect(primaPaymentDate("2026-07")).toBe("2026-12-31");
  });

  it("sin ficha, vinculación o área no hay movimientos", () => {
    expect(employeeMovements({ ...row, area: undefined }, "2026-08", "2026-09-05", puc)).toHaveLength(0);
  });
});

describe("empleados", () => {
  it("la llave es tipo + número de documento", () => {
    expect(parseIdentification("CC 1192816998")).toEqual({ docType: "CC", docNumber: "1192816998" });
    expect(parseIdentification("ce 1.234.567")).toEqual({ docType: "CE", docNumber: "1234567" });
  });

  it("el área puede cambiar en el tiempo sin reescribir el histórico", () => {
    const e = employee(1, "1", { areas: [{ area: "admin", effectiveFrom: "2026-01" }, { area: "sales", effectiveFrom: "2026-04" }] });
    expect([areaFor(e, "2026-03"), areaFor(e, "2026-04"), areaFor(e, "2026-09"), areaFor(e, "2025-12")]).toEqual(["admin", "sales", "sales", undefined]);
  });

  it("empleado que desaparece sin liquidación ni justificación bloquea", () => {
    const carlos = employee(1, "111");
    const ana = employee(2, "222");
    const rows: PayrollRow[] = [
      { id: 1, batchId: 1, employeeId: 1, employmentId: 10, period: "2026-01", paymentDate: "2026-02-05", detail: null },
      { id: 2, batchId: 2, employeeId: 1, employmentId: 10, period: "2026-02", paymentDate: "2026-03-05", detail: null },
      { id: 3, batchId: 2, employeeId: 2, employmentId: 20, period: "2026-02", paymentDate: "2026-03-05", detail: null },
    ];
    const present = new Set(["CC 222"]);
    expect(findAbsences("2026-03", present, [carlos, ana], rows).map((a) => [a.employee.id, a.lastSeen])).toEqual([[1, "2026-02"]]);
    // Liquidado al finalizar febrero: ya no bloquea.
    const liquidated = { ...carlos, employments: [{ id: 10, number: 1, hireDate: "2026-01-01", endDate: "2026-02-28" }] };
    expect(findAbsences("2026-03", present, [liquidated, ana], rows)).toHaveLength(0);
    // Ausencia justificada para marzo.
    const justified = { ...carlos, justifications: [{ employeeId: 1, period: "2026-03", justification: "Licencia", createdAt: "" }] };
    expect(findAbsences("2026-03", present, [justified, ana], rows)).toHaveLength(0);
    // Primera planilla: no hay con qué comparar.
    expect(findAbsences("2026-01", present, [carlos], rows)).toHaveLength(0);
  });
});
