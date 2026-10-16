import type { Company } from "../../../types/models";
import type { ExoRecord, RecordData, SyncProposal } from "../../../types/exogena";
import { capitalSummary } from "../../../pages/companies/capitalSummary";
import { allocateCapital } from "./capital";
import type { CatalogIndex } from "./catalogIndex";
import { shareholderRow } from "./form1010";
import type { Problem } from "./problems";
import { checkThirdPartyData } from "./thirdPartyCheck";

/**
 * Formato 1008 — Saldo de cuentas por cobrar al 31 de diciembre.
 *
 * Primera versión: el origen automático es solo la CxC a socios (capital suscrito − capital pagado), repartida entre los socios
 * por su participación (reparto determinista; la suma de las filas es exactamente la CxC). El concepto sugerido es 1316 y siempre
 * se puede cambiar. Empresas guarda los hechos; aquí se crean los registros, sus conceptos y las correcciones.
 */

export const FORMAT_1008 = "1008";
/** Concepto sugerido para la CxC a socios (no 1317). */
export const CONCEPT_SOCIOS = "1316";
export const DESCRIPTION_SOCIOS = "Saldo de las cuentas por cobrar a accionistas, socios, comuneros, cooperados y compañías vinculadas";

/** Conceptos oficiales de fábrica del 1008 (la migración los siembra; los de usuario se administran por formato). */
export const SYSTEM_CONCEPTS_1008 = [
  { code: "1315", description: "Saldo de las cuentas por cobrar a clientes" },
  { code: CONCEPT_SOCIOS, description: DESCRIPTION_SOCIOS },
  { code: "1317", description: "Otras cuentas por cobrar" },
  { code: "1318", description: "Valor total del saldo fiscal del deterioro de cartera, identificándolo con el NIT del deudor" },
];

export interface Data1008 extends RecordData {
  shareholderId: number | null;
  shareholderName: string;
  personType: "PJ" | "PN" | null;
  concept: string;
  /** Descripción del concepto al crear la fila: se conserva aunque el concepto se desactive o cambie. */
  conceptDescription: string;
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
  /** Saldo en pesos enteros. */
  balance: number;
}

export const sourceKey1008 = (shareholderId: number) => `socio-cxc:${shareholderId}`;

/** Cuentas por cobrar a socios que informa Empresas (suscrito − pagado); null si no hay capital suscrito. */
export const receivableFromSocios = (company: Pick<Company, "subscribedTotalShares" | "subscribedNominalValue" | "paidTotalShares" | "paidNominalValue">): number | null => capitalSummary(company).receivable;

/** Una propuesta por socio con su parte de la CxC. Sin CxC (cero, negativa o sin capital) no se propone nada. */
export function buildProposals1008(company: Company): SyncProposal[] {
  const receivable = receivableFromSocios(company);
  const shareholders = company.shareholders.filter((s) => s.id !== undefined);
  if (receivable === null || receivable <= 0 || shareholders.length === 0) return [];
  const parts = allocateCapital(receivable, shareholders);
  return shareholders.map((s, i) => {
    const base = shareholderRow(s, null);
    const data: Data1008 = {
      shareholderId: base.shareholderId,
      shareholderName: base.shareholderName,
      personType: base.personType,
      concept: CONCEPT_SOCIOS,
      conceptDescription: DESCRIPTION_SOCIOS,
      docTypeCode: base.docTypeCode,
      docNumber: base.docNumber,
      dv: base.dv,
      firstSurname: base.firstSurname,
      secondSurname: base.secondSurname,
      firstName: base.firstName,
      otherNames: base.otherNames,
      businessName: base.businessName,
      address: base.address,
      deptCode: base.deptCode,
      muniCode: base.muniCode,
      countryCode: base.countryCode,
      balance: parts[i],
    };
    return { sourceKey: sourceKey1008(s.id!), origin: "empresas", originRef: `Empresas · CxC a socios · ${s.name}`, data };
  });
}

