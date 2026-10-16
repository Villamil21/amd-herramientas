import type { Company } from "../../../../types/models";
import { findCompanyByNit, namesMatch, normalizeNit } from "../../shared/companyMatch";
import type { ParsedTaxReturn } from "../parser/taxReturnParser";
import type { TaxPeriodicity, TaxReturn, TaxReturnInput, VatPeriodicity } from "../types";
import { periodRange } from "./effects";

/**
 * Una declaración leída, lista para revisar antes de guardarla: empresa por
 * NIT (el nombre solo valida), periodo según la periodicidad y, si ya existe
 * una declaración vigente del mismo periodo, la que se corregiría.
 */
export interface ImportDraft {
  parsed: ParsedTaxReturn;
  fileName: string;
  company: Company | null;
  /** El nombre del formulario es muy distinto al de la empresa: se pide confirmación. */
  nameMismatch: boolean;
  year: number | null;
  periodicity: TaxPeriodicity | null;
  /** IVA: la periodicidad del formulario no coincide con la configurada en la empresa. */
  periodicityMismatch: boolean;
  /** Declaración vigente del mismo impuesto y periodo. */
  existing: TaxReturn | null;
  /** El formulario indica que corrige a `existing` (casilla «No. Formulario anterior»). */
  correctsExisting: boolean;
  /** El mismo formulario ya fue importado. */
  duplicate: TaxReturn | null;
}

export function buildDraft(parsed: ParsedTaxReturn, fileName: string, companies: Company[], returns: TaxReturn[], vatPeriodicity: VatPeriodicity | null): ImportDraft {
  const company = findCompanyByNit(companies, parsed.nit) ?? null;
  const periodicity: TaxPeriodicity | null = parsed.taxType === "withholding" ? "monthly" : parsed.taxType === "income" ? "annual" : (parsed.periodicity ?? vatPeriodicity);
  const draft: ImportDraft = {
    parsed,
    fileName,
    company,
    nameMismatch: Boolean(company) && !namesMatch(company!.razonSocial, parsed.companyName),
    year: parsed.year,
    periodicity,
    periodicityMismatch: parsed.taxType === "vat" && Boolean(parsed.periodicity && vatPeriodicity && parsed.periodicity !== vatPeriodicity),
    existing: null,
    correctsExisting: false,
    duplicate: (parsed.formNumber && returns.find((r) => r.formNumber === parsed.formNumber)) || null,
  };
  return withExisting(draft, returns);
}

/** Recalcula la declaración vigente del periodo (al cambiar el año propuesto). */
export function withExisting(draft: ImportDraft, returns: TaxReturn[]): ImportDraft {
  const { parsed } = draft;
  const period = parsed.taxType === "income" ? null : parsed.period;
  const existing = returns.find((r) => r.taxType === parsed.taxType && r.year === draft.year && r.period === period && r.supersededBy === null) ?? null;
  return { ...draft, existing, correctsExisting: Boolean(existing && parsed.previousFormNumber && existing.formNumber === parsed.previousFormNumber) };
}

/** Qué falta para poder guardar (vacío = listo). */
export function draftBlockers(d: ImportDraft, confirmedName: boolean, confirmedCorrection: boolean): string[] {
  const out: string[] = [];
  if (!d.company) out.push(`No hay una empresa con NIT ${normalizeNit(d.parsed.nit) || "(sin leer)"}. Créala en Datos → Empresas.`);
  if (d.duplicate) out.push(`El formulario ${d.parsed.formNumber} ya fue importado.`);
  if (d.nameMismatch && !confirmedName) out.push("Confirma que la declaración es de esta empresa.");
  if (d.year === null) out.push("Falta el año gravable.");
  if (d.parsed.taxType !== "income" && d.parsed.period === null) out.push("No se pudo leer el periodo.");
  if (!d.periodicity) out.push("Configura la periodicidad de IVA de la empresa.");
  if (d.existing && !confirmedCorrection) out.push("Ya existe una declaración de este periodo: confirma que la nueva es una corrección.");
  // IVA: un formulario es saldo a pagar (88) o saldo a favor (89), nunca ambos.
  if (d.parsed.taxType === "vat" && (d.parsed.values.vatPayable?.cents ?? 0) > 0 && (d.parsed.values.vatFavor?.cents ?? 0) > 0) {
    out.push("Las casillas 88 (Total saldo a pagar) y 89 (Total saldo a favor) son ambas mayores que cero: revisa la declaración antes de importarla.");
  }
  return out;
}

export function draftInput(d: ImportDraft, yearSource: "form" | "presentation" | "manual" | null): TaxReturnInput {
  const p = d.parsed;
  const period = p.taxType === "income" ? null : p.period;
  const range = periodRange(d.periodicity!, d.year!, period);
  const v = (k: keyof ParsedTaxReturn["values"]) => p.values[k]?.cents ?? 0;
  const payable = p.taxType === "withholding" ? v("withholdingTotal") : p.taxType === "vat" ? v("vatPayable") : v("incomePayable");
  const favor = p.taxType === "vat" ? v("vatFavor") : p.taxType === "income" ? v("incomeFavor") : 0;
  return {
    companyId: d.company!.id,
    taxType: p.taxType,
    year: d.year!,
    period,
    periodicity: d.periodicity!,
    periodStart: range.start,
    periodEnd: range.end,
    formNumber: p.formNumber,
    previousFormNumber: p.previousFormNumber,
    isCorrection: Boolean(p.previousFormNumber || d.existing),
    replacesId: d.existing?.id ?? null,
    payableCents: payable,
    favorCents: favor,
    nit: normalizeNit(p.nit),
    companyName: p.companyName,
    fileName: d.fileName,
    incomeOrdinaryCents: p.taxType === "income" ? v("incomeOrdinary") : null,
    incomeLossCents: p.taxType === "income" ? v("incomeLoss") : null,
    advanceNextCents: p.taxType === "income" ? v("incomeAdvanceNext") : null,
    advanceTargetYear: p.taxType === "income" ? d.year! + 1 : null,
    detail: {
      formCode: p.formCode,
      presentedOn: p.presentedOn,
      yearSource,
      periodicityOnForm: p.periodicity,
      values: p.values as NonNullable<TaxReturnInput["detail"]["values"]>,
      equity: p.equity.map((e) => ({ key: e.key, label: e.label, cents: e.value?.cents ?? null, casilla: e.value?.casilla ?? null })),
      warnings: p.warnings,
      nameMismatchConfirmed: d.nameMismatch || undefined,
      ...(p.withholdingCasillas && Object.keys(p.withholdingCasillas).length > 0 && { withholding: { casillas: p.withholdingCasillas } }),
    },
  };
}
