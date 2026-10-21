use serde_json::Value;
use tauri::State;

use crate::database::purchases::{
    self, LineClassInput, PurchaseRule, PurchaseScope, PurchasesState, RuleHistory, SavePurchaseUploadInput, SavePurchaseUploadOutcome, TitleType,
};
use crate::database::tax_profiles::{
    self, CompanyVatEntry, CompanyVatEntryInput, PucConcept1001, SupplierFiscalEntry, SupplierFiscalEntryInput, YearConcept, YearConceptAudit, YearConceptInput,
};
use crate::database::Db;
use crate::error::AppResult;

#[tauri::command]
pub fn get_purchases_state(db: State<'_, Db>, buyer_nit: String, year: Option<i64>) -> AppResult<PurchasesState> {
    db.with(|c| purchases::state(c, buyer_nit.trim(), year))
}

#[tauri::command]
pub fn list_purchase_scopes(db: State<'_, Db>) -> AppResult<Vec<PurchaseScope>> {
    db.with(|c| purchases::list_scopes(c))
}

#[tauri::command]
pub fn save_purchase_upload(db: State<'_, Db>, input: SavePurchaseUploadInput) -> AppResult<SavePurchaseUploadOutcome> {
    db.with(|c| purchases::save_upload(c, &input))
}

#[tauri::command]
pub fn find_identical_purchase_upload(db: State<'_, Db>, buyer_nit: String, fingerprints: Vec<String>) -> AppResult<Option<purchases::IdenticalUpload>> {
    db.with(|c| purchases::find_identical_upload(c, &buyer_nit, &fingerprints))
}

#[tauri::command]
pub fn replace_identical_purchase_upload(db: State<'_, Db>, upload_id: i64, folder_name: String, files: Vec<purchases::ReplaceFile>) -> AppResult<i64> {
    db.with(|c| purchases::replace_identical_upload(c, upload_id, &folder_name, &files))
}

#[tauri::command]
pub fn substitute_purchase_document(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| purchases::substitute_document(c, id))
}

#[tauri::command]
pub fn save_purchase_line_classes(db: State<'_, Db>, inputs: Vec<LineClassInput>) -> AppResult<()> {
    db.with(|c| purchases::save_line_classes(c, &inputs))
}

#[tauri::command]
pub fn delete_purchase_line_class(db: State<'_, Db>, document_id: i64, line_index: i64) -> AppResult<()> {
    db.with(|c| purchases::delete_line_class(c, document_id, line_index))
}

#[tauri::command]
pub fn set_purchase_doc_flag(db: State<'_, Db>, document_id: i64, kind: String, value: String) -> AppResult<()> {
    db.with(|c| purchases::set_doc_flag(c, document_id, &kind, &value))
}

#[tauri::command]
pub fn delete_purchase_doc_flag(db: State<'_, Db>, document_id: i64, kind: String) -> AppResult<()> {
    db.with(|c| purchases::delete_doc_flag(c, document_id, &kind))
}

#[tauri::command]
pub fn list_purchase_rules(db: State<'_, Db>) -> AppResult<Vec<PurchaseRule>> {
    db.with(|c| purchases::list_rules(c))
}

#[tauri::command]
pub fn list_purchase_rule_history(db: State<'_, Db>, rule_id: Option<i64>) -> AppResult<Vec<RuleHistory>> {
    db.with(|c| purchases::list_rule_history(c, rule_id))
}

#[tauri::command]
pub fn update_purchase_rule(db: State<'_, Db>, id: i64, puc_code: String, concept_1001: String, retention: Value) -> AppResult<()> {
    db.with(|c| purchases::update_rule(c, id, puc_code.trim(), concept_1001.trim(), &retention))
}

#[tauri::command]
pub fn delete_purchase_rule(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| purchases::delete_rule(c, id))
}

#[tauri::command]
pub fn list_purchase_title_types(db: State<'_, Db>) -> AppResult<Vec<TitleType>> {
    db.with(|c| purchases::list_title_types(c))
}

#[tauri::command]
pub fn save_purchase_title_type(db: State<'_, Db>, title_key: String, display_title: String, kind: String) -> AppResult<()> {
    db.with(|c| purchases::save_title_type(c, &title_key, &display_title, &kind))
}

#[tauri::command]
pub fn delete_purchase_title_type(db: State<'_, Db>, title_key: String) -> AppResult<()> {
    db.with(|c| purchases::delete_title_type(c, &title_key))
}

#[tauri::command]
pub fn append_purchase_audit(db: State<'_, Db>, buyer_nit: String, year: Option<i64>, event: String, detail: Value) -> AppResult<()> {
    db.with(|c| purchases::audit(c, buyer_nit.trim(), year, &event, &detail))
}

