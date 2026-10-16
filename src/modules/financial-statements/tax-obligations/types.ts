/** Obligaciones tributarias: declaraciones DIAN guardadas por empresa. */

export type TaxType = "withholding" | "vat" | "income";
export type VatPeriodicity = "bimonthly" | "four_monthly";
export type TaxPeriodicity = "monthly" | VatPeriodicity | "annual";

export const TAX_LABEL: Record<TaxType, string> = { withholding: "Retención en la fuente", vat: "IVA", income: "Renta" };
export const SHORT_TAX_LABEL: Record<TaxType, string> = { withholding: "Retefuente", vat: "IVA", income: "Renta" };
export const PERIODICITY_LABEL: Record<TaxPeriodicity, string> = { monthly: "Mensual", bimonthly: "Bimestral", four_monthly: "Cuatrimestral", annual: "Anual" };

/** Solo un saldo a pagar o un saldo a favor: si la declaración trae ambos, el usuario decide cuál vale. */
export type TaxResolution = "" | "payable" | "favor";

/** «Periodo sin obligación» registrado (lo que devuelve Rust). */
export interface TaxEmptyPeriod {
  id: number;
  companyId: number;
  taxType: TaxType;
  year: number;
  period: number | null;
  periodicity: TaxPeriodicity;
  confirmation: string;
  status: "active" | "voided";
  createdAt: string;
  voidedAt: string | null;
}

/** Declaración guardada (lo que devuelve Rust). Valores en centavos. */
export interface TaxReturn {
  id: number;
  companyId: number;
  taxType: TaxType;
  year: number;
  /** Retefuente 1–12, IVA 1–6 o 1–3; Renta: null. */
  period: number | null;
  periodicity: TaxPeriodicity;
  /** Rango del periodo fiscal (AAAA-MM-DD). */
  periodStart: string;
  periodEnd: string;
  formNumber: string;
  previousFormNumber: string;
  isCorrection: boolean;
  /** Declaración que la reemplazó (corrección): ya no cuenta. */
  supersededBy: number | null;
  payableCents: number;
  favorCents: number;
  resolution: TaxResolution;
  nit: string;
  companyName: string;
  fileName: string;
  /** Solo Renta. */
  incomeOrdinaryCents: number | null;
  incomeLossCents: number | null;
  advanceNextCents: number | null;
  advanceTargetYear: number | null;
  /** Lectura completa (casillas, patrimonio declarado, avisos). */
  detail: TaxReturnDetail;
  createdAt: string;
  updatedAt: string;
  events: TaxReturnEvent[];
  /** Pagos registrados (0, 1 o varios), ordenados por fecha. */
  payments: TaxPayment[];
}

export interface TaxReturnDetail {
  formCode?: string;
  presentedOn?: string | null;
  yearSource?: "form" | "presentation" | "manual" | null;
  periodicityOnForm?: VatPeriodicity | null;
  values?: Record<string, { label: string; cents: number; casilla: string | null; expectedCasilla: string | null; foundBy: string }>;
  equity?: { key: string; label: string; cents: number | null; casilla: string | null }[];
  warnings?: string[];
  nameMismatchConfirmed?: boolean;
  /** Formulario 350: casillas numéricas leídas (casilla → centavos). Base de la discriminación por concepto. */
  withholding?: { casillas: Record<string, number> };
  /** Decisiones manuales del usuario (nunca se pisan al releer el PDF). */
  manual?: { adjustments129?: { id: string; conceptKey: string; cents: number; note: string }[] };
}

/** Pago total o parcial de una declaración con saldo a pagar. */
export interface TaxPayment {
  id: number;
  returnId: number;
  /** AAAA-MM-DD. */
  paymentDate: string;
  /** Valor aplicado a la obligación (nunca supera el saldo a pagar). */
  amountCents: number;
  /** Lo pagado por encima del saldo pendiente y su clasificación. */
  excessCents: number;
  excessKind: ExcessKind;
  /** Decisión sobre el excedente a favor para EEFF y 1008 (null: sin revisar). */
  excessReview: { decision: "applies" | "not_applies"; fingerprint: string; decidedAt: string } | null;
  note: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
}

export type ExcessKind = "" | "interest" | "favor";

export interface TaxPaymentInput {
  paymentDate: string;
  /** Total pagado: si supera el saldo pendiente, el sistema separa lo aplicado del excedente. */
  amountCents: number;
  excessKind: ExcessKind;
  note: string;
  reference: string;
}

export interface TaxReturnEvent {
  id: number;
  returnId: number;
  action: string;
  note: string;
  createdAt: string;
}

