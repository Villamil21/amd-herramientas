//! Estados Financieros → Códigos PUC por factura.
//!
//! - `puc_codes`: catálogo del PUC, sembrado por la migración 010. Solo se
//!   consulta: no hay funciones para crear, editar ni eliminar códigos.
//! - `puc_document_title_mappings`: título de documento → Factura electrónica
//!   / Nota crédito. Misma forma que los títulos de IVA de compras, pero en su
//!   propia tabla: una decisión en un módulo no cambia el otro.
//! - `supplier_puc_codes`: códigos que el usuario ha confirmado para cada
//!   proveedor registrado (por su id). Son accesos rápidos: nunca se asignan solos.

use rusqlite::{params, Connection, Row};

use crate::error::{AppError, AppResult};
use crate::models::puc::{PucCode, SupplierPucCode};
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

/// Códigos confirmados para un proveedor, del usado más recientemente al más antiguo.
pub fn list_supplier_codes(conn: &Connection, supplier_id: i64) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT puc_code FROM supplier_puc_codes WHERE supplier_id = ?1 ORDER BY last_used_at DESC, id DESC")?;
    let rows = stmt.query_map([supplier_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Asocia un código al proveedor. Si ya lo tenía no se duplica: se actualizan
/// la fecha de último uso y el contador. Solo admite subcuentas de 6 dígitos del
/// catálogo y proveedores registrados.
pub fn record_supplier_code(conn: &Connection, supplier_id: i64, code: &str) -> AppResult<()> {
    record_supplier_code_at(conn, supplier_id, code, &now_iso())
}

fn record_supplier_code_at(conn: &Connection, supplier_id: i64, code: &str, now: &str) -> AppResult<()> {
    let known: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM puc_codes WHERE code = ?1 AND length(code) = 6)", [code], |r| r.get(0))?;
    if !known {
        return Err(AppError::user("No se puede asignar este nivel del PUC. Selecciona un código de 6 dígitos."));
    }
    let registered: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM suppliers WHERE id = ?1)", [supplier_id], |r| r.get(0))?;
    if !registered {
        return Err(AppError::user("El proveedor no existe o fue eliminado."));
    }
    conn.execute(
        "INSERT INTO supplier_puc_codes (supplier_id, puc_code, usage_count, created_at, last_used_at)
         VALUES (?1, ?2, 1, ?3, ?3)
         ON CONFLICT(supplier_id, puc_code) DO UPDATE SET
            usage_count = usage_count + 1,
            last_used_at = excluded.last_used_at",
        params![supplier_id, code, now],
    )?;
    Ok(())
}

/// Un proveedor recién creado recibe los códigos que la versión anterior guardó
/// solo por NIT (tabla de archivo de la migración 011): pasan a su registro y
/// salen del archivo.
pub fn adopt_codes_saved_by_nit(conn: &Connection, supplier_id: i64, nit: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO supplier_puc_codes (supplier_id, puc_code, usage_count, created_at, last_used_at)
         SELECT ?1, puc_code, usage_count, created_at, last_used_at FROM supplier_puc_codes_by_nit WHERE supplier_nit = ?2 ORDER BY id",
        params![supplier_id, nit],
    )?;
    conn.execute("DELETE FROM supplier_puc_codes_by_nit WHERE supplier_nit = ?1", [nit])?;
    Ok(())
}

