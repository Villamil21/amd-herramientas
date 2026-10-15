/**
 * Estados Financieros: catálogo de cuentas, movimientos contables por empresa,
 * nómina, ajustes y periodos. Espejo de los modelos de Rust (src-tauri/src/models/fs.rs).
 * Todos los valores en centavos enteros (exactos): el redondeo al millar es
 * solo de presentación.
 */

/** Secciones del catálogo. ESF: activo / pasivo / patrimonio. EERR: ingresos, costos, gastos y otros. */
export type FsSectionKey =
  | "asset_current"
  | "asset_noncurrent"
  | "liability_current"
  | "liability_noncurrent"
  | "equity"
  | "income"
  | "costs"
  | "admin_expenses"
  | "sales_expenses"
  | "other_income"
  | "other_expenses";

export const ESF_SECTIONS: FsSectionKey[] = ["asset_current", "asset_noncurrent", "liability_current", "liability_noncurrent", "equity"];
export const EERR_SECTIONS: FsSectionKey[] = ["income", "costs", "admin_expenses", "sales_expenses", "other_income", "other_expenses"];

export const SECTION_LABEL: Record<FsSectionKey, string> = {
  asset_current: "ACTIVO CORRIENTE",
  asset_noncurrent: "ACTIVO NO CORRIENTE",
  liability_current: "PASIVO CORRIENTE",
  liability_noncurrent: "PASIVO NO CORRIENTE",
  equity: "PATRIMONIO",
  income: "INGRESOS DE ACTIVIDADES ORDINARIAS",
  costs: "COSTOS DE ACTIVIDADES ORDINARIAS",
  admin_expenses: "GASTOS OPERACIONALES DE ADMINISTRACIÓN",
  sales_expenses: "GASTOS OPERACIONALES DE VENTAS",
  other_income: "Otros ingresos",
  other_expenses: "Otros gastos",
};

/** Secciones donde el usuario puede crear líneas (ESF completo; EERR: gastos operacionales). */
export const CREATABLE_SECTIONS: FsSectionKey[] = ["asset_current", "asset_noncurrent", "liability_current", "liability_noncurrent", "equity", "admin_expenses", "sales_expenses"];

export type FsLineRole = "share_capital" | "period_result" | "sales" | "third_party_income" | "cost_of_sales" | "third_party_cost";

export interface FsLine {
  id: number;
  section: FsSectionKey;
  name: string;
  sortOrder: number;
  role: FsLineRole | null;
  isActive: boolean;
  hasHistory: boolean;
}

export interface FsSection {
  section: FsSectionKey;
  representativeLineId: number | null;
}

export interface FsCatalog {
  lines: FsLine[];
  sections: FsSection[];
}

export interface FsPucMapping {
  pucCode: string;
  lineId: number | null;
  excluded: boolean;
  updatedAt: string;
}

export type FsSource = "purchases" | "bank" | "payroll" | "sales_einvoice" | "sales_tpsv" | "opening" | "adjustment";

export const SOURCE_LABEL: Record<FsSource, string> = {
  purchases: "Compras",
  bank: "Extractos bancarios",
  payroll: "Nómina",
  sales_einvoice: "Ventas electrónicas",
  sales_tpsv: "Reporte de operaciones",
  opening: "Saldos iniciales",
  adjustment: "Ajustes",
};

export type MovementStatus = "active" | "replaced" | "ignored" | "adjusted" | "voided";

export const MOVEMENT_STATUS_LABEL: Record<MovementStatus, string> = { active: "Activo", replaced: "Reemplazado", ignored: "Ignorado", adjusted: "Ajustado", voided: "Anulado" };

export interface MovementInput {
  accountingDate: string;
  conceptKey?: string;
  documentId?: string;
  documentNumber?: string;
  documentType?: string;
  supplierId?: number | null;
  supplierNit?: string;
  supplierName?: string;
  employeeId?: number | null;
  employmentId?: number | null;
  bank?: string;
  accountNumber?: string;
  pucCode: string;
  description?: string;
  amountCents: number;
  /** Solo extractos: D = salida del banco, C = entrada. El signo final lo da la sección destino. */
  dc?: "D" | "C" | null;
  /** Fecha en que se paga una cuenta por pagar. */
  settlesOn?: string | null;
  detail?: unknown;
}

