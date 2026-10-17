import type { PersonType } from "../../../types/models";

/**
 * Datos tributarios y territoriales de un tercero (proveedor o socio) para Información Exógena.
 * Las reglas de «completo / requiere datos» son las mismas del backend (`models/third_party.rs`, con los mismos casos de prueba).
 */

export const COLOMBIA = "169";
export const DOC_NIT = "31";
/** Tipos cuyo número puede llevar letras (pasaportes y documentos extranjeros). */
const ALPHANUMERIC_DOC_TYPES = ["33", "41", "42", "43", "44", "46", "47"];

export interface ThirdPartyData {
  docTypeCode: string | null;
  dv: string;
  personType: PersonType | null;
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
  address: string;
  countryCode: string;
  countryName: string;
  deptCode: string;
  deptName: string;
  muniCode: string;
  muniName: string;
}

export const EMPTY_THIRD_PARTY: ThirdPartyData = {
  docTypeCode: null,
  dv: "",
  personType: null,
  firstSurname: "",
  secondSurname: "",
  firstName: "",
  otherNames: "",
  address: "",
  countryCode: "",
  countryName: "",
  deptCode: "",
  deptName: "",
  muniCode: "",
  muniName: "",
};

/** Cualquier objeto con los campos opcionales de un proveedor o un socio → datos completos (los vacíos como cadena vacía). */
export function thirdPartyOf(source: Partial<{ [K in keyof ThirdPartyData]: ThirdPartyData[K] | null | undefined }>): ThirdPartyData {
  return {
    docTypeCode: source.docTypeCode || null,
    dv: source.dv ?? "",
    personType: source.personType ?? null,
    firstSurname: source.firstSurname ?? "",
    secondSurname: source.secondSurname ?? "",
    firstName: source.firstName ?? "",
    otherNames: source.otherNames ?? "",
    address: source.address ?? "",
    countryCode: source.countryCode ?? "",
    countryName: source.countryName ?? "",
    deptCode: source.deptCode ?? "",
    deptName: source.deptName ?? "",
    muniCode: source.muniCode ?? "",
    muniName: source.muniName ?? "",
  };
}

export const allowsLetters = (docType: string | null | undefined) => !!docType && ALPHANUMERIC_DOC_TYPES.includes(docType);

/** Número de documento sin espacios, puntos ni guiones. Numérico salvo pasaportes y documentos extranjeros (alfanumérico en mayúsculas). */
export function documentNumber(value: string, docType?: string | null): string {
  const main = docType === DOC_NIT ? (value.split("-")[0] ?? "") : value;
  return allowsLetters(docType) ? main.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase() : main.replace(/\D/g, "");
}

/** Prefijo con que se muestra el documento de un socio («CC», «NIT»…) → código DIAN. */
const PREFIX_TO_DOC_TYPE: Record<string, string> = { CC: "13", NIT: "31", CE: "22", TI: "12", RC: "11", PA: "41", PEP: "47", PPT: "48", TE: "21" };
const DOC_TYPE_TO_PREFIX: Record<string, string> = { "13": "CC", "31": "NIT", "22": "CE", "12": "TI", "11": "RC", "41": "PA", "47": "PEP", "48": "PPT", "21": "TE" };

/** «CC 1192729629» → { prefix: «CC», number: «1192729629» }. Un documento sin prefijo es solo el número. */
export function parseIdentityDocument(identityDocument: string): { prefix: string; number: string } {
  const m = /^\s*([A-Za-zÁÉÍÓÚáéíóú]{1,4})\.?\s+(.+)$/.exec(identityDocument);
  if (!m) return { prefix: "", number: identityDocument.trim() };
  return { prefix: m[1].toUpperCase(), number: m[2].trim() };
}

/** Código DIAN que corresponde al prefijo del documento («CC» → 13); undefined si no es un prefijo conocido. */
export const docTypeFromPrefix = (prefix: string): string | undefined => PREFIX_TO_DOC_TYPE[prefix.toUpperCase()];

