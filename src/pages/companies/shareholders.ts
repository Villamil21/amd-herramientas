import type { CatalogIndex } from "../../modules/exogena/domain/catalogIndex";
import { COLOMBIA, composeIdentityDocument, DOC_NIT, documentNumber, parseIdentityDocument, personName } from "../../modules/exogena/domain/thirdParty";
import type { RutStatus, Shareholder } from "../../types/models";
import { digitsOf, nameKey, normalizePhone, upperText } from "./normalize";
import type { ResolvedTerritory, ShareholderRutData } from "./import/shareholderRut";

/**
 * Socios y su RUT: cómo se reconoce a qué socio pertenece un RUT, cómo se compara con los datos actuales y cómo se aplica lo
 * que el usuario acepta. Funciones puras: la pantalla solo muestra y confirma.
 */

export type RutMatch = { index: number; by: "documento" | "nombre" };

/**
 * Busca primero por documento normalizado (solo dígitos) y, si no hay coincidencia, por nombre normalizado (sin tildes ni
 * mayúsculas, sin importar el orden de las palabras). Si ningún socio coincide devuelve null: nunca se vincula en silencio.
 */
export function matchShareholder(shareholders: Pick<Shareholder, "name" | "identityDocument">[], rut: Pick<ShareholderRutData, "docNumber" | "firstSurname" | "secondSurname" | "firstName" | "otherNames" | "businessName">): RutMatch | null {
  const rutDocument = digitsOf(rut.docNumber ?? "");
  if (rutDocument) {
    const index = shareholders.findIndex((s) => digitsOf(parseIdentityDocument(s.identityDocument).number) === rutDocument);
    if (index >= 0) return { index, by: "documento" };
  }
  const rutName = nameKey(rut.businessName ?? personName({ firstSurname: rut.firstSurname ?? "", secondSurname: rut.secondSurname ?? "", firstName: rut.firstName ?? "", otherNames: rut.otherNames ?? "" }));
  if (rutName) {
    const index = shareholders.findIndex((s) => nameKey(s.name) === rutName);
    if (index >= 0) return { index, by: "nombre" };
  }
  return null;
}

export type FieldKey = "personType" | "docTypeCode" | "docNumber" | "dv" | "name" | "firstSurname" | "secondSurname" | "firstName" | "otherNames" | "address" | "countryCode" | "deptCode" | "muniCode" | "phone" | "email";

export interface FieldComparison {
  key: FieldKey;
  label: string;
  /** Valor que trae el RUT (mostrado) y el dato actual del socio (mostrado). */
  extracted: string;
  current: string;
  /** coincide · nuevo (el socio no lo tenía) · conflicto (son distintos) · sin dato en el RUT. */
  status: "match" | "new" | "conflict" | "absent";
}

const LABEL: Record<FieldKey, string> = {
  personType: "Tipo de persona",
  docTypeCode: "Tipo de documento",
  docNumber: "Número de documento",
  dv: "DV",
  name: "Razón social",
  firstSurname: "Primer apellido",
  secondSurname: "Segundo apellido",
  firstName: "Primer nombre",
  otherNames: "Otros nombres",
  address: "Dirección",
  countryCode: "País",
  deptCode: "Departamento",
  muniCode: "Municipio",
  phone: "Teléfono",
  email: "Correo electrónico",
};

const PERSON_LABEL = { PJ: "Persona jurídica", PN: "Persona natural" } as const;

/** Lo que el RUT propone para cada campo, ya normalizado como se guarda. */
export function proposedValues(rut: ShareholderRutData, territory: ResolvedTerritory): Partial<Record<FieldKey, string>> {
  const legal = rut.personType === "PJ";
  const out: Partial<Record<FieldKey, string>> = {
    personType: rut.personType ?? undefined,
    docTypeCode: rut.docTypeCode,
    docNumber: rut.docNumber ? documentNumber(rut.docNumber, rut.docTypeCode ?? null) : undefined,
    dv: legal || rut.docTypeCode === DOC_NIT ? rut.dv : undefined,
    name: legal ? rut.businessName : undefined,
    firstSurname: legal ? undefined : rut.firstSurname,
    secondSurname: legal ? undefined : rut.secondSurname,
    firstName: legal ? undefined : rut.firstName,
    otherNames: legal ? undefined : rut.otherNames,
    address: rut.address,
    countryCode: territory.countryCode || undefined,
    deptCode: territory.deptCode || undefined,
    muniCode: territory.muniCode || undefined,
    phone: rut.phone ? normalizePhone(rut.phone) : undefined,
    email: rut.email,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ""));
}

/** Valor actual de un campo del socio, en la misma forma en que lo propone el RUT. */
export function currentValue(s: Shareholder, key: FieldKey): string {
  const identity = parseIdentityDocument(s.identityDocument);
  switch (key) {
    case "personType":
      return s.personType ?? "";
    case "docTypeCode":
      return s.docTypeCode ?? "";
    case "docNumber":
      return documentNumber(identity.number, s.docTypeCode ?? null);
    case "dv":
      return s.dv ?? "";
    case "name":
      return s.personType === "PJ" ? s.name : "";
    case "firstSurname":
    case "secondSurname":
    case "firstName":
    case "otherNames":
    case "address":
    case "countryCode":
    case "deptCode":
    case "muniCode":
      return s[key] ?? "";
    case "phone":
      return s.phone ?? "";
    case "email":
      return s.email ?? "";
  }
}

