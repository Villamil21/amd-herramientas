import type { BatchSummary, Employee } from "../../../../types/fs";
import type { MinimumWage } from "../../../../types/models";
import { planillaMetadata, dedupeKeyV2 } from "./store";
import { OPERATOR_LABEL, PLANILLA_SCHEMA_VERSION, type NormalizedEmployee, type NormalizedEntity, type NormalizedPlanilla } from "./types";

export const SMMLV = 1_750_905;
export const AUX = 249_095;
export const WAGES: MinimumWage[] = [{ year: 2026, valuePesos: SMMLV, transportAllowancePesos: AUX } as MinimumWage];

export function person(doc: string, over: Partial<NormalizedEmployee> = {}): NormalizedEmployee {
  return {
    docType: "CC",
    docNumber: doc,
    name: `PEREZ GOMEZ JUAN ${doc}`,
    pension: { days: 30, ibc: SMMLV },
    health: { days: 30, ibc: SMMLV },
    risk: { days: 30, ibc: SMMLV },
    ccf: { days: 30, ibc: SMMLV },
    contributions: { pension: 280_145, health: 148_827, arl: 9_139, ccf: 70_036, sena: 0, icbf: 0 },
    unrecognized: {},
    entityCodes: { afp: "230301", eps: "EPS037", arl: "14-11", ccf: "CCF07" },
    novelties: [],
    unreadCodes: [],
    page: 2,
    row: 1,
    ...over,
  };
}

export const ENTITIES: NormalizedEntity[] = [
  { kind: "AFP", code: "230301", name: "PROTECCION", nit: "800138188", dv: "4", liquidated: 280_145 },
  { kind: "EPS", code: "EPS037", name: "SURA EPS", nit: "800088702", dv: "2", liquidated: 148_827 },
  { kind: "ARL", code: "14-11", name: "SURA ARL", nit: "800088702", dv: "2", liquidated: 9_139 },
  { kind: "CCF", code: "CCF07", name: "COMFAMA", nit: "890900841", dv: "9", liquidated: 70_036 },
];

export function planilla(period: string, over: Partial<NormalizedPlanilla> = {}): NormalizedPlanilla {
  return {
    schemaVersion: PLANILLA_SCHEMA_VERSION,
    operator: "miplanilla",
    operatorLabel: OPERATOR_LABEL.miplanilla,
    planillaNumber: `P${period}`,
    employer: { nit: "901000001", dv: "1" },
    period,
    paymentDate: `${period}-10`,
    employees: [person("111")],
    entities: ENTITIES,
    lateInterest: 5_000,
    issues: [],
    checks: [],
    warnings: [],
    pageCount: 3,
    ...over,
  };
}

let nextId = 1;
export function batchOf(p: NormalizedPlanilla, over: Partial<BatchSummary> = {}): BatchSummary {
  return {
    id: nextId++,
    companyId: 1,
    source: "payroll",
    fileName: `${p.period}.pdf`,
    periodLabel: p.period,
    periodStart: `${p.period}-01`,
    periodEnd: `${p.period}-28`,
    dedupeKey: dedupeKeyV2(p),
    recordCount: 1,
    totalCents: 0,
    status: "active",
    replacedBy: null,
    metadata: planillaMetadata(p, {}),
    createdAt: "2026-02-01",
    ...over,
  };
}

export const emptyBatch = (period: string): BatchSummary => ({ ...batchOf(planilla(period)), metadata: { emptyPeriod: true, period }, dedupeKey: `empty:${period}` });

export const months = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

export const ficha = (id: number, doc: string, over: Partial<Employee> = {}): Employee => ({
  id,
  companyId: 1,
  docType: "CC",
  docNumber: doc,
  name: `PEREZ GOMEZ JUAN ${doc}`,
  areas: [{ area: "admin", effectiveFrom: "2026-01" }],
  employments: [{ id: id * 10, number: 1, hireDate: "2026-01-01", endDate: null }],
  liquidations: [],
  justifications: [],
  events: [],
  nameParts: { firstSurname: "PEREZ", secondSurname: "GOMEZ", firstName: "JUAN", otherNames: doc, confirmedAt: "2026-02-01" },
  ...over,
});
