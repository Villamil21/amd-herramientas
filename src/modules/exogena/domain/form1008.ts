import { taxEffects, type TaxInput, type TaxTrace } from "../../financial-statements/tax-obligations/services/effects";
import type { Company, Supplier } from "../../../types/models";
import type { ExoRecord, RecordData, SyncProposal } from "../../../types/exogena";
import { capitalSummary } from "../../../pages/companies/capitalSummary";
import { allocateCapital } from "./capital";
import type { CatalogIndex } from "./catalogIndex";
import { DIAN_NIT, thirdPartyFields } from "./form1009";
import { shareholderRow } from "./form1010";
import type { Problem } from "./problems";
import { checkThirdPartyData } from "./thirdPartyCheck";
import { nitDigits } from "./text";

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

/** Concepto para el saldo a favor de la DIAN (IVA y Renta): «Otras cuentas por cobrar». El anticipo de renta nunca se propone. */
export const CONCEPT_DIAN = "1317";
export const DESCRIPTION_DIAN = "Otras cuentas por cobrar";
export const sourceKeyDian1008 = `dian-cxc:${DIAN_NIT}`;

export interface Data1008 extends RecordData {
  /** Saldos a favor de IVA / Renta de los que sale el valor (impuesto, periodo, formulario, valor, corte). */
  taxTrace?: TaxTrace[];
  supplierId?: number | null;
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

/**
 * Saldos a favor de IVA y Renta vigentes al 31/12 → un registro a nombre de la DIAN (1317). Un solo registro por empresa y año:
 * volver a sincronizar lo actualiza, nunca lo duplica. Sin saldo a favor no hay propuesta. El anticipo de renta nunca entra.
 * Los datos del tercero salen de la ficha de proveedores (sin inventar DV, dirección ni ubicación).
 */
export function buildTaxProposals1008(src: { tax: TaxInput; year: number; suppliers: Supplier[]; /** El registro DIAN tiene el saldo editado a mano: se sigue proponiendo (en $0 si ya no hay saldos) para que su desglose se actualice sin tocar el valor editado. */ keepManualDian?: boolean }): { proposals: SyncProposal[]; issues: Problem[] } {
  const effects = taxEffects(src.tax, `${src.year}-12-31`);
  const issues: Problem[] = effects.issues
    .filter((i) => i.level === "blocking" && i.taxType !== "capital")
    .map((i) => ({ level: "blocking" as const, message: i.message, action: { label: "Obligaciones tributarias", path: "/herramientas/estados-financieros/obligaciones-tributarias" } }));
  const favors = effects.effects.filter((e) => (e.kind === "vat_favor" || e.kind === "income_favor" || e.kind === "excess_favor") && e.pucCode && e.trace);
  const cents = favors.reduce((n, e) => n + e.cents, 0);
  if (cents <= 0 && !src.keepManualDian) return { proposals: [], issues };
  const supplier = src.suppliers.find((s) => nitDigits(s.nit) === DIAN_NIT);
  const base = thirdPartyFields(DIAN_NIT, "DIAN", supplier);
  const traces = favors.map((e) => e.trace!).sort((a, b) => a.returnId - b.returnId);
  const data: Data1008 = {
    ...base,
    shareholderId: null,
    shareholderName: "",
    concept: CONCEPT_DIAN,
    conceptDescription: DESCRIPTION_DIAN,
    taxTrace: traces,
    balance: Math.round(Math.max(0, cents) / 100),
  };
  const ref = favors.length ? favors.map((e) => e.label).join(" · ") : "sin saldos a favor";
  return { proposals: [{ sourceKey: sourceKeyDian1008, origin: "estados_financieros", originRef: `Obligaciones tributarias · ${ref}`, data }], issues };
}

export type RowOrigin1008 = "Calculado desde capital" | "Calculado desde obligaciones tributarias" | "Manual" | "Modificado manualmente";

export function rowOrigin1008(r: Pick<ExoRecord, "origin" | "manualFields"> & { sourceKey?: string }): RowOrigin1008 {
  if (r.origin === "manual") return "Manual";
  if (r.manualFields.length > 0) return "Modificado manualmente";
  return r.sourceKey?.startsWith("dian-cxc:") ? "Calculado desde obligaciones tributarias" : "Calculado desde capital";
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
  for (const r of records) {
    out.push(...checkRecord1008(r, catalog, concepts));
    if (r.sourceKey === sourceKeyDian1008 && (r.data.supplierId === null || r.data.supplierId === undefined))
      out.push({ level: "blocking", message: `Falta el proveedor DIAN (NIT ${DIAN_NIT}): créalo o búscalo en Proveedores para completar sus datos.`, recordKey: r.sourceKey, field: "supplierId", action: { label: "Crear o buscar proveedor DIAN", path: `/proveedores/${DIAN_NIT}` } });
  }
  if (rec.difference !== 0) out.push({ level: "blocking", message: `La CxC a socios en Empresas (${rec.companyReceivable ?? 0}) no coincide con el total 1008 del concepto ${CONCEPT_SOCIOS} (${rec.total}); diferencia ${rec.difference}.` });
  return out;
}

/**
 * Saldos editados a mano que difieren de lo que calculan las fuentes (si la fuente ya no propone el registro, el cálculo es $0).
 * Son pendientes bloqueantes: el formato no puede quedar «listo» ni exportarse hasta revisarlos o restaurar el cálculo.
 */
export function manualBalanceProblems(records: Pick<ExoRecord, "sourceKey" | "origin" | "manualFields" | "data">[], proposals: Pick<SyncProposal, "sourceKey" | "data">[]): Problem[] {
  const out: Problem[] = [];
  for (const r of records) {
    if (r.origin === "manual" || !r.manualFields.includes("balance")) continue;
    const calculated = proposals.find((p) => p.sourceKey === r.sourceKey)?.data.balance ?? 0;
    if (r.data.balance !== calculated)
      out.push({ level: "blocking", message: `${text(r.data.businessName) || text(r.data.shareholderName) || r.sourceKey}: el saldo editado a mano (${r.data.balance}) difiere del calculado por las fuentes (${calculated}). Revísalo o restaura el cálculo.`, recordKey: r.sourceKey, field: "balance", code: "manual_balance" });
  }
  return out;
}