export interface TaxReturnInput {
  companyId: number;
  taxType: TaxType;
  year: number;
  period: number | null;
  periodicity: TaxPeriodicity;
  periodStart: string;
  periodEnd: string;
  formNumber: string;
  previousFormNumber: string;
  isCorrection: boolean;
  /** Declaración que esta reemplaza (corrección del mismo periodo). */
  replacesId: number | null;
  payableCents: number;
  favorCents: number;
  nit: string;
  companyName: string;
  fileName: string;
  incomeOrdinaryCents: number | null;
  incomeLossCents: number | null;
  advanceNextCents: number | null;
  advanceTargetYear: number | null;
  detail: TaxReturnDetail;
}

export interface TaxCompanySettings {
  companyId: number;
  vatPeriodicity: VatPeriodicity | null;
}

/** Cuentas PUC globales (fs_puc_settings). */
export const TAX_PUC = {
  withholdingPayable: "tax.withholding_payable",
  vatPayable: "tax.vat_payable",
  vatFavor: "tax.vat_favor",
  incomePayable: "tax.income_payable",
  incomeFavor: "tax.income_favor",
  incomeAdvance: "tax.income_advance",
  priorResults: "tax.prior_results",
  interestExpense: "tax.interest.expense",
  excessFavor: "tax.excess.favor",
} as const;

/** Cuenta por cobrar a socios (capital suscrito − pagado): global, obligatoria para llegar a EEFF. */
export const CAPITAL_RECEIVABLE_KEY = "capital.receivable";

export const sanctionExpenseKey = (t: TaxType) => `tax.sanction.expense.${t}`;
export const sanctionPayableKey = (t: TaxType) => `tax.sanction.payable.${t}`;

/** Clave PUC de una cuenta de configuración (las de Retefuente por concepto son dinámicas: tax.wh.<concepto>). */
export type TaxPucKey = string;

export interface TaxPucItem {
  key: TaxPucKey;
  label: string;
  group: string;
}

export const TAX_PUC_ITEMS: TaxPucItem[] = [
  { key: TAX_PUC.vatPayable, label: "IVA por pagar", group: "IVA" },
  { key: TAX_PUC.vatFavor, label: "Saldo a favor de IVA", group: "IVA" },
  { key: sanctionExpenseKey("vat"), label: "Sanciones de IVA — gasto", group: "IVA" },
  { key: sanctionPayableKey("vat"), label: "Sanciones de IVA — cuenta por pagar", group: "IVA" },
  { key: TAX_PUC.incomePayable, label: "Renta por pagar", group: "Renta" },
  { key: TAX_PUC.incomeFavor, label: "Saldo a favor de Renta", group: "Renta" },
  { key: TAX_PUC.incomeAdvance, label: "Anticipo de Renta", group: "Renta" },
  { key: TAX_PUC.priorResults, label: "Resultados de ejercicios anteriores (renta líquida / pérdida líquida)", group: "Renta" },
  { key: sanctionExpenseKey("income"), label: "Sanciones de Renta — gasto", group: "Renta" },
  { key: sanctionPayableKey("income"), label: "Sanciones de Renta — cuenta por pagar", group: "Renta" },
  { key: sanctionExpenseKey("withholding"), label: "Sanciones de Retefuente — gasto", group: "Retención en la fuente" },
  { key: sanctionPayableKey("withholding"), label: "Sanciones de Retefuente — cuenta por pagar", group: "Retención en la fuente" },
  { key: TAX_PUC.interestExpense, label: "Intereses por pagos de impuestos — gasto", group: "Pagos de impuestos" },
  { key: TAX_PUC.excessFavor, label: "Excedente a favor de la DIAN — deudor", group: "Pagos de impuestos" },
];

/** Claves PUC que cada impuesto necesita configurar (las de Retefuente por concepto salen de la declaración). */
export const PUC_KEYS_BY_TAX: Record<TaxType, TaxPucKey[]> = {
  withholding: [sanctionExpenseKey("withholding"), sanctionPayableKey("withholding"), TAX_PUC.interestExpense, TAX_PUC.excessFavor],
  vat: [TAX_PUC.vatPayable, TAX_PUC.vatFavor, sanctionExpenseKey("vat"), sanctionPayableKey("vat"), TAX_PUC.interestExpense, TAX_PUC.excessFavor],
  income: [TAX_PUC.incomePayable, TAX_PUC.incomeFavor, TAX_PUC.incomeAdvance, TAX_PUC.priorResults, sanctionExpenseKey("income"), sanctionPayableKey("income"), TAX_PUC.interestExpense, TAX_PUC.excessFavor],
};
