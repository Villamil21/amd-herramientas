import { lastDayOfMonth } from "../../shared/money";
import { PERIODICITY_LABEL, SHORT_TAX_LABEL, TAX_PUC, sanctionExpenseKey, sanctionPayableKey, type TaxPayment, type TaxPeriodicity, type TaxPucKey, type TaxReturn, type TaxType, type VatPeriodicity } from "../types";
import { whBreakdownOf, whPucKey, type WhBreakdown } from "../withholding/detail";

/**
 * Efecto de las declaraciones tributarias en el Estado de Situación
 * Financiera a una fecha de corte. Función pura: el Generador la llama con
 * las declaraciones guardadas y no se crean movimientos contables.
 *
 * - Retefuente / IVA / Renta por pagar: declaraciones cuyo periodo terminó al
 *   corte, por su SALDO PENDIENTE al corte (saldo a pagar − pagos con fecha ≤
 *   corte; una declaración puede pagarse por partes). La Retefuente se
 *   discrimina por concepto (un PUC por concepto, PJ + PN en una fila) y las
 *   sanciones llevan gasto y cuenta por pagar propios.
 * - Ningún valor llega a EEFF sin PUC: sin cuenta configurada el efecto queda
 *   «Pendiente de clasificar» (pucCode null) y bloquea.
 * - Una obligación o saldo a favor de un año anterior al del corte se presenta
 *   NO corriente (el PUC no cambia: solo su ubicación en el ESF).
 * - Pagos por encima del saldo: el excedente es interés (gasto) o excedente a
 *   favor (deudor, solo si el usuario lo aprueba para EEFF y 1008).
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

export type TaxEffectKind =
  | "withholding_payable"
  | "vat_payable"
  | "vat_favor"
  | "income_payable"
  | "income_favor"
  | "income_advance"
  | "prior_results"
  | "sanction_expense"
  | "sanction_payable"
  | "interest_expense"
  | "excess_favor";

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
  /** Concepto de Retefuente (clave de whBreakdown) o pago de origen del excedente. */
  conceptKey?: string;
  paymentId?: number;
}

export interface TaxEffect {
  kind: TaxEffectKind;
  taxType: TaxType;
  pucKey: TaxPucKey;
  /** null: la cuenta PUC no está configurada («Pendiente de clasificar»: no se envía y bloquea). */
  pucCode: string | null;
  label: string;
  cents: number;
  /** Declaraciones de las que sale el valor. */
  returnIds: number[];
  /** Se presenta como NO corriente (obligación o saldo a favor de un año anterior al del corte). */
  noncurrent?: boolean;
  /** Fecha del hecho (gastos del Estado de Resultados); sin fecha: saldo del ESF. */
  date?: string;
  /** Concepto de Retefuente (si la retención está discriminada). */
  conceptKey?: string;
  /** Presente en los efectos de una sola declaración (por pagar, saldo a favor, anticipo). */
  trace?: TaxTrace;
}

export interface TaxIssue {
  level: "blocking" | "warning";
  taxType: TaxType | "capital";
  message: string;
  /** Cuenta PUC que falta (acción «Configurar PUC»). */
  pucKey?: TaxPucKey;
  /** Revisión pendiente de excedentes a favor. */
  code?: "excess_review" | "puc_missing" | "undistributed_129" | "unsplit_withholding";
}

export interface TaxInput {
  returns: TaxReturn[];
  /** Cuentas PUC configuradas (clave tax.* → código). */
  puc: Map<string, string>;
  vatPeriodicity: VatPeriodicity | null;
}

/** Excedente de un pago clasificado como «a favor» y su decisión para EEFF y 1008. */
export interface ExcessReviewItem {
  paymentId: number;
  returnId: number;
  taxType: TaxType;
  periodLabel: string;
  paymentDate: string;
  cents: number;
  pucCode: string | null;
  /** Cambia si cambian el pago, la clasificación, el PUC o el valor: invalida una decisión anterior. */
  fingerprint: string;
  decision: "applies" | "not_applies" | null;
  /** Había una decisión, pero la fuente cambió: se vuelve a preguntar. */
  stale: boolean;
  needsReview: boolean;
  year: number;
}

