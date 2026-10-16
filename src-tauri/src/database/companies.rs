use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{AppError, AppResult};
use crate::database::{company_documents, exogena, shareholder_documents};
use crate::models::company::{Company, CompanyInput, Shareholder};
use crate::models::third_party::ThirdPartyData;
use crate::services::time::now_iso;

const COLUMNS: &str = "id, razon_social, nit, direccion, ciudad, telefono, correo, info_adicional, logo_file, dv, subscribed_total_shares, subscribed_nominal_value, paid_total_shares, paid_nominal_value, created_at, updated_at, ciiu_code, legal_rep_name, legal_rep_document, legal_rep_alt_name, legal_rep_alt_document, legal_rep_manual, legal_rep_alt_manual, entity_narrative, corporate_purpose, registry_chamber, registry_city, constitution_doc_type, constitution_date, registry_number, registry_date, registry_book, registral_review";

fn map(r: &Row) -> rusqlite::Result<Company> {
    Ok(Company {
        id: r.get(0)?,
        razon_social: r.get(1)?,
        nit: r.get(2)?,
        direccion: r.get(3)?,
        ciudad: r.get(4)?,
        telefono: r.get(5)?,
        correo: r.get(6)?,
        info_adicional: r.get(7)?,
        logo_file: r.get(8)?,
        dv: r.get(9)?,
        subscribed_total_shares: r.get(10)?,
        subscribed_nominal_value: r.get(11)?,
        paid_total_shares: r.get(12)?,
        paid_nominal_value: r.get(13)?,
        ciiu_code: r.get(16)?,
        legal_rep_name: r.get(17)?,
        legal_rep_document: r.get(18)?,
        legal_rep_alt_name: r.get(19)?,
        legal_rep_alt_document: r.get(20)?,
        legal_rep_manual: r.get::<_, i64>(21)? != 0,
        legal_rep_alt_manual: r.get::<_, i64>(22)? != 0,
        entity_narrative: r.get(23)?,
        corporate_purpose: r.get(24)?,
        registry_chamber: r.get(25)?,
        registry_city: r.get(26)?,
        constitution_doc_type: r.get(27)?,
        constitution_date: r.get(28)?,
        registry_number: r.get(29)?,
        registry_date: r.get(30)?,
        registry_book: r.get(31)?,
        registral_review: serde_json::from_str(&r.get::<_, String>(32)?).unwrap_or_default(),
        shareholders: Vec::new(),
        documents: Vec::new(),
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}

pub fn list(conn: &Connection, search: Option<&str>) -> AppResult<Vec<Company>> {
    let pattern = format!("%{}%", search.unwrap_or("").trim());
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM companies
         WHERE razon_social LIKE ?1 OR nit LIKE ?1 OR ciudad LIKE ?1
         ORDER BY razon_social COLLATE NOCASE"
    ))?;
    let mut rows = stmt.query_map([pattern], map)?.collect::<Result<Vec<_>, _>>()?;
    for c in &mut rows {
        c.shareholders = list_shareholders(conn, c.id)?;
        c.documents = company_documents::list(conn, c.id)?;
    }
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Company> {
    let mut company = conn.query_row(&format!("SELECT {COLUMNS} FROM companies WHERE id = ?1"), [id], map)
        .optional()?
        .ok_or_else(|| AppError::user("La empresa no existe o fue eliminada."))?;
    company.shareholders = list_shareholders(conn, id)?;
    company.documents = company_documents::list(conn, id)?;
    Ok(company)
}

const SHAREHOLDER_COLUMNS: &str = "id, name, identity_document, percentage, sort_order, legal_role, doc_type_code, dv, person_type, first_surname, second_surname, first_name, other_names, address, country_code, country_name, dept_code, dept_name, muni_code, muni_name, phone, email, rut_status";

fn map_shareholder(r: &Row) -> rusqlite::Result<Shareholder> {
    Ok(Shareholder {
        id: Some(r.get(0)?),
        name: r.get(1)?,
        identity_document: r.get(2)?,
        percentage: r.get(3)?,
        sort_order: r.get(4)?,
        legal_role: r.get(5)?,
        tax: ThirdPartyData {
            doc_type_code: r.get(6)?,
            dv: r.get(7)?,
            person_type: r.get(8)?,
            first_surname: r.get(9)?,
            second_surname: r.get(10)?,
            first_name: r.get(11)?,
            other_names: r.get(12)?,
            address: r.get(13)?,
            country_code: r.get(14)?,
            country_name: r.get(15)?,
            dept_code: r.get(16)?,
            dept_name: r.get(17)?,
            muni_code: r.get(18)?,
            muni_name: r.get(19)?,
        },
        phone: r.get(20)?,
        email: r.get(21)?,
        rut_status: r.get(22)?,
        documents: Vec::new(),
        new_documents: Vec::new(),
    })
}

fn list_shareholders(conn: &Connection, company_id: i64) -> AppResult<Vec<Shareholder>> {
    let mut rows: Vec<Shareholder> = conn
        .prepare(&format!("SELECT {SHAREHOLDER_COLUMNS} FROM shareholders WHERE company_id = ?1 ORDER BY sort_order, id"))?
        .query_map([company_id], map_shareholder)?
        .collect::<Result<_, _>>()?;
    let mut docs = shareholder_documents::list_for_company(conn, company_id)?;
    for s in &mut rows {
        s.documents = s.id.and_then(|id| docs.remove(&id)).unwrap_or_default();
    }
    Ok(rows)
}

/// Guarda los socios SIN cambiar el id de los que ya existían (el RUT, el historial y los registros de Exógena cuelgan de ese id):
/// los que traen id se actualizan, los nuevos se insertan y los que ya no están se eliminan. Registra el RUT cargado en el formulario.
fn replace_shareholders(conn: &Connection, company_id: i64, rows: &[Shareholder], sizes: &std::collections::HashMap<String, i64>) -> AppResult<()> {
    let existing: Vec<i64> = conn.prepare("SELECT id FROM shareholders WHERE company_id = ?1")?.query_map([company_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let kept: Vec<i64> = rows.iter().filter_map(|s| s.id).filter(|id| existing.contains(id)).collect();
    for id in &existing {
        if !kept.contains(id) {
            conn.execute("DELETE FROM shareholders WHERE id = ?1", [id])?;
        }
    }
    let now = now_iso();
    for s in rows {
        let mut tax = s.tax.clone();
        exogena::resolve_third_party(conn, &mut tax)?;
        let id = match s.id.filter(|id| existing.contains(id)) {
            Some(id) => {
                conn.execute(
                    "UPDATE shareholders SET name = ?1, identity_document = ?2, percentage = ?3, sort_order = ?4, legal_role = ?5, doc_type_code = ?6, dv = ?7, person_type = ?8,
                            first_surname = ?9, second_surname = ?10, first_name = ?11, other_names = ?12, address = ?13, country_code = ?14, country_name = ?15, dept_code = ?16,
                            dept_name = ?17, muni_code = ?18, muni_name = ?19, phone = ?20, email = ?21, rut_status = ?22, updated_at = ?23
                     WHERE id = ?24",
                    params![
                        s.name, s.identity_document, s.percentage, s.sort_order, s.legal_role, tax.doc_type_code, tax.dv, tax.person_type, tax.first_surname, tax.second_surname, tax.first_name,
                        tax.other_names, tax.address, tax.country_code, tax.country_name, tax.dept_code, tax.dept_name, tax.muni_code, tax.muni_name, s.phone, s.email, s.rut_status, now, id
                    ],
                )?;
                id
            }
            None => {
                // Un socio con id que pertenece a otra empresa no se reutiliza: se inserta como nuevo.
                let taken: bool = match s.id {
                    Some(id) => conn.query_row("SELECT EXISTS(SELECT 1 FROM shareholders WHERE id = ?1)", [id], |r| r.get(0))?,
                    None => false,
                };
                conn.execute(
                    "INSERT INTO shareholders (id, company_id, name, identity_document, percentage, sort_order, legal_role, doc_type_code, dv, person_type, first_surname, second_surname,
                            first_name, other_names, address, country_code, country_name, dept_code, dept_name, muni_code, muni_name, phone, email, rut_status, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?25)",
                    params![
                        if taken { None } else { s.id }, company_id, s.name, s.identity_document, s.percentage, s.sort_order, s.legal_role, tax.doc_type_code, tax.dv, tax.person_type, tax.first_surname,
                        tax.second_surname, tax.first_name, tax.other_names, tax.address, tax.country_code, tax.country_name, tax.dept_code, tax.dept_name, tax.muni_code, tax.muni_name, s.phone,
                        s.email, s.rut_status, now
                    ],
                )?;
                conn.last_insert_rowid()
            }
        };
        for doc in &s.new_documents {
            let size = sizes.get(&doc.stored_file).copied().unwrap_or(1).max(1);
            shareholder_documents::insert(conn, id, doc, size)?;
        }
    }
    Ok(())
}

pub fn insert(conn: &Connection, c: &CompanyInput) -> AppResult<i64> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO companies (razon_social, nit, direccion, ciudad, telefono, correo, info_adicional, logo_file, dv, subscribed_total_shares, subscribed_nominal_value, paid_total_shares, paid_nominal_value, created_at, updated_at, ciiu_code, legal_rep_name, legal_rep_document, legal_rep_alt_name, legal_rep_alt_document, legal_rep_manual, legal_rep_alt_manual, entity_narrative, corporate_purpose, registry_chamber, registry_city, constitution_doc_type, constitution_date, registry_number, registry_date, registry_book, registral_review)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31)",
        params![c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.dv, c.subscribed_total_shares, c.subscribed_nominal_value, c.paid_total_shares, c.paid_nominal_value, now, c.ciiu_code, c.legal_rep_name, c.legal_rep_document, c.legal_rep_alt_name, c.legal_rep_alt_document, c.legal_rep_manual, c.legal_rep_alt_manual, c.entity_narrative, c.corporate_purpose, c.registry_chamber, c.registry_city, c.constitution_doc_type, c.constitution_date, c.registry_number, c.registry_date, c.registry_book, serde_json::to_string(&c.registral_review).unwrap_or_else(|_| "[]".into())],
    )?;
    let id = conn.last_insert_rowid();
    replace_shareholders(conn, id, &c.shareholders, &c.document_sizes)?;
    exogena::flag_stale_shareholder_formats(conn, id)?;
    Ok(id)
}

