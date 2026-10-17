import { compareText, displayName, exportedDv, type NameParts } from "./documents";
import type { Operation } from "./operations";

/** Relleno de una columna que no aplica (nunca se deja una celda vacía en un formato exportable). */
export const NOT_APPLICABLE = "No aplica";
/** Dato obligatorio que no se pudo determinar: bloquea la exportación hasta que el usuario lo complete. */
export const PENDING = "Pendiente de completar";

export const isPending = (v: unknown) => v === PENDING;

export interface PartyFields {
  docTypeCode: string;
  docNumber: string;
  dv: string;
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
  businessName: string;
}

export interface Party {
  fields: PartyFields;
  /** Lo que falta para poder informar al tercero (vacío = completo). */
  missing: string[];
}

const firstNonEmpty = (ops: readonly Operation[], pick: (n: NameParts) => string): string => {
  for (const o of ops) {
    const v = pick(o.names).trim();
    if (v) return v;
  }
  return "";
};

/**
 * Datos de un tercero a partir de sus operaciones. Persona jurídica = razón social; persona natural = apellidos y nombres.
 * Lo que no aplica se rellena con «No aplica»; lo obligatorio que falta queda «Pendiente de completar».
 */
export function partyOf(ops: readonly Operation[], docCode: string, docNumber: string): Party {
  const names: NameParts = {
    firstSurname: firstNonEmpty(ops, (n) => n.firstSurname),
    secondSurname: firstNonEmpty(ops, (n) => n.secondSurname),
    firstName: firstNonEmpty(ops, (n) => n.firstName),
    otherNames: firstNonEmpty(ops, (n) => n.otherNames),
    businessName: firstNonEmpty(ops, (n) => n.businessName),
  };
  const missing: string[] = [];
  const hasPerson = Boolean(names.firstSurname && names.firstName);
  const hasBusiness = Boolean(names.businessName);
  if (!hasPerson && !hasBusiness) missing.push("el nombre (apellidos y nombres) o la razón social");
  const fields: PartyFields = {
    docTypeCode: docCode,
    docNumber,
    dv: docCode === "31" ? exportedDv(docCode, docNumber) : NOT_APPLICABLE,
    firstSurname: hasPerson ? names.firstSurname : hasBusiness ? NOT_APPLICABLE : PENDING,
    secondSurname: hasPerson ? names.secondSurname || NOT_APPLICABLE : NOT_APPLICABLE,
    firstName: hasPerson ? names.firstName : hasBusiness ? NOT_APPLICABLE : PENDING,
    otherNames: hasPerson ? names.otherNames || NOT_APPLICABLE : NOT_APPLICABLE,
    businessName: hasBusiness ? names.businessName : hasPerson ? NOT_APPLICABLE : PENDING,
  };
  if (docCode === "31" && !fields.dv) missing.push("el dígito de verificación (el número de NIT no es válido)");
  return { fields, missing };
}

/** Nombre para listas y mensajes. */
export const partyName = (ops: readonly Operation[]): string => {
  const first = ops[0];
  if (!first) return "";
  return displayName({
    firstSurname: firstNonEmpty(ops, (n) => n.firstSurname),
    secondSurname: firstNonEmpty(ops, (n) => n.secondSurname),
    firstName: firstNonEmpty(ops, (n) => n.firstName),
    otherNames: firstNonEmpty(ops, (n) => n.otherNames),
    businessName: firstNonEmpty(ops, (n) => n.businessName),
  });
};

export const sameName = (a: string, b: string) => compareText(a) === compareText(b);
