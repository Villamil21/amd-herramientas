use std::collections::HashMap;

use rusqlite::{params, Connection, ErrorCode, Row};

use crate::error::{AppError, AppResult};
use crate::models::supplier::{Supplier, SupplierInput};
use crate::database::puc;
use crate::models::withholding::{SupplierWithholdingRule, WithholdingProfileInput};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, nit, business_name, vat_type, created_at, updated_at, person_type, fiscal_regime, fiscal_checked_at";

fn map(r: &Row) -> rusqlite::Result<Supplier> {
    Ok(Supplier {
        id: r.get(0)?,
        nit: r.get(1)?,
        business_name: r.get(2)?,
        vat_type: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
        person_type: r.get(6)?,
        fiscal_regime: r.get(7)?,
        fiscal_checked_at: r.get(8)?,
        withholding_rules: Vec::new(),
    })
}

/// Reglas de retención agrupadas por proveedor, en el orden en que se guardaron.
fn rules_by_supplier(conn: &Connection) -> AppResult<HashMap<i64, Vec<SupplierWithholdingRule>>> {
    let mut stmt = conn.prepare("SELECT supplier_id, id, rate_id, base_mode, is_default FROM supplier_withholding_rules ORDER BY supplier_id, id")?;
    let mut out: HashMap<i64, Vec<SupplierWithholdingRule>> = HashMap::new();
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, SupplierWithholdingRule { id: r.get(1)?, rate_id: r.get(2)?, base_mode: r.get(3)?, is_default: r.get::<_, i64>(4)? != 0 }))
    })? {
        let (supplier_id, rule) = row?;
        out.entry(supplier_id).or_default().push(rule);
    }
    Ok(out)
}

/// El NIT es único: un segundo proveedor con el mismo NIT se rechaza con un mensaje claro.
fn duplicate_nit(e: rusqlite::Error, nit: &str) -> AppError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == ErrorCode::ConstraintViolation => {
            AppError::user(format!("Ya existe un proveedor con el NIT {nit}."))
        }
        _ => e.into(),
    }
}

pub fn list(conn: &Connection, search: Option<&str>) -> AppResult<Vec<Supplier>> {
    let pattern = format!("%{}%", search.unwrap_or("").trim());
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM suppliers WHERE business_name LIKE ?1 OR nit LIKE ?1 ORDER BY business_name COLLATE NOCASE"
    ))?;
    let mut rows: Vec<Supplier> = stmt.query_map([pattern], map)?.collect::<Result<_, _>>()?;
    let mut rules = rules_by_supplier(conn)?;
    for s in &mut rows {
        s.withholding_rules = rules.remove(&s.id).unwrap_or_default();
    }
    Ok(rows)
}

pub fn insert(conn: &Connection, s: &SupplierInput) -> AppResult<i64> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![s.nit, s.business_name, s.vat_type, now],
    )
    .map_err(|e| duplicate_nit(e, &s.nit))?;
    let id = conn.last_insert_rowid();
    puc::adopt_codes_saved_by_nit(conn, id, &s.nit)?;
    Ok(id)
}

/// Inserta un proveedor completo (restauración de backup), con sus reglas de retención.
pub fn insert_full(conn: &Connection, s: &Supplier) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO suppliers ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"),
        params![s.id, s.nit, s.business_name, s.vat_type, s.created_at, s.updated_at, s.person_type, s.fiscal_regime, s.fiscal_checked_at],
    )
    .map_err(|e| duplicate_nit(e, &s.nit))?;
    for r in &s.withholding_rules {
        conn.execute(
            "INSERT INTO supplier_withholding_rules (id, supplier_id, rate_id, base_mode, is_default, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![r.id, s.id, r.rate_id, r.base_mode, r.is_default as i64, s.updated_at],
        )?;
    }
    Ok(())
}