export type RowOrigin1008 = "Calculado desde capital" | "Manual" | "Modificado manualmente";

export function rowOrigin1008(r: Pick<ExoRecord, "origin" | "manualFields">): RowOrigin1008 {
  if (r.origin === "manual") return "Manual";
  return r.manualFields.length > 0 ? "Modificado manualmente" : "Calculado desde capital";
}

export interface ConceptOption {
  code: string;
  description: string;
  isActive: boolean;
}

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function checkRecord1008(record: Pick<ExoRecord, "sourceKey" | "data">, catalog: CatalogIndex, concepts: ConceptOption[]): Problem[] {
  const d = record.data as Partial<Data1008>;
  const name = text(d.shareholderName) || text(d.businessName) || [d.firstName, d.firstSurname].filter(Boolean).join(" ") || record.sourceKey;
  const out: Problem[] = [];
  const bad = (message: string, field?: string) => void out.push({ level: "blocking", message: `${name}: ${message}`, recordKey: record.sourceKey, field });
  const concept = text(d.concept);
  if (!concept) bad("falta el concepto.", "concept");
  else if (!concepts.some((c) => c.code === concept)) bad(`el concepto ${concept} no existe en los conceptos del formato 1008; créalo en «Administrar conceptos».`, "concept");
  out.push(...checkThirdPartyData(d, name, record.sourceKey, catalog));
  if (typeof d.balance !== "number" || !Number.isSafeInteger(d.balance)) bad("el saldo debe ser un entero de pesos.", "balance");
  else if (d.balance < 0) bad("el saldo no puede ser negativo.", "balance");
  return out;
}

export interface Reconciliation1008 {
  /** CxC a socios según Empresas (suscrito − pagado); null si la empresa no tiene capital suscrito. */
  companyReceivable: number | null;
  /** Total de las filas con el concepto de CxC a socios. */
  total: number;
  /** Total de todas las filas (incluye otros conceptos manuales). */
  grandTotal: number;
  /** companyReceivable − total (0 si coinciden). */
  difference: number;
}

export function reconcile1008(records: Pick<ExoRecord, "data">[], company: Pick<Company, "subscribedTotalShares" | "subscribedNominalValue" | "paidTotalShares" | "paidNominalValue">): Reconciliation1008 {
  const balanceOf = (r: Pick<ExoRecord, "data">) => (typeof r.data.balance === "number" ? r.data.balance : 0);
  const total = records.filter((r) => text(r.data.concept) === CONCEPT_SOCIOS).reduce((n, r) => n + balanceOf(r), 0);
  const grandTotal = records.reduce((n, r) => n + balanceOf(r), 0);
  const companyReceivable = receivableFromSocios(company);
  return { companyReceivable, total, grandTotal, difference: (companyReceivable !== null && companyReceivable > 0 ? companyReceivable : 0) - total };
}

export function check1008(records: Pick<ExoRecord, "sourceKey" | "data">[], company: Company, catalog: CatalogIndex, concepts: ConceptOption[]): Problem[] {
  const out: Problem[] = [];
  const rec = reconcile1008(records, company);
  if (records.length === 0) {
    out.push({ level: "blocking", message: rec.companyReceivable && rec.companyReceivable > 0 ? "No hay registros en el formato. Sincroniza desde Empresas o marca el formato como «No aplica»." : "La empresa no tiene cuentas por cobrar a socios. Marca el formato como «No aplica» (con el motivo) o agrega registros manuales." });
    return out;
  }
  for (const r of records) out.push(...checkRecord1008(r, catalog, concepts));
  if (rec.difference !== 0) out.push({ level: "blocking", message: `La CxC a socios en Empresas (${rec.companyReceivable ?? 0}) no coincide con el total 1008 del concepto ${CONCEPT_SOCIOS} (${rec.total}); diferencia ${rec.difference}.` });
  return out;
}
