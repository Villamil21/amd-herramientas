import type { PdfDocumentText } from "../../../modules/bank-analysis/shared/pdf/pdfTypes";
import type { CatalogIndex } from "../../../modules/exogena/domain/catalogIndex";
import { countryByName, departmentByName, municipalityByName } from "../../../modules/exogena/domain/territory";
import { COLOMBIA, DOC_NIT, splitMunicipalityCode } from "../../../modules/exogena/domain/thirdParty";
import type { ExoCatalogs } from "../../../types/exogena";
import { parseRut, readField } from "./rutParser";

/**
 * Datos de un socio leídos de SU RUT (el formulario de la DIAN). Se procesa en el equipo: nada se envía a ningún servicio.
 *
 * - Persona jurídica: tipo de documento 31, NIT (casillas 5 y 6) y razón social (35).
 * - Persona natural: tipo de documento de la casilla 25 (por su código, por ejemplo 13), número de la casilla 26 y los
 *   apellidos y nombres de las casillas 31 a 34, cada uno en su campo.
 * - Ubicación: país (38), departamento (39) y ciudad/municipio (40), con sus códigos tal como se escriben en las casillas
 *   (ceros iniciales incluidos). Un código de municipio de cinco dígitos («76001») se descompone en departamento + municipio.
 */
export interface ShareholderRutData {
  /** null si el RUT no permite distinguirlo. */
  personType: "PJ" | "PN" | null;
  docTypeCode?: string;
  /** Texto del tipo de documento tal como lo imprime el RUT («Cédula de Ciudadanía»). */
  docTypeText?: string;
  docNumber?: string;
  dv?: string;
  firstSurname?: string;
  secondSurname?: string;
  firstName?: string;
  otherNames?: string;
  businessName?: string;
  address?: string;
  countryCode?: string;
  countryName?: string;
  deptCode?: string;
  deptName?: string;
  muniCode?: string;
  muniName?: string;
  email?: string;
  phone?: string;
  notes: string[];
}

const clean = (v: string | undefined) => v?.replace(/\s+/g, " ").trim() || undefined;
const upper = (v: string | undefined) => clean(v)?.toUpperCase();

export function parseShareholderRut(doc: PdfDocumentText): ShareholderRutData {
  const base = parseRut(doc);
  const first = doc.pages[0]?.items ?? [];
  // Las notas de la lectura de empresa sobre CIIU no aplican a un socio; la razón social y el NIT solo a una persona jurídica.
  const notes = base.notes.filter((n) => !/CIIU/i.test(n) && !/razón social|NIT del RUT/i.test(n));
  const text = (re: RegExp, maxDrop = 20) => clean(readField(first, re, { mode: "text", maxDrop }));
  const digits = (re: RegExp, maxDrop = 20) => readField(first, re, { mode: "digits", maxDrop })?.replace(/\D/g, "") || undefined;

  const firstSurname = upper(text(/^31\.\s*Primer apellido/i));
  const secondSurname = upper(text(/^32\.\s*Segundo apellido/i));
  const firstName = upper(text(/^33\.\s*Primer nombre/i));
  const otherNames = upper(text(/^34\.\s*Otros nombres/i));
  const legalName = upper(text(/^35\.\s*Raz[óo]n social/i));
  const natural = !legalName && !!(firstSurname || firstName);
  const personType: ShareholderRutData["personType"] = legalName ? "PJ" : natural ? "PN" : null;
  if (!personType) notes.push("No se pudo distinguir si el RUT es de persona natural o jurídica.");

  const out: ShareholderRutData = { personType, notes };
  if (personType === "PJ") {
    if (!base.nit) notes.push("No se pudo leer el NIT del RUT.");
    out.docTypeCode = DOC_NIT;
    out.docNumber = base.nit;
    out.dv = base.dv;
    out.businessName = legalName;
  } else if (personType === "PN") {
    out.docTypeText = text(/^25\.\s*Tipo de documento/i);
    out.docTypeCode = digits(/^25\.\s*Tipo de documento/i);
    out.docNumber = digits(/^26\.\s*N[úu]mero de Identificaci/i);
    // Una persona natural con NIT conserva su DV; con cédula el DV de la casilla 6 es el del NIT derivado y no se usa.
    out.dv = out.docTypeCode === DOC_NIT ? base.dv : undefined;
    out.firstSurname = firstSurname;
    out.secondSurname = secondSurname;
    out.firstName = firstName;
    out.otherNames = otherNames;
    if (!out.docTypeCode) notes.push("No se pudo leer el tipo de documento (casilla 25): elígelo a mano.");
    if (!out.docNumber) notes.push("No se pudo leer el número de identificación (casilla 26).");
  }

  out.address = upper(base.direccion);
  out.email = base.correo;
  out.phone = base.telefono;
  out.countryName = text(/^38\.\s*Pa[ií]s/i);
  out.deptName = text(/^39\.\s*Departamento/i);
  out.muniName = text(/^40\.\s*Ciudad\/Municipio/i);
  out.countryCode = digits(/^38\.\s*Pa[ií]s/i)?.padStart(3, "0");
  const deptDigits = digits(/^39\.\s*Departamento/i);
  const muniDigits = digits(/^40\.\s*Ciudad\/Municipio/i);
  if (muniDigits && muniDigits.length === 5) {
    // El código de municipio viene completo («76001»): departamento + municipio.
    const parts = splitMunicipalityCode(muniDigits)!;
    out.muniCode = parts.muniCode;
    out.deptCode = parts.deptCode;
    if (deptDigits && deptDigits.padStart(2, "0") !== parts.deptCode) notes.push(`El departamento (${deptDigits}) no coincide con el código del municipio (${muniDigits}).`);
  } else {
    out.deptCode = deptDigits?.padStart(2, "0");
    out.muniCode = muniDigits?.padStart(3, "0");
  }
  return out;
}

/** País, departamento y municipio resueltos contra los catálogos Exógena (por código y, si faltan, por nombre). */
export interface ResolvedTerritory {
  countryCode: string;
  deptCode: string;
  muniCode: string;
  warnings: string[];
}

export function resolveRutTerritory(data: Pick<ShareholderRutData, "countryCode" | "countryName" | "deptCode" | "deptName" | "muniCode" | "muniName">, catalogs: ExoCatalogs, index: CatalogIndex): ResolvedTerritory {
  const warnings: string[] = [];
  let country = data.countryCode && index.country(data.countryCode) !== undefined ? data.countryCode : "";
  if (!country && data.countryName) country = countryByName(catalogs, data.countryName)?.code ?? "";
  if (!country && (data.countryCode || data.countryName)) warnings.push("El país del RUT no está en el catálogo de Exógena.");
  if (country !== COLOMBIA) return { countryCode: country, deptCode: "", muniCode: "", warnings };

  let dept = data.deptCode && index.department(data.deptCode) !== undefined ? data.deptCode : "";
  if (!dept && data.deptName) dept = departmentByName(catalogs, data.deptName)?.code ?? "";
  if (!dept) warnings.push("El departamento del RUT no está en el catálogo de Exógena.");
  let muni = dept && data.muniCode && index.municipality(dept, data.muniCode) !== undefined ? data.muniCode : "";
  if (!muni && dept && data.muniName) muni = municipalityByName(catalogs, data.muniName, dept)?.code ?? "";
  if (dept && !muni) warnings.push("El municipio del RUT no existe en el departamento indicado del catálogo de Exógena.");
  return { countryCode: country, deptCode: dept, muniCode: muni, warnings };
}
