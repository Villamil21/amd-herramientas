//! SMMLV por año (Datos → SMMLV por año). Configuración local y manual: nunca se consulta Internet.

use tauri::State;

use crate::database::{minimum_wages, Db};
use crate::error::AppResult;
use crate::models::minimum_wage::{validate_minimum_wage, MinimumWage};

#[tauri::command]
pub fn list_minimum_wages(db: State<'_, Db>) -> AppResult<Vec<MinimumWage>> {
    db.with(|c| minimum_wages::list(c))
}

#[tauri::command]
pub fn create_minimum_wage(db: State<'_, Db>, year: i64, value_pesos: i64) -> AppResult<()> {
    validate_minimum_wage(year, value_pesos)?;
    db.with(|c| minimum_wages::create(c, year, value_pesos))
}

#[tauri::command]
pub fn update_minimum_wage(db: State<'_, Db>, year: i64, value_pesos: i64) -> AppResult<()> {
    validate_minimum_wage(year, value_pesos)?;
    db.with(|c| minimum_wages::update(c, year, value_pesos))
}
