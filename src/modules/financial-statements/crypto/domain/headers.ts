import { normalizeKey } from "../../../../utils/text";
import type { CryptoKind } from "./types";

/**
 * Encabezados del Excel de Transacciones Cripto. Las columnas se ubican siempre por su nombre (nunca por posición ni por
 * letra), tolerando mayúsculas, tildes, espacios y la errata de origen «Identificación del terro…».
 */

export type PurchaseField =
  | "amount"
  | "docType"
  | "docNumber"
  | "firstName"
  | "otherNames"
  | "firstSurname"
  | "secondSurname"
  | "businessName"
  | "city"
  | "date"
  | "order"
  | "type"
  | "rate"
  | "quantity"
  | "names";

export type SaleField = "docType" | "docNumber" | "dv" | "firstSurname" | "secondSurname" | "firstName" | "otherNames" | "businessName" | "amount";

export type CryptoField = PurchaseField | SaleField;

/** «del tercero / del terro / del ter…  para quien se recibió ingreso» (la errata de origen cortó la palabra). */
const THIRD = String.raw`del ter[a-z]*(?: para quien se recib[a-z]* ingreso)?`;

interface FieldSpec<F extends string> {
  field: F;
  /** Texto legible en la interfaz. */
  label: string;
  pattern: RegExp;
}

const PURCHASE_SPECS: FieldSpec<PurchaseField>[] = [
  { field: "amount", label: "Valor total de la operación", pattern: /^valor total de la operacion$/ },
  { field: "docType", label: "Tipo de documento del tercero", pattern: new RegExp(String.raw`^tipo de documento ${THIRD}$`) },
  // «Identificación del terro…» es la errata del archivo de origen: en pantalla siempre se muestra completa.
  { field: "docNumber", label: "Identificación del tercero", pattern: new RegExp(String.raw`^(?:numero de )?identificacion ${THIRD}$`) },
  { field: "firstName", label: "Primer nombre del tercero", pattern: new RegExp(String.raw`^primer nombre ${THIRD}$`) },
  { field: "otherNames", label: "Otros nombres del tercero", pattern: new RegExp(String.raw`^otros nombres ${THIRD}$`) },
  { field: "firstSurname", label: "Primer apellido del tercero", pattern: new RegExp(String.raw`^primer apellido ${THIRD}$`) },
  { field: "secondSurname", label: "Segundo apellido del tercero", pattern: new RegExp(String.raw`^segundo apellido ${THIRD}$`) },
  { field: "businessName", label: "Razón social del tercero", pattern: new RegExp(String.raw`^razon social ${THIRD}$`) },
  { field: "city", label: "Código mcp (ciudad)", pattern: /^codigo mcp$/ },
  { field: "date", label: "Fecha", pattern: /^fecha$/ },
  { field: "order", label: "Orden", pattern: /^orden$/ },
  { field: "type", label: "Tipo", pattern: /^tipo$/ },
  { field: "rate", label: "Tasa", pattern: /^tasa$/ },
  { field: "quantity", label: "Cantidad", pattern: /^cantidad$/ },
  { field: "names", label: "Nombres", pattern: /^nombres$/ },
];

const SALE_PERSON = String.raw`de quien se recibe ingreso`;
const SALE_SPECS: FieldSpec<SaleField>[] = [
  { field: "docType", label: "Tipo de documento de quien se recibe ingreso", pattern: new RegExp(String.raw`^tipo de documento ${SALE_PERSON}$`) },
  { field: "docNumber", label: "Número identificación de quien se recibe ingreso", pattern: new RegExp(String.raw`^(?:numero (?:de )?)?identificacion ${SALE_PERSON}$`) },
  { field: "dv", label: "DV", pattern: /^dv$/ },
  { field: "firstSurname", label: "Primer apellido de quien se recibe ingreso", pattern: new RegExp(String.raw`^primer apellido ${SALE_PERSON}$`) },
  { field: "secondSurname", label: "Segundo apellido de quien se recibe ingreso", pattern: new RegExp(String.raw`^segundo apellido ${SALE_PERSON}$`) },
  { field: "firstName", label: "Primer nombre de quien se recibe ingreso", pattern: new RegExp(String.raw`^primer nombre ${SALE_PERSON}$`) },
  { field: "otherNames", label: "Otros nombres de quien se recibe ingreso", pattern: new RegExp(String.raw`^otros nombres ${SALE_PERSON}$`) },
  { field: "businessName", label: "Razón social de quien se recibe ingreso", pattern: new RegExp(String.raw`^razon social ${SALE_PERSON}$`) },
  { field: "amount", label: "Ingresos brutos recibidos", pattern: /^ingresos brutos recibidos$/ },
];

const SPECS = { purchase: PURCHASE_SPECS, sale: SALE_SPECS } as const;

/** Encabezado normalizado: minúsculas, sin tildes, sin signos ni espacios dobles. */
export const headerKey = (header: string) => normalizeKey(header).replace(/[.:;,]/g, "").replace(/\s+/g, " ").trim();

/** Qué campo es un encabezado de la hoja (undefined = columna ajena al contrato; se conserva como dato de auditoría). */
export function fieldOfHeader(kind: CryptoKind, header: string): CryptoField | undefined {
  const key = headerKey(header);
  return (SPECS[kind] as readonly FieldSpec<CryptoField>[]).find((s) => s.pattern.test(key))?.field;
}

/** Columnas sin las cuales la hoja no se puede usar (se explican al usuario). */
export const REQUIRED_FIELDS: Record<CryptoKind, CryptoField[]> = { purchase: ["amount", "date"], sale: ["amount"] };

export const fieldLabel = (kind: CryptoKind, field: CryptoField): string => (SPECS[kind] as readonly FieldSpec<CryptoField>[]).find((s) => s.field === field)?.label ?? field;

/** Nombres de hoja del contrato (sin importar mayúsculas ni espacios). */
export const SHEET_NAMES: Record<CryptoKind, string> = { purchase: "Compras", sale: "Ventas" };
export const kindOfSheet = (name: string): CryptoKind | undefined => {
  const key = normalizeKey(name);
  return key === "compras" ? "purchase" : key === "ventas" ? "sale" : undefined;
};
