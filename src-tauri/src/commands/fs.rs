//! Estados Financieros: catálogo de cuentas, movimientos contables, nómina,
//! ajustes y periodos. La lógica de cada submódulo (lectura de archivos,
//! cálculos de nómina, generación de los estados) vive en el frontend; aquí se
//! guarda todo con sus reglas de integridad.

use serde_json::Value;
use tauri::State;

use crate::database::{fs, Db};
use crate::error::AppResult;
use crate::models::fs::*;

#[tauri::command]
pub fn get_fs_catalog(db: State<'_, Db>) -> AppResult<FsCatalog> {
    db.with(|c| fs::catalog(c))
}

#[tauri::command]
pub fn create_fs_line(db: State<'_, Db>, section: String, name: String) -> AppResult<i64> {
    db.with(|c| fs::create_line(c, &section, &name))
}

#[tauri::command]
pub fn update_fs_line(db: State<'_, Db>, id: i64, name: String, is_active: bool) -> AppResult<()> {
    db.with(|c| fs::update_line(c, id, &name, is_active))
}

#[tauri::command]
pub fn reorder_fs_lines(db: State<'_, Db>, section: String, ids: Vec<i64>) -> AppResult<()> {
    db.with(|c| fs::reorder_lines(c, &section, &ids))
}

#[tauri::command]
pub fn set_fs_section_representative(db: State<'_, Db>, section: String, line_id: i64) -> AppResult<()> {
    db.with(|c| fs::set_representative(c, &section, line_id))
}

#[tauri::command]
pub fn list_fs_puc_mappings(db: State<'_, Db>) -> AppResult<Vec<FsPucMapping>> {
    db.with(|c| fs::list_mappings(c))
}

#[tauri::command]
pub fn set_fs_puc_mapping(db: State<'_, Db>, puc_code: String, line_id: Option<i64>, excluded: bool) -> AppResult<()> {
    db.with(|c| fs::set_mapping(c, puc_code.trim(), line_id, excluded))
}

#[tauri::command]
pub fn send_fs_batch(db: State<'_, Db>, input: BatchInput) -> AppResult<SendOutcome> {
    db.with(|c| fs::send_batch(c, &input))
}

/// «Registrar periodo sin compras / nómina / ventas / operaciones».
#[tauri::command]
pub fn register_fs_empty_period(db: State<'_, Db>, input: EmptyPeriodInput) -> AppResult<EmptyPeriodOutcome> {
    db.with(|c| fs::register_empty_period(c, &input))
}

#[tauri::command]
pub fn void_fs_empty_period(db: State<'_, Db>, batch_id: i64, reason: String) -> AppResult<()> {
    db.with(|c| fs::void_empty_period(c, batch_id, &reason))
}