/** Documento «tal como se muestra» (lo que usan certificados y representantes): «CC 1192729629». */
export function composeIdentityDocument(docType: string | null | undefined, number: string): string {
  const prefix = docType ? DOC_TYPE_TO_PREFIX[docType] : undefined;
  const clean = documentNumber(number, docType);
  return prefix && clean ? `${prefix} ${clean}` : clean;
}

/** Nombre completo de una persona natural (apellidos primero, como en el RUT). */
export const personName = (d: Pick<ThirdPartyData, "firstSurname" | "secondSurname" | "firstName" | "otherNames">) =>
  [d.firstSurname, d.secondSurname, d.firstName, d.otherNames].map((x) => x.trim()).filter(Boolean).join(" ");

/** Qué falta para poder reportar al tercero (vacío = completo). `legalName` es la razón social (PJ). */
export function missingFields(data: ThirdPartyData, number: string, legalName: string): string[] {
  const missing: string[] = [];
  if (!data.docTypeCode) missing.push("Tipo de documento");
  if (!number) missing.push("Número de documento");
  if (data.docTypeCode === DOC_NIT && !data.dv) missing.push("DV");
  if (!data.personType) missing.push("Persona natural o jurídica");
  else if (data.personType === "PJ") {
    if (!legalName.trim()) missing.push("Razón social");
  } else {
    if (!data.firstSurname.trim()) missing.push("Primer apellido");
    if (!data.firstName.trim()) missing.push("Primer nombre");
  }
  if (!data.address.trim()) missing.push("Dirección");
  if (!data.countryCode) missing.push("País");
  else if (data.countryCode === COLOMBIA) {
    if (!data.deptCode) missing.push("Departamento");
    if (!data.muniCode) missing.push("Municipio");
  }
  return missing;
}

/** Dígito de verificación de un NIT colombiano (módulo 11 con los primos de la DIAN). */
export function computeNitDv(nit: string): string {
  const digits = nit.replace(/\D/g, "");
  if (!digits || digits.length > 15) return "";
  const primes = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const sum = [...digits].reverse().reduce((acc, d, i) => acc + Number(d) * primes[i], 0);
  const mod = sum % 11;
  return String(mod > 1 ? 11 - mod : mod);
}

/** «76001» → { deptCode: «76», muniCode: «001» }. null si no son exactamente cinco dígitos. */
export function splitMunicipalityCode(code: string): { deptCode: string; muniCode: string } | null {
  return /^\d{5}$/.test(code) ? { deptCode: code.slice(0, 2), muniCode: code.slice(2) } : null;
}

/** Clave de una denominación de tipo de documento: mayúsculas, sin tildes, signos ni espacios («C.C.» = «CC», «Cédula de ciudadanía» = «CEDULADECIUDADANIA»). */
export const docTypeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");

/**
 * Código Exógena de la denominación que trae una factura: por el propio código («13»), por el nombre oficial del catálogo o por un
 * alias persistente (Catálogos Exógena → Alias). Solo cuenta si el código existe y está activo; lo que no se reconoce queda sin
 * resolver (nunca se inventa un tipo de documento).
 */
export function resolveDocTypeCode(
  text: string | undefined,
  documentTypes: readonly { code: string; description: string; isActive: boolean }[],
  aliases: readonly { kind: string; aliasKey: string; target: string }[] = [],
): string | undefined {
  const key = text ? docTypeKey(text) : "";
  if (!key) return undefined;
  const active = documentTypes.filter((d) => d.isActive);
  const byCode = active.find((d) => docTypeKey(d.code) === key && /^\d+$/.test(text!.trim()));
  if (byCode) return byCode.code;
  const byName = active.find((d) => docTypeKey(d.description) === key);
  if (byName) return byName.code;
  const alias = aliases.find((a) => a.kind === "document_type" && a.aliasKey === key);
  return alias && active.some((d) => d.code === alias.target) ? alias.target : undefined;
}
