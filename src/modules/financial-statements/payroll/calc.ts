import type { Area, Employee, MovementInput, PayrollRow } from "../../../types/fs";
import type { MinimumWage } from "../../../types/models";
import { lastDayOfMonth } from "../shared/money";

/**
 * Nómina para Estados Financieros a partir de una planilla de seguridad
 * social (Aportes en Línea; la arquitectura admite SOI, Mi Planilla…).
 *
 * Por empleado y mes:
 * - Sueldo base = IBC pensión × 30 / días pensión. Sueldo del mes = IBC pensión.
 * - Auxilio de transporte si sueldo base ≤ 2 × SMMLV: auxilio × días / 30.
 * - Salario y auxilio se consideran pagados en el mes: solo gasto.
 * - Seguridad social (pensión, EPS, ARL, CCF): el valor completo de la
 *   planilla; gasto + cuenta por pagar que se paga en la fecha de pago.
 * - Prestaciones: prima y cesantías ((base + auxilio) × días / 360), intereses
 *   (cesantías × días × 12 % / 360) y vacaciones (base × días / 720); gasto +
 *   cuenta por pagar. La prima se paga en junio y diciembre; cesantías,
 *   intereses y vacaciones quedan por pagar hasta la liquidación.
 * - Intereses de mora de la planilla: concepto propio con una cuenta global.
 * - Parafiscales > 0: alerta bloqueante (sin tratamiento contable todavía).
 */

export type SocialKind = "pension" | "health" | "arl" | "ccf";
export type BenefitKind = "prima" | "cesantias" | "intereses" | "vacaciones";
export type PayrollKind = "salary" | "transport" | SocialKind | BenefitKind;

export const KIND_LABEL: Record<PayrollKind | "mora", string> = {
  salary: "Salario",
  transport: "Auxilio de transporte",
  pension: "Pensión",
  health: "EPS / Salud",
  arl: "ARL",
  ccf: "CCF",
  prima: "Prima",
  cesantias: "Cesantías",
  intereses: "Intereses sobre cesantías",
  vacaciones: "Vacaciones",
  mora: "Intereses de mora de planilla",
};

export const SOCIAL_KINDS: SocialKind[] = ["pension", "health", "arl", "ccf"];
export const BENEFIT_KINDS: BenefitKind[] = ["prima", "cesantias", "intereses", "vacaciones"];
/** Conceptos que se causan con gasto + cuenta por pagar. */
export const WITH_PAYABLE: PayrollKind[] = [...SOCIAL_KINDS, ...BENEFIT_KINDS];

/** Claves de la configuración PUC global (fs_puc_settings). */
export const pucKey = (kind: PayrollKind, area: Area, side: "expense" | "payable") => `payroll.${kind}.${area}.${side}`;
export const MORA_KEY = "payroll.mora.expense";

/** Todas las cuentas que la nómina puede necesitar. */
export function allPayrollKeys(): { key: string; kind: PayrollKind | "mora"; area?: Area; side: "expense" | "payable" }[] {
  const out: { key: string; kind: PayrollKind | "mora"; area?: Area; side: "expense" | "payable" }[] = [];
  for (const kind of ["salary", "transport", ...SOCIAL_KINDS, ...BENEFIT_KINDS] as PayrollKind[]) {
    for (const area of ["admin", "sales"] as Area[]) {
      out.push({ key: pucKey(kind, area, "expense"), kind, area, side: "expense" });
      if (WITH_PAYABLE.includes(kind)) out.push({ key: pucKey(kind, area, "payable"), kind, area, side: "payable" });
    }
  }
  out.push({ key: MORA_KEY, kind: "mora", side: "expense" });
  return out;
}

const cents = (value: number) => Math.round(value);

export interface MonthCalc {
  /** Sueldo base mensual (exacto, en centavos, sin redondear). */
  baseSalaryCents: number;
  days: number;
  /** Sueldo del mes = IBC pensión. */
  salaryCents: number;
  transportApplies: boolean;
  transportCents: number;
  primaCents: number;
  cesantiasCents: number;
  interesesCents: number;
  vacacionesCents: number;
}

/** Cálculo de un empleado en un mes. IBC y valores de la planilla en pesos enteros. */
export function computeMonth(ibcPesos: number, days: number, smmlvPesos: number, transportPesos: number): MonthCalc {
  const ibc = ibcPesos * 100;
  const base = days > 0 ? (ibc * 30) / days : 0;
  const transportApplies = base > 0 && base <= 2 * smmlvPesos * 100;
  const monthlyTransport = transportApplies ? transportPesos * 100 : 0;
  const cesantias = ((base + monthlyTransport) * days) / 360;
  return {
    baseSalaryCents: base,
    days,
    salaryCents: ibc,
    transportApplies,
    transportCents: cents((monthlyTransport * days) / 30),
    primaCents: cents(((base + monthlyTransport) * days) / 360),
    cesantiasCents: cents(cesantias),
    interesesCents: cents((cesantias * days * 0.12) / 360),
    vacacionesCents: cents((base * days) / 720),
  };
}

/** «CC 1192816998» → { docType: "CC", docNumber: "1192816998" }. */
export function parseIdentification(identification: string): { docType: string; docNumber: string } {
  const m = /^\s*([A-Za-z]{1,4})\s*([\w.-]+)\s*$/.exec(identification);
  if (!m) return { docType: "", docNumber: identification.replace(/\W/g, "") };
  return { docType: m[1].toUpperCase(), docNumber: m[2].replace(/[^0-9A-Za-z]/g, "") };
}

