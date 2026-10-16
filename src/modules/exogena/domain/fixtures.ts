import type { ExoCatalogs, ExoRecord } from "../../../types/exogena";
import type { Company, Shareholder } from "../../../types/models";
import { buildCatalogIndex } from "./catalogIndex";

/** Catálogos mínimos para las pruebas (los reales se siembran en la migración 023). */
export const CATALOGS: ExoCatalogs = {
  version: "test",
  source: "test",
  documentTypes: ["11", "12", "13", "21", "22", "31", "41"].map((code) => ({ code, description: `Tipo ${code}`, isSystem: true, isActive: true })),
  countries: [
    { code: "169", name: "COLOMBIA", isSystem: true, isActive: true },
    { code: "249", name: "ESTADOS UNIDOS", isSystem: true, isActive: true },
  ],
  departments: [
    { code: "05", name: "Antioquia", isSystem: true, isActive: true },
    { code: "08", name: "Atlántico", isSystem: true, isActive: true },
    { code: "11", name: "Bogotá D.C.", isSystem: true, isActive: true },
    { code: "76", name: "Valle del Cauca", isSystem: true, isActive: true },
  ],
  municipalities: [
    { deptCode: "05", code: "001", name: "Medellín", isSystem: true, isActive: true },
    { deptCode: "08", code: "001", name: "Barranquilla", isSystem: true, isActive: true },
    { deptCode: "11", code: "001", name: "Bogotá, D.C.", isSystem: true, isActive: true },
    { deptCode: "76", code: "001", name: "Cali", isSystem: true, isActive: true },
  ],
};
export const CATALOG_INDEX = buildCatalogIndex(CATALOGS);

export function shareholder(overrides: Partial<Shareholder> = {}): Shareholder {
  return {
    id: 1,
    name: "ANGARITA LOPEZ RONALDO",
    identityDocument: "CC 1192816998",
    percentage: 100,
    sortOrder: 0,
    legalRole: null,
    docTypeCode: "13",
    dv: "",
    personType: "PN",
    firstSurname: "ANGARITA",
    secondSurname: "LOPEZ",
    firstName: "RONALDO",
    otherNames: "",
    address: "CL 77 B 57 103",
    countryCode: "169",
    countryName: "COLOMBIA",
    deptCode: "76",
    deptName: "Valle del Cauca",
    muniCode: "001",
    muniName: "Cali",
    phone: "",
    email: "",
    rutStatus: "validado",
    ...overrides,
  };
}

export function company(shareholders: Shareholder[], overrides: Partial<Company> = {}): Company {
  return {
    id: 1,
    razonSocial: "EMPRESA SAS",
    nit: "901741186",
    dv: "9",
    direccion: "",
    ciudad: "",
    telefono: "",
    correo: "",
    infoAdicional: "",
    logoFile: null,
    subscribedTotalShares: 1000,
    subscribedNominalValue: 100_000,
    paidTotalShares: null,
    paidNominalValue: null,
    ciiuCode: "",
    legalRepName: "",
    legalRepDocument: "",
    legalRepAltName: "",
    legalRepAltDocument: "",
    legalRepManual: false,
    legalRepAltManual: false,
    shareholders,
    documents: [],
    createdAt: "x",
    updatedAt: "x",
    ...overrides,
  };
}

/** Un registro guardado a partir de una propuesta (como lo devuelve el backend). */
export function stored(proposal: { sourceKey: string; origin: string; originRef: string; data: Record<string, unknown> }, extra: Partial<ExoRecord> = {}): ExoRecord {
  return {
    id: 1,
    companyId: 1,
    year: 2025,
    formatCode: "1010",
    sourceKey: proposal.sourceKey,
    origin: proposal.origin as ExoRecord["origin"],
    originRef: proposal.originRef,
    data: proposal.data,
    manualFields: [],
    manuallyModifiedAt: null,
    syncedAt: "2026-01-10T10:00:00Z",
    createdAt: "x",
    updatedAt: "x",
    ...extra,
  };
}