/// Inserta conservando id y fechas (restauración de backups).
pub fn insert_full(conn: &Connection, c: &Company) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO companies ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33)"),
        params![c.id, c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.dv, c.subscribed_total_shares, c.subscribed_nominal_value, c.paid_total_shares, c.paid_nominal_value, c.created_at, c.updated_at, c.ciiu_code, c.legal_rep_name, c.legal_rep_document, c.legal_rep_alt_name, c.legal_rep_alt_document, c.legal_rep_manual, c.legal_rep_alt_manual, c.entity_narrative, c.corporate_purpose, c.registry_chamber, c.registry_city, c.constitution_doc_type, c.constitution_date, c.registry_number, c.registry_date, c.registry_book, serde_json::to_string(&c.registral_review).unwrap_or_else(|_| "[]".into())],
    )?;
    replace_shareholders(conn, c.id, &c.shareholders, &Default::default())?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, c: &CompanyInput) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE companies SET razon_social = ?1, nit = ?2, direccion = ?3, ciudad = ?4, telefono = ?5,
                correo = ?6, info_adicional = ?7, logo_file = ?8, dv = ?9, subscribed_total_shares = ?10, subscribed_nominal_value = ?11, paid_total_shares = ?12, paid_nominal_value = ?13, updated_at = ?14, ciiu_code = ?16, legal_rep_name = ?17, legal_rep_document = ?18, legal_rep_alt_name = ?19, legal_rep_alt_document = ?20, legal_rep_manual = ?21, legal_rep_alt_manual = ?22, entity_narrative = ?23, corporate_purpose = ?24, registry_chamber = ?25, registry_city = ?26, constitution_doc_type = ?27, constitution_date = ?28, registry_number = ?29, registry_date = ?30, registry_book = ?31, registral_review = ?32
         WHERE id = ?15",
        params![c.razon_social, c.nit, c.direccion, c.ciudad, c.telefono, c.correo, c.info_adicional, c.logo_file, c.dv, c.subscribed_total_shares, c.subscribed_nominal_value, c.paid_total_shares, c.paid_nominal_value, now_iso(), id, c.ciiu_code, c.legal_rep_name, c.legal_rep_document, c.legal_rep_alt_name, c.legal_rep_alt_document, c.legal_rep_manual, c.legal_rep_alt_manual, c.entity_narrative, c.corporate_purpose, c.registry_chamber, c.registry_city, c.constitution_doc_type, c.constitution_date, c.registry_number, c.registry_date, c.registry_book, serde_json::to_string(&c.registral_review).unwrap_or_else(|_| "[]".into())],
    )?;
    if n == 0 {
        return Err(AppError::user("La empresa no existe o fue eliminada."));
    }
    replace_shareholders(conn, id, &c.shareholders, &c.document_sizes)?;
    // Si cambiaron los socios o el capital, un 1010 ya «listo» se reabre (sus registros no se reescriben).
    exogena::flag_stale_shareholder_formats(conn, id)?;
    Ok(())
}

