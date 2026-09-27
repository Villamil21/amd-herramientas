//! Conexión SQLite compartida por todos los comandos.

pub mod companies;
pub mod concepts;
pub mod migrations;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};

use crate::error::{AppError, AppResult};

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(conn)
}

/// Estado gestionado por Tauri. `None` si la base no pudo abrirse o migrarse:
/// la app sigue abriendo y muestra el problema en lugar de cerrarse.
pub struct Db(pub Mutex<Option<Connection>>);

impl Db {
    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| AppError::user("La base de datos no está disponible. Reinicia la aplicación."))?;
        let conn = guard
            .as_mut()
            .ok_or_else(|| AppError::user("La base de datos no está disponible. Reinicia la aplicación."))?;
        f(conn)
    }
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}
