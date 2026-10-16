use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::company::{CompanyDocument, NewDocument};
use crate::services::time::now_iso;

/// Versiones de la empresa, de la más antigua a la más reciente. La vigente de cada tipo es la última.
pub fn list(conn: &Connection, company_id: i64) -> AppResult<Vec<CompanyDocument>> {
    let mut docs: Vec<CompanyDocument> = conn
        .prepare("SELECT id, kind, file_name, stored_file, size_bytes, uploaded_at FROM company_documents WHERE company_id = ?1 ORDER BY uploaded_at, id")?
        .query_map([company_id], |r| {
            Ok(CompanyDocument { id: r.get(0)?, kind: r.get(1)?, file_name: r.get(2)?, stored_file: r.get(3)?, size_bytes: r.get(4)?, uploaded_at: r.get(5)?, is_current: false })
        })?
        .collect::<Result<_, _>>()?;
    for kind in ["rut", "camara"] {
        if let Some(last) = docs.iter_mut().rev().find(|d| d.kind == kind) {
            last.is_current = true;
        }
    }
    Ok(docs)
}

/// Registra una versión nueva con el tamaño real del archivo ya guardado. Nunca borra versiones anteriores.
pub fn insert(conn: &Connection, company_id: i64, doc: &NewDocument, size_bytes: i64, uploaded_at: Option<&str>) -> AppResult<()> {
    let name = doc.file_name.trim();
    if name.is_empty() {
        return Err(AppError::user("El documento necesita un nombre de archivo."));
    }
    let now = now_iso();
    conn.execute(
        "INSERT INTO company_documents (company_id, kind, file_name, stored_file, size_bytes, uploaded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![company_id, doc.kind, name.chars().take(200).collect::<String>(), doc.stored_file, size_bytes, uploaded_at.unwrap_or(&now)],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => AppError::user("Ese documento ya está registrado."),
        other => other.into(),
    })?;
    Ok(())
}

/// Un archivo está en uso si lo referencia una versión de la empresa o el RUT de un socio.
pub fn is_referenced(conn: &Connection, stored_file: &str) -> AppResult<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM company_documents WHERE stored_file = ?1) OR EXISTS(SELECT 1 FROM shareholder_documents WHERE stored_file = ?1)",
        [stored_file],
        |r| r.get(0),
    )?)
}
