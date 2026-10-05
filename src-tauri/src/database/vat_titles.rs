//! IVA de compras: título de documento → Factura electrónica / Nota crédito.
//! Misma forma que los títulos de Retención en la fuente compras, pero en su
//! propia tabla: una decisión en un módulo no cambia el otro.

use rusqlite::{params, Connection, Row};

use crate::error::{AppError, AppResult};
use crate::models::withholding::{DocumentTitleMapping, DocumentTitleMappingInput};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, normalized_title, display_title, category, created_at, updated_at";

fn map(r: &Row) -> rusqlite::Result<DocumentTitleMapping> {
    Ok(DocumentTitleMapping {
        id: r.get(0)?,
        normalized_title: r.get(1)?,
        display_title: r.get(2)?,
        category: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<DocumentTitleMapping>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM vat_document_title_mappings ORDER BY normalized_title"))?;
    let rows = stmt.query_map([], map)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Crea o actualiza (por título normalizado) varias clasificaciones: todas o ninguna.
pub fn save(conn: &mut Connection, items: &[DocumentTitleMappingInput]) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    for m in items {
        tx.execute(
            "INSERT INTO vat_document_title_mappings (normalized_title, display_title, category, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(normalized_title) DO UPDATE SET
                display_title = excluded.display_title,
                category = excluded.category,
                updated_at = excluded.updated_at",
            params![m.normalized_title, m.display_title, m.category, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn update_category(conn: &Connection, id: i64, category: &str) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE vat_document_title_mappings SET category = ?1, updated_at = ?2 WHERE id = ?3",
        params![category, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::user("La clasificación no existe o fue eliminada."));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM vat_document_title_mappings WHERE id = ?1", [id])?;
    Ok(())
}

pub fn insert_full(conn: &Connection, m: &DocumentTitleMapping) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO vat_document_title_mappings ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
        params![m.id, m.normalized_title, m.display_title, m.category, m.created_at, m.updated_at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;
    use crate::database::withholding;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        conn
    }

    fn category(conn: &Connection, title: &str) -> Option<String> {
        list(conn).unwrap().into_iter().find(|m| m.normalized_title == title).map(|m| m.category)
    }

    #[test]
    fn seeds_initial_titles() {
        let conn = db();
        for title in ["factura electronica de venta", "factura electronica de mandato", "factura de venta de talonario o de papel"] {
            assert_eq!(category(&conn, title).as_deref(), Some("invoice"), "{title}");
        }
        assert_eq!(category(&conn, "nota de credito electronica").as_deref(), Some("credit_note"));
        assert_eq!(category(&conn, "documento nuevo xyz"), None, "un título desconocido se pregunta");
    }

    #[test]
    fn decisions_persist_and_do_not_touch_withholding_titles() {
        let mut conn = db();
        let before = withholding::list_titles(&conn).unwrap().len();
        let t = |category: &str| DocumentTitleMappingInput { normalized_title: "documento nuevo xyz".into(), display_title: "DOCUMENTO NUEVO XYZ".into(), category: category.into() };
        save(&mut conn, &[t("credit_note")]).unwrap();
        // Un segundo arranque (o una actualización sin migraciones nuevas) no vuelve a sembrar ni borra la decisión.
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(category(&conn, "documento nuevo xyz").as_deref(), Some("credit_note"));
        save(&mut conn, &[t("invoice")]).unwrap();
        let saved = list(&conn).unwrap().into_iter().find(|m| m.normalized_title == "documento nuevo xyz").unwrap();
        assert_eq!(saved.category, "invoice");
        update_category(&conn, saved.id, "credit_note").unwrap();
        assert_eq!(category(&conn, "documento nuevo xyz").as_deref(), Some("credit_note"));
        assert!(update_category(&conn, 99_999, "invoice").is_err());
        assert!(save(&mut conn, &[t("otro")]).is_err(), "la tabla solo admite las dos categorías");
        delete(&conn, saved.id).unwrap();
        assert_eq!(category(&conn, "documento nuevo xyz"), None);
        assert_eq!(withholding::list_titles(&conn).unwrap().len(), before);
    }
}
