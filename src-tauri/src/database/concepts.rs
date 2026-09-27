use rusqlite::{params, Connection, Row};

use crate::error::{AppError, AppResult};
use crate::models::concept::{Concept, ConceptInput};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, nombre, tipo_retencion, tarifa_predeterminada, unidad_tarifa, created_at, updated_at";

fn map(r: &Row) -> rusqlite::Result<Concept> {
    Ok(Concept {
        id: r.get(0)?,
        nombre: r.get(1)?,
        tipo_retencion: r.get(2)?,
        tarifa_predeterminada: r.get(3)?,
        unidad_tarifa: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

pub fn list(conn: &Connection, search: Option<&str>) -> AppResult<Vec<Concept>> {
    let pattern = format!("%{}%", search.unwrap_or("").trim());
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM retention_concepts WHERE nombre LIKE ?1 ORDER BY nombre COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([pattern], map)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn insert(conn: &Connection, c: &ConceptInput) -> AppResult<i64> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO retention_concepts (nombre, tipo_retencion, tarifa_predeterminada, unidad_tarifa, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![c.nombre, c.tipo_retencion, c.tarifa_predeterminada, c.unidad_tarifa, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn insert_full(conn: &Connection, c: &Concept) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO retention_concepts ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"),
        params![c.id, c.nombre, c.tipo_retencion, c.tarifa_predeterminada, c.unidad_tarifa, c.created_at, c.updated_at],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, c: &ConceptInput) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE retention_concepts SET nombre = ?1, tipo_retencion = ?2, tarifa_predeterminada = ?3,
                unidad_tarifa = ?4, updated_at = ?5 WHERE id = ?6",
        params![c.nombre, c.tipo_retencion, c.tarifa_predeterminada, c.unidad_tarifa, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::user("El concepto no existe o fue eliminado."));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM retention_concepts WHERE id = ?1", [id])?;
    Ok(())
}
