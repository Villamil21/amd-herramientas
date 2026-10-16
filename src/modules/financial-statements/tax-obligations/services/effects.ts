import { lastDayOfMonth } from "../../shared/money";
import { PERIODICITY_LABEL, SHORT_TAX_LABEL, TAX_PUC, type TaxPeriodicity, type TaxPucKey, type TaxReturn, type TaxType, type VatPeriodicity } from "../types";

/**
 * Efecto de las declaraciones tributarias en el Estado de Situación
 * Financiera a una fecha de corte. Función pura: el Generador la llama con
 * las declaraciones guardadas y no se crean movimientos contables.
 *
 * - Retefuente / IVA / Renta por pagar: declaraciones cuyo periodo terminó al
 *   corte, por su SALDO PENDIENTE al corte (saldo a pagar − pagos con fecha ≤
 *   corte; una declaración puede pagarse por partes). La Retefuente pendiente
 *   de un año anterior al del corte se presenta como pasivo NO corriente (el
 *   PUC no cambia: solo su ubicación en el ESF).
 * - Saldo a favor de IVA y de Renta: FOTO de la declaración del último periodo
 *   terminado al corte (la siguiente ya incorpora el saldo anterior: nunca se suman).
 * - Anticipo de renta: solo el de la declaración del año anterior al corte y antes del 31/12 (ese día se consume).
 * - Resultados de ejercicios anteriores: suma algebraica de la renta líquida
 *   ordinaria (+) y la pérdida líquida (−) de los años anteriores al del corte.
 * - El patrimonio declarado en Renta es solo informativo: nunca se envía.
 * - Una declaración reemplazada por una corrección ya no cuenta; una que
 *   requiere revisión no se envía hasta resolverla.
 */

export interface PeriodRange {
  start: string;
  end: string;
}

