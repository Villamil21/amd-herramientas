//! Retención en la fuente ventas: Tabla de Autorretenciones y clasificación
//! de tipos de documento de la hoja Ventas (Facturas / Notas Crédito).

use tauri::State;

use crate::database::{self_withholding, Db};
use crate::error::AppResult;
use crate::models::self_withholding::{
    validate_sales_category, SalesDocumentTypeMapping, SalesDocumentTypeMappingInput, SelfWithholdingRate, SelfWithholdingRateInput,
    SelfWithholdingRateUpdate,
};

#[tauri::command]
pub fn list_self_withholding_rates(db: State<'_, Db>) -> AppResult<Vec<SelfWithholdingRate>> {
    db.with(|c| self_withholding::list_rates(c))
}

#[tauri::command]
pub fn create_self_withholding_rate(db: State<'_, Db>, input: SelfWithholdingRateInput) -> AppResult<i64> {
    let input = input.validated()?;
    db.with(|c| self_withholding::insert_rate(c, &input))
}

#[tauri::command]
pub fn update_self_withholding_rates(db: State<'_, Db>, items: Vec<SelfWithholdingRateUpdate>) -> AppResult<()> {
    items.iter().try_for_each(SelfWithholdingRateUpdate::validate)?;
    db.with(|c| self_withholding::update_rates(c, &items))
}

#[tauri::command]
pub fn delete_self_withholding_rate(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| self_withholding::delete_rate(c, id))
}

#[tauri::command]
pub fn list_sales_document_types(db: State<'_, Db>) -> AppResult<Vec<SalesDocumentTypeMapping>> {
    db.with(|c| self_withholding::list_types(c))
}

#[tauri::command]
pub fn save_sales_document_types(db: State<'_, Db>, items: Vec<SalesDocumentTypeMappingInput>) -> AppResult<()> {
    let items = items.into_iter().map(SalesDocumentTypeMappingInput::validated).collect::<AppResult<Vec<_>>>()?;
    db.with(|c| self_withholding::save_types(c, &items))
}

#[tauri::command]
pub fn update_sales_document_type(db: State<'_, Db>, id: i64, category: String) -> AppResult<()> {
    let category = validate_sales_category(&category)?;
    db.with(|c| self_withholding::update_type_category(c, id, &category))
}

#[tauri::command]
pub fn delete_sales_document_type(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db.with(|c| self_withholding::delete_type(c, id))
}