#[tauri::command]
pub fn list_fs_batches(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<BatchSummary>> {
    db.with(|c| fs::list_batches(c, company_id))
}

#[tauri::command]
pub fn list_fs_movements(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<Movement>> {
    db.with(|c| fs::list_movements(c, company_id))
}

#[tauri::command]
pub fn reclassify_fs_movements(db: State<'_, Db>, company_id: Option<i64>, ids: Vec<i64>, puc_code: String) -> AppResult<i64> {
    db.with(|c| fs::reclassify_movements(c, company_id, &ids, puc_code.trim()))
}

#[tauri::command]
pub fn edit_fs_movement(db: State<'_, Db>, input: MovementEditInput) -> AppResult<MovementEdit> {
    db.with(|c| fs::edit_movement(c, &input))
}

#[tauri::command]
pub fn list_fs_movement_edits(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<MovementEdit>> {
    db.with(|c| fs::list_movement_edits(c, company_id))
}

#[tauri::command]
pub fn list_fs_bank_balances(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<BankBalance>> {
    db.with(|c| fs::list_bank_balances(c, company_id))
}

#[tauri::command]
pub fn list_fs_bank_accounts(db: State<'_, Db>) -> AppResult<Vec<BankAccount>> {
    db.with(|c| fs::list_bank_accounts(c))
}

#[tauri::command]
pub fn list_fs_bank_concept_mappings(db: State<'_, Db>) -> AppResult<Vec<BankConceptMapping>> {
    db.with(|c| fs::list_bank_concept_mappings(c))
}

#[tauri::command]
pub fn list_fs_puc_settings(db: State<'_, Db>) -> AppResult<Vec<PucSetting>> {
    db.with(|c| fs::list_puc_settings(c))
}

#[tauri::command]
pub fn save_fs_puc_settings(db: State<'_, Db>, items: Vec<PucSetting>) -> AppResult<()> {
    db.with(|c| fs::save_puc_settings(c, &items))
}

#[tauri::command]
pub fn list_fs_sales_doc_types(db: State<'_, Db>) -> AppResult<Vec<SalesDocType>> {
    db.with(|c| fs::list_sales_doc_types(c))
}

#[tauri::command]
pub fn save_fs_sales_doc_type(db: State<'_, Db>, normalized_label: String, original_label: String, category: String) -> AppResult<()> {
    db.with(|c| fs::save_sales_doc_type(c, &normalized_label, &original_label, &category))
}

#[tauri::command]
pub fn get_fs_opening_draft(db: State<'_, Db>, company_id: i64, balance_date: String) -> AppResult<Option<Value>> {
    db.with(|c| fs::get_opening_draft(c, company_id, &balance_date))
}

#[tauri::command]
pub fn list_fs_opening_dates(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<String>> {
    db.with(|c| fs::list_opening_dates(c, company_id))
}

#[tauri::command]
pub fn save_fs_opening_draft(db: State<'_, Db>, company_id: i64, balance_date: String, rows: Value) -> AppResult<()> {
    db.with(|c| fs::save_opening_draft(c, company_id, &balance_date, &rows))
}

#[tauri::command]
pub fn list_fs_employees(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<Employee>> {
    db.with(|c| fs::list_employees(c, company_id))
}

#[tauri::command]
pub fn create_fs_employee(db: State<'_, Db>, input: EmployeeInput) -> AppResult<i64> {
    db.with(|c| fs::create_employee(c, &input))
}

#[tauri::command]
pub fn update_fs_employee(db: State<'_, Db>, input: EmployeeUpdateInput) -> AppResult<()> {
    db.with(|c| fs::update_employee(c, &input))
}

#[tauri::command]
pub fn list_fs_bank_lifecycles(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<BankAccountLifecycle>> {
    db.with(|c| fs::list_bank_lifecycles(c, company_id))
}

#[tauri::command]
pub fn save_fs_bank_lifecycle(db: State<'_, Db>, input: BankLifecycleInput) -> AppResult<()> {
    db.with(|c| fs::save_bank_lifecycle(c, &input))
}

#[tauri::command]
pub fn list_fs_bank_gmf_rules(db: State<'_, Db>) -> AppResult<Vec<GmfRule>> {
    db.with(|c| fs::list_gmf_rules(c))
}

#[tauri::command]
pub fn save_fs_bank_gmf_rule(db: State<'_, Db>, bank: String, concept: String, is_gmf: bool, origin: String) -> AppResult<()> {
    db.with(|c| fs::save_gmf_rule(c, &bank, &concept, is_gmf, &origin))
}

#[tauri::command]
pub fn set_fs_employee_area(db: State<'_, Db>, employee_id: i64, area: String, effective_from: String) -> AppResult<()> {
    db.with(|c| fs::set_employee_area(c, employee_id, &area, &effective_from))
}

#[tauri::command]
pub fn add_fs_employment(db: State<'_, Db>, employee_id: i64, hire_date: String) -> AppResult<i64> {
    db.with(|c| fs::add_employment(c, employee_id, &hire_date))
}

#[tauri::command]
pub fn register_fs_liquidation(db: State<'_, Db>, input: LiquidationInput) -> AppResult<Liquidation> {
    db.with(|c| fs::register_liquidation(c, &input))
}

#[tauri::command]
pub fn justify_fs_absence(db: State<'_, Db>, employee_id: i64, period: String, justification: String) -> AppResult<()> {
    db.with(|c| fs::justify_absence(c, employee_id, &period, &justification))
}

#[tauri::command]
pub fn list_fs_payroll_rows(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<PayrollRow>> {
    db.with(|c| fs::list_payroll_rows(c, company_id))
}

#[tauri::command]
pub fn create_fs_adjustment(db: State<'_, Db>, input: AdjustmentInput) -> AppResult<i64> {
    db.with(|c| fs::create_adjustment(c, &input))
}

#[tauri::command]
pub fn update_fs_adjustment(db: State<'_, Db>, id: i64, input: AdjustmentInput) -> AppResult<()> {
    db.with(|c| fs::update_adjustment(c, id, &input))
}

#[tauri::command]
pub fn list_fs_adjustments(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<Adjustment>> {
    db.with(|c| fs::list_adjustments(c, company_id))
}

#[tauri::command]
pub fn get_fs_period(db: State<'_, Db>, key: PeriodKey) -> AppResult<Option<Period>> {
    let key = key.validated()?;
    db.with(|c| fs::get_period(c, &key))
}

#[tauri::command]
pub fn list_fs_periods(db: State<'_, Db>, company_id: i64) -> AppResult<Vec<Period>> {
    db.with(|c| fs::list_periods(c, company_id))
}

#[tauri::command]
pub fn mark_fs_period_ready(db: State<'_, Db>, key: PeriodKey, hash: String) -> AppResult<()> {
    let key = key.validated()?;
    db.with(|c| fs::mark_ready(c, &key, &hash))
}

#[tauri::command]
pub fn mark_fs_period_needs_review(db: State<'_, Db>, key: PeriodKey, reason: String) -> AppResult<()> {
    let key = key.validated()?;
    db.with(|c| fs::mark_needs_review(c, &key, &reason))
}

#[tauri::command]
pub fn record_fs_statement_version(db: State<'_, Db>, key: PeriodKey, file_name: String, snapshot: Value) -> AppResult<StatementVersion> {
    let key = key.validated()?;
    db.with(|c| fs::record_version(c, &key, &file_name, &snapshot))
}

#[tauri::command]
pub fn close_fs_period(db: State<'_, Db>, key: PeriodKey, snapshot: Value) -> AppResult<()> {
    let key = key.validated()?;
    db.with(|c| fs::close_period(c, &key, &snapshot))
}

#[tauri::command]
pub fn unlock_fs_period(db: State<'_, Db>, key: PeriodKey, note: String) -> AppResult<()> {
    let key = key.validated()?;
    db.with(|c| fs::unlock_period(c, &key, &note))
}

// ---------------------------------------------------------------------------
// Notas Financieras
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_fs_notes(db: State<'_, Db>, company_id: i64, period_start: String, period_end: String) -> AppResult<Option<crate::database::fs_notes::FsNotes>> {
    db.with(|c| crate::database::fs_notes::get(c, company_id, &period_start, &period_end))
}

#[tauri::command]
pub fn save_fs_notes(db: State<'_, Db>, input: crate::database::fs_notes::FsNotesInput) -> AppResult<crate::database::fs_notes::FsNotes> {
    db.with(|c| crate::database::fs_notes::save(c, &input))
}

#[tauri::command]
pub fn delete_fs_notes(db: State<'_, Db>, company_id: i64, period_start: String, period_end: String) -> AppResult<()> {
    db.with(|c| crate::database::fs_notes::delete(c, company_id, &period_start, &period_end))
}
