import type { ExoCatalogs, RecordData } from "../../../../types/exogena";
import type { ExoAlias, PurchaseIssuer } from "../../../../types/purchases";
import type { Supplier } from "../../../../types/models";
import { buildCatalogIndex } from "../../../exogena/domain/catalogIndex";
import { resolveTerritoryByName } from "../../../exogena/domain/territory";
import { checkThirdPartyData } from "../../../exogena/domain/thirdPartyCheck";
import { COLOMBIA, computeNitDv, DOC_NIT, documentNumber, resolveDocTypeCode, thirdPartyOf } from "../../../exogena/domain/thirdParty";

/**
 * Datos del tercero (proveedor) que reportan 1001, 1005 y 1006. Salen de la ficha del proveedor y, en lo que ella no tenga,
 * de lo que dice la factura. Nunca se inventa: tipo de documento solo se propone para personas jurídicas (NIT), la ubicación
 * solo si se resuelve con certeza en los catálogos y los nombres de una persona natural no se parten a la fuerza.
 */

export interface ThirdFields {
  supplierId: number | null;
  thirdName: string;
  personType: "PJ" | "PN" | null;
  docTypeCode: string;
  docNumber: string;
  dv: string;
  firstSurname: string;
  secondSurname: string;
  firstName: string;
  otherNames: string;
  businessName: string;
  address: string;
  deptCode: string;
  muniCode: string;
  countryCode: string;
}

export interface ResolvedThird {
  fields: ThirdFields;
  /** Qué falta para poder reportarlo (mensajes del formato; vacío = completo). */
  missing: string[];
  /** Denominación del tipo de documento que trae la factura y que no se reconoció (pide un alias en Catálogos Exógena). */
  unknownDocType?: string;
  /** De dónde sale cada grupo de datos. */
  from: { supplier: boolean; invoice: boolean };
}

const pick = (a: string, b: string) => (a.trim() ? a : b);

/** Datos que se pueden proponer solo con la factura. */
export function thirdFromInvoice(nit: string, issuer: Pick<PurchaseIssuer, "name" | "personType" | "address" | "country" | "department" | "city" | "docTypeText">, catalogs: ExoCatalogs | null, aliases: readonly ExoAlias[] = []): ThirdFields {
  const legal = issuer.personType === "PJ";
  const territory = catalogs ? resolveTerritoryByName(catalogs, { country: issuer.country, department: issuer.department, city: issuer.city }, aliases) : { countryCode: "", deptCode: "", muniCode: "" };
  // Persona jurídica: siempre NIT. Persona natural: el tipo que dice la factura, reconocido por nombre oficial o alias persistente.
  const docTypeCode = legal ? DOC_NIT : resolveDocTypeCode(issuer.docTypeText, catalogs?.documentTypes ?? [], aliases) ?? "";
  return {
    supplierId: null,
    thirdName: issuer.name || nit,
    personType: issuer.personType ?? null,
    docTypeCode,
    docNumber: documentNumber(nit, docTypeCode || null),
    dv: legal ? computeNitDv(nit) : "",
    firstSurname: "",
    secondSurname: "",
    firstName: "",
    otherNames: "",
    businessName: legal ? issuer.name : "",
    address: issuer.address ?? "",
    deptCode: territory.countryCode === COLOMBIA ? territory.deptCode : "",
    muniCode: territory.countryCode === COLOMBIA ? territory.muniCode : "",
    countryCode: territory.countryCode,
  };
}

/** Une la ficha del proveedor (manda) con lo que dice la factura (completa lo que falta). */
export function resolveThird(nit: string, issuer: PurchaseIssuer, supplier: Supplier | undefined, catalogs: ExoCatalogs | null, aliases: readonly ExoAlias[] = []): ResolvedThird {
  const invoice = thirdFromInvoice(nit, issuer, catalogs, aliases);
  const unknown = (fields: ThirdFields) => (issuer.docTypeText && !fields.docTypeCode ? { unknownDocType: issuer.docTypeText } : {});
  if (!supplier) return { fields: invoice, missing: missingOf(invoice, catalogs), from: { supplier: false, invoice: true }, ...unknown(invoice) };

  const t = thirdPartyOf(supplier);
  const personType = t.personType ?? invoice.personType;
  const legal = personType === "PJ";
  // La ficha manda. Sin tipo en la ficha: jurídica → NIT; natural → solo lo que la factura diga expresamente (nunca un NIT
  // deducido de que la factura lo trate como jurídica); si no se reconoce, queda vacío y pendiente.
  const fromText = resolveDocTypeCode(issuer.docTypeText, catalogs?.documentTypes ?? [], aliases) ?? "";
  const docTypeCode = t.docTypeCode ?? (legal ? DOC_NIT : fromText);
  const colombia = (t.countryCode || invoice.countryCode) === COLOMBIA;
  const fields: ThirdFields = {
    supplierId: supplier.id,
    thirdName: supplier.businessName || invoice.thirdName,
    personType,
    docTypeCode,
    docNumber: documentNumber(supplier.nit, docTypeCode || null),
    dv: docTypeCode === DOC_NIT ? pick(t.dv, invoice.dv || computeNitDv(supplier.nit)) : "",
    firstSurname: legal ? "" : t.firstSurname,
    secondSurname: legal ? "" : t.secondSurname,
    firstName: legal ? "" : t.firstName,
    otherNames: legal ? "" : t.otherNames,
    businessName: legal ? pick(supplier.businessName, invoice.businessName) : "",
    address: pick(t.address, invoice.address),
    deptCode: colombia ? pick(t.deptCode, invoice.deptCode) : "",
    muniCode: colombia ? pick(t.muniCode, invoice.muniCode) : "",
    countryCode: pick(t.countryCode, invoice.countryCode),
  };
  return { fields, missing: missingOf(fields, catalogs), from: { supplier: true, invoice: true }, ...unknown(fields) };
}

/** Pendientes del tercero con las mismas reglas de los demás formatos (identificación, nombres, dirección y ubicación). */
function missingOf(fields: ThirdFields, catalogs: ExoCatalogs | null): string[] {
  if (!catalogs) return [];
  const data: RecordData = { ...fields };
  return checkThirdPartyData(data, "", "", buildCatalogIndex(catalogs)).map((p) => p.message.replace(/^:\s*/, "").replace(/\.$/, ""));
}

/** Campos del tercero que van en cada registro de 1001, 1005 y 1006. */
export function thirdColumns(f: ThirdFields) {
  return {
    docTypeCode: f.docTypeCode,
    docNumber: f.docNumber,
    dv: f.dv,
    firstSurname: f.firstSurname,
    secondSurname: f.secondSurname,
    firstName: f.firstName,
    otherNames: f.otherNames,
    businessName: f.businessName,
    address: f.address,
    deptCode: f.deptCode,
    muniCode: f.muniCode,
    countryCode: f.countryCode,
  };
}