#[tauri::command]
pub fn list_company_vat_history(db: State<'_, Db>, company_id: Option<i64>) -> AppResult<Vec<CompanyVatEntry>> {
    db.with(|c| tax_profiles::list_vat_history(c, company_id))
}

#[tauri::command]
pub fn save_company_vat_entry(db: State<'_, Db>, input: CompanyVatEntryInput) -> AppResult<()> {
    db.with(|c| tax_profiles::save_vat_entry(c, &input))
}

#[tauri::command]
pub fn delete_company_vat_entry(db: State<'_, Db>, company_id: i64, effective_date: String) -> AppResult<()> {
    db.with(|c| tax_profiles::delete_vat_entry(c, company_id, &effective_date))
}

#[tauri::command]
pub fn list_supplier_fiscal_history(db: State<'_, Db>, supplier_nit: Option<String>) -> AppResult<Vec<SupplierFiscalEntry>> {
    db.with(|c| tax_profiles::list_fiscal_history(c, supplier_nit.as_deref()))
}

#[tauri::command]
pub fn save_supplier_fiscal_entry(db: State<'_, Db>, input: SupplierFiscalEntryInput) -> AppResult<purchases::ExemptCleanup> {
    db.with(|c| {
        tax_profiles::save_fiscal_entry(c, &input)?;
        purchases::clean_exempt_retention(c)
    })
}

#[tauri::command]
pub fn delete_supplier_fiscal_entry(db: State<'_, Db>, supplier_nit: String, effective_date: String) -> AppResult<purchases::ExemptCleanup> {
    db.with(|c| {
        tax_profiles::delete_fiscal_entry(c, &supplier_nit, &effective_date)?;
        purchases::clean_exempt_retention(c)
    })
}

#[tauri::command]
pub fn list_puc_concepts_1001(db: State<'_, Db>) -> AppResult<Vec<PucConcept1001>> {
    db.with(|c| tax_profiles::list_puc_concepts(c))
}

#[tauri::command]
pub fn set_puc_concept_1001(db: State<'_, Db>, puc_code: String, concept_code: Option<String>) -> AppResult<()> {
    db.with(|c| tax_profiles::set_puc_concept(c, &puc_code, concept_code.as_deref()))
}

#[tauri::command]
pub fn list_exo_year_concepts(db: State<'_, Db>, format_code: String, year: Option<i64>) -> AppResult<Vec<YearConcept>> {
    db.with(|c| tax_profiles::list_year_concepts(c, &format_code, year))
}

#[tauri::command]
pub fn save_exo_year_concept(db: State<'_, Db>, input: YearConceptInput) -> AppResult<()> {
    db.with(|c| tax_profiles::save_year_concept(c, &input))
}

#[tauri::command]
pub fn delete_exo_year_concept(db: State<'_, Db>, format_code: String, year: i64, code: String) -> AppResult<()> {
    db.with(|c| tax_profiles::delete_year_concept(c, &format_code, year, &code))
}

#[tauri::command]
pub fn copy_exo_year_concepts(db: State<'_, Db>, format_code: String, from_year: i64, to_year: i64) -> AppResult<i64> {
    db.with(|c| tax_profiles::copy_year_concepts(c, &format_code, from_year, to_year))
}

#[tauri::command]
pub fn list_exo_year_concept_audit(db: State<'_, Db>, format_code: String, year: Option<i64>, limit: i64) -> AppResult<Vec<YearConceptAudit>> {
    db.with(|c| tax_profiles::list_year_concept_audit(c, &format_code, year, limit))
}

#[tauri::command]
pub fn set_purchase_total_decision(db: State<'_, Db>, document_id: i64, choice: String, reason: String, lines_cents: i64, gross_cents: i64) -> AppResult<()> {
    db.with(|c| purchases::set_total_decision(c, document_id, &choice, &reason, lines_cents, gross_cents))
}

#[tauri::command]
pub fn delete_purchase_total_decision(db: State<'_, Db>, document_id: i64) -> AppResult<()> {
    db.with(|c| purchases::delete_total_decision(c, document_id))
}

#[tauri::command]
pub fn set_purchase_line_override(db: State<'_, Db>, document_id: i64, line_index: i64, base_cents: i64, reason: String) -> AppResult<()> {
    db.with(|c| purchases::set_line_override(c, document_id, line_index, base_cents, &reason))
}

#[tauri::command]
pub fn delete_purchase_line_override(db: State<'_, Db>, document_id: i64, line_index: i64) -> AppResult<()> {
    db.with(|c| purchases::delete_line_override(c, document_id, line_index))
}
