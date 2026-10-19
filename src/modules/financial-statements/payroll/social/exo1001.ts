import type { ExoCatalogs, RecordData, SyncProposal } from "../../../../types/exogena";
import type { Supplier } from "../../../../types/models";
import { buildCatalogIndex } from "../../../exogena/domain/catalogIndex";
import { checkThirdPartyData } from "../../../exogena/domain/thirdPartyCheck";
import { computeNitDv, DOC_NIT } from "../../../exogena/domain/thirdParty";
import { nitDigits } from "../../../exogena/domain/text";
import { supplierPath, type PayrollAlert } from "./alerts";
import type { ContributionKind, EntityKind, NormalizedEmployee } from "./types";
import type { YearData } from "./year";

/**
 * Pagos a entidades de seguridad social en el 1001: una fila por ENTIDAD + CONCEPTO (el empleado no es tercero). Solo el
 * aporte liquidado (sin mora, recargos, fondos adicionales, saldos de incapacidad ni «valor a pagar»). La razón social nunca sale
 * de la planilla: solo de la ficha del proveedor. Sin esos datos se bloquea únicamente el 1001.
 */

export type Concept1001 = "5010" | "5011" | "5012";

export const CONCEPT_1001: Record<EntityKind, Concept1001> = { AFP: "5012", EPS: "5011", ARL: "5011", CCF: "5010", SENA: "5010", ICBF: "5010" };

const KIND_KEY: Record<EntityKind, ContributionKind> = { AFP: "pension", EPS: "health", ARL: "arl", CCF: "ccf", SENA: "sena", ICBF: "icbf" };
const CODE_KEY = { AFP: "afp", EPS: "eps", ARL: "arl", CCF: "ccf" } as const;

/**
 * Las planillas no traen el NIT del SENA ni del ICBF. Son los NIT oficiales de las entidades y solo se PROPONEN: quedan
 * el acumulado de Nómina no depende del proveedor; la ficha (con NIT ya puesto) solo es requisito del 1001.
 */
export const PARAFISCAL_NIT: Partial<Record<EntityKind, string>> = { SENA: "899999034", ICBF: "899999239" };

export interface Term1001 {
  batchId: number;
  fileName: string;
  period: string;
  kind: EntityKind;
  code: string;
  entityName: string;
  /** Aporte liquidado en pesos. */
  pesos: number;
  /** Personas involucradas en ese aporte de esa planilla. */
  people: { key: string; name: string }[];
}

export interface Group1001 {
  nit: string;
  concept: Concept1001;
  /** Nombre que dice la planilla: SOLO informativo, nunca razón social. */
  planillaNames: string[];
  pesos: number;
  terms: Term1001[];
  /** El NIT no viene en la planilla (SENA / ICBF): es una propuesta. */
  proposedNit: boolean;
}

export interface Form1001Payroll {
  groups: Group1001[];
  proposals: SyncProposal[];
  alerts: PayrollAlert[];
}

function peopleFor(employees: NormalizedEmployee[], kind: EntityKind, code: string) {
  const key = KIND_KEY[kind];
  const withValue = employees.filter((e) => e.contributions[key] > 0);
  const codeKey = kind in CODE_KEY ? CODE_KEY[kind as keyof typeof CODE_KEY] : undefined;
  const matched = codeKey && code ? withValue.filter((e) => e.entityCodes[codeKey] === code) : [];
  return (matched.length ? matched : withValue).map((e) => ({ key: `${e.docType} ${e.docNumber}`, name: e.name }));
}

export function groups1001(data: YearData): Group1001[] {
  const map = new Map<string, Group1001>();
  const add = (nit: string, concept: Concept1001, name: string, term: Term1001, proposedNit: boolean) => {
    const key = `${nit}|${concept}`;
    const g = map.get(key) ?? { nit, concept, planillaNames: [], pesos: 0, terms: [], proposedNit };
    g.pesos += term.pesos;
    if (name && !g.planillaNames.includes(name)) g.planillaNames.push(name);
    g.terms.push(term);
    map.set(key, g);
  };
  for (const { batch, planilla } of data.planillas) {
    for (const e of planilla.entities) {
      const nit = nitDigits(e.nit);
      if (!nit || !e.liquidated) continue;
      add(nit, CONCEPT_1001[e.kind], e.name, { batchId: batch.id, fileName: batch.fileName, period: planilla.period, kind: e.kind, code: e.code, entityName: e.name, pesos: e.liquidated, people: peopleFor(planilla.employees, e.kind, e.code) }, false);
    }
    // SENA e ICBF: la planilla trae el aporte por empleado pero no la entidad.
    for (const kind of ["SENA", "ICBF"] as const) {
      const pesos = planilla.employees.reduce((n, e) => n + e.contributions[KIND_KEY[kind]], 0);
      if (!pesos || planilla.entities.some((e) => e.kind === kind)) continue;
      add(PARAFISCAL_NIT[kind]!, CONCEPT_1001[kind], "", { batchId: batch.id, fileName: batch.fileName, period: planilla.period, kind, code: "", entityName: kind, pesos, people: peopleFor(planilla.employees, kind, "") }, true);
    }
  }
  return [...map.values()].sort((a, b) => (a.nit + a.concept).localeCompare(b.nit + b.concept));
}