fn replace_rules(conn: &Connection, id: i64, profile: &WithholdingProfileInput, now: &str) -> AppResult<()> {
    conn.execute("DELETE FROM supplier_withholding_rules WHERE supplier_id = ?1", [id])?;
    for r in &profile.rules {
        conn.execute(
            "INSERT INTO supplier_withholding_rules (supplier_id, rate_id, base_mode, is_default, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, r.rate_id, r.base_mode, r.is_default as i64, now],
        )?;
    }
    Ok(())
}

/// Guarda PJ/PN y reemplaza las reglas de retención del proveedor (todo o nada).
/// NIT, razón social y tipo IVA no se tocan.
pub fn save_withholding_profile(conn: &mut Connection, id: i64, profile: &WithholdingProfileInput) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_iso();
    let n = tx.execute("UPDATE suppliers SET person_type = ?1, updated_at = ?2 WHERE id = ?3", params![profile.person_type, now, id])?;
    if n == 0 {
        return Err(AppError::user("El proveedor no existe o fue eliminado."));
    }
    replace_rules(&tx, id, profile, &now)?;
    tx.commit()?;
    Ok(())
}

/// Crea un proveedor desde Retención en la fuente con su configuración y el régimen leído de la factura.
pub fn insert_with_profile(conn: &mut Connection, s: &SupplierInput, profile: &WithholdingProfileInput, fiscal_regime: Option<&str>) -> AppResult<i64> {
    let tx = conn.transaction()?;
    let id = insert(&tx, s)?;
    let now = now_iso();
    tx.execute(
        "UPDATE suppliers SET person_type = ?1, fiscal_regime = ?2, fiscal_checked_at = CASE WHEN ?2 IS NULL THEN NULL ELSE ?3 END WHERE id = ?4",
        params![profile.person_type, fiscal_regime, now, id],
    )?;
    replace_rules(&tx, id, profile, &now)?;
    tx.commit()?;
    Ok(id)
}

/// Guarda el régimen / responsabilidad fiscal verificado en una factura.
pub fn set_fiscal_regime(conn: &Connection, id: i64, fiscal_regime: &str) -> AppResult<()> {
    let now = now_iso();
    let n = conn.execute(
        "UPDATE suppliers SET fiscal_regime = ?1, fiscal_checked_at = ?2, updated_at = ?2 WHERE id = ?3",
        params![fiscal_regime, now, id],
    )?;
    if n == 0 {
        return Err(AppError::user("El proveedor no existe o fue eliminado."));
    }
    Ok(())
}

/// Reglas que usan un concepto de la tabla de retenciones (para avisar antes de eliminarlo).
pub fn count_rules_using_rate(conn: &Connection, rate_id: i64) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM supplier_withholding_rules WHERE rate_id = ?1", [rate_id], |r| r.get(0))?)
}

