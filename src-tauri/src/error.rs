//! Errores que viajan al frontend. El mensaje siempre es comprensible para
//! un usuario normal; el detalle técnico solo se registra en consola.

use serde::{Serialize, Serializer};

#[derive(Debug)]
pub struct AppError(pub String);

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn user(msg: impl Into<String>) -> Self {
        AppError(msg.into())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        eprintln!("[db] {e}");
        AppError::user("Ocurrió un error al acceder a la base de datos local.")
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        eprintln!("[io] {e}");
        AppError::user("No se pudo leer o escribir un archivo en el equipo.")
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        eprintln!("[json] {e}");
        AppError::user("El archivo no tiene un formato válido.")
    }
}

impl std::error::Error for AppError {}