export const employeeKey = (docType: string, docNumber: string) => `${docType.toUpperCase()} ${docNumber}`;

/** Área vigente en un periodo (la última con vigencia ≤ periodo). */
export function areaFor(employee: Employee, period: string): Area | undefined {
  let area: Area | undefined;
  for (const a of employee.areas) if (a.effectiveFrom <= period) area = a.area;
  return area;
}

/** Vinculación abierta (sin liquidación) del empleado. */
export const openEmployment = (employee: Employee) => employee.employments.find((j) => !j.endDate);

/** Fecha en que se paga la prima del semestre del periodo: 30 de junio o 31 de diciembre. */
export const primaPaymentDate = (period: string) => `${period.slice(0, 4)}-${Number(period.slice(5, 7)) <= 6 ? "06-30" : "12-31"}`;

export interface PlanillaEmployee {
  identification: string;
  name: string;
  pensionDays: number;
  pensionIbc: number;
  pensionContribution: number;
  healthContribution: number;
  riskContribution: number;
  ccfContribution: number;
  otherContribution?: number;
}

export interface EmployeeMonth {
  source: PlanillaEmployee;
  docType: string;
  docNumber: string;
  employee?: Employee;
  employmentId?: number;
  area?: Area;
  calc: MonthCalc;
  social: Record<SocialKind, number>;
  parafiscalesCents: number;
}

/** Movimientos de un empleado en un periodo. Requiere su ficha, vinculación, área y las cuentas configuradas. */
export function employeeMovements(row: EmployeeMonth, period: string, paymentDate: string, puc: Map<string, string>): MovementInput[] {
  const { employee, employmentId, area, calc } = row;
  if (!employee || !employmentId || !area) return [];
  const date = lastDayOfMonth(period);
  const documentId = `${employeeKey(row.docType, row.docNumber)}|${period}`;
  const out: MovementInput[] = [];
  const base = { accountingDate: date, documentId, documentNumber: employeeKey(row.docType, row.docNumber), employeeId: employee.id, employmentId };
  const add = (kind: PayrollKind, amountCents: number) => {
    if (!amountCents) return;
    const detail = { area, kind, period, employee: employee.name, days: calc.days };
    out.push({ ...base, conceptKey: `payroll.${kind}.expense`, pucCode: puc.get(pucKey(kind, area, "expense")) ?? "", amountCents, description: `${KIND_LABEL[kind]} — ${employee.name}`, detail });
    if (WITH_PAYABLE.includes(kind)) {
      const settlesOn = (SOCIAL_KINDS as PayrollKind[]).includes(kind) ? paymentDate : kind === "prima" ? primaPaymentDate(period) : null;
      out.push({ ...base, conceptKey: `payroll.${kind}.payable`, pucCode: puc.get(pucKey(kind, area, "payable")) ?? "", amountCents, settlesOn, description: `${KIND_LABEL[kind]} por pagar — ${employee.name}`, detail });
    }
  };
  add("salary", calc.salaryCents);
  add("transport", calc.transportCents);
  for (const k of SOCIAL_KINDS) add(k, row.social[k]);
  add("prima", calc.primaCents);
  add("cesantias", calc.cesantiasCents);
  add("intereses", calc.interesesCents);
  add("vacaciones", calc.vacacionesCents);
  return out;
}

/** Claves PUC que necesita la planilla (según las áreas de sus empleados). */
export function requiredKeys(rows: EmployeeMonth[], lateInterestCents: number): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    if (!r.area) continue;
    const kinds: PayrollKind[] = ["salary", "prima", "cesantias", "intereses", "vacaciones", ...SOCIAL_KINDS.filter((k) => r.social[k])];
    if (r.calc.transportCents) kinds.push("transport");
    for (const k of kinds) {
      keys.add(pucKey(k, r.area, "expense"));
      if (WITH_PAYABLE.includes(k)) keys.add(pucKey(k, r.area, "payable"));
    }
  }
  if (lateInterestCents) keys.add(MORA_KEY);
  return [...keys];
}

export interface Absence {
  employee: Employee;
  /** Último periodo en que apareció. */
  lastSeen: string;
}

/**
 * Empleados que estaban en la planilla anterior importada y no están en esta:
 * posible retiro. Bloquea salvo que la vinculación esté liquidada o la
 * ausencia de este periodo esté justificada.
 */
export function findAbsences(period: string, presentKeys: Set<string>, employees: Employee[], rows: PayrollRow[]): Absence[] {
  const previous = [...new Set(rows.map((r) => r.period).filter((p) => p < period))].sort().pop();
  if (!previous) return [];
  const out: Absence[] = [];
  for (const r of rows.filter((x) => x.period === previous)) {
    const employee = employees.find((e) => e.id === r.employeeId);
    if (!employee || presentKeys.has(employeeKey(employee.docType, employee.docNumber))) continue;
    const employment = employee.employments.find((j) => j.id === r.employmentId);
    if (employment?.endDate) continue;
    if (employee.justifications.some((j) => j.period === period)) continue;
    if (!out.some((a) => a.employee.id === employee.id)) out.push({ employee, lastSeen: previous });
  }
  return out;
}

/** El año de un periodo con su SMMLV y auxilio de transporte configurados. */
export function wagesFor(period: string, wages: MinimumWage[]): { smmlv: number; transport: number } | undefined {
  const w = wages.find((x) => x.year === Number(period.slice(0, 4)));
  return w && w.transportAllowancePesos ? { smmlv: w.valuePesos, transport: w.transportAllowancePesos } : undefined;
}
