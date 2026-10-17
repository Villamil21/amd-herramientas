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

export type FsSource = "purchases" | "bank" | "payroll" | "sales_einvoice" | "sales_tpsv" | "crypto_ops" | "opening" | "adjustment";

export const SOURCE_LABEL: Record<FsSource, string> = {
  purchases: "Compras",
  bank: "Extractos bancarios",
  payroll: "Nómina",
  sales_einvoice: "Ventas electrónicas",
  sales_tpsv: "Reportes UIAF",
  crypto_ops: "Transacciones Cripto",
  opening: "Saldos iniciales",
  adjustment: "Ajustes",
};

export type MovementStatus = "active" | "replaced" | "ignored" | "adjusted" | "voided";

export const MOVEMENT_STATUS_LABEL: Record<MovementStatus, string> = { active: "Activo", replaced: "Reemplazado", ignored: "Ignorado", adjusted: "Ajustado", voided: "Anulado" };

/** Edición de un movimiento desde Movimientos contables (siempre con motivo; nunca sobrescribe el original). */
export interface MovementEditInput {
  movementId: number;
  accountingDate: string;
  pucCode: string;
  pucConcept: string;
  description: string;
  amountCents: number;
  /** "active" = corregir valores (versión nueva); "ignored" / "voided" = solo cambiar el estado. */
  status: "active" | "ignored" | "voided";
  reason: string;
}

export interface MovementEditSnapshot {
  accountingDate: string;
  pucCode: string;
  pucConcept: string;
  description: string;
  amountCents: number;
  status: MovementStatus;
}

export interface MovementEdit {
  id: number;
  companyId: number;
  originalMovementId: number;
  newMovementId: number | null;
  reason: string;
  origin: string;
  previous: MovementEditSnapshot;
  next: MovementEditSnapshot;
  createdAt: string;
}

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

/** Fuentes que admiten «Registrar periodo sin …». */
export type EmptyPeriodSource = "purchases" | "payroll" | "sales_einvoice" | "sales_tpsv";

/** «✓ Sin compras», «✓ Sin nómina»… */
export const EMPTY_PERIOD_LABEL: Record<EmptyPeriodSource, string> = {
  purchases: "Sin compras",
  payroll: "Sin nómina",
  sales_einvoice: "Sin ventas",
  sales_tpsv: "Sin operaciones",
};

export type EmptyPeriodOutcome = { kind: "registered"; batchIds: number[] } | { kind: "hasData"; months: string[] };

/** Lote «periodo sin actividad»: cubre el mes sin movimientos. */
export function isEmptyPeriodBatch(b: Pick<BatchSummary, "metadata">): boolean {
  return b.metadata?.emptyPeriod === true;
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

/** Ciclo de vida de una cuenta bancaria (empresa + banco + número). Periodos AAAA-MM. */
export interface BankAccountLifecycle {
  companyId: number;
  bank: string;
  accountNumber: string;
  openedPeriod: string | null;
  closedPeriod: string | null;
  status: "active" | "closed";
  updatedAt: string;
  events: BankAccountEvent[];
}

export type BankLifecycleAction = "opened" | "closed" | "kept_active" | "existed_before" | "edited";

export interface BankAccountEvent {
  bank: string;
  accountNumber: string;
  action: BankLifecycleAction;
  period: string | null;
  note: string;
  previous: { openedPeriod?: string | null; closedPeriod?: string | null } | null;
  createdAt: string;
}

export interface BankLifecycleInput {
  companyId: number;
  bank: string;
  accountNumber: string;
  action: BankLifecycleAction;
  period?: string | null;
  openedPeriod?: string | null;
  closedPeriod?: string | null;
  note?: string;
}

/** Banco + concepto exacto → es GMF (4x1000) o no. */
export interface GmfRule {
  bank: string;
  concept: string;
  isGmf: boolean;
  origin: "auto" | "manual";
  confirmed: boolean;
  updatedAt: string;
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
  /** Historial de ediciones de la ficha (valores anteriores y nuevos). */
  events: { action: string; previous: Record<string, unknown> | null; next: Record<string, unknown> | null; createdAt: string }[];
}

export interface EmployeeUpdateInput {
  employeeId: number;
  docType: string;
  docNumber: string;
  name: string;
  /** Fecha de ingreso de la vinculación vigente. */
  hireDate: string;
  /** Área nueva y el mes (AAAA-MM) desde el que rige; los meses anteriores conservan la suya. */
  area?: Area | null;
  areaFrom?: string | null;
}

export interface PayrollRow {
  id: number;
  batchId: number;
  employeeId: number;
  employmentId: number;
  period: string;
  paymentDate: string;
  detail: Record<string, unknown> | null;
  /** Operador de la planilla del lote («Aportes en Línea», «MiPlanilla»); vacío en lotes sin ese dato. */
  provider: string;
  batchFileName: string;
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
export const PRESENTATION_LABEL: Record<Presentation, string> = { bank: "Bancos", otc: "OTC" };

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
