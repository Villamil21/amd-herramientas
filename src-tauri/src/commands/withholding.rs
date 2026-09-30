//! Retención en la fuente: tabla de retenciones, UVT por año, configuración
//! de retención de proveedores y clasificación de títulos (Factura / Nota).

use tauri::State;

use crate::database::{suppliers, withholding, Db};
use crate::error::AppResult;
use crate::models::clean;
use crate::models::supplier::SupplierInput;
use crate::models::withholding::{
    validate_title_category, validate_uvt, DocumentTitleMapping, DocumentTitleMappingInput, UvtValue, WithholdingProfileInput,
    WithholdingRate, WithholdingRateInput, WithholdingRateUpdate,
};

#[tauri::command]
pub fn list_withholding_rates(db: State<'_, Db>) -> AppResult<Vec<WithholdingRate>> {
    db.with(|c| withholding::list_rates(c))
}

#[tauri::command]
pub fn create_withholding_rate(db: State<'_, Db>, input: WithholdingRateInput) -> AppResult<i64> {
    let input = input.validated()?;
    db.with(|c| withholding::insert_rate(c, &input))
}

#[tauri::command]
pub fn update_withholding_rates(db: State<'_, Db>, items: Vec<WithholdingRateUpdate>) -> AppResult<()> {
    for u in &items {
        WithholdingRateInput { retention_type: "services".into(), name: "-".into(), base_uvt_centi: u.base_uvt_centi, rate_bp: u.rate_bp }.validated()?;
    }
    db.with(|c| withholding::update_rates(c, &items))
}

#[tauri::command]
pub fn delete_withholding_rate(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| withholding::delete_rate(c, id))
}

/// Cantidad de reglas de proveedores que usan el concepto (aviso antes de eliminarlo).
#[tauri::command]
pub fn count_withholding_rate_usage(db: State<'_, Db>, id: i64) -> AppResult<i64> {
    db.with(|c| suppliers::count_rules_using_rate(c, id))
}

#[tauri::command]
pub fn list_uvt_values(db: State<'_, Db>) -> AppResult<Vec<UvtValue>> {
    db.with(|c| withholding::list_uvt(c))
}

#[tauri::command]
pub fn save_uvt_value(db: State<'_, Db>, year: i64, value_pesos: i64) -> AppResult<()> {
    validate_uvt(year, value_pesos)?;
    db.with(|c| withholding::save_uvt(c, year, value_pesos))
}

#[tauri::command]
pub fn delete_uvt_value(db: State<'_, Db>, year: i64) -> AppResult<()> {
    db.with(|c| withholding::delete_uvt(c, year))
}

#[tauri::command]
pub fn save_supplier_withholding(db: State<'_, Db>, id: i64, profile: WithholdingProfileInput) -> AppResult<()> {
    let profile = profile.validated()?;
    db.with(|c| suppliers::save_withholding_profile(c, id, &profile))
}

#[tauri::command]
pub fn create_withholding_supplier(
    db: State<'_, Db>,
    input: SupplierInput,
    profile: WithholdingProfileInput,
    fiscal_regime: Option<String>,
) -> AppResult<i64> {
    let input = input.validated()?;
    let profile = profile.validated()?;
    let regime = fiscal_regime.map(|r| clean(&r, 250)).filter(|r| !r.is_empty());
    db.with(|c| suppliers::insert_with_profile(c, &input, &profile, regime.as_deref()))
}

#[tauri::command]
pub fn set_supplier_fiscal_regime(db: State<'_, Db>, id: i64, fiscal_regime: String) -> AppResult<()> {
    let regime = clean(&fiscal_regime, 250);
    db.with(|c| suppliers::set_fiscal_regime(c, id, &regime))
}

#[tauri::command]
pub fn list_document_title_mappings(db: State<'_, Db>) -> AppResult<Vec<DocumentTitleMapping>> {
    db.with(|c| withholding::list_titles(c))
}

#[tauri::command]
pub fn save_document_title_mappings(db: State<'_, Db>, items: Vec<DocumentTitleMappingInput>) -> AppResult<()> {
    let items = items.into_iter().map(DocumentTitleMappingInput::validated).collect::<AppResult<Vec<_>>>()?;
    db.with(|c| withholding::save_titles(c, &items))
}

#[tauri::command]
pub fn update_document_title_mapping(db: State<'_, Db>, id: i64, category: String) -> AppResult<()> {
    let category = validate_title_category(&category)?;
    db.with(|c| withholding::update_title_category(c, id, &category))
}

#[tauri::command]
pub fn delete_document_title_mapping(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| withholding::delete_title(c, id))
}
