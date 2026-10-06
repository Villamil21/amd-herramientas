//! Estados Financieros → Códigos PUC por factura.
//!
//! - `puc_codes`: catálogo del PUC, sembrado por la migración 010. Solo se
//!   consulta: no hay funciones para crear, editar ni eliminar códigos.
//! - `puc_document_title_mappings`: título de documento → Factura electrónica
//!   / Nota crédito. Misma forma que los títulos de IVA de compras, pero en su
//!   propia tabla: una decisión en un módulo no cambia el otro.

use rusqlite::{params, Connection, Row};

use crate::error::{AppError, AppResult};
use crate::models::puc::PucCode;
use crate::models::withholding::{DocumentTitleMapping, DocumentTitleMappingInput};
use crate::services::time::now_iso;

/// Todo el catálogo en el orden del PUC: como texto, «1» < «11» < «1105» < «110505».
pub fn list_codes(conn: &Connection) -> AppResult<Vec<PucCode>> {
    let mut stmt = conn.prepare("SELECT code, concept FROM puc_codes ORDER BY code")?;
    let rows = stmt.query_map([], |r| Ok(PucCode { code: r.get(0)?, concept: r.get(1)? }))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

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

pub fn list_titles(conn: &Connection) -> AppResult<Vec<DocumentTitleMapping>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM puc_document_title_mappings ORDER BY normalized_title"))?;
    let rows = stmt.query_map([], map)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Crea o actualiza (por título normalizado) varias clasificaciones: todas o ninguna.
pub fn save_titles(conn: &mut Connection, items: &[DocumentTitleMappingInput]) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    for m in items {
        tx.execute(
            "INSERT INTO puc_document_title_mappings (normalized_title, display_title, category, created_at, updated_at)
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
        "UPDATE puc_document_title_mappings SET category = ?1, updated_at = ?2 WHERE id = ?3",
        params![category, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::user("La clasificación no existe o fue eliminada."));
    }
    Ok(())
}

pub fn delete_title(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM puc_document_title_mappings WHERE id = ?1", [id])?;
    Ok(())
}

pub fn insert_title_full(conn: &Connection, m: &DocumentTitleMapping) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO puc_document_title_mappings ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
        params![m.id, m.normalized_title, m.display_title, m.category, m.created_at, m.updated_at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;
    use crate::database::vat_titles;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        conn
    }

    fn concept(codes: &[PucCode], code: &str) -> Option<String> {
        codes.iter().find(|c| c.code == code).map(|c| c.concept.clone())
    }

    #[test]
    fn seeds_the_catalog_in_puc_order() {
        let codes = list_codes(&db()).unwrap();
        assert_eq!(codes.len(), 2517);
        // Puntos de control del catálogo fuente (páginas 5 y 115).
        let head: Vec<(&str, &str)> = codes.iter().take(5).map(|c| (c.code.as_str(), c.concept.as_str())).collect();
        assert_eq!(head, [("1", "ACTIVO"), ("11", "DISPONIBLE"), ("1105", "CAJA"), ("110505", "CAJA GENERAL"), ("110510", "CAJAS MENORES")]);
        let last = codes.last().unwrap();
        assert_eq!((last.code.as_str(), last.concept.as_str()), ("96", "ACREEDORAS DE CONTROL POR CONTRA (DB)"));
        assert_eq!(concept(&codes, "1110").as_deref(), Some("BANCOS"));
        assert_eq!(concept(&codes, "111005").as_deref(), Some("MONEDA NACIONAL"));
        // Filas que en el PDF vienen pegadas o con la denominación desfasada.
        assert_eq!(concept(&codes, "125040").as_deref(), Some("ACEPTACIONES BANCARIAS O FINANCIERAS"));
        assert_eq!(concept(&codes, "125095").as_deref(), Some("OTROS"));
        assert_eq!(concept(&codes, "171068").as_deref(), Some("LOZA Y CRISTALERIA"));
        assert_eq!(concept(&codes, "1455").as_deref(), Some("MATERIALES, REPUESTOS Y ACCESORIOS"));
    }

    #[test]
    fn catalog_has_no_ranges_notes_or_invented_codes() {
        let codes = list_codes(&db()).unwrap();
        let count = |len: usize| codes.iter().filter(|c| c.code.len() == len).count();
        assert_eq!((count(1), count(2), count(4), count(6)), (9, 51, 338, 2119));
        for c in &codes {
            assert!(c.code.chars().all(|ch| ch.is_ascii_digit()), "{}", c.code);
            assert!(!c.concept.trim().is_empty(), "{} sin denominación", c.code);
            let upper = c.concept.to_uppercase();
            for note in ["D.R.", "ART.", "REPLANTEAD", "ADICIONAD", "ELIMINAD", "REDENOMINAD", "RECODIFICAD", "NUEVA DENOMINACI"] {
                assert!(!upper.contains(note), "{} conserva una nota legal: {}", c.code, c.concept);
            }
        }
        // «126001 a 126098» no se expande: la cuenta existe, sus números intermedios no.
        assert_eq!(concept(&codes, "1260").as_deref(), Some("CUENTAS EN PARTICIPACION"));
        for code in ["126001", "126050", "126098", "960101", "9601"] {
            assert_eq!(concept(&codes, code), None, "{code}");
        }
    }

    #[test]
    fn catalog_is_read_only_and_survives_restarts() {
        let mut conn = db();
        assert!(conn.execute("INSERT INTO puc_codes (code, concept) VALUES ('12345', 'X')", []).is_err(), "solo 1, 2, 4 o 6 dígitos");
        assert!(conn.execute("INSERT INTO puc_codes (code, concept) VALUES ('11050A', 'X')", []).is_err(), "solo dígitos");
        // Segundo arranque o actualización sin migraciones nuevas: no se vuelve a sembrar ni se pierde nada.
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(list_codes(&conn).unwrap().len(), 2517);
    }

    fn category(conn: &Connection, title: &str) -> Option<String> {
        list_titles(conn).unwrap().into_iter().find(|m| m.normalized_title == title).map(|m| m.category)
    }

    #[test]
    fn title_decisions_persist_and_do_not_touch_other_modules() {
        let mut conn = db();
        assert_eq!(category(&conn, "factura electronica de venta").as_deref(), Some("invoice"));
        assert_eq!(category(&conn, "nota de credito electronica").as_deref(), Some("credit_note"));
        assert_eq!(category(&conn, "documento xyz"), None, "un título desconocido se pregunta");

        let vat_before = vat_titles::list(&conn).unwrap().len();
        let t = |category: &str| DocumentTitleMappingInput { normalized_title: "documento xyz".into(), display_title: "DOCUMENTO XYZ".into(), category: category.into() };
        save_titles(&mut conn, &[t("credit_note")]).unwrap();
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(category(&conn, "documento xyz").as_deref(), Some("credit_note"));
        let saved = list_titles(&conn).unwrap().into_iter().find(|m| m.normalized_title == "documento xyz").unwrap();
        assert_eq!(saved.display_title, "DOCUMENTO XYZ", "se conserva el título original para mostrarlo");
        update_title_category(&conn, saved.id, "invoice").unwrap();
        assert_eq!(category(&conn, "documento xyz").as_deref(), Some("invoice"));
        assert!(update_title_category(&conn, 99_999, "invoice").is_err());
        assert!(save_titles(&mut conn, &[t("otro")]).is_err(), "la tabla solo admite las dos categorías");
        delete_title(&conn, saved.id).unwrap();
        assert_eq!(category(&conn, "documento xyz"), None);
        assert_eq!(vat_titles::list(&conn).unwrap().len(), vat_before);
    }
}
