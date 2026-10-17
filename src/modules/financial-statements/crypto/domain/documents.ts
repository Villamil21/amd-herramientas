import { computeNitDv } from "../../../exogena/domain/thirdParty";

/**
 * Terceros de las operaciones: tipo de documento (homologado a código DIAN), número limpio, DV y país.
 * Nada se supone: un tipo desconocido queda pendiente de clasificar hasta que el usuario lo homologa una vez.
 */

export const DOC_NIT = "31";
export const COLOMBIA = "169";

/** Equivalencias iniciales Excel → código DIAN. Las que el usuario clasifica después se guardan aparte (por valor original). */
export const DEFAULT_DOCUMENT_TYPES: Readonly<Record<string, string>> = { CC: "13", CE: "22", NIT: "31", PA: "41", PPT: "42", PT: "42" };

/** Tipos DIAN cuyo país de residencia o domicilio es Colombia (169); con cualquier otro tipo el país se confirma a mano. */
export const COLOMBIA_BY_DOCUMENT: readonly string[] = ["11", "12", "13", "14", "15", "31"];

/** Tipos cuyo número puede llevar letras (pasaportes y documentos extranjeros). */
const ALPHANUMERIC_TYPES = ["33", "41", "42", "43", "44", "46", "47"];

/** Clave del valor original de un tipo de documento: «C.C.» = «cc» = «CC». */
export const documentTypeKey = (raw: string | undefined | null): string =>
  (raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

export interface DocumentLookup {
  /** Homologaciones guardadas por el usuario (clave normalizada → código DIAN). */
  stored: ReadonlyMap<string, string>;
  /** Códigos DIAN del catálogo de Exógena: un valor que ya es un código válido se acepta tal cual. */
  catalogCodes?: ReadonlySet<string>;
}

export interface ResolvedDocumentType {
  /** Código DIAN, o null si hay que clasificarlo. */
  code: string | null;
  /** Clave normalizada del valor original (con ella se guarda la homologación). */
  key: string;
  /** Valor tal como llegó. */
  raw: string;
}

export function resolveDocumentType(raw: string | undefined | null, lookup: DocumentLookup): ResolvedDocumentType {
  const value = (raw ?? "").trim();
  const key = documentTypeKey(value);
  if (!key) return { code: null, key, raw: value };
  const code = lookup.stored.get(key) ?? DEFAULT_DOCUMENT_TYPES[key] ?? (/^\d{2}$/.test(key) && lookup.catalogCodes?.has(key) ? key : null);
  return { code, key, raw: value };
}

/** Número de identificación limpio: sin espacios, puntos, comas, letras ni guiones (salvo documentos que admiten letras). */
export function cleanDocumentNumber(raw: string | undefined | null, docCode: string | null): { number: string; sourceDv: string } {
  const value = (raw ?? "").trim();
  if (!value) return { number: "", sourceDv: "" };
  if (docCode === DOC_NIT) {
    // «900642307-5»: el guion separa el DV de origen; quitarlo sin más pegaría el DV al NIT.
    const withDv = /^([\d.,\s]+?)\s*-\s*(\d)$/.exec(value);
    if (withDv) return { number: withDv[1].replace(/\D/g, ""), sourceDv: withDv[2] };
    return { number: value.replace(/\D/g, ""), sourceDv: "" };
  }
  if (docCode && ALPHANUMERIC_TYPES.includes(docCode)) return { number: value.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase(), sourceDv: "" };
  if (docCode === null) return { number: value.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase(), sourceDv: "" };
  return { number: value.replace(/\D/g, ""), sourceDv: "" };
}

/** DV colombiano del NIT: lo calcula el sistema; el de la fuente solo se conserva como dato de auditoría. */
export const nitDv = (number: string): string => computeNitDv(number);

/** El DV que se exporta: calculado para NIT (tipo 31); otro tipo no lleva DV. */
export const exportedDv = (docCode: string | null, number: string): string => (docCode === DOC_NIT ? nitDv(number) : "");

/** País sugerido por el tipo de documento; undefined = hay que confirmarlo manualmente. */
export const countryByDocument = (docCode: string | null): string | undefined => (docCode && COLOMBIA_BY_DOCUMENT.includes(docCode) ? COLOMBIA : undefined);

/** Identidad de un tercero: tipo DIAN + número limpio. */
export const thirdKey = (docCode: string, number: string) => `${docCode}|${number}`;

/** Texto comparable: mayúsculas, sin tildes ni signos, espacios colapsados. */
export const compareText = (value: string | undefined | null): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

export interface NameParts {
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
  businessName: string;
}

/** Nombre para comparar y mostrar: razón social o apellidos + nombres. */
export function displayName(n: NameParts): string {
  return n.businessName.trim() || [n.firstSurname, n.secondSurname, n.firstName, n.otherNames].map((x) => x.trim()).filter(Boolean).join(" ");
}
