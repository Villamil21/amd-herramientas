import type {
  Adjustment,
  AdjustmentInput,
  BankAccount,
  BankAccountLifecycle,
  BankLifecycleInput,
  BankBalance,
  BankConceptMapping,
  BatchInput,
  BatchSummary,
  EmptyPeriodOutcome,
  EmptyPeriodSource,
  Employee,
  EmployeeUpdateInput,
  FsCatalog,
  FsPucMapping,
  FsSectionKey,
  GmfRule,
  Liquidation,
  Movement,
  MovementEdit,
  MovementEditInput,
  PayrollRow,
  Period,
  PeriodKey,
  PucSetting,
  SalesDocCategory,
  SalesDocType,
  SendOutcome,
  StatementVersion,
} from "../types/fs";
import { call } from "./tauri";

/** Estados Financieros: todo lo que se guarda en SQLite (con sus reglas de integridad en Rust). */
export const fsService = {
  // Catálogo de cuentas
  catalog: () => call<FsCatalog>("get_fs_catalog"),
  createLine: (section: FsSectionKey, name: string) => call<number>("create_fs_line", { section, name }),
  updateLine: (id: number, name: string, isActive: boolean) => call<void>("update_fs_line", { id, name, isActive }),
  reorderLines: (section: FsSectionKey, ids: number[]) => call<void>("reorder_fs_lines", { section, ids }),
  setRepresentative: (section: FsSectionKey, lineId: number) => call<void>("set_fs_section_representative", { section, lineId }),
  mappings: () => call<FsPucMapping[]>("list_fs_puc_mappings"),
  /** PUC → línea, o «No afecta Estados Financieros» (excluded). */
  setMapping: (pucCode: string, lineId: number | null, excluded: boolean) => call<void>("set_fs_puc_mapping", { pucCode, lineId, excluded }),

  // Movimientos
  send: (input: BatchInput) => call<SendOutcome>("send_fs_batch", { input }),
  /** Retira del cálculo un envío de Transacciones Cripto desactualizado (se conserva para auditoría); devuelve los periodos que vuelven a revisión. */
  /** Marca un envío de Cripto como desactualizado sin tocar movimientos (sirve con periodo cerrado). */
  markCryptoOutdated: (batchId: number, reason: string) => call<void>("mark_fs_crypto_batch_outdated", { batchId, reason }),
  voidCryptoBatch: (batchId: number, reason: string) => call<number>("void_fs_crypto_batch", { batchId, reason }),
  batches: (companyId: number) => call<BatchSummary[]>("list_fs_batches", { companyId }),
  /** Meses sin actividad (sin movimientos): cubren el Generador. `allowWithData`: el usuario aceptó la advertencia de datos reales. */
  registerEmptyPeriod: (input: { companyId: number; source: EmptyPeriodSource; months: string[]; confirmation: string; allowWithData?: boolean }) =>
    call<EmptyPeriodOutcome>("register_fs_empty_period", { input }),
  voidEmptyPeriod: (batchId: number, reason: string) => call<void>("void_fs_empty_period", { batchId, reason }),
  movements: (companyId: number) => call<Movement[]>("list_fs_movements", { companyId }),
  reclassify: (companyId: number | null, ids: number[], pucCode: string) => call<number>("reclassify_fs_movements", { companyId, ids, pucCode }),
  editMovement: (input: MovementEditInput) => call<MovementEdit>("edit_fs_movement", { input }),
  movementEdits: (companyId: number) => call<MovementEdit[]>("list_fs_movement_edits", { companyId }),
  bankBalances: (companyId: number) => call<BankBalance[]>("list_fs_bank_balances", { companyId }),
  bankAccounts: () => call<BankAccount[]>("list_fs_bank_accounts"),
  bankConceptMappings: () => call<BankConceptMapping[]>("list_fs_bank_concept_mappings"),
  /** Apertura / cierre de las cuentas de una empresa, con su auditoría. */
  bankLifecycles: (companyId: number) => call<BankAccountLifecycle[]>("list_fs_bank_lifecycles", { companyId }),
  saveBankLifecycle: (input: BankLifecycleInput) => call<void>("save_fs_bank_lifecycle", { input }),
  gmfRules: () => call<GmfRule[]>("list_fs_bank_gmf_rules"),
  saveGmfRule: (bank: string, concept: string, isGmf: boolean, origin: "auto" | "manual") => call<void>("save_fs_bank_gmf_rule", { bank, concept, isGmf, origin }),

  // Configuración global
  pucSettings: () => call<PucSetting[]>("list_fs_puc_settings"),
  savePucSettings: (items: PucSetting[]) => call<void>("save_fs_puc_settings", { items }),
  salesDocTypes: () => call<SalesDocType[]>("list_fs_sales_doc_types"),
  saveSalesDocType: (normalizedLabel: string, originalLabel: string, category: SalesDocCategory) => call<void>("save_fs_sales_doc_type", { normalizedLabel, originalLabel, category }),

  // Saldos iniciales
  openingDraft: (companyId: number, balanceDate: string) => call<unknown>("get_fs_opening_draft", { companyId, balanceDate }),
  openingDates: (companyId: number) => call<string[]>("list_fs_opening_dates", { companyId }),
  saveOpeningDraft: (companyId: number, balanceDate: string, rows: unknown[]) => call<void>("save_fs_opening_draft", { companyId, balanceDate, rows }),

  // Nómina
  employees: (companyId: number) => call<Employee[]>("list_fs_employees", { companyId }),
  createEmployee: (input: { companyId: number; docType: string; docNumber: string; name: string; hireDate: string; area: string; effectiveFrom: string }) =>
    call<number>("create_fs_employee", { input }),
  updateEmployee: (input: EmployeeUpdateInput) => call<void>("update_fs_employee", { input }),
  setEmployeeArea: (employeeId: number, area: string, effectiveFrom: string) => call<void>("set_fs_employee_area", { employeeId, area, effectiveFrom }),
  addEmployment: (employeeId: number, hireDate: string) => call<number>("add_fs_employment", { employeeId, hireDate }),
  registerLiquidation: (input: { employmentId: number; liquidationDate: string; lastPeriod: string; notes: string }) => call<Liquidation>("register_fs_liquidation", { input }),
  justifyAbsence: (employeeId: number, period: string, justification: string) => call<void>("justify_fs_absence", { employeeId, period, justification }),
  payrollRows: (companyId: number) => call<PayrollRow[]>("list_fs_payroll_rows", { companyId }),

  // Ajustes
  createAdjustment: (input: AdjustmentInput) => call<number>("create_fs_adjustment", { input }),
  updateAdjustment: (id: number, input: AdjustmentInput) => call<void>("update_fs_adjustment", { id, input }),
  adjustments: (companyId: number) => call<Adjustment[]>("list_fs_adjustments", { companyId }),

  // Notas Financieras (por empresa y período)
  notes: (companyId: number, periodStart: string, periodEnd: string) => call<FsNotes | null>("get_fs_notes", { companyId, periodStart, periodEnd }),
  saveNotes: (input: FsNotesInput) => call<FsNotes>("save_fs_notes", { input }),
  deleteNotes: (companyId: number, periodStart: string, periodEnd: string) => call<void>("delete_fs_notes", { companyId, periodStart, periodEnd }),

  // Periodos
  period: (key: PeriodKey) => call<Period | null>("get_fs_period", { key }),
  periods: (companyId: number) => call<Period[]>("list_fs_periods", { companyId }),
  markReady: (key: PeriodKey, hash: string) => call<void>("mark_fs_period_ready", { key, hash }),
  markNeedsReview: (key: PeriodKey, reason: string) => call<void>("mark_fs_period_needs_review", { key, reason }),
  recordVersion: (key: PeriodKey, fileName: string, snapshot: unknown) => call<StatementVersion>("record_fs_statement_version", { key, fileName, snapshot }),
  close: (key: PeriodKey, snapshot: unknown) => call<void>("close_fs_period", { key, snapshot }),
  unlock: (key: PeriodKey, note: string) => call<void>("unlock_fs_period", { key, note }),
};

export interface FsNotes {
  id: number;
  companyId: number;
  periodStart: string;
  periodEnd: string;
  data: unknown;
  companySnapshot: unknown;
  generatedAt: string | null;
  updatedAt: string;
}

export interface FsNotesInput {
  companyId: number;
  periodStart: string;
  periodEnd: string;
  data: unknown;
  companySnapshot: unknown;
  /** El usuario generó el PDF con esta versión. */
  generated?: boolean;
}
