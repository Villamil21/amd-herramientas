use rusqlite::{params, Connection, ErrorCode, Row};

use crate::error::{AppError, AppResult};
use crate::models::withholding::{
    DocumentTitleMapping, DocumentTitleMappingInput, UvtValue, WithholdingRate, WithholdingRateInput, WithholdingRateUpdate,
};
use crate::services::time::now_iso;

// ---------------------------------------------------------------------------
// Tabla de retenciones
// ---------------------------------------------------------------------------

const RATE_COLUMNS: &str = "id, retention_type, name, base_uvt_centi, rate_bp, sort_order, created_at, updated_at";

fn map_rate(r: &Row) -> rusqlite::Result<WithholdingRate> {
    Ok(WithholdingRate {
        id: r.get(0)?,
        retention_type: r.get(1)?,
        name: r.get(2)?,
        base_uvt_centi: r.get(3)?,
        rate_bp: r.get(4)?,
        sort_order: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

fn duplicate_rate(e: rusqlite::Error, name: &str) -> AppError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == ErrorCode::ConstraintViolation => {
            AppError::user(format!("Ya existe el concepto «{name}» para ese tipo."))
        }
        _ => e.into(),
    }
}

pub fn list_rates(conn: &Connection) -> AppResult<Vec<WithholdingRate>> {
    let mut stmt = conn.prepare(&format!("SELECT {RATE_COLUMNS} FROM withholding_rates ORDER BY sort_order, id"))?;
    let rows = stmt.query_map([], map_rate)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn insert_rate(conn: &Connection, r: &WithholdingRateInput) -> AppResult<i64> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO withholding_rates (retention_type, name, base_uvt_centi, rate_bp, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM withholding_rates), ?5, ?5)",
        params![r.retention_type, r.name, r.base_uvt_centi, r.rate_bp, now],
    )
    .map_err(|e| duplicate_rate(e, &r.name))?;
    Ok(conn.last_insert_rowid())
}