export interface Movement extends Required<Omit<MovementInput, "detail" | "supplierId" | "employeeId" | "employmentId" | "dc" | "settlesOn">> {
  id: number;
  companyId: number;
  batchId: number;
  source: FsSource;
  supplierId: number | null;
  employeeId: number | null;
  employmentId: number | null;
  dc: "D" | "C" | null;
  settlesOn: string | null;
  pucConcept: string;
  status: MovementStatus;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface BankBalanceInput {
  bank: string;
  accountNumber: string;
  balanceDate: string;
  balanceCents: number;
  pucCode: string;
}

export interface BatchInput {
  companyId: number;
  source: FsSource;
  fileName?: string;
  periodLabel?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  dedupeKey?: string;
  replace?: boolean;
  metadata?: unknown;
  movements: MovementInput[];
  bankBalances?: BankBalanceInput[];
  bankConceptMappings?: { bank: string; concept: string; pucCode: string }[];
  payrollRows?: { employeeId: number; employmentId: number; period: string; paymentDate: string; detail?: unknown }[];
  decisions?: { documentKey: string; decision: string; detail?: string }[];
}

export interface BatchSummary {
  id: number;
  companyId: number;
  source: FsSource;
  fileName: string;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  dedupeKey: string;
  recordCount: number;
  totalCents: number;
  status: "active" | "replaced" | "voided";
  replacedBy: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type SendOutcome =
  | { kind: "sent"; batchId: number; replacedBatchIds: number[]; invalidatedPeriods: number }
  | { kind: "duplicate"; batches: BatchSummary[]; repeatedDocuments: number };

export interface BankBalance {
  id: number;
  batchId: number;
  bank: string;
  accountNumber: string;
  balanceDate: string;
  balanceCents: number;
  pucCode: string;
  active: boolean;
}

export interface BankAccount {
  id: number;
  companyId: number;
  bank: string;
  accountNumber: string;
  pucCode: string;
}

export interface BankConceptMapping {
  bank: string;
  concept: string;
  pucCode: string;
}

export interface PucSetting {
  key: string;
  pucCode: string;
}

export type SalesDocCategory = "sale" | "return" | "ignore";

export const SALES_DOC_CATEGORY_LABEL: Record<SalesDocCategory, string> = { sale: "Venta", return: "Devolución", ignore: "Ignorar" };

export interface SalesDocType {
  normalizedLabel: string;
  originalLabel: string;
  category: SalesDocCategory;
}

export type Area = "admin" | "sales";

export const AREA_LABEL: Record<Area, string> = { admin: "Administración", sales: "Ventas" };

export interface Employment {
  id: number;
  number: number;
  hireDate: string;
  endDate: string | null;
}

export interface Liquidation {
  id: number;
  employeeId: number;
  employmentId: number;
  liquidationDate: string;
  lastPeriod: string;
  primaCents: number;
  cesantiasCents: number;
  interesesCents: number;
  vacacionesCents: number;
  notes: string;
  createdAt: string;
}

export interface Employee {
  id: number;
  companyId: number;
  docType: string;
  docNumber: string;
  name: string;
  areas: { area: Area; effectiveFrom: string }[];
  employments: Employment[];
  liquidations: Liquidation[];
  justifications: { employeeId: number; period: string; justification: string; createdAt: string }[];
}

export interface PayrollRow {
  id: number;
  batchId: number;
  employeeId: number;
  employmentId: number;
  period: string;
  paymentDate: string;
  detail: Record<string, unknown> | null;
}

export type AdjustmentType = "replace" | "delta";

export interface AdjustmentInput {
  companyId: number;
  accountingDate: string;
  pucCode: string;
  reason: string;
  previousCents: number;
  adjustmentType: AdjustmentType;
  inputCents: number;
}

export interface Adjustment extends AdjustmentInput {
  id: number;
  movementId: number;
  concept: string;
  finalCents: number;
  createdAt: string;
  updatedAt: string;
  history: { previous: Record<string, unknown>; editedAt: string }[];
}

export type Presentation = "bank" | "otc";

/** Solo en la app: nunca aparece en el PDF. */
export const PRESENTATION_LABEL: Record<Presentation, string> = { bank: "Banco", otc: "OTC" };

export type PeriodStatus = "preparing" | "ready" | "pdf_generated" | "needs_review" | "closed";

export const PERIOD_STATUS_LABEL: Record<PeriodStatus, string> = {
  preparing: "En preparación",
  ready: "Cuadrado / Listo para generar",
  pdf_generated: "PDF generado",
  needs_review: "Requiere nueva revisión",
  closed: "Cerrado / Bloqueado",
};

export interface PeriodKey {
  companyId: number;
  startDate: string;
  endDate: string;
  presentation: Presentation;
}

export interface StatementVersion {
  id: number;
  version: number;
  fileName: string;
  snapshot: unknown;
  generatedAt: string;
}

export interface Period extends PeriodKey {
  id: number;
  status: PeriodStatus;
  validationHash: string | null;
  reviewReason: string;
  closedSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
  events: { action: string; note: string; createdAt: string }[];
  versions: StatementVersion[];
}
