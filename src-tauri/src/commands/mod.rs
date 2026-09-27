//! Comandos expuestos al frontend. Cada módulo agrupa un dominio.
//! Solo se registran en `lib.rs` los comandos que la interfaz utiliza.

pub mod app;
pub mod backup;
pub mod companies;
pub mod concepts;
pub mod files;

use std::path::PathBuf;

use tauri_plugin_dialog::FilePath;

use crate::error::{AppError, AppResult};

pub(crate) fn to_path(fp: FilePath) -> AppResult<PathBuf> {
    fp.into_path()
        .map_err(|_| AppError::user("No se pudo acceder a la ubicación seleccionada."))
}