/// Guarda varias ediciones de base UVT y tarifa a la vez: todas o ninguna.
pub fn update_rates(conn: &mut Connection, items: &[WithholdingRateUpdate]) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    for u in items {
        let n = tx.execute(
            "UPDATE withholding_rates SET base_uvt_centi = ?1, rate_bp = ?2, updated_at = ?3 WHERE id = ?4",
            params![u.base_uvt_centi, u.rate_bp, now, u.id],
        )?;
        if n == 0 {
            return Err(AppError::user("Un concepto de la tabla ya no existe. Recarga la pantalla."));
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn delete_rate(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM withholding_rates WHERE id = ?1", [id])?;
    Ok(())
}

pub fn insert_rate_full(conn: &Connection, r: &WithholdingRate) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO withholding_rates ({RATE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![r.id, r.retention_type, r.name, r.base_uvt_centi, r.rate_bp, r.sort_order, r.created_at, r.updated_at],
    )
    .map_err(|e| duplicate_rate(e, &r.name))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// UVT por año
// ---------------------------------------------------------------------------

pub fn list_uvt(conn: &Connection) -> AppResult<Vec<UvtValue>> {
    let mut stmt = conn.prepare("SELECT year, value_pesos, updated_at FROM uvt_values ORDER BY year")?;
    let rows = stmt
        .query_map([], |r| Ok(UvtValue { year: r.get(0)?, value_pesos: r.get(1)?, updated_at: r.get(2)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Crea o actualiza el valor UVT de un año.
pub fn save_uvt(conn: &Connection, year: i64, value_pesos: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO uvt_values (year, value_pesos, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(year) DO UPDATE SET value_pesos = excluded.value_pesos, updated_at = excluded.updated_at",
        params![year, value_pesos, now_iso()],
    )?;
    Ok(())
}

pub fn delete_uvt(conn: &Connection, year: i64) -> AppResult<()> {
    conn.execute("DELETE FROM uvt_values WHERE year = ?1", [year])?;
    Ok(())
}

pub fn insert_uvt_full(conn: &Connection, u: &UvtValue) -> AppResult<()> {
    conn.execute(
        "INSERT INTO uvt_values (year, value_pesos, updated_at) VALUES (?1, ?2, ?3)",
        params![u.year, u.value_pesos, u.updated_at],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Títulos de documento: Factura / Nota
// ---------------------------------------------------------------------------

const TITLE_COLUMNS: &str = "id, normalized_title, display_title, category, created_at, updated_at";

fn map_title(r: &Row) -> rusqlite::Result<DocumentTitleMapping> {
    Ok(DocumentTitleMapping {
        id: r.get(0)?,
        normalized_title: r.get(1)?,
        display_title: r.get(2)?,
        category: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn list_titles(conn: &Connection) -> AppResult<Vec<DocumentTitleMapping>> {
    let mut stmt = conn.prepare(&format!("SELECT {TITLE_COLUMNS} FROM document_title_mappings ORDER BY normalized_title"))?;
    let rows = stmt.query_map([], map_title)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Crea o actualiza (por título normalizado) varias clasificaciones: todas o ninguna.
pub fn save_titles(conn: &mut Connection, items: &[DocumentTitleMappingInput]) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    for m in items {
        tx.execute(
            "INSERT INTO document_title_mappings (normalized_title, display_title, category, created_at, updated_at)
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

pub fn update_title_category(conn: &Connection, id: i64, category: &str) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE document_title_mappings SET category = ?1, updated_at = ?2 WHERE id = ?3",
        params![category, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::user("La clasificación no existe o fue eliminada."));
    }
    Ok(())
}

pub fn delete_title(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM document_title_mappings WHERE id = ?1", [id])?;
    Ok(())
}

pub fn insert_title_full(conn: &Connection, m: &DocumentTitleMapping) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO document_title_mappings ({TITLE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
        params![m.id, m.normalized_title, m.display_title, m.category, m.created_at, m.updated_at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        conn
    }

    #[test]
    fn seeds_initial_table_uvt_and_titles() {
        let conn = db();
        let rates = list_rates(&conn).unwrap();
        assert_eq!(rates.len(), 15);
        let services = rates.iter().find(|r| r.name == "Servicios generales (declarantes)").unwrap();
        assert_eq!((services.retention_type.as_str(), services.base_uvt_centi, services.rate_bp), ("services", 200, 400));
        let agro = rates.iter().find(|r| r.name.contains("sin procesamiento")).unwrap();
        assert_eq!((agro.base_uvt_centi, agro.rate_bp), (7000, 150));
        let fuel = rates.iter().find(|r| r.name.contains("combustibles")).unwrap();
        assert_eq!((fuel.base_uvt_centi, fuel.rate_bp), (0, 10));
        assert_eq!(list_uvt(&conn).unwrap().iter().map(|u| (u.year, u.value_pesos)).collect::<Vec<_>>(), vec![(2026, 52374)]);
        let titles = list_titles(&conn).unwrap();
        assert_eq!(
            titles.iter().map(|t| (t.normalized_title.as_str(), t.category.as_str())).collect::<Vec<_>>(),
            vec![("factura electronica de venta", "invoice"), ("nota credito electronica", "credit_note")]
        );
    }

    #[test]
    fn edits_persist_and_are_not_reseeded() {
        let mut conn = db();
        update_rates(&mut conn, &[WithholdingRateUpdate { id: 6, base_uvt_centi: 400, rate_bp: 600 }]).unwrap();
        save_uvt(&conn, 2026, 50000).unwrap();
        save_uvt(&conn, 2027, 55000).unwrap();
        // Un segundo arranque no vuelve a aplicar la migración ni sus datos iniciales.
        assert!(run_pending(&mut conn).unwrap().is_empty());
        let r = list_rates(&conn).unwrap().into_iter().find(|r| r.id == 6).unwrap();
        assert_eq!((r.base_uvt_centi, r.rate_bp), (400, 600));
        assert_eq!(list_uvt(&conn).unwrap().iter().map(|u| (u.year, u.value_pesos)).collect::<Vec<_>>(), vec![(2026, 50000), (2027, 55000)]);
        assert!(update_rates(&mut conn, &[WithholdingRateUpdate { id: 999, base_uvt_centi: 0, rate_bp: 0 }]).is_err());
    }

    #[test]
    fn adds_and_deletes_rates_and_titles() {
        let mut conn = db();
        let input = WithholdingRateInput { retention_type: "services".into(), name: "Servicios de vigilancia".into(), base_uvt_centi: 200, rate_bp: 200 };
        let id = insert_rate(&conn, &input).unwrap();
        assert!(insert_rate(&conn, &input).unwrap_err().0.contains("vigilancia"));
        assert_eq!(list_rates(&conn).unwrap().last().unwrap().id, id, "los conceptos nuevos van al final");
        delete_rate(&conn, id).unwrap();
        assert_eq!(list_rates(&conn).unwrap().len(), 15);

        let t = |title: &str, category: &str| DocumentTitleMappingInput { normalized_title: title.into(), display_title: title.into(), category: category.into() };
        save_titles(&mut conn, &[t("nota debito electronica", "credit_note")]).unwrap();
        save_titles(&mut conn, &[t("nota debito electronica", "invoice")]).unwrap();
        let debit = list_titles(&conn).unwrap().into_iter().find(|m| m.normalized_title == "nota debito electronica").unwrap();
        assert_eq!(debit.category, "invoice");
        update_title_category(&conn, debit.id, "credit_note").unwrap();
        delete_title(&conn, debit.id).unwrap();
        assert_eq!(list_titles(&conn).unwrap().len(), 2);
        assert!(save_titles(&mut conn, &[t("x", "otro")]).is_err());
    }
}
