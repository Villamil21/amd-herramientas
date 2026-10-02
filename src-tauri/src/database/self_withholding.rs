use rusqlite::{params, Connection, ErrorCode, Row};

use crate::error::{AppError, AppResult};
use crate::models::self_withholding::{
    normalize_ciiu, SalesDocumentTypeMapping, SalesDocumentTypeMappingInput, SelfWithholdingRate, SelfWithholdingRateInput,
    SelfWithholdingRateUpdate,
};
use crate::services::time::now_iso;

/// Origen de los códigos que agrega el usuario (los del decreto traen su propia fuente).
pub const USER_SOURCE: &str = "Agregado por el usuario";

// ---------------------------------------------------------------------------
// Tabla de Autorretenciones
// ---------------------------------------------------------------------------

const RATE_COLUMNS: &str = "id, ciiu_code, normalized_code, economic_activity, rate_bp, source, created_at, updated_at";

fn map_rate(r: &Row) -> rusqlite::Result<SelfWithholdingRate> {
    Ok(SelfWithholdingRate {
        id: r.get(0)?,
        ciiu_code: r.get(1)?,
        normalized_code: r.get(2)?,
        economic_activity: r.get(3)?,
        rate_bp: r.get(4)?,
        source: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

fn duplicate_code(e: rusqlite::Error, code: &str) -> AppError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == ErrorCode::ConstraintViolation => {
            AppError::user(format!("El Código CIIU {code} ya existe en la Tabla de Autorretenciones."))
        }
        _ => e.into(),
    }
}

pub fn list_rates(conn: &Connection) -> AppResult<Vec<SelfWithholdingRate>> {
    let mut stmt = conn.prepare(&format!("SELECT {RATE_COLUMNS} FROM self_withholding_rates ORDER BY normalized_code"))?;
    let rows = stmt.query_map([], map_rate)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn insert_rate(conn: &Connection, r: &SelfWithholdingRateInput) -> AppResult<i64> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO self_withholding_rates (ciiu_code, normalized_code, economic_activity, rate_bp, source, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![r.ciiu_code, normalize_ciiu(&r.ciiu_code), r.economic_activity, r.rate_bp, USER_SOURCE, now],
    )
    .map_err(|e| duplicate_code(e, &r.ciiu_code))?;
    Ok(conn.last_insert_rowid())
}

/// Guarda varias ediciones de tarifa a la vez: todas o ninguna.
pub fn update_rates(conn: &mut Connection, items: &[SelfWithholdingRateUpdate]) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    for u in items {
        let n = tx.execute("UPDATE self_withholding_rates SET rate_bp = ?1, updated_at = ?2 WHERE id = ?3", params![u.rate_bp, now, u.id])?;
        if n == 0 {
            return Err(AppError::user("Un código de la tabla ya no existe. Recarga la pantalla."));
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn delete_rate(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM self_withholding_rates WHERE id = ?1", [id])?;
    Ok(())
}

pub fn insert_rate_full(conn: &Connection, r: &SelfWithholdingRate) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO self_withholding_rates ({RATE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![r.id, r.ciiu_code, r.normalized_code, r.economic_activity, r.rate_bp, r.source, r.created_at, r.updated_at],
    )
    .map_err(|e| duplicate_code(e, &r.ciiu_code))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tipos de documento de Ventas: Facturas / Notas Crédito
// ---------------------------------------------------------------------------

const TYPE_COLUMNS: &str = "id, normalized_label, original_label, category, created_at, updated_at";

fn map_type(r: &Row) -> rusqlite::Result<SalesDocumentTypeMapping> {
    Ok(SalesDocumentTypeMapping {
        id: r.get(0)?,
        normalized_label: r.get(1)?,
        original_label: r.get(2)?,
        category: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn list_types(conn: &Connection) -> AppResult<Vec<SalesDocumentTypeMapping>> {
    let mut stmt = conn.prepare(&format!("SELECT {TYPE_COLUMNS} FROM sales_document_type_mappings ORDER BY normalized_label"))?;
    let rows = stmt.query_map([], map_type)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Crea o actualiza (por tipo normalizado) varias clasificaciones: todas o ninguna.
pub fn save_types(conn: &mut Connection, items: &[SalesDocumentTypeMappingInput]) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    for m in items {
        tx.execute(
            "INSERT INTO sales_document_type_mappings (normalized_label, original_label, category, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(normalized_label) DO UPDATE SET
                original_label = excluded.original_label,
                category = excluded.category,
                updated_at = excluded.updated_at",
            params![m.normalized_label, m.original_label, m.category, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn update_type_category(conn: &Connection, id: i64, category: &str) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE sales_document_type_mappings SET category = ?1, updated_at = ?2 WHERE id = ?3",
        params![category, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::user("La clasificación no existe o fue eliminada."));
    }
    Ok(())
}

pub fn delete_type(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM sales_document_type_mappings WHERE id = ?1", [id])?;
    Ok(())
}

pub fn insert_type_full(conn: &Connection, m: &SalesDocumentTypeMapping) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO sales_document_type_mappings ({TYPE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
        params![m.id, m.normalized_label, m.original_label, m.category, m.created_at, m.updated_at],
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

    fn rate<'a>(rates: &'a [SelfWithholdingRate], code: &str) -> &'a SelfWithholdingRate {
        rates.iter().find(|r| r.normalized_code == code).unwrap()
    }

    #[test]
    fn seeds_full_decree_table_and_types() {
        let conn = db();
        let rates = list_rates(&conn).unwrap();
        assert_eq!(rates.len(), 501, "todos los códigos del artículo 1.2.6.8");
        for code in ["6201", "6202", "6209", "6311", "7310"] {
            assert_eq!(rate(&rates, code).rate_bp, 110, "{code} → 1,10 %");
        }
        let first = rate(&rates, "0111");
        assert_eq!((first.ciiu_code.as_str(), first.rate_bp), ("111", 120), "se conserva el código de la fuente");
        assert_eq!(rate(&rates, "0610").rate_bp, 270);
        assert_eq!(rate(&rates, "0170").rate_bp, 55);
        assert!(rates.iter().all(|r| r.source.contains("572 de 2025")));
        let types = list_types(&conn).unwrap();
        assert_eq!(
            types.iter().map(|t| (t.normalized_label.as_str(), t.category.as_str())).collect::<Vec<_>>(),
            vec![("factura electronica", "invoice"), ("nota de credito electronica", "credit_note")]
        );
    }

    #[test]
    fn edited_rates_survive_restarts() {
        let mut conn = db();
        let id = rate(&list_rates(&conn).unwrap(), "6201").id;
        update_rates(&mut conn, &[SelfWithholdingRateUpdate { id, rate_bp: 150 }]).unwrap();
        // Un segundo arranque (o una actualización sin migraciones nuevas) no vuelve a sembrar.
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(rate(&list_rates(&conn).unwrap(), "6201").rate_bp, 150);
        assert!(update_rates(&mut conn, &[SelfWithholdingRateUpdate { id: 99_999, rate_bp: 0 }]).is_err());
    }

    #[test]
    fn adds_and_deletes_codes_and_types() {
        let mut conn = db();
        let input = |code: &str| SelfWithholdingRateInput { ciiu_code: code.into(), economic_activity: "Prueba".into(), rate_bp: 80 };
        let id = insert_rate(&conn, &input("99")).unwrap();
        assert_eq!(rate(&list_rates(&conn).unwrap(), "0099").source, USER_SOURCE);
        assert!(insert_rate(&conn, &input("0111")).unwrap_err().0.contains("ya existe"), "0111 y 111 son el mismo código");
        delete_rate(&conn, id).unwrap();
        assert_eq!(list_rates(&conn).unwrap().len(), 501);

        let t = |label: &str, category: &str| SalesDocumentTypeMappingInput { normalized_label: label.into(), original_label: label.into(), category: category.into() };
        save_types(&mut conn, &[t("documento electronico x", "credit_note")]).unwrap();
        save_types(&mut conn, &[t("documento electronico x", "invoice")]).unwrap();
        let x = list_types(&conn).unwrap().into_iter().find(|m| m.normalized_label == "documento electronico x").unwrap();
        assert_eq!(x.category, "invoice");
        update_type_category(&conn, x.id, "credit_note").unwrap();
        delete_type(&conn, x.id).unwrap();
        assert_eq!(list_types(&conn).unwrap().len(), 2);
    }
}