const MONTHS: Record<Exclude<TaxPeriodicity, "annual">, number> = { monthly: 1, bimonthly: 2, four_monthly: 4 };
const SHORT_MONTH = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function periodRange(periodicity: TaxPeriodicity, year: number, period: number | null): PeriodRange {
  if (periodicity === "annual") return { start: `${year}-01-01`, end: `${year}-12-31` };
  const size = MONTHS[periodicity];
  const first = ((period ?? 1) - 1) * size + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${year}-${pad(first)}-01`, end: lastDayOfMonth(`${year}-${pad(first + size - 1)}`) };
}

/** Cantidad de periodos del año. */
export const periodsPerYear = (periodicity: TaxPeriodicity) => (periodicity === "annual" ? 1 : 12 / MONTHS[periodicity]);

/** «P4 Jul–Ago 2026», «Septiembre 2026» (mensual) o «Año gravable 2025». */
export function periodName(r: Pick<TaxReturn, "taxType" | "year" | "period" | "periodicity">): string {
  if (r.periodicity === "annual" || r.period === null) return `Año gravable ${r.year}`;
  const { start, end } = periodRange(r.periodicity, r.year, r.period);
  const from = SHORT_MONTH[Number(start.slice(5, 7)) - 1];
  const to = SHORT_MONTH[Number(end.slice(5, 7)) - 1];
  if (r.periodicity === "monthly") return `${from} ${r.year} (periodo ${String(r.period).padStart(2, "0")})`;
  return `P${r.period} ${from}–${to} ${r.year}`;
}

/** Último periodo terminado (fecha final ≤ corte) de una periodicidad. */
export function lastEndedPeriod(periodicity: TaxPeriodicity, cut: string): { year: number; period: number | null; range: PeriodRange } {
  let year = Number(cut.slice(0, 4));
  for (;;) {
    for (let p = periodsPerYear(periodicity); p >= 1; p--) {
      const range = periodRange(periodicity, year, periodicity === "annual" ? null : p);
      if (range.end <= cut) return { year, period: periodicity === "annual" ? null : p, range };
    }
    year--;
  }
}

// ---------------------------------------------------------------------------
// Estado y anomalías
// ---------------------------------------------------------------------------

export type TaxStatus = "pending" | "partial" | "paid" | "favor" | "none" | "review" | "superseded";

export const STATUS_LABEL: Record<TaxStatus, string> = {
  pending: "Pendiente de pago",
  partial: "Pago parcial",
  paid: "Pagado",
  favor: "Saldo a favor",
  none: "Declarada",
  review: "Requiere revisión",
  superseded: "Reemplazada (corrección)",
};

/** Motivos por los que una declaración no se envía hasta revisarla. */
export function anomalies(r: TaxReturn, vatPeriodicity: VatPeriodicity | null): string[] {
  const out: string[] = [];
  if (r.payableCents > 0 && r.favorCents > 0 && !r.resolution) out.push("Trae saldo a pagar y saldo a favor a la vez: indica cuál es el resultado final.");
  if (r.taxType === "vat") {
    if (!vatPeriodicity) out.push("La empresa no tiene configurada la periodicidad de IVA.");
    else if (r.periodicity !== vatPeriodicity) out.push(`La declaración es ${PERIODICITY_LABEL[r.periodicity].toLowerCase()} y la empresa está configurada como ${PERIODICITY_LABEL[vatPeriodicity].toLowerCase()}.`);
  }
  if (r.taxType === "income" && (r.incomeOrdinaryCents ?? 0) > 0 && (r.incomeLossCents ?? 0) > 0) out.push("Trae renta líquida ordinaria y pérdida líquida a la vez.");
  return out;
}

/** Saldo a pagar y a favor que valen (si trae ambos, el que el usuario indicó). */
export function effectiveValues(r: TaxReturn): { payable: number; favor: number } {
  if (r.resolution === "payable") return { payable: r.payableCents, favor: 0 };
  if (r.resolution === "favor") return { payable: 0, favor: r.favorCents };
  return { payable: r.payableCents, favor: r.favorCents };
}

/** Pagos con fecha ≤ corte (sin corte: todos los registrados). */
export function paidCents(r: Pick<TaxReturn, "payments">, cut?: string): number {
  return r.payments.reduce((s, p) => (cut === undefined || p.paymentDate <= cut ? s + p.amountCents : s), 0);
}

/** Saldo a pagar − pagos hasta el corte. Nunca reemplaza el valor de la declaración. */
export function pendingCents(r: TaxReturn, cut?: string): number {
  return Math.max(0, effectiveValues(r).payable - paidCents(r, cut));
}

/** Estado de la declaración (a la fecha de corte si se indica; si no, con todos los pagos registrados). */
export function taxStatus(r: TaxReturn, vatPeriodicity: VatPeriodicity | null, cut?: string): TaxStatus {
  if (r.supersededBy !== null) return "superseded";
  if (anomalies(r, vatPeriodicity).length) return "review";
  const v = effectiveValues(r);
  if (v.payable > 0) {
    if (pendingCents(r, cut) === 0) return "paid";
    return paidCents(r, cut) > 0 ? "partial" : "pending";
  }
  if (v.favor > 0) return "favor";
  return "none";
}

/** Resultado fiscal histórico: renta líquida ordinaria (+) o pérdida líquida (−). */
export const fiscalResult = (r: TaxReturn) => (r.incomeOrdinaryCents ?? 0) - (r.incomeLossCents ?? 0);

// ---------------------------------------------------------------------------
// Efectos a una fecha de corte
// ---------------------------------------------------------------------------

export type TaxEffectKind = "withholding_payable" | "vat_payable" | "vat_favor" | "income_payable" | "income_favor" | "income_advance" | "prior_results";

/** Origen de un efecto para que Exógena (1008/1009) y los reportes lo expliquen: impuesto, periodo, formulario, valor declarado, pagos y corte. */
export interface TaxTrace {
  returnId: number;
  taxType: TaxType;
  kind: TaxEffectKind;
  year: number;
  period: number | null;
  periodLabel: string;
  formNumber: string;
  declaredCents: number;
  paidCents: number;
  cut: string;
  /** Saldo resultante al corte (pendiente por pagar o saldo a favor vigente). */
  resultCents: number;
}

export interface TaxEffect {
  kind: TaxEffectKind;
  pucKey: TaxPucKey;
  /** null: la cuenta PUC no está configurada (no se envía y bloquea). */
  pucCode: string | null;
  label: string;
  cents: number;
  /** Declaraciones de las que sale el valor. */
  returnIds: number[];
  /** Se presenta en el pasivo no corriente (Retefuente de un año anterior al del corte). */
  noncurrent?: boolean;
  /** Presente en los efectos de una sola declaración (por pagar, saldo a favor, anticipo). */
  trace?: TaxTrace;
}

export interface TaxIssue {
  level: "blocking" | "warning";
  taxType: TaxType;
  message: string;
}

export interface TaxInput {
  returns: TaxReturn[];
  /** Cuentas PUC configuradas (clave tax.* → código). */
  puc: Map<string, string>;
  vatPeriodicity: VatPeriodicity | null;
}

export interface TaxEffects {
  effects: TaxEffect[];
  issues: TaxIssue[];
}

const PUC_LABEL: Record<TaxPucKey, string> = {
  [TAX_PUC.withholdingPayable]: "Retención en la fuente por pagar",
  [TAX_PUC.vatPayable]: "IVA por pagar",
  [TAX_PUC.vatFavor]: "Saldo a favor de IVA",
  [TAX_PUC.incomePayable]: "Renta por pagar",
  [TAX_PUC.incomeFavor]: "Saldo a favor de Renta",
  [TAX_PUC.incomeAdvance]: "Anticipo de Renta",
  [TAX_PUC.priorResults]: "Resultados de ejercicios anteriores",
};

function traceOf(kind: TaxEffectKind, r: TaxReturn, resultCents: number, cut: string): TaxTrace {
  const v = effectiveValues(r);
  const payable = kind === "withholding_payable" || kind === "vat_payable" || kind === "income_payable";
  return {
    returnId: r.id,
    taxType: r.taxType,
    kind,
    year: r.year,
    period: r.period,
    periodLabel: periodName(r),
    formNumber: r.formNumber,
    declaredCents: payable ? v.payable : kind === "income_advance" ? (r.advanceNextCents ?? 0) : v.favor,
    paidCents: payable ? paidCents(r, cut) : 0,
    cut,
    resultCents,
  };
}

export function taxEffects(input: TaxInput, cut: string): TaxEffects {
  const effects: TaxEffect[] = [];
  const issues: TaxIssue[] = [];
  const live = input.returns.filter((r) => r.supersededBy === null && r.periodEnd <= cut);
  const usable = live.filter((r) => {
    const why = anomalies(r, input.vatPeriodicity);
    if (why.length) issues.push({ level: "blocking", taxType: r.taxType, message: `${SHORT_TAX_LABEL[r.taxType]} ${periodName(r)} (formulario ${r.formNumber || "sin número"}) requiere revisión: ${why.join(" ")}` });
    return why.length === 0;
  });
  const missingPuc = new Set<TaxPucKey>();
  const add = (kind: TaxEffectKind, pucKey: TaxPucKey, label: string, cents: number, returns: TaxReturn[], noncurrent = false) => {
    if (cents === 0) return;
    const pucCode = input.puc.get(pucKey) || null;
    const trace = returns.length === 1 && kind !== "prior_results" ? traceOf(kind, returns[0], cents, cut) : undefined;
    effects.push({ kind, pucKey, pucCode, label, cents, returnIds: returns.map((r) => r.id), ...(noncurrent && { noncurrent }), ...(trace && { trace }) });
    // Un solo aviso por cuenta sin configurar (no uno por declaración).
    if (!pucCode && !missingPuc.has(pucKey)) {
      missingPuc.add(pucKey);
      issues.push({
        level: "blocking",
        taxType: returns[0].taxType,
        message: `Configura la cuenta PUC «${PUC_LABEL[pucKey]}» en Obligaciones tributarias: sus valores no se incluyen en los Estados Financieros.`,
      });
    }
  };

  // Por pagar: el saldo pendiente al corte de cada declaración terminada al corte.
  const cutYear = Number(cut.slice(0, 4));
  const payables: [TaxType, TaxEffectKind, TaxPucKey][] = [
    ["withholding", "withholding_payable", TAX_PUC.withholdingPayable],
    ["vat", "vat_payable", TAX_PUC.vatPayable],
    ["income", "income_payable", TAX_PUC.incomePayable],
  ];
  for (const [type, kind, key] of payables)
    for (const r of usable.filter((x) => x.taxType === type).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))) {
      const pending = pendingCents(r, cut);
      // Retefuente: el año de la obligación frente al del corte decide corriente / no corriente (sobre el saldo pendiente).
      const noncurrent = type === "withholding" && r.year < cutYear;
      const partial = pending > 0 && pending < effectiveValues(r).payable;
      if (pending > 0) add(kind, key, `${SHORT_TAX_LABEL[type]} por pagar ${periodName(r)}${partial ? " (saldo pendiente)" : ""}${noncurrent ? " (no corriente)" : ""}`, pending, [r], noncurrent);
    }

  // Saldo a favor de IVA: foto del último periodo terminado según la periodicidad de la empresa.
  const vat = live.filter((r) => r.taxType === "vat");
  if (vat.length) {
    const periodicity = input.vatPeriodicity ?? vat[vat.length - 1].periodicity;
    const last = lastEndedPeriod(periodicity, cut);
    const snapshot = vat.find((r) => r.year === last.year && r.period === last.period && r.periodicity === periodicity);
    if (!snapshot) {
      const name = periodName({ taxType: "vat", year: last.year, period: last.period, periodicity });
      issues.push({ level: "warning", taxType: "vat", message: `Falta la declaración de IVA ${name} (último periodo terminado al corte): no se incluye saldo a favor de IVA. No se usa una declaración anterior.` });
    } else if (usable.includes(snapshot)) {
      const { favor } = effectiveValues(snapshot);
      if (favor > 0) add("vat_favor", TAX_PUC.vatFavor, `Saldo a favor de IVA ${periodName(snapshot)}`, favor, [snapshot]);
    }
  }

  // Renta.
  const income = usable.filter((r) => r.taxType === "income").sort((a, b) => a.year - b.year);
  const latest = income[income.length - 1];
  if (latest) {
    const { favor } = effectiveValues(latest);
    if (favor > 0) add("income_favor", TAX_PUC.incomeFavor, `Saldo a favor de Renta ${latest.year}`, favor, [latest]);
  }
  // El anticipo es un activo temporal del año siguiente: el 31/12 se consume en la liquidación de ese año y deja de aparecer.
  for (const r of income.filter((x) => x.advanceTargetYear === cutYear && cut < `${cutYear}-12-31` && (x.advanceNextCents ?? 0) > 0))
    add("income_advance", TAX_PUC.incomeAdvance, `Anticipo de Renta ${cutYear} (declaración ${r.year})`, r.advanceNextCents!, [r]);
  const prior = income.filter((r) => r.year < cutYear);
  if (prior.length) add("prior_results", TAX_PUC.priorResults, `Resultados fiscales ${prior.map((r) => r.year).join(", ")}`, prior.reduce((s, r) => s + fiscalResult(r), 0), prior);

  return { effects, issues };
}
