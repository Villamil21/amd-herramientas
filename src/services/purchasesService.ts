import type {
  AliasKind,
  CompanyVatEntry,
  ExoAlias,
  RateVersion,
  DocFlagKind,
  LineClassInput,
  PucConcept1001,
  PurchaseRule,
  PurchaseScope,
  PurchasesState,
  RetentionPick,
  RuleHistory,
  SavePurchaseUploadInput,
  SavePurchaseUploadOutcome,
  IdenticalUpload,
  ReplaceFile,
  SupplierFiscalEntry,
  TitleKind,
  TitleType,
  YearConcept,
  YearConceptAudit,
  YearConceptInput,
} from "../types/purchases";
import { call } from "./tauri";

/** Compras, costos y exógena: facturas por empresa y año, clasificación por línea, reglas e historiales fiscales (todo en SQLite). */
export const purchasesService = {
  state: (buyerNit: string, year: number | null) => call<PurchasesState>("get_purchases_state", { buyerNit, year }),
  scopes: () => call<PurchaseScope[]>("list_purchase_scopes"),
  saveUpload: (input: SavePurchaseUploadInput) => call<SavePurchaseUploadOutcome>("save_purchase_upload", { input }),
  /** Carga vigente de la empresa con exactamente el mismo conjunto de facturas (por huella de contenido), si existe. */
  findIdenticalUpload: (buyerNit: string, fingerprints: string[]) => call<IdenticalUpload | null>("find_identical_purchase_upload", { buyerNit, fingerprints }),
  /** Reemplaza esa carga: solo cambia el nombre de la carpeta y de los archivos; no crea facturas, evidencias ni cargas. */
  replaceIdenticalUpload: (uploadId: number, folderName: string, files: ReplaceFile[]) => call<number>("replace_identical_purchase_upload", { uploadId, folderName, files }),
  /** Sustituye la factura vigente por esta versión duplicada (autorización explícita; la anterior queda como evidencia). */
  substitute: (id: number) => call<void>("substitute_purchase_document", { id }),
  saveLineClasses: (inputs: LineClassInput[]) => call<void>("save_purchase_line_classes", { inputs }),
  deleteLineClass: (documentId: number, lineIndex: number) => call<void>("delete_purchase_line_class", { documentId, lineIndex }),
  setFlag: (documentId: number, kind: DocFlagKind, value: string) => call<void>("set_purchase_doc_flag", { documentId, kind, value }),
  deleteFlag: (documentId: number, kind: DocFlagKind) => call<void>("delete_purchase_doc_flag", { documentId, kind }),
  audit: (buyerNit: string, year: number | null, event: string, detail: Record<string, unknown>) => call<void>("append_purchase_audit", { buyerNit, year, event, detail }),

  rules: () => call<PurchaseRule[]>("list_purchase_rules"),
  ruleHistory: (ruleId: number | null) => call<RuleHistory[]>("list_purchase_rule_history", { ruleId }),
  updateRule: (id: number, pucCode: string, concept1001: string, retention: RetentionPick[]) => call<void>("update_purchase_rule", { id, pucCode, concept1001, retention }),
  deleteRule: (id: number) => call<void>("delete_purchase_rule", { id }),

  titleTypes: () => call<TitleType[]>("list_purchase_title_types"),
  saveTitleType: (titleKey: string, displayTitle: string, kind: TitleKind) => call<void>("save_purchase_title_type", { titleKey, displayTitle, kind }),
  deleteTitleType: (titleKey: string) => call<void>("delete_purchase_title_type", { titleKey }),

  companyVatHistory: (companyId: number | null = null) => call<CompanyVatEntry[]>("list_company_vat_history", { companyId }),
  saveCompanyVat: (input: { companyId: number; effectiveDate: string; responsible: boolean; source: "rut" | "manual"; note: string }) => call<void>("save_company_vat_entry", { input }),
  deleteCompanyVat: (companyId: number, effectiveDate: string) => call<void>("delete_company_vat_entry", { companyId, effectiveDate }),

  supplierFiscalHistory: (supplierNit: string | null = null) => call<SupplierFiscalEntry[]>("list_supplier_fiscal_history", { supplierNit }),
  saveSupplierFiscal: (input: { supplierNit: string; effectiveDate: string; regime: string; source: "factura" | "manual" | "proveedor"; note: string }) => call<void>("save_supplier_fiscal_entry", { input }),
  deleteSupplierFiscal: (supplierNit: string, effectiveDate: string) => call<void>("delete_supplier_fiscal_entry", { supplierNit, effectiveDate }),

  pucConcepts1001: () => call<PucConcept1001[]>("list_puc_concepts_1001"),
  setPucConcept1001: (pucCode: string, conceptCode: string | null) => call<void>("set_puc_concept_1001", { pucCode, conceptCode }),

  yearConcepts: (formatCode: string, year: number | null = null) => call<YearConcept[]>("list_exo_year_concepts", { formatCode, year }),
  saveYearConcept: (input: YearConceptInput) => call<void>("save_exo_year_concept", { input }),
  deleteYearConcept: (formatCode: string, year: number, code: string) => call<void>("delete_exo_year_concept", { formatCode, year, code }),
  copyYearConcepts: (formatCode: string, fromYear: number, toYear: number) => call<number>("copy_exo_year_concepts", { formatCode, fromYear, toYear }),
  yearConceptAudit: (formatCode: string, year: number | null = null, limit = 200) => call<YearConceptAudit[]>("list_exo_year_concept_audit", { formatCode, year, limit }),
};

export const catalogExtrasService = {
  rateVersions: () => call<RateVersion[]>("list_withholding_rate_versions"),
  saveRateVersion: (rateId: number, effectiveFrom: string, baseUvtCenti: number, rateBp: number, note: string) => call<void>("save_withholding_rate_version", { rateId, effectiveFrom, baseUvtCenti, rateBp, note }),
  deleteRateVersion: (rateId: number, effectiveFrom: string) => call<void>("delete_withholding_rate_version", { rateId, effectiveFrom }),
  aliases: (kind: AliasKind | null = null) => call<ExoAlias[]>("list_exo_aliases", { kind }),
  saveAlias: (kind: AliasKind, aliasKey: string, parent: string, alias: string, target: string) => call<void>("save_exo_alias", { kind, aliasKey, parent, alias, target }),
  deleteAlias: (kind: AliasKind, aliasKey: string, parent: string) => call<void>("delete_exo_alias", { kind, aliasKey, parent }),
};
