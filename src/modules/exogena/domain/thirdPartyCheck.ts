import type { RecordData } from "../../../types/exogena";
import type { CatalogIndex } from "./catalogIndex";
import type { Problem } from "./problems";
import { COLOMBIA, DOC_NIT } from "./thirdParty";

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * Pendientes de los datos del tercero de un registro (formatos 1010 y 1009): identificación, nombres o razón social según el
 * tipo de persona, dirección y ubicación validada contra los catálogos Exógena.
 *
 * Los campos son los del registro: `personType`, `docTypeCode`, `docNumber`, `dv`, apellidos y nombres, `businessName`,
 * `address`, `countryCode`, `deptCode`, `muniCode`.
 */
export function checkThirdPartyData(d: RecordData, label: string, recordKey: string, catalog: CatalogIndex): Problem[] {
  const out: Problem[] = [];
  const bad = (message: string, field: string) => out.push({ level: "blocking", message: `${label}: ${message}`, recordKey, field });

  const person = (d.personType as string | null | undefined) ?? null;
  const doc = text(d.docTypeCode);
  if (!person) bad("define si es persona natural o jurídica.", "personType");
  if (!doc) bad("falta el tipo de documento.", "docTypeCode");
  else if (catalog.docType(doc) === undefined) bad(`el tipo de documento ${doc} no está en el catálogo.`, "docTypeCode");
  if (person === "PJ" && doc && doc !== DOC_NIT) bad("una persona jurídica debe tener tipo de documento 31 (NIT).", "docTypeCode");
  if (!text(d.docNumber)) bad("falta el número de identificación.", "docNumber");
  if (doc === DOC_NIT && !text(d.dv)) bad("falta el DV del NIT.", "dv");
  if (doc && doc !== DOC_NIT && text(d.dv)) bad("solo el NIT lleva DV.", "dv");

  if (person === "PJ") {
    if (!text(d.businessName).trim()) bad("falta la razón social.", "businessName");
    if (text(d.firstSurname) || text(d.secondSurname) || text(d.firstName) || text(d.otherNames)) bad("una persona jurídica no lleva apellidos ni nombres.", "firstName");
  } else if (person === "PN") {
    if (!text(d.firstSurname).trim()) bad("falta el primer apellido.", "firstSurname");
    if (!text(d.firstName).trim()) bad("falta el primer nombre.", "firstName");
    if (text(d.businessName).trim()) bad("una persona natural no lleva razón social.", "businessName");
  }

  if (!text(d.address).trim()) bad("falta la dirección.", "address");
  const country = text(d.countryCode);
  if (!country) bad("falta el país de residencia o domicilio.", "countryCode");
  else if (catalog.country(country) === undefined) bad(`el país ${country} no está en el catálogo.`, "countryCode");
  if (country === COLOMBIA) {
    const dept = text(d.deptCode);
    const muni = text(d.muniCode);
    if (!dept) bad("falta el departamento.", "deptCode");
    else if (catalog.department(dept) === undefined) bad(`el departamento ${dept} no está en el catálogo.`, "deptCode");
    if (!muni) bad("falta el municipio.", "muniCode");
    else if (dept && catalog.department(dept) !== undefined && catalog.municipality(dept, muni) === undefined) bad(`el municipio ${dept}${muni} no existe en el catálogo.`, "muniCode");
  }
  return out;
}