export interface TaxEffects {
  effects: TaxEffect[];
  issues: TaxIssue[];
  excessReviews: ExcessReviewItem[];
}

const PUC_LABEL: Record<string, string> = {
  [TAX_PUC.withholdingPayable]: "Retención en la fuente por pagar",
  [TAX_PUC.vatPayable]: "IVA por pagar",
  [TAX_PUC.vatFavor]: "Saldo a favor de IVA",
  [TAX_PUC.incomePayable]: "Renta por pagar",
  [TAX_PUC.incomeFavor]: "Saldo a favor de Renta",
  [TAX_PUC.incomeAdvance]: "Anticipo de Renta",
  [TAX_PUC.priorResults]: "Resultados de ejercicios anteriores",
  [TAX_PUC.interestExpense]: "Intereses por pagos de impuestos (gasto)",
  [TAX_PUC.excessFavor]: "Excedente a favor de la DIAN (deudor)",
  [sanctionExpenseKey("withholding")]: "Sanciones de Retefuente (gasto)",
  [sanctionPayableKey("withholding")]: "Sanciones de Retefuente por pagar",
  [sanctionExpenseKey("vat")]: "Sanciones de IVA (gasto)",
  [sanctionPayableKey("vat")]: "Sanciones de IVA por pagar",
  [sanctionExpenseKey("income")]: "Sanciones de Renta (gasto)",
  [sanctionPayableKey("income")]: "Sanciones de Renta por pagar",
};

/** Nombre legible de una clave PUC de configuración (las de Retefuente por concepto llevan el nombre del concepto). */
export function pucLabel(key: TaxPucKey, conceptLabels?: Map<string, string>): string {
  if (PUC_LABEL[key]) return PUC_LABEL[key];
  const concept = key.startsWith("tax.wh.") ? conceptLabels?.get(key.slice("tax.wh.".length)) : undefined;
  return concept ? `Retención en la fuente por pagar — ${concept}` : key;
}

/**
 * Año de la obligación frente al del corte (corriente / no corriente). Retefuente e IVA: el año del periodo. Renta: el año en que se
 * declara (el de la presentación; sin ella, el siguiente al año gravable).
 */
export function obligationYear(r: Pick<TaxReturn, "taxType" | "year" | "detail">): number {
  if (r.taxType !== "income") return r.year;
  const presented = r.detail?.presentedOn;
  return presented && /^\d{4}/.test(presented) ? Number(presented.slice(0, 4)) : r.year + 1;
}

export const excessFingerprint = (p: Pick<TaxPayment, "id" | "paymentDate" | "excessCents" | "excessKind">, pucCode: string | null) => `${p.id}|${p.paymentDate}|${p.excessCents}|${p.excessKind}|${pucCode ?? ""}`;

function traceOf(kind: TaxEffectKind, r: TaxReturn, t: { declared: number; paid?: number; result: number; conceptKey?: string; paymentId?: number }, cut: string): TaxTrace {
  return {
    returnId: r.id,
    taxType: r.taxType,
    kind,
    year: r.year,
    period: r.period,
    periodLabel: periodName(r),
    formNumber: r.formNumber,
    declaredCents: t.declared,
    paidCents: t.paid ?? 0,
    cut,
    resultCents: t.result,
    ...(t.conceptKey && { conceptKey: t.conceptKey }),
    ...(t.paymentId !== undefined && { paymentId: t.paymentId }),
  };
}

/** Sanción declarada: Retefuente, casilla 137; IVA y Renta, el renglón «Sanciones» cuando el formulario lo discrimina. */
export function sanctionCents(r: TaxReturn, breakdown?: WhBreakdown | null): number {
  if (r.taxType === "withholding") return (breakdown ?? whBreakdownOf(r))?.sanctionCents ?? 0;
  return r.detail?.values?.sanctions?.cents ?? 0;
}

export interface PayableLine {
  kind: "tax" | "sanction";
  conceptKey?: string;
  label: string;
  cents: number;
}

