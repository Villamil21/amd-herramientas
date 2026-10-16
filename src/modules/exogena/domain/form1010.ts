import type { Company, Shareholder } from "../../../types/models";
import type { ExoRecord, RecordData, SyncProposal } from "../../../types/exogena";
import { allocateCapital, subscribedCapitalPesos } from "./capital";
import type { CatalogIndex } from "./catalogIndex";
import { isValidPercentage, percentageHundredths, splitPercentage } from "./numbers";
import type { Problem } from "./problems";
import { COLOMBIA, DOC_NIT, docTypeFromPrefix, documentNumber, parseIdentityDocument, thirdPartyOf } from "./thirdParty";
import { checkThirdPartyData } from "./thirdPartyCheck";

/**
 * Formato 1010 — Información de socios, accionistas, comuneros y/o cooperados.
 *
 * La fuente es Empresas (socios y capital suscrito); en Exógena los campos se pueden corregir conservando origen y
 * marca de corrección. Prima en colocación: siempre 0 en esta fase.
 */

export const FORMAT_1010 = "1010";

/** Datos de un registro 1010 (las 16 columnas del formato más lo que ayuda a revisarlo). */
export interface Data1010 extends RecordData {
  shareholderId: number | null;
  shareholderName: string;
  personType: "PJ" | "PN" | null;
  rutStatus: string;
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
  /** Capital suscrito asignado a este socio a 31 de diciembre (pesos enteros); null si la empresa no tiene capital configurado. */
  nominalValue: number | null;
  premium: number;
  /** Participación exacta (50,20) y sus dos columnas. */
  percentage: number;
  pctInteger: number;
  pctDecimal: number;
}

/** Cómo sale un socio hacia el formato, según sea persona jurídica o natural. */
export function shareholderRow(s: Shareholder, nominalValue: number | null): Data1010 {
  const t = thirdPartyOf(s);
  const isLegal = t.personType === "PJ";
  const identity = parseIdentityDocument(s.identityDocument);
  // Persona jurídica: siempre NIT (31). Natural: el tipo del RUT / ficha; en un socio anterior a la ficha, el del prefijo («CC» → 13).
  const docTypeCode = isLegal ? "31" : (t.docTypeCode ?? docTypeFromPrefix(identity.prefix) ?? "");
  const docNumber = documentNumber(identity.number, docTypeCode || null);
  const { integer, decimal } = splitPercentage(s.percentage);
  const colombia = t.countryCode === COLOMBIA;
  return {
    shareholderId: s.id ?? null,
    shareholderName: s.name,
    personType: t.personType,
    rutStatus: s.rutStatus ?? "pendiente",
    docTypeCode,
    docNumber,
    dv: docTypeCode === DOC_NIT ? t.dv : "",
    firstSurname: isLegal ? "" : t.firstSurname,
    secondSurname: isLegal ? "" : t.secondSurname,
    firstName: isLegal ? "" : t.firstName,
    otherNames: isLegal ? "" : t.otherNames,
    businessName: isLegal ? s.name : "",
    address: t.address,
    deptCode: colombia ? t.deptCode : "",
    muniCode: colombia ? t.muniCode : "",
    countryCode: t.countryCode,
    nominalValue,
    premium: 0,
    percentage: s.percentage,
    pctInteger: integer,
    pctDecimal: decimal,
  };
}

export const sourceKey1010 = (shareholderId: number) => `shareholder:${shareholderId}`;

/**
 * Propuestas desde Empresas: un registro por socio con el capital suscrito asignado (reparto determinista, la suma
 * coincide con el capital). Los socios sin ficha guardada (sin id) no se proponen: primero se guarda la empresa.
 */
export function buildProposals1010(company: Company): SyncProposal[] {
  const shareholders = company.shareholders.filter((s) => s.id !== undefined);
  const capital = subscribedCapitalPesos(company);
  const allocation = capital === null ? null : allocateCapital(capital, shareholders);
  return shareholders.map((s, i) => ({
    sourceKey: sourceKey1010(s.id!),
    origin: "empresas",
    originRef: `Empresas · socio ${s.name}`,
    data: shareholderRow(s, allocation ? allocation[i] : null),
  }));
}

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Pendientes de un registro 1010 con sus datos finales (incluidas las correcciones manuales). */
export function checkRecord1010(record: Pick<ExoRecord, "sourceKey" | "data">, catalog: CatalogIndex): Problem[] {
  const d = record.data as Partial<Data1010>;
  const name = text(d.shareholderName) || record.sourceKey;
  const out: Problem[] = [];
  const bad = (message: string, field?: string): void => void out.push({ level: "blocking", message: `${name}: ${message}`, recordKey: record.sourceKey, field });

  out.push(...checkThirdPartyData(d, name, record.sourceKey, catalog));

  const pct = typeof d.percentage === "number" ? d.percentage : NaN;
  if (!isValidPercentage(pct)) bad("el porcentaje de participación no es válido (máximo dos decimales).", "percentage");
  else {
    const split = splitPercentage(pct);
    if (d.pctInteger !== split.integer || d.pctDecimal !== split.decimal) bad("las columnas de porcentaje no coinciden con la participación.", "pctInteger");
  }
  if (d.nominalValue === null || d.nominalValue === undefined) bad("falta el capital suscrito de la empresa (en Empresas) para asignar el valor nominal.", "nominalValue");
  else if (!Number.isSafeInteger(d.nominalValue) || d.nominalValue < 0) bad("el valor nominal debe ser un entero de pesos.", "nominalValue");
  if (d.premium !== 0) bad("la prima en colocación debe ser 0 en esta fase.", "premium");
  if (d.rutStatus === "revisar") bad("el RUT del socio tiene diferencias por resolver (en Empresas).", "rutStatus");
  return out;
}

/** Pendientes de todo el formato: cada registro más las reglas del conjunto. */
export function check1010(records: Pick<ExoRecord, "sourceKey" | "data">[], company: Company, catalog: CatalogIndex): Problem[] {
  const out: Problem[] = [];
  if (records.length === 0) {
    out.push({ level: "blocking", message: "No hay socios en el formato. Sincroniza desde Empresas o marca el formato como «No aplica»." });
    return out;
  }
  for (const r of records) out.push(...checkRecord1010(r, catalog));
  const total = records.reduce((n, r) => n + percentageHundredths(typeof r.data.percentage === "number" ? r.data.percentage : 0), 0);
  if (total !== 10000) out.push({ level: "blocking", message: `La participación de los socios suma ${(total / 100).toLocaleString("es-CO", { minimumFractionDigits: 2 })} %, debe sumar 100,00 %.` });
  const capital = subscribedCapitalPesos(company);
  if (capital !== null) {
    const assigned = records.reduce((n, r) => n + (typeof r.data.nominalValue === "number" ? r.data.nominalValue : 0), 0);
    if (assigned !== capital) out.push({ level: "blocking", message: "El valor nominal asignado a los socios no coincide con el capital suscrito de la empresa." });
  }
  return out;
}

export { pendingChanges, type PendingChange } from "./pending";