/** Datos del tercero de una entidad: siempre NIT; todo lo demás sale de la ficha del proveedor (nada de la planilla). */
export function thirdOfEntity(nit: string, supplier: Supplier | undefined, catalogs: ExoCatalogs | null) {
  const data: RecordData = {
    personType: "PJ",
    docTypeCode: DOC_NIT,
    docNumber: nit,
    dv: supplier?.dv || computeNitDv(nit),
    firstSurname: "",
    secondSurname: "",
    firstName: "",
    otherNames: "",
    businessName: supplier?.businessName.trim() ?? "",
    address: supplier?.address ?? "",
    deptCode: supplier?.deptCode ?? "",
    muniCode: supplier?.muniCode ?? "",
    countryCode: supplier?.countryCode ?? "",
  };
  const missing = supplier
    ? catalogs
      ? checkThirdPartyData(data, "", "", buildCatalogIndex(catalogs)).map((p) => p.message.replace(/^:\s*/, "").replace(/\.$/, ""))
      : (["businessName", "address", "countryCode"] as const).filter((k) => !String(data[k] ?? "").trim()).map((k) => ({ businessName: "razón social", address: "dirección", countryCode: "país" })[k])
    : ["razón social", "dirección", "departamento", "municipio", "país"];
  return { data, missing };
}

/** NIT de SENA / ICBF que una planilla identificó y todavía no tienen ficha de proveedor: se crean solos (ficha mínima). */
export function parafiscalNitsToCreate(groups: Group1001[], suppliers: Supplier[]): string[] {
  const have = new Set(suppliers.map((s) => nitDigits(s.nit)));
  return [...new Set(groups.filter((g) => g.proposedNit && !have.has(g.nit)).map((g) => g.nit))];
}

export function build1001Payroll(data: YearData, suppliers: Supplier[], catalogs: ExoCatalogs | null): Form1001Payroll {
  const groups = groups1001(data);
  const alerts: PayrollAlert[] = [];
  const proposals: SyncProposal[] = [];
  const checked = new Set<string>();
  for (const g of groups) {
    const supplier = suppliers.find((s) => nitDigits(s.nit) === g.nit);
    const { data: third, missing } = thirdOfEntity(g.nit, supplier, catalogs);
    const label = supplier?.businessName || g.planillaNames[0] || (g.proposedNit ? g.terms[0]?.entityName : "") || g.nit;
    if (!checked.has(g.nit)) {
      checked.add(g.nit);
      if (!supplier) {
        alerts.push({
          id: `1001:supplier-missing:${g.nit}`,
          code: "supplier-missing",
          severity: "block",
          dests: ["1001"],
          title: g.proposedNit ? `${g.planillaNames[0] || g.terms[0]?.entityName || "Entidad"} (NIT ${g.nit}): falta crear el proveedor` : `${label} (NIT ${g.nit}): falta el proveedor`,
          why: g.proposedNit
            ? `La planilla no trae el NIT de la entidad: se propone el NIT oficial ${g.nit} (tipo NIT). El aporte ya se guarda y se acumula en Nómina sin esperar la ficha; solo faltan la razón social legal, dirección, departamento, municipio y país, que no salen de la planilla. Esos faltantes detienen únicamente el 1001 (no el EEFF, el 1011, el 2276 ni la planilla).`
            : "El 1001 pide la razón social legal y el domicilio de la entidad, y no pueden salir del nombre de la planilla. Sin esa ficha de proveedor solo el 1001 queda detenido.",
          how: "Crea el proveedor con su razón social legal, dirección, departamento, municipio y país (el NIT ya viene puesto).",
          action: { label: "Crear proveedor", path: supplierPath(g.nit) },
        });
      } else if (missing.length) {
        alerts.push({
          id: `1001:supplier-incomplete:${g.nit}`,
          code: "supplier-incomplete",
          severity: "block",
          dests: ["1001"],
          title: `${label} (NIT ${g.nit}): datos del proveedor incompletos`,
          why: `Al 1001 le falta: ${missing.join("; ")}. ${supplier.dataOrigin === "planilla" ? "La ficha se creó sola desde la planilla, solo con el NIT. " : ""}Solo el 1001 queda detenido.`,
          how: "Completa los datos del proveedor.",
          action: { label: "Abrir proveedor", path: supplierPath(g.nit) },
        });
      }
    }
    const periods = new Set(g.terms.map((t) => t.period)).size;
    const batches = new Set(g.terms.map((t) => t.batchId)).size;
    proposals.push({
      sourceKey: `nomina:${g.nit}|${g.concept}`,
      origin: "estados_financieros",
      originRef: `Nómina · ${batches} ${batches === 1 ? "planilla" : "planillas"} · ${periods} ${periods === 1 ? "periodo" : "periodos"}`,
      data: {
        concept: g.concept,
        ...third,
        thirdName: third.businessName,
        supplierId: supplier?.id ?? null,
        deductible: g.pesos,
        nonDeductible: 0,
        ivaDeductible: 0,
        ivaNonDeductible: 0,
        retPracticed: 0,
        retAssumed: 0,
        retIvaResponsible: 0,
        retIvaNonResident: 0,
        exactCents: { deductible: g.pesos * 100 },
      },
    });
  }
  return { groups, proposals, alerts };
}

/** Compras ya propone 1001 por tercero y concepto; si coincide con una entidad de nómina, es UNA fila con los valores sumados. */
export function mergePayroll1001(purchases: SyncProposal[], payroll: SyncProposal[]): SyncProposal[] {
  const out = purchases.map((p) => ({ ...p, data: { ...p.data } }));
  for (const p of payroll) {
    const same = out.find((x) => x.data.docNumber === p.data.docNumber && x.data.concept === p.data.concept);
    if (!same) {
      out.push(p);
      continue;
    }
    const num = (v: unknown) => (typeof v === "number" ? v : 0);
    same.data.deductible = num(same.data.deductible) + num(p.data.deductible);
    const exact = (same.data.exactCents ?? {}) as Record<string, number>;
    same.data.exactCents = { ...exact, deductible: num(exact.deductible) + num((p.data.exactCents as Record<string, number> | undefined)?.deductible) };
    same.originRef = `${same.originRef} + ${p.originRef}`;
  }
  return out;
}