/// Todas las asociaciones proveedor ↔ código, con el NIT del proveedor (backup).
pub fn list_all_supplier_codes(conn: &Connection) -> AppResult<Vec<SupplierPucCode>> {
    let mut stmt = conn.prepare(
        "SELECT s.nit, c.puc_code, c.usage_count, c.created_at, c.last_used_at
         FROM supplier_puc_codes c JOIN suppliers s ON s.id = c.supplier_id ORDER BY c.id",
    )?;
    let rows = stmt
        .query_map([], |r| Ok(SupplierPucCode { supplier_nit: r.get(0)?, puc_code: r.get(1)?, usage_count: r.get(2)?, created_at: r.get(3)?, last_used_at: r.get(4)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Restauración de backup: el proveedor se localiza por NIT. Se omite, sin
/// fallar, una asociación repetida, de un proveedor que no está o cuyo código
/// no sea una subcuenta del catálogo de esta versión. Devuelve si se insertó.
pub fn insert_supplier_code_full(conn: &Connection, c: &SupplierPucCode) -> AppResult<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO supplier_puc_codes (supplier_id, puc_code, usage_count, created_at, last_used_at)
         SELECT s.id, ?2, ?3, ?4, ?5 FROM suppliers s
         WHERE s.nit = ?1 AND EXISTS (SELECT 1 FROM puc_codes WHERE code = ?2 AND length(code) = 6)",
        params![c.supplier_nit, c.puc_code, c.usage_count.max(1), c.created_at, c.last_used_at],
    )?;
    Ok(n > 0)
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

    fn supplier(conn: &Connection, nit: &str) -> i64 {
        use crate::models::supplier::SupplierInput;
        crate::database::suppliers::insert(conn, &SupplierInput { nit: nit.into(), business_name: format!("PROVEEDOR {nit}"), vat_type: None }).unwrap()
    }

    #[test]
    fn supplier_codes_are_remembered_per_supplier_without_duplicates() {
        let mut conn = db();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let (a, b) = (supplier(&conn, "900319753"), supplier(&conn, "800123456"));
        assert!(list_supplier_codes(&conn, a).unwrap().is_empty(), "un proveedor nuevo no trae códigos de otros");

        record_supplier_code_at(&conn, a, "513595", "2026-10-01T10:00:00Z").unwrap();
        record_supplier_code_at(&conn, a, "514010", "2026-10-01T10:05:00Z").unwrap();
        record_supplier_code_at(&conn, b, "110505", "2026-10-01T10:06:00Z").unwrap();
        assert_eq!(list_supplier_codes(&conn, a).unwrap(), ["514010", "513595"], "el más reciente primero");
        assert_eq!(list_supplier_codes(&conn, b).unwrap(), ["110505"], "solo los del proveedor");

        // Reutilizar un código no lo duplica: sube al principio y cuenta el uso.
        record_supplier_code_at(&conn, a, "513595", "2026-10-02T09:00:00Z").unwrap();
        assert_eq!(list_supplier_codes(&conn, a).unwrap(), ["513595", "514010"]);
        let saved = list_all_supplier_codes(&conn).unwrap();
        assert_eq!(saved.len(), 3);
        let reused = saved.iter().find(|c| c.supplier_nit == "900319753" && c.puc_code == "513595").unwrap();
        assert_eq!((reused.usage_count, reused.created_at.as_str(), reused.last_used_at.as_str()), (2, "2026-10-01T10:00:00Z", "2026-10-02T09:00:00Z"));

        // Solo subcuentas de 6 dígitos que existan en la tabla: nunca una cuenta de 4 (5135, 1105) ni un grupo.
        for bad in ["5135", "1105", "11", "999999", "", "51359A"] {
            assert!(record_supplier_code(&conn, a, bad).unwrap_err().0.contains("código de 6 dígitos"), "{bad}");
        }
        assert!(conn.execute("INSERT INTO supplier_puc_codes (supplier_id, puc_code, created_at, last_used_at) VALUES (?1, '5135', 'x', 'x')", [a]).is_err());
        // Solo contra un proveedor registrado: sin él no se guarda nada.
        assert!(record_supplier_code(&conn, 99_999, "513595").is_err());
        assert_eq!(list_all_supplier_codes(&conn).unwrap().len(), 3);

        // Segundo arranque o actualización: se conservan.
        assert!(run_pending(&mut conn).unwrap().is_empty());
        assert_eq!(list_supplier_codes(&conn, a).unwrap(), ["513595", "514010"]);

        // Cambiar el NIT o la razón social no pierde el historial; eliminar el proveedor sí lo quita.
        conn.execute("UPDATE suppliers SET nit = '900319754', business_name = 'Otro Nombre' WHERE id = ?1", [a]).unwrap();
        assert_eq!(list_supplier_codes(&conn, a).unwrap().len(), 2);
        crate::database::suppliers::delete(&conn, a).unwrap();
        assert_eq!(list_all_supplier_codes(&conn).unwrap().len(), 1);
    }

    #[test]
    fn migration_011_keeps_existing_data() {
        use crate::database::migrations::{ensure_migrations_table, MIGRATIONS};
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_migrations_table(&conn).unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 10) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO schema_migrations VALUES (?1, ?2, 'x')", params![m.version, m.name]).unwrap();
        }
        conn.execute("INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at) VALUES ('900319753', 'PRICESMART', 'purchase', 'c', 'u')", []).unwrap();
        let titles = list_titles(&conn).unwrap().len();
        assert_eq!(run_pending(&mut conn).unwrap()[0], "011_supplier_puc_codes");
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM suppliers", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!((list_codes(&conn).unwrap().len(), list_titles(&conn).unwrap().len()), (2517, titles));
        assert!(list_all_supplier_codes(&conn).unwrap().is_empty());
    }
}