/**
 * Cómo se compone el saldo a pagar de una declaración. Retefuente discriminada: una línea por concepto (neto de devoluciones
 * distribuidas) y la sanción; sin discriminar: una sola línea. IVA / Renta: impuesto y sanción (si el formulario la separa).
 * `discriminated` = false en declaraciones leídas antes de guardar las casillas.
 */
export function payableLines(r: TaxReturn): { lines: PayableLine[]; discriminated: boolean; breakdown: WhBreakdown | null } {
  const payable = effectiveValues(r).payable;
  if (r.taxType === "withholding") {
    const b = whBreakdownOf(r);
    if (b) {
      const lines: PayableLine[] = b.rows.filter((row) => row.netCents !== 0).map((row) => ({ kind: "tax", conceptKey: row.key, label: row.label, cents: row.netCents }));
      if (b.sanctionCents > 0) lines.push({ kind: "sanction", label: "Sanciones", cents: b.sanctionCents });
      return { lines, discriminated: true, breakdown: b };
    }
    return { lines: [{ kind: "tax", label: "Sin discriminar por concepto", cents: payable }], discriminated: false, breakdown: null };
  }
  const sanction = Math.min(sanctionCents(r), payable);
  const lines: PayableLine[] = [{ kind: "tax", label: SHORT_TAX_LABEL[r.taxType], cents: payable - sanction }];
  if (sanction > 0) lines.push({ kind: "sanction", label: "Sanciones", cents: sanction });
  return { lines: lines.filter((l) => l.cents !== 0), discriminated: true, breakdown: null };
}