pub fn update(conn: &Connection, id: i64, s: &SupplierInput) -> AppResult<()> {
    let n = conn
        .execute(
            "UPDATE suppliers SET nit = ?1, business_name = ?2, vat_type = ?3, updated_at = ?4 WHERE id = ?5",
            params![s.nit, s.business_name, s.vat_type, now_iso(), id],
        )
        .map_err(|e| duplicate_nit(e, &s.nit))?;
    if n == 0 {
        return Err(AppError::user("El proveedor no existe o fue eliminado."));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM suppliers WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    #[test]
    fn crud_and_unique_nit() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        let input = SupplierInput { nit: "900319753".into(), business_name: "PRICESMART COLOMBIA S.A.S.".into(), vat_type: Some("purchase".into()) };
        let id = insert(&conn, &input).unwrap();
        assert!(insert(&conn, &input).unwrap_err().0.contains("900319753"));
        update(&conn, id, &SupplierInput { vat_type: Some("service".into()), ..input.clone() }).unwrap();
        let all = list(&conn, Some("9003")).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].vat_type.as_deref(), Some("service"));
        delete(&conn, id).unwrap();
        assert!(list(&conn, None).unwrap().is_empty());
    }

    #[test]
    fn withholding_profile_keeps_iva_data_and_cascades() {
        use crate::models::withholding::SupplierWithholdingRuleInput;
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).unwrap();
        let input = SupplierInput { nit: "901398069".into(), business_name: "MONO COLOMBIA S.A.S.".into(), vat_type: Some("service".into()) };
        let rule = |rate_id, is_default| SupplierWithholdingRuleInput { rate_id, base_mode: "invoice_subtotal".into(), is_default };
        let profile = WithholdingProfileInput { person_type: Some("PJ".into()), rules: vec![rule(6, true), rule(13, false)] };
        let id = insert_with_profile(&mut conn, &input, &profile, Some("R-99-PN")).unwrap();
        let s = &list(&conn, None).unwrap()[0];
        assert_eq!((s.person_type.as_deref(), s.fiscal_regime.as_deref()), (Some("PJ"), Some("R-99-PN")));
        assert!(s.fiscal_checked_at.is_some());
        assert_eq!(s.withholding_rules.iter().map(|r| (r.rate_id, r.is_default)).collect::<Vec<_>>(), vec![(6, true), (13, false)]);

        // El análisis de IVA actualiza solo sus datos: la configuración de retención se conserva.
        update(&conn, id, &SupplierInput { business_name: "MONO".into(), ..input.clone() }).unwrap();
        assert_eq!(list(&conn, None).unwrap()[0].withholding_rules.len(), 2);

        save_withholding_profile(&mut conn, id, &WithholdingProfileInput { person_type: Some("PN".into()), rules: vec![rule(14, true)] }).unwrap();
        set_fiscal_regime(&conn, id, "O-15").unwrap();
        let s = &list(&conn, None).unwrap()[0];
        assert_eq!((s.person_type.as_deref(), s.fiscal_regime.as_deref(), s.withholding_rules.len()), (Some("PN"), Some("O-15"), 1));
        assert_eq!(count_rules_using_rate(&conn, 14).unwrap(), 1);

        delete(&conn, id).unwrap();
        assert_eq!(count_rules_using_rate(&conn, 14).unwrap(), 0, "las reglas se eliminan con el proveedor");
    }

    #[test]
    fn migration_006_keeps_existing_suppliers() {
        use crate::database::migrations::{ensure_migrations_table, MIGRATIONS};
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_migrations_table(&conn).unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 5) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO schema_migrations VALUES (?1, ?2, 'x')", params![m.version, m.name]).unwrap();
        }
        conn.execute(
            "INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at) VALUES ('900319753', 'PRICESMART', 'purchase', 'c', 'u')",
            [],
        )
        .unwrap();
        run_pending(&mut conn).unwrap();
        let s = &list(&conn, None).unwrap()[0];
        assert_eq!((s.nit.as_str(), s.vat_type.as_deref(), s.created_at.as_str(), s.updated_at.as_str()), ("900319753", Some("purchase"), "c", "u"));
        assert!(s.person_type.is_none() && s.fiscal_regime.is_none() && s.withholding_rules.is_empty());
    }

    #[test]
    fn minimal_supplier_has_no_vat_type_until_configured() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        // Creado desde Códigos PUC por factura: solo NIT y razón social.
        let minimal = SupplierInput { nit: "900999999".into(), business_name: "PROVEEDOR NUEVO SAS".into(), vat_type: None };
        let id = insert(&conn, &minimal).unwrap();
        let s = &list(&conn, None).unwrap()[0];
        assert_eq!((s.nit.as_str(), s.business_name.as_str(), s.vat_type.as_deref(), s.person_type.as_deref()), ("900999999", "PROVEEDOR NUEVO SAS", None, None));
        assert!(insert(&conn, &minimal).unwrap_err().0.contains("900999999"), "no se duplica por NIT");
        // IVA de compras lo completa después sobre el mismo registro.
        update(&conn, id, &SupplierInput { vat_type: Some("service".into()), ..minimal }).unwrap();
        let all = list(&conn, None).unwrap();
        assert_eq!((all.len(), all[0].id, all[0].vat_type.as_deref()), (1, id, Some("service")));
    }

    /// La 012 reconstruye `suppliers`: con las llaves foráneas activas (como en la app) no se pierde nada.
    #[test]
    fn migration_012_rebuild_keeps_suppliers_rules_and_codes() {
        use crate::database::migrations::{ensure_migrations_table, MIGRATIONS};
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        ensure_migrations_table(&conn).unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 11) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO schema_migrations VALUES (?1, ?2, 'x')", params![m.version, m.name]).unwrap();
        }
        conn.execute_batch(
            "INSERT INTO suppliers (id, nit, business_name, vat_type, created_at, updated_at, person_type, fiscal_regime, fiscal_checked_at)
                VALUES (7, '900319753', 'PRICESMART', 'purchase', 'c', 'u', 'PJ', 'O-15', 'f'), (9, '901398069', 'MONO', 'service', 'c2', 'u2', NULL, NULL, NULL);
             INSERT INTO supplier_withholding_rules (id, supplier_id, rate_id, base_mode, is_default, created_at, updated_at)
                VALUES (3, 7, 6, 'invoice_subtotal', 1, 'x', 'x'), (4, 7, 13, 'manual', 0, 'x', 'x');
             INSERT INTO supplier_puc_codes (supplier_nit, puc_code, usage_count, created_at, last_used_at)
                VALUES ('900319753', '513595', 4, 'a', 'b'), ('800123456', '110505', 1, 'a', 'b');",
        )
        .unwrap();

        assert_eq!(run_pending(&mut conn).unwrap(), ["012_suppliers_minimal_and_puc_by_supplier"]);
        assert_eq!(conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0)).unwrap(), 1, "las llaves foráneas vuelven a quedar activas");

        let all = list(&conn, None).unwrap();
        assert_eq!(all.len(), 2);
        let mono = &all[0];
        assert_eq!((mono.id, mono.nit.as_str(), mono.vat_type.as_deref(), mono.created_at.as_str(), mono.updated_at.as_str()), (9, "901398069", Some("service"), "c2", "u2"));
        let price = &all[1];
        assert_eq!((price.id, price.vat_type.as_deref(), price.person_type.as_deref(), price.fiscal_regime.as_deref(), price.fiscal_checked_at.as_deref()), (7, Some("purchase"), Some("PJ"), Some("O-15"), Some("f")));
        assert_eq!(price.withholding_rules.iter().map(|r| (r.id, r.rate_id, r.is_default)).collect::<Vec<_>>(), vec![(3, 6, true), (4, 13, false)], "las reglas de retención siguen en su proveedor");

        // Los códigos PUC pasan al proveedor real; los de un NIT sin proveedor esperan a que se cree.
        assert_eq!(puc::list_supplier_codes(&conn, 7).unwrap(), ["513595"]);
        assert_eq!(puc::list_all_supplier_codes(&conn).unwrap()[0].usage_count, 4);
        let new_id = insert(&conn, &SupplierInput { nit: "800123456".into(), business_name: "NUEVO".into(), vat_type: None }).unwrap();
        assert!(new_id > 9, "los id no se reutilizan");
        assert_eq!(puc::list_supplier_codes(&conn, new_id).unwrap(), ["110505"]);

        // Siguen vigentes el NIT único, las categorías válidas y el borrado en cascada.
        assert!(conn.execute("INSERT INTO suppliers (nit, business_name, created_at, updated_at) VALUES ('900319753', 'X', 'c', 'u')", []).is_err());
        assert!(conn.execute("INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at) VALUES ('5', 'X', 'otro', 'c', 'u')", []).is_err());
        delete(&conn, 7).unwrap();
        assert_eq!(count_rules_using_rate(&conn, 6).unwrap(), 0);
        assert!(puc::list_supplier_codes(&conn, 7).unwrap().is_empty());
    }

    #[test]
    fn rejects_unknown_vat_type_in_sql() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        let bad = SupplierInput { nit: "1".into(), business_name: "A".into(), vat_type: Some("otro".into()) };
        assert!(insert(&conn, &bad).is_err());
    }
}
