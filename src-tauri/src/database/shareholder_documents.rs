//! Historial del RUT de cada socio. Misma mecánica que `company_documents`: cada carga es una versión nueva, la vigente
//! es la más reciente y las anteriores nunca se borran al cargar otra. Los PDF viven en <datos>/company_documents.

use std::collections::HashMap;

use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::company::{CompanyDocument, NewDocument};
use crate::services::time::now_iso;

/// Versiones de los socios de una empresa, agrupadas por socio (la última de cada uno es la vigente).
pub fn list_for_company(conn: &Connection, company_id: i64) -> AppResult<HashMap<i64, Vec<CompanyDocument>>> {
    let mut stmt = conn.prepare(
        "SELECT d.shareholder_id, d.id, d.kind, d.file_name, d.stored_file, d.size_bytes, d.uploaded_at
         FROM shareholder_documents d JOIN shareholders s ON s.id = d.shareholder_id
         WHERE s.company_id = ?1 ORDER BY d.uploaded_at, d.id",
    )?;
    let mut out: HashMap<i64, Vec<CompanyDocument>> = HashMap::new();
    for row in stmt.query_map([company_id], |r| {
        Ok((r.get::<_, i64>(0)?, CompanyDocument { id: r.get(1)?, kind: r.get(2)?, file_name: r.get(3)?, stored_file: r.get(4)?, size_bytes: r.get(5)?, uploaded_at: r.get(6)?, is_current: false }))
    })? {
        let (shareholder_id, doc) = row?;
        out.entry(shareholder_id).or_default().push(doc);
    }
    for docs in out.values_mut() {
        if let Some(last) = docs.last_mut() {
            last.is_current = true;
        }
    }
    Ok(out)
}

pub fn insert(conn: &Connection, shareholder_id: i64, doc: &NewDocument, size_bytes: i64) -> AppResult<()> {
    let name = doc.file_name.trim();
    if name.is_empty() {
        return Err(AppError::user("El documento necesita un nombre de archivo."));
    }
    conn.execute(
        "INSERT INTO shareholder_documents (shareholder_id, kind, file_name, stored_file, size_bytes, uploaded_at) VALUES (?1, 'rut', ?2, ?3, ?4, ?5)",
        params![shareholder_id, name.chars().take(200).collect::<String>(), doc.stored_file, size_bytes, now_iso()],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => AppError::user("Ese documento ya está registrado."),
        other => other.into(),
    })?;
    Ok(())
}

/// Archivos de todos los socios de una empresa (para borrarlos junto con la empresa).
pub fn stored_files_for_company(conn: &Connection, company_id: i64) -> AppResult<Vec<String>> {
    Ok(conn
        .prepare("SELECT d.stored_file FROM shareholder_documents d JOIN shareholders s ON s.id = d.shareholder_id WHERE s.company_id = ?1")?
        .query_map([company_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?)
}
