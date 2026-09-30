use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Row};

use crate::error::{AppError, AppResult};
use crate::models::identity_document::{IdentityDocumentType, IdentityDocumentTypeInput};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, name, is_numeric, is_system, created_at, updated_at";

fn map(r: &Row) -> rusqlite::Result<IdentityDocumentType> {
    Ok(IdentityDocumentType {
        id: r.get(0)?,
        name: r.get(1)?,
        is_numeric: r.get::<_, i64>(2)? != 0,
        is_system: r.get::<_, i64>(3)? != 0,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

/// El nombre es único sin distinguir mayúsculas.
fn duplicate_name(e: rusqlite::Error, name: &str) -> AppError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == ErrorCode::ConstraintViolation => {
            AppError::user(format!("Ya existe el tipo de documento «{name}»."))
        }
        _ => e.into(),
    }
}

/// Primero los de sistema (en su orden original), luego los personalizados por nombre.
pub fn list(conn: &Connection) -> AppResult<Vec<IdentityDocumentType>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM identity_document_types ORDER BY is_system DESC, CASE WHEN is_system = 1 THEN id END, name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([], map)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<IdentityDocumentType> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM identity_document_types WHERE id = ?1"), [id], map)
        .optional()?
        .ok_or_else(|| AppError::user("El tipo de documento no existe o fue eliminado."))
}

pub fn insert(conn: &Connection, v: &IdentityDocumentTypeInput) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO identity_document_types (name, is_numeric, is_system, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)",
        params![v.name, v.is_numeric as i64, now_iso()],
    )
    .map_err(|e| duplicate_name(e, &v.name))?;
    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, v: &IdentityDocumentTypeInput) -> AppResult<()> {
    let n = conn
        .execute(
            "UPDATE identity_document_types SET name = ?1, is_numeric = ?2, updated_at = ?3 WHERE id = ?4",
            params![v.name, v.is_numeric as i64, now_iso(), id],
        )
        .map_err(|e| duplicate_name(e, &v.name))?;
    if n == 0 {
        return Err(AppError::user("El tipo de documento no existe o fue eliminado."));
    }
    Ok(())
}

/// Los tipos de sistema no se eliminan.
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    if get(conn, id)?.is_system {
        return Err(AppError::user("Los tipos de documento iniciales no se pueden eliminar."));
    }
    conn.execute("DELETE FROM identity_document_types WHERE id = ?1", [id])?;
    Ok(())
}

/// Restauración de backup: conserva id, marca de sistema y fechas originales.
pub fn insert_full(conn: &Connection, t: &IdentityDocumentType) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO identity_document_types ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
        params![t.id, t.name, t.is_numeric as i64, t.is_system as i64, t.created_at, t.updated_at],
    )
    .map_err(|e| duplicate_name(e, &t.name))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    fn input(name: &str, is_numeric: bool) -> IdentityDocumentTypeInput {
        IdentityDocumentTypeInput { name: name.into(), is_numeric }
    }

    #[test]
    fn seeds_crud_and_protects_system_types() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        let seeded: Vec<(String, bool, bool)> = list(&conn).unwrap().into_iter().map(|t| (t.name, t.is_numeric, t.is_system)).collect();
        assert_eq!(seeded, vec![("Cédula de Ciudadanía".into(), true, true), ("Cédula de Extranjería".into(), true, true)]);

        let id = insert(&conn, &input("Pasaporte", false)).unwrap();
        assert!(insert(&conn, &input("pasaporte", false)).is_err(), "nombre único sin distinguir mayúsculas");
        update(&conn, id, &input("Pasaporte extranjero", false)).unwrap();
        assert_eq!(list(&conn).unwrap().last().unwrap().name, "Pasaporte extranjero");
        assert!(delete(&conn, 1).is_err(), "los de sistema no se eliminan");
        delete(&conn, id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 2);
    }
}