const norm = (key: FieldKey, v: string) => (key === "phone" || key === "docNumber" ? v.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase() : key === "email" ? v.trim().toLowerCase() : upperText(v));

/** Campos que se comparan según el tipo de persona del RUT. */
const FIELDS_PN: FieldKey[] = ["personType", "docTypeCode", "docNumber", "firstSurname", "secondSurname", "firstName", "otherNames", "address", "countryCode", "deptCode", "muniCode", "phone", "email"];
const FIELDS_PJ: FieldKey[] = ["personType", "docTypeCode", "docNumber", "dv", "name", "address", "countryCode", "deptCode", "muniCode", "phone", "email"];

/** Comparación «extraído del RUT» vs «dato actual»: coincidencias, datos nuevos y conflictos. */
export function compareRut(s: Shareholder, rut: ShareholderRutData, territory: ResolvedTerritory, index: CatalogIndex | null): FieldComparison[] {
  const proposed = proposedValues(rut, territory);
  const fields = rut.personType === "PJ" ? FIELDS_PJ : FIELDS_PN;
  const show = (key: FieldKey, v: string): string => {
    if (!v) return "";
    if (key === "personType") return PERSON_LABEL[v as "PJ" | "PN"] ?? v;
    if (key === "docTypeCode") return `${v} — ${index?.docType(v) ?? ""}`.replace(/ — $/, "");
    if (key === "countryCode") return `${v} — ${index?.country(v) ?? ""}`.replace(/ — $/, "");
    if (key === "deptCode") return `${v} — ${index?.department(v) ?? ""}`.replace(/ — $/, "");
    if (key === "muniCode") return `${v} — ${index?.municipality(proposed.deptCode ?? s.deptCode ?? "", v) ?? ""}`.replace(/ — $/, "");
    return v;
  };
  return fields.map((key) => {
    const extracted = proposed[key] ?? "";
    const current = currentValue(s, key);
    let status: FieldComparison["status"];
    if (!extracted) status = "absent";
    else if (!current) status = "new";
    else status = norm(key, extracted) === norm(key, current) ? "match" : "conflict";
    return { key, label: key === "name" ? LABEL.name : LABEL[key], extracted: show(key, extracted), current: show(key, current), status };
  });
}

/**
 * Aplica al socio los campos del RUT que el usuario aceptó (`accept`: por defecto lo nuevo y los conflictos; los conflictos
 * que decide conservar quedan fuera). El estado del RUT queda «validado» si no quedó ningún conflicto sin resolver, o
 * «revisar» si el usuario conservó algún dato distinto al del RUT.
 */
export function applyRut(s: Shareholder, rut: ShareholderRutData, territory: ResolvedTerritory, comparison: FieldComparison[], keepCurrent: ReadonlySet<FieldKey>): { shareholder: Shareholder; status: RutStatus } {
  const proposed = proposedValues(rut, territory);
  const take = (key: FieldKey) => proposed[key] !== undefined && !keepCurrent.has(key);
  const next: Shareholder = { ...s };
  if (take("personType")) next.personType = proposed.personType as "PJ" | "PN";
  const legal = next.personType === "PJ";
  if (take("docTypeCode")) next.docTypeCode = proposed.docTypeCode!;
  else if (legal) next.docTypeCode = DOC_NIT;
  if (take("dv")) next.dv = proposed.dv!;
  if (take("firstSurname")) next.firstSurname = proposed.firstSurname!;
  if (take("secondSurname")) next.secondSurname = proposed.secondSurname!;
  if (take("firstName")) next.firstName = proposed.firstName!;
  if (take("otherNames")) next.otherNames = proposed.otherNames!;
  if (take("address")) next.address = proposed.address!;
  if (take("countryCode")) next.countryCode = proposed.countryCode!;
  if (take("deptCode")) next.deptCode = proposed.deptCode!;
  if (take("muniCode")) next.muniCode = proposed.muniCode!;
  if (take("phone")) next.phone = proposed.phone!;
  if (take("email")) next.email = proposed.email!;
  if ((next.countryCode ?? "") !== COLOMBIA) {
    next.deptCode = "";
    next.muniCode = "";
  }
  if (legal) {
    next.firstSurname = "";
    next.secondSurname = "";
    next.firstName = "";
    next.otherNames = "";
    if (take("name")) next.name = upperText(proposed.name!);
  } else {
    // Persona natural: el nombre completo se arma con sus partes (apellidos primero, como en el RUT).
    next.name = upperText(personName({ firstSurname: next.firstSurname ?? "", secondSurname: next.secondSurname ?? "", firstName: next.firstName ?? "", otherNames: next.otherNames ?? "" })) || next.name;
  }
  if (take("docNumber") || take("docTypeCode")) {
    const docType = next.docTypeCode ?? null;
    const number = take("docNumber") ? proposed.docNumber! : documentNumber(parseIdentityDocument(s.identityDocument).number, docType);
    next.identityDocument = composeIdentityDocument(docType, number);
  }
  const unresolved = comparison.some((c) => c.status === "conflict" && keepCurrent.has(c.key));
  return { shareholder: next, status: unresolved ? "revisar" : "validado" };
}

/** Capital suscrito asignado a un socio para mostrarlo en la tabla (pesos), o null si aún no hay capital configurado. */
export const allocatedLabel = (pesos: number | null | undefined) => (pesos === null || pesos === undefined ? "—" : new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(pesos));