/** Reparte el saldo pendiente entre las líneas en proporción a lo declarado; el redondeo se corrige en la línea mayor. */
function allocate(lines: PayableLine[], pending: number, payable: number): number[] {
  if (payable <= 0) return lines.map(() => 0);
  if (pending >= payable) return lines.map((l) => l.cents);
  const scaled = lines.map((l) => Math.round((l.cents * pending) / payable));
  const target = Math.round((lines.reduce((n, l) => n + l.cents, 0) * pending) / payable);
  const diff = target - scaled.reduce((n, c) => n + c, 0);
  if (diff !== 0 && lines.length) {
    const biggest = lines.reduce((best, l, i) => (Math.abs(l.cents) > Math.abs(lines[best].cents) ? i : best), 0);
    scaled[biggest] += diff;
  }
  return scaled;
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
  const cutYear = Number(cut.slice(0, 4));
  const missingPuc = new Set<TaxPucKey>();
  const conceptLabels = new Map<string, string>();
  const add = (e: Omit<TaxEffect, "pucCode" | "returnIds">, returns: TaxReturn[]) => {
    if (e.cents === 0) return;
    const pucCode = input.puc.get(e.pucKey) || null;
    const trace = returns.length === 1 && e.kind !== "prior_results" ? e.trace : undefined;
    effects.push({ ...e, pucCode, returnIds: returns.map((r) => r.id), ...(trace && { trace }) });
    // Un solo aviso por cuenta sin configurar (no uno por declaración).
    if (!pucCode && !missingPuc.has(e.pucKey)) {
      missingPuc.add(e.pucKey);
      issues.push({
        level: "blocking",
        taxType: e.taxType,
        pucKey: e.pucKey,
        code: "puc_missing",
        message: `Configura la cuenta PUC «${pucLabel(e.pucKey, conceptLabels)}» en Obligaciones tributarias: sus valores quedan «Pendiente de clasificar» y no se incluyen en los Estados Financieros.`,
      });
    }
  };

  // Por pagar: el saldo pendiente al corte de cada declaración terminada al corte, por concepto cuando la declaración lo discrimina.
  const payables: [TaxType, TaxEffectKind][] = [
    ["withholding", "withholding_payable"],
    ["vat", "vat_payable"],
    ["income", "income_payable"],
  ];
  const payablePuc: Record<TaxType, TaxPucKey> = { withholding: TAX_PUC.withholdingPayable, vat: TAX_PUC.vatPayable, income: TAX_PUC.incomePayable };
  for (const [type, kind] of payables)
    for (const r of usable.filter((x) => x.taxType === type).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))) {
      const payable = effectiveValues(r).payable;
      const pending = pendingCents(r, cut);
      const { lines, discriminated, breakdown } = payableLines(r);
      if (breakdown) {
        for (const row of breakdown.rows) conceptLabels.set(row.key, row.label);
        if (breakdown.undistributed129Cents > 0 && pending > 0)
          issues.push({
            level: "blocking",
            taxType: "withholding",
            code: "undistributed_129",
            message: `Retefuente ${periodName(r)}: la casilla 129 tiene ${formatMoney(breakdown.undistributed129Cents)} sin distribuir por concepto; ese saldo no viaja a EEFF hasta asignarlo.`,
          });
      } else if (type === "withholding" && pending > 0)
        issues.push({ level: "warning", taxType: "withholding", code: "unsplit_withholding", message: `Retefuente ${periodName(r)} se leyó sin discriminar por concepto: relee el PDF desde la declaración para separar los conceptos.` });
      if (pending <= 0) continue;
      const noncurrent = obligationYear(r) < cutYear;
      const partial = pending < payable;
      const amounts = allocate(lines, pending, payable);
      // Gasto de la sanción: se reconoce en la fecha de presentación (o fin del periodo) y no baja con los pagos.
      lines.forEach((line, i) => {
        const cents = amounts[i];
        const nc = noncurrent ? { noncurrent } : {};
        if (line.kind === "sanction") {
          add({ kind: "sanction_payable", taxType: type, pucKey: sanctionPayableKey(type), label: `Sanciones ${SHORT_TAX_LABEL[type]} por pagar ${periodName(r)}${partial ? " (saldo pendiente)" : ""}${noncurrent ? " (no corriente)" : ""}`, cents, ...nc, trace: traceOf("sanction_payable", r, { declared: line.cents, paid: paidCents(r, cut), result: cents }, cut) }, [r]);
          return;
        }
        const pucKey = discriminated && line.conceptKey ? whPucKey(line.conceptKey) : payablePuc[type];
        const what = line.conceptKey ? `${SHORT_TAX_LABEL[type]} ${line.label} por pagar` : `${SHORT_TAX_LABEL[type]} por pagar`;
        add({ kind, taxType: type, pucKey, ...(line.conceptKey && { conceptKey: line.conceptKey }), label: `${what} ${periodName(r)}${partial ? " (saldo pendiente)" : ""}${noncurrent ? " (no corriente)" : ""}`, cents, ...nc, trace: traceOf(kind, r, { declared: line.cents, paid: paidCents(r, cut), result: cents, conceptKey: line.conceptKey }, cut) }, [r]);
      });
      const sanction = lines.find((l) => l.kind === "sanction");
      if (sanction)
        add({ kind: "sanction_expense", taxType: type, pucKey: sanctionExpenseKey(type), label: `Sanciones ${SHORT_TAX_LABEL[type]} (gasto) ${periodName(r)}`, cents: sanction.cents, date: r.detail?.presentedOn || r.periodEnd, trace: traceOf("sanction_expense", r, { declared: sanction.cents, result: sanction.cents }, cut) }, [r]);
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
      const noncurrent = obligationYear(snapshot) < cutYear;
      if (favor > 0) add({ kind: "vat_favor", taxType: "vat", pucKey: TAX_PUC.vatFavor, label: `Saldo a favor de IVA ${periodName(snapshot)}${noncurrent ? " (no corriente)" : ""}`, cents: favor, ...(noncurrent && { noncurrent }), trace: traceOf("vat_favor", snapshot, { declared: favor, result: favor }, cut) }, [snapshot]);
    }
  }

  // Renta.
  const income = usable.filter((r) => r.taxType === "income").sort((a, b) => a.year - b.year);
  const latest = income[income.length - 1];
  if (latest) {
    const { favor } = effectiveValues(latest);
    const noncurrent = obligationYear(latest) < cutYear;
    if (favor > 0) add({ kind: "income_favor", taxType: "income", pucKey: TAX_PUC.incomeFavor, label: `Saldo a favor de Renta ${latest.year}${noncurrent ? " (no corriente)" : ""}`, cents: favor, ...(noncurrent && { noncurrent }), trace: traceOf("income_favor", latest, { declared: favor, result: favor }, cut) }, [latest]);
  }
  // El anticipo es un activo temporal del año siguiente: el 31/12 se consume en la liquidación de ese año y deja de aparecer.
  // Para EEFF del año X solo cuenta el anticipo de la declaración X−1; los anticipos de declaraciones anteriores ya se consumieron en EEFF anteriores.
  for (const r of income.filter((x) => x.advanceTargetYear === cutYear && cut < `${cutYear}-12-31` && (x.advanceNextCents ?? 0) > 0))
    add({ kind: "income_advance", taxType: "income", pucKey: TAX_PUC.incomeAdvance, label: `Anticipo de Renta ${cutYear} (declaración ${r.year})`, cents: r.advanceNextCents!, trace: traceOf("income_advance", r, { declared: r.advanceNextCents ?? 0, result: r.advanceNextCents ?? 0 }, cut) }, [r]);
  const prior = income.filter((r) => r.year < cutYear);
  if (prior.length) add({ kind: "prior_results", taxType: "income", pucKey: TAX_PUC.priorResults, label: `Resultados fiscales ${prior.map((r) => r.year).join(", ")}`, cents: prior.reduce((s, r) => s + fiscalResult(r), 0) }, prior);

  // Pagos por encima del saldo: intereses (gasto) y excedentes a favor (deudor, solo si el usuario los aprueba).
  const excessReviews: ExcessReviewItem[] = [];
  for (const r of live) {
    for (const p of r.payments) {
      if (p.excessCents <= 0 || p.paymentDate > cut) continue;
      if (p.excessKind === "interest") {
        add({ kind: "interest_expense", taxType: r.taxType, pucKey: TAX_PUC.interestExpense, label: `Intereses ${SHORT_TAX_LABEL[r.taxType]} ${periodName(r)} (pago ${p.paymentDate})`, cents: p.excessCents, date: p.paymentDate, trace: traceOf("interest_expense", r, { declared: p.excessCents, result: p.excessCents, paymentId: p.id }, cut) }, [r]);
        continue;
      }
      if (p.excessKind !== "favor") continue;
      const pucCode = input.puc.get(TAX_PUC.excessFavor) || null;
      const fingerprint = excessFingerprint(p, pucCode);
      const decision = p.excessReview?.decision ?? null;
      const stale = decision !== null && p.excessReview?.fingerprint !== fingerprint;
      const item: ExcessReviewItem = { paymentId: p.id, returnId: r.id, taxType: r.taxType, periodLabel: periodName(r), paymentDate: p.paymentDate, cents: p.excessCents, pucCode, fingerprint, decision, stale, needsReview: decision === null || stale, year: obligationYear(r) };
      excessReviews.push(item);
      if (item.needsReview || decision !== "applies") continue;
      const noncurrent = item.year < cutYear;
      add({ kind: "excess_favor", taxType: r.taxType, pucKey: TAX_PUC.excessFavor, label: `Excedente a favor DIAN ${SHORT_TAX_LABEL[r.taxType]} ${periodName(r)} (pago ${p.paymentDate})${noncurrent ? " (no corriente)" : ""}`, cents: p.excessCents, ...(noncurrent && { noncurrent }), trace: traceOf("excess_favor", r, { declared: p.excessCents, result: p.excessCents, paymentId: p.id }, cut) }, [r]);
    }
  }
  const toReview = excessReviews.filter((x) => x.needsReview);
  if (toReview.length)
    issues.push({ level: "blocking", taxType: toReview[0].taxType, code: "excess_review", message: `${toReview.length === 1 ? "Hay 1 excedente" : `Hay ${toReview.length} excedentes`} a favor de la DIAN por revisar: decide si aplica a Estados Financieros y 1008.` });

  return { effects, issues, excessReviews };
}

const formatMoney = (cents: number) => `$ ${Math.round(cents / 100).toLocaleString("es-CO")}`;
