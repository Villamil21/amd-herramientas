import { estimatedIncomeTax } from "../shared/money";
import { periodName, periodRange, STATUS_LABEL, taxStatus } from "../tax-obligations/services/effects";
import type { TaxEmptyPeriod, TaxReturn, VatPeriodicity } from "../tax-obligations/types";
import { WH_SELF_KEY, whBreakdownOf } from "../tax-obligations/withholding/detail";

/**
 * Impuesto de renta estimado NETO (indicador informativo de Estados Financieros).
 *
 *   estimado bruto (35 % de la utilidad positiva) − autorretenciones netas de los Formularios 350 = neto
 *
 * Autorretenciones netas de un 350 = autorretenciones declaradas − devoluciones/excesos de la casilla 129 que el usuario
 * clasificó específicamente como autorretenciones. El resto de la 129 (otros conceptos) NO las reduce y lo que no esté
 * distribuido queda pendiente: nunca se asigna por defecto. No genera movimientos contables ni entra al PDF.
 */

export const ESTIMATED_TAX_RATE = 0.35;

export interface SelfWithholdingForm {
  returnId: number;
  period: string;
  formNumber: string;
  presentedOn: string | null;
  statusLabel: string;
  /** Autorretenciones declaradas (centavos). */
  grossCents: number;
  /** Devoluciones/excesos clasificados como autorretenciones. */
  classifiedReturnsCents: number;
  /** Lo que realmente se resta: bruto − devoluciones clasificadas. */
  netCents: number;
  /** Devoluciones distribuidas a OTROS conceptos: no reducen las autorretenciones. */
  otherConceptsCents: number;
  /** Casilla 129 sin distribuir: pendiente, no se asigna. */
  undistributedCents: number;
  /** El formulario no trae casillas leídas: no se puede conocer su autorretención. */
  noDetail: boolean;
}

export interface EstimatedIncomeTax {
  cutYear: number;
  /** Utilidad antes de impuestos usada (centavos; puede ser ≤ 0). */
  baseCents: number;
  rate: number;
  /** Estimado bruto (centavos): 35 % de la utilidad positiva, redondeado al millar. */
  grossCents: number;
  selfWithholdingCents: number;
  /** Bruto − autorretenciones (puede ser negativo). */
  resultCents: number;
  /** Neto > 0 es impuesto estimado; ≤ 0 se muestra como saldo a favor. */
  kind: "tax" | "favor";
  /** Valor absoluto a mostrar como valor principal. */
  displayCents: number;
  included: SelfWithholdingForm[];
  /** Meses del año ya transcurridos sin 350 vigente (AAAA-MM). */
  missingMonths: string[];
  undistributedCents: number;
  /** Faltan 350, hay devoluciones sin distribuir o formularios sin casillas. */
  partial: boolean;
  /** Formularios incluidos sin casillas leídas (su autorretención se desconoce). */
  noDetailReturns: SelfWithholdingForm[];
}

const MONTH_NAME = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const missingMonthsText = (months: string[]) => months.map((m) => `${MONTH_NAME[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`).join(", ");

export function estimatedIncomeTaxNet(args: {
  /** Utilidad antes de impuestos (centavos). */
  baseCents: number;
  /** Impuesto estimado bruto en pesos (el que ya calcula el motor o el snapshot cerrado). */
  grossPesos?: number;
  returns: TaxReturn[];
  empties?: TaxEmptyPeriod[];
  vatPeriodicity?: VatPeriodicity | null;
  cut: string;
  constitutionDate?: string | null;
}): EstimatedIncomeTax {
  const { baseCents, cut } = args;
  const cutYear = Number(cut.slice(0, 4));
  const grossCents = (args.grossPesos ?? estimatedIncomeTax(baseCents)) * 100;

  // Solo declaraciones vigentes (no reemplazadas por una corrección) del año fiscal, con periodo terminado a la fecha de corte.
  const live = args.returns
    .filter((r) => r.taxType === "withholding" && r.supersededBy === null && r.year === cutYear && r.periodEnd <= cut)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.id - b.id);
  const forms: SelfWithholdingForm[] = live.map((r) => {
    const b = whBreakdownOf(r);
    const row = b?.rows.find((x) => x.key === WH_SELF_KEY);
    const gross = row?.grossCents ?? 0;
    const classified = -(row?.adjustmentCents ?? 0);
    return {
      returnId: r.id,
      period: periodName(r),
      formNumber: r.formNumber,
      presentedOn: r.detail?.presentedOn ?? null,
      statusLabel: STATUS_LABEL[taxStatus(r, args.vatPeriodicity ?? null, cut)],
      grossCents: gross,
      classifiedReturnsCents: classified,
      netCents: gross - classified,
      otherConceptsCents: b ? Math.max(0, b.distributed129Cents - classified) : 0,
      undistributedCents: b?.undistributed129Cents ?? 0,
      noDetail: !b,
    };
  });

  // Meses transcurridos sin 350: ni vigente ni «sin obligación»; se omiten los anteriores a la constitución.
  const created = /^\d{4}-\d{2}-\d{2}$/.test(args.constitutionDate ?? "") ? args.constitutionDate! : null;
  const present = new Set(live.map((r) => r.periodStart.slice(0, 7)));
  const empty = new Set((args.empties ?? []).filter((e) => e.status === "active" && e.taxType === "withholding" && e.year === cutYear).map((e) => `${cutYear}-${String(e.period).padStart(2, "0")}`));
  const missingMonths: string[] = [];
  for (let p = 1; p <= 12; p++) {
    const range = periodRange("monthly", cutYear, p);
    const month = range.start.slice(0, 7);
    if (range.end > cut || (created && range.end < created)) continue;
    if (!present.has(month) && !empty.has(month)) missingMonths.push(month);
  }

  const selfWithholdingCents = forms.reduce((n, f) => n + f.netCents, 0);
  const undistributedCents = forms.reduce((n, f) => n + f.undistributedCents, 0);
  const noDetailReturns = forms.filter((f) => f.noDetail);
  const resultCents = grossCents - selfWithholdingCents;
  return {
    cutYear,
    baseCents,
    rate: ESTIMATED_TAX_RATE,
    grossCents,
    selfWithholdingCents,
    resultCents,
    kind: resultCents < 0 ? "favor" : "tax",
    displayCents: Math.abs(resultCents),
    included: forms,
    missingMonths,
    undistributedCents,
    partial: missingMonths.length > 0 || undistributedCents > 0 || noDetailReturns.length > 0,
    noDetailReturns,
  };
}

/** Teclas que activan la tarjeta del indicador (igual que un botón): Enter y Espacio. */
export const isActivationKey = (key: string) => key === "Enter" || key === " " || key === "Spacebar";
