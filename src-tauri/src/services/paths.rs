//! Ubicaciones persistentes de la aplicación.
//!
//! Todo vive en el directorio de datos que entrega Tauri
//! (~/Library/Application Support/<identifier>/ en macOS), fuera del
//! bundle .app. Reemplazar o actualizar la app nunca toca esta carpeta.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_file: PathBuf,
    pub logos_dir: PathBuf,
    pub backups_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> AppResult<Self> {
        let data_dir = app.path().app_data_dir().map_err(|e| {
            eprintln!("[paths] {e}");
            AppError::user("No se pudo determinar la carpeta de datos de la aplicación.")
        })?;
        Self::from_data_dir(data_dir)
    }

    pub fn from_data_dir(data_dir: PathBuf) -> AppResult<Self> {
        let paths = AppPaths {
            db_file: data_dir.join("database.sqlite"),
            logos_dir: data_dir.join("logos"),
            backups_dir: data_dir.join("backups"),
            data_dir,
        };
        std::fs::create_dir_all(&paths.logos_dir)?;
        std::fs::create_dir_all(&paths.backups_dir)?;
        Ok(paths)
    }
}
