use rusqlite::{params, Connection, Row};

use crate::error::{AppError, AppResult};
use crate::models::dropi::{DropiStatusMapping, DropiStatusMappingInput};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, normalized_status, display_status, category, created_at, updated_at";

fn map(r: &Row) -> rusqlite::Result<DropiStatusMapping> {
    Ok(DropiStatusMapping {
        id: r.get(0)?,
        normalized_status: r.get(1)?,
        display_status: r.get(2)?,
        category: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<DropiStatusMapping>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM dropi_status_mappings ORDER BY normalized_status"))?;
    let rows = stmt.query_map([], map)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Crea o actualiza la regla de un estado (la clave es el estado normalizado).
fn upsert(conn: &Connection, m: &DropiStatusMappingInput) -> AppResult<()> {
    conn.execute(
        "INSERT INTO dropi_status_mappings (normalized_status, display_status, category, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(normalized_status) DO UPDATE SET
            display_status = excluded.display_status,
            category = excluded.category,
            updated_at = excluded.updated_at",
        params![m.normalized_status, m.display_status, m.category, now_iso()],
    )?;
    Ok(())
}

/// Guarda varias clasificaciones a la vez: todas o ninguna.
pub fn save_many(conn: &mut Connection, items: &[DropiStatusMappingInput]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for m in items {
        upsert(&tx, m)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn update_category(conn: &Connection, id: i64, category: &str) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE dropi_status_mappings SET category = ?1, updated_at = ?2 WHERE id = ?3",
        params![category, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::user("La regla no existe o fue eliminada."));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM dropi_status_mappings WHERE id = ?1", [id])?;
    Ok(())
}

pub fn insert_full(conn: &Connection, m: &DropiStatusMapping) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO dropi_status_mappings ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
        params![m.id, m.normalized_status, m.display_status, m.category, m.created_at, m.updated_at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    fn input(status: &str, category: &str) -> DropiStatusMappingInput {
        DropiStatusMappingInput { normalized_status: status.into(), display_status: status.into(), category: category.into() }
    }

    #[test]
    fn saves_updates_and_deletes_rules() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        save_many(&mut conn, &[input("EN TERMINAL DESTINO", "in_process"), input("RECLAME EN OFICINA", "claim")]).unwrap();
        // Guardar de nuevo el mismo estado lo actualiza (no duplica).
        save_many(&mut conn, &[input("EN TERMINAL DESTINO", "claim")]).unwrap();
        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!((all[0].normalized_status.as_str(), all[0].category.as_str()), ("EN TERMINAL DESTINO", "claim"));

        update_category(&conn, all[1].id, "in_process").unwrap();
        assert_eq!(list(&conn).unwrap()[1].category, "in_process");
        delete(&conn, all[0].id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert!(update_category(&conn, all[0].id, "claim").is_err());
    }

    #[test]
    fn rejects_unknown_category_in_sql() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        assert!(save_many(&mut conn, &[input("X", "otro")]).is_err());
        assert!(list(&conn).unwrap().is_empty(), "la transacción se revierte");
    }
}