/// Empresas guardadas antes de los vínculos de representación legal: el principal se vincula con el socio
/// de igual documento; si no coincide queda como excepción explícita (así siguen editables sin perder el dato).
/// Es idempotente: solo toca empresas con representante, sin vínculo ni excepción.
pub fn link_legacy_representatives(conn: &Connection) -> AppResult<()> {
    let pending: Vec<(i64, String)> = conn
        .prepare("SELECT id, legal_rep_document FROM companies WHERE legal_rep_name <> '' AND legal_rep_manual = 0 AND NOT EXISTS (SELECT 1 FROM shareholders s WHERE s.company_id = companies.id AND s.legal_role = 'principal')")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (company_id, document) in pending {
        let key = crate::models::normalize::digits(&document);
        let matched = if key.is_empty() { None } else { list_shareholders(conn, company_id)?.into_iter().find(|s| crate::models::normalize::digits(&s.identity_document) == key).and_then(|s| s.id) };
        match matched {
            Some(shareholder_id) => conn.execute("UPDATE shareholders SET legal_role = 'principal' WHERE id = ?1", [shareholder_id])?,
            None => conn.execute("UPDATE companies SET legal_rep_manual = 1 WHERE id = ?1", [company_id])?,
        };
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    // Los movimientos contables nunca se borran sin trazabilidad: una empresa con información financiera se conserva.
    let used: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM fs_batches WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_employees WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_periods WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_opening_drafts WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_bank_accounts WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_tax_returns WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_tax_empty_periods WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_tax_company_settings WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_bank_account_lifecycle WHERE company_id = ?1) OR EXISTS(SELECT 1 FROM fs_bank_account_events WHERE company_id = ?1)", [id], |r| r.get(0))?;
    if used {
        return Err(AppError::user("La empresa tiene información en Estados Financieros (movimientos, nómina o periodos) y no se puede eliminar."));
    }
    conn.execute("DELETE FROM companies WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    #[test]
    fn legacy_representatives_are_linked_or_marked_as_exception() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        for (id, rep_name, rep_doc) in [(1, "Ana", "CC 1.020"), (2, "Pedro", "CC 99")] {
            conn.execute("INSERT INTO companies (id, razon_social, nit, created_at, updated_at, legal_rep_name, legal_rep_document) VALUES (?1, 'E', ?2, 'x', 'x', ?3, ?4)", params![id, format!("9{id}"), rep_name, rep_doc]).unwrap();
            conn.execute("INSERT INTO shareholders (company_id, name, identity_document, percentage, sort_order, created_at, updated_at) VALUES (?1, 'ANA', 'CC 1020', 100, 0, 'x', 'x')", [id]).unwrap();
        }
        link_legacy_representatives(&conn).unwrap();
        link_legacy_representatives(&conn).unwrap();
        let linked = get(&conn, 1).unwrap();
        assert_eq!(linked.shareholders[0].legal_role.as_deref(), Some("principal"));
        assert!(!linked.legal_rep_manual);
        let outsider = get(&conn, 2).unwrap();
        assert!(outsider.legal_rep_manual);
        assert_eq!(outsider.shareholders[0].legal_role, None);
    }

    fn company_input(shareholders: Vec<Shareholder>) -> CompanyInput {
        CompanyInput {
            razon_social: "EMPRESA".into(),
            nit: "900123456".into(),
            direccion: String::new(),
            ciudad: String::new(),
            telefono: String::new(),
            correo: String::new(),
            info_adicional: String::new(),
            logo_file: None,
            dv: "7".into(),
            subscribed_total_shares: Some(1000),
            subscribed_nominal_value: Some(1000),
            paid_total_shares: None,
            paid_nominal_value: None,
            ciiu_code: String::new(),
            legal_rep_name: String::new(),
            legal_rep_document: String::new(),
            legal_rep_alt_name: String::new(),
            legal_rep_alt_document: String::new(),
            legal_rep_manual: false,
            legal_rep_alt_manual: false,
            entity_narrative: String::new(),
            corporate_purpose: String::new(),
            registry_chamber: String::new(),
            registry_city: String::new(),
            constitution_doc_type: String::new(),
            constitution_date: String::new(),
            registry_number: String::new(),
            registry_date: String::new(),
            registry_book: String::new(),
            registral_review: vec![],
            shareholders,
            new_documents: vec![],
            document_sizes: Default::default(),
        }
    }

    fn natural(name_parts: (&str, &str), doc: &str, pct: f64) -> Shareholder {
        let mut s = Shareholder::basic("", doc, pct, None);
        s.tax = ThirdPartyData {
            doc_type_code: Some("13".into()),
            person_type: Some("PN".into()),
            first_surname: name_parts.0.into(),
            first_name: name_parts.1.into(),
            address: "cl 1 # 2-3".into(),
            country_code: "169".into(),
            dept_code: "76".into(),
            muni_code: "001".into(),
            ..Default::default()
        };
        s
    }

    fn open() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).unwrap();
        conn
    }

    #[test]
    fn shareholder_ids_territory_and_rut_history_survive_company_edits() {
        use crate::models::company::NewDocument;
        let conn = open();
        let input = company_input(vec![natural(("angarita", "ronaldo"), "cc 1.192.816.998", 50.2), natural(("lopez", "ana"), "cc 22.517.821", 49.8)]).validated().unwrap();
        let company_id = insert(&conn, &input).unwrap();
        let saved = get(&conn, company_id).unwrap();
        let (a, b) = (saved.shareholders[0].clone(), saved.shareholders[1].clone());
        assert_eq!(a.name, "ANGARITA RONALDO", "el nombre de una persona natural se arma con sus partes");
        assert_eq!((a.tax.country_name.as_str(), a.tax.dept_name.as_str(), a.tax.muni_name.as_str()), ("COLOMBIA", "Valle del Cauca", "Cali"));
        assert_eq!((a.tax.dept_code.as_str(), a.tax.muni_code.as_str(), a.identity_document.as_str()), ("76", "001", "CC 1192816998"));

        // Se carga el RUT de un socio dos veces: queda el historial y la versión vigente es la última.
        for (i, file) in ["a".repeat(32), "b".repeat(32)].iter().enumerate() {
            let mut edit = get(&conn, company_id).unwrap();
            edit.shareholders[0].new_documents = vec![NewDocument { kind: "rut".into(), file_name: format!("RUT {i}.pdf"), stored_file: format!("{file}.pdf") }];
            let mut i2 = company_input(edit.shareholders.clone()).validated().unwrap();
            i2.document_sizes.insert(format!("{file}.pdf"), 1234);
            update(&conn, company_id, &i2).unwrap();
        }
        let after = get(&conn, company_id).unwrap();
        assert_eq!(after.shareholders.iter().map(|s| s.id).collect::<Vec<_>>(), vec![a.id, b.id], "guardar la empresa no cambia el id de los socios");
        let docs = &after.shareholders[0].documents;
        assert_eq!(docs.len(), 2);
        assert_eq!((docs[0].is_current, docs[1].is_current, docs[1].size_bytes), (false, true, 1234));
        assert!(after.shareholders[1].documents.is_empty());
        assert!(company_documents::is_referenced(&conn, &docs[1].stored_file).unwrap(), "el archivo cuenta como en uso para la limpieza");

        // Quitar un socio elimina su ficha y su historial; el otro conserva todo.
        let one = company_input(vec![Shareholder { percentage: 100.0, ..after.shareholders[1].clone() }]).validated().unwrap();
        update(&conn, company_id, &one).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM shareholder_documents", [], |r| r.get(0)).unwrap();
        assert_eq!((get(&conn, company_id).unwrap().shareholders.len(), rows), (1, 0));
    }

    #[test]
    fn percentages_support_two_decimals_only() {
        assert!(company_input(vec![Shareholder::basic("a", "1", 50.2, None), Shareholder::basic("b", "2", 49.8, None)]).validated().is_ok());
        assert!(company_input(vec![Shareholder::basic("a", "1", 50.123, None), Shareholder::basic("b", "2", 49.877, None)]).validated().is_err());
        assert!(company_input(vec![Shareholder::basic("a", "1", 100.0, None)]).validated().is_ok());
    }

    #[test]
    fn invalid_shareholder_territory_is_rejected_and_nothing_is_saved() {
        let mut conn = open();
        let mut s = natural(("perez", "juan"), "cc 5", 100.0);
        s.tax.muni_code = "999".into();
        let input = company_input(vec![s]).validated().unwrap();
        // Como en el comando: la empresa y sus socios se guardan en una sola transacción.
        let tx = conn.transaction().unwrap();
        assert!(insert(&tx, &input).unwrap_err().0.contains("76999"));
        drop(tx);
        assert!(list(&conn, None).unwrap().is_empty());
    }

    #[test]
    fn editing_a_shareholder_reopens_a_ready_1010() {
        use serde_json::json;
        let mut conn = open();
        let input = company_input(vec![natural(("angarita", "ronaldo"), "cc 1", 100.0)]).validated().unwrap();
        let company_id = insert(&conn, &input).unwrap();
        let sync = exogena::ApplySyncInputForTest::new(company_id, json!({"name": "X"}), exogena::source_fingerprint(&conn, company_id).unwrap());
        exogena::apply_sync(&mut conn, &sync.0).unwrap();
        exogena::set_status(&conn, company_id, 2025, "1010", "listo", "").unwrap();
        let status = |c: &Connection| exogena::list_status(c, company_id, 2025).unwrap()[0].status.clone();
        // Guardar la empresa sin cambiar nada de socios ni capital no reabre el formato.
        let same = get(&conn, company_id).unwrap();
        update(&conn, company_id, &company_input(same.shareholders.clone()).validated().unwrap()).unwrap();
        assert_eq!(status(&conn), "listo");
        // Cambiar la dirección de un socio sí.
        let mut changed = same.shareholders.clone();
        changed[0].tax.address = "CL NUEVA 9".into();
        update(&conn, company_id, &company_input(changed).validated().unwrap()).unwrap();
        assert_eq!(status(&conn), "requiere_actualizacion");
    }

    #[test]
    fn registry_data_round_trips_keeps_case_and_flags_review_fields() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        let mut input = company_input(vec![]);
        input.entity_narrative = "  D&P Capital   Inversiones SAS con domicilio en Medellín  ".into();
        input.corporate_purpose = "Procesamiento de datos.\r\n\r\n\r\nComercio al por mayor.".into();
        input.registry_chamber = "Cámara de Comercio de Medellín".into();
        input.constitution_date = "2024-07-05".into();
        input.registry_number = "5955".into();
        input.registry_book = "IX".into();
        input.registral_review = vec!["registryDate".into(), " ".into()];
        let id = insert(&conn, &input.validated().unwrap()).unwrap();
        let c = get(&conn, id).unwrap();
        assert_eq!(c.entity_narrative, "D&P Capital Inversiones SAS con domicilio en Medellín");
        assert_eq!(c.corporate_purpose, "Procesamiento de datos.\n\nComercio al por mayor.");
        assert_eq!((c.registry_chamber.as_str(), c.constitution_date.as_str(), c.registry_number.as_str(), c.registry_book.as_str()), ("Cámara de Comercio de Medellín", "2024-07-05", "5955", "IX"));
        assert_eq!(c.registral_review, vec!["registryDate".to_string()]);
        let mut bad = company_input(vec![]);
        bad.constitution_date = "05/07/2024".into();
        assert!(bad.validated().is_err());
    }
}
