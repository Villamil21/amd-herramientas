import type { CompanyVatEntry, ExemptCleanup, SupplierFiscalEntry } from "../../../../types/purchases";
import { EXCLUDED_CODES, excludedCode, fiscalCodes, regimeKey } from "../../../taxes/withholding/services/fiscal";

/**
 * Historiales con fecha efectiva. Un cambio rige desde su fecha y NUNCA recalcula períodos anteriores: cada factura usa lo que
 * estaba vigente en su fecha de expedición.
 */

/** Entrada vigente en una fecha: la última cuya fecha efectiva es anterior o igual. */
function effectiveAt<T extends { effectiveDate: string }>(entries: readonly T[], date: string): T | undefined {
  let found: T | undefined;
  for (const e of entries) if (e.effectiveDate <= date && (!found || e.effectiveDate >= found.effectiveDate)) found = e;
  return found;
}

/**
 * ¿La empresa era responsable de IVA (responsabilidad 48) en esa fecha? `undefined` = no se sabe (sin historial vigente): jamás
 * se supone, el dato debe capturarse en Empresas.
 */
export function vatResponsibleAt(history: readonly CompanyVatEntry[], date: string | null | undefined): boolean | undefined {
  if (!date) return undefined;
  return effectiveAt(history, date)?.responsible;
}

export interface VatYearCoverage {
  /** Hay historial para todo el año (la primera entrada rige desde el 1 de enero o antes). */
  known: boolean;
  /** Responsable en algún día del año. */
  anyResponsible: boolean;
  /** No responsable durante todo el año (con historial que lo cubre). */
  neverResponsible: boolean;
}

/** Cómo estuvo la empresa frente al IVA durante un año: decide si 1005 y 1006 aplican. */
export function vatYearCoverage(history: readonly CompanyVatEntry[], year: number): VatYearCoverage {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const atStart = vatResponsibleAt(history, start);
  const changes = history.filter((e) => e.effectiveDate > start && e.effectiveDate <= end);
  const known = atStart !== undefined;
  const anyResponsible = atStart === true || changes.some((e) => e.responsible);
  return { known, anyResponsible, neverResponsible: known && !anyResponsible };
}

export interface RegimeAt {
  /** Códigos tributarios vigentes (O-13, O-15, O-47, R-99-PN…). */
  codes: string[];
  /** Texto tal como se guardó. */
  text: string;
  /** history: entrada del historial · invoice: lo que dice la factura (sin entrada vigente) · unknown: no se identificó. */
  from: "history" | "invoice" | "unknown";
  /** Fecha desde la que rige la entrada del historial. */
  since?: string;
}

/**
 * Régimen fiscal del proveedor vigente en la fecha de la factura. Sin entrada vigente se usa lo que dice la propia factura; si
 * tampoco lo trae queda «unknown» (pendiente de captura manual).
 */
export function regimeAt(history: readonly SupplierFiscalEntry[], date: string | null | undefined, invoiceCodes: readonly string[], invoiceText?: string): RegimeAt {
  const entry = date ? effectiveAt(history, date) : undefined;
  if (entry) return { codes: fiscalCodes(entry.regime), text: entry.regime, from: "history", since: entry.effectiveDate };
  if (invoiceCodes.length) return { codes: [...invoiceCodes], text: invoiceText ?? invoiceCodes.join(";"), from: "invoice" };
  return { codes: [], text: "", from: "unknown" };
}

/** O-15 (autorretenedor) u O-47 (régimen simple): no generan retención en la fuente automática. */
export function retentionExemption(regime: RegimeAt): { code: string; label: string } | undefined {
  const code = excludedCode(regime.codes);
  return code ? { code, label: EXCLUDED_CODES[code] } : undefined;
}

/** Mensaje de la línea cuando el proveedor no genera retención: «No aplica retención: el proveedor es O-15 Autorretenedor». */
export const exemptionMessage = (exemption: { code: string; label: string }) => `No aplica retención: el proveedor es ${exemption.code} ${exemption.label}`;

/** ¿La factura trae un régimen distinto del vigente en el historial en esa fecha? (cambio por registrar) */
export function regimeChanged(history: readonly SupplierFiscalEntry[], date: string | null | undefined, invoiceText: string | undefined, invoiceCodes: readonly string[]): boolean {
  const entry = date ? effectiveAt(history, date) : undefined;
  if (!entry || invoiceCodes.length === 0) return false;
  return regimeKey(entry.regime) !== regimeKey(invoiceText ?? invoiceCodes.join(";"));
}

/** Qué se corrigió al registrar un régimen O-15 / O-47 (para el aviso al usuario); vacío si no hubo nada que corregir. */
export function cleanupSummary(c: ExemptCleanup): string {
  const parts = [
    c.rules ? `${c.rules} ${c.rules === 1 ? "regla de compras sin retención" : "reglas de compras sin retención"}` : "",
    c.supplierRules ? `${c.supplierRules} ${c.supplierRules === 1 ? "regla predeterminada de retención eliminada" : "reglas predeterminadas de retención eliminadas"}` : "",
    c.lines ? `${c.lines} ${c.lines === 1 ? "línea corregida" : "líneas corregidas"} a retención cero (queda en la auditoría)` : "",
    c.keptInformed ? `${c.keptInformed} ${c.keptInformed === 1 ? "línea con retención informada por el emisor: decide en la factura" : "líneas con retención informada por el emisor: decide en cada factura"}` : "",
  ].filter(Boolean);
  return parts.join("; ");
}
