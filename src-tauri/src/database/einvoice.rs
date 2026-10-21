//! Ventas por facturación electrónica para Exógena (1007, 1005 y 1006): el detalle de cada documento importado y la identidad
//! confirmada de los clientes. Lo calculado (formatos, bases por formato) se recalcula siempre desde estas filas.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::time::now_iso;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EinvoiceDocInput {
    pub document_id: String,
    pub issue_date: String,
    pub doc_type: String,
    pub doc_type_key: String,
    /// `sale` (factura) o `return` (nota crédito).
    pub category: String,
    #[serde(default)]
    pub number: String,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub sheet: String,
    #[serde(default)]
    pub row_number: i64,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub receiver_nit_raw: String,
    #[serde(default)]
    pub receiver_name: String,
    pub total_cents: i64,
    pub iva_cents: i64,
    pub eeff_base_cents: i64,
    #[serde(default)]
    pub eeff_columns: Vec<String>,
    pub exo_base_cents: Option<i64>,
    #[serde(default)]
    pub exo_columns: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEinvoiceInput {
    pub company_id: i64,
    /// El usuario confirmó sustituir los documentos ya guardados cuyos valores cambiaron.
    #[serde(default)]
    pub replace: bool,
    pub docs: Vec<EinvoiceDocInput>,
}

#[derive(Debug, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveEinvoiceOutcome {
    pub inserted: i64,
    pub updated: i64,
    pub unchanged: i64,
    /// Documentos ya guardados con valores distintos: si no hay confirmación no se guarda nada.
    pub conflicts: Vec<String>,
    /// Años (de la fecha de emisión) que recibieron o cambiaron documentos.
    pub years: Vec<i64>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EinvoiceDoc {
    pub id: i64,
    pub company_id: i64,
    pub document_id: String,
    pub year: i64,
    pub issue_date: String,
    pub doc_type: String,
    pub doc_type_key: String,
    pub category: String,
    pub number: String,
    pub file_name: String,
    pub sheet: String,
    pub row_number: i64,
    pub status: String,
    pub receiver_nit_raw: String,
    pub receiver_name: String,
    pub total_cents: i64,
    pub iva_cents: i64,
    pub eeff_base_cents: i64,
    pub eeff_columns: Vec<String>,
    pub exo_base_cents: Option<i64>,
    pub exo_columns: Vec<String>,
    pub imported_at: String,
    pub updated_at: String,
}

const DOC_COLUMNS: &str = "id, company_id, document_id, year, issue_date, doc_type, doc_type_key, category, number, file_name, sheet, row_number, status, receiver_nit_raw, receiver_name, total_cents, iva_cents, eeff_base_cents, eeff_columns, exo_base_cents, exo_columns, imported_at, updated_at";

fn names(text: String) -> Vec<String> {
    serde_json::from_str(&text).unwrap_or_default()
}

fn map_doc(r: &Row) -> rusqlite::Result<EinvoiceDoc> {
    Ok(EinvoiceDoc {
        id: r.get(0)?,
        company_id: r.get(1)?,
        document_id: r.get(2)?,
        year: r.get(3)?,
        issue_date: r.get(4)?,
        doc_type: r.get(5)?,
        doc_type_key: r.get(6)?,
        category: r.get(7)?,
        number: r.get(8)?,
        file_name: r.get(9)?,
        sheet: r.get(10)?,
        row_number: r.get(11)?,
        status: r.get(12)?,
        receiver_nit_raw: r.get(13)?,
        receiver_name: r.get(14)?,
        total_cents: r.get(15)?,
        iva_cents: r.get(16)?,
        eeff_base_cents: r.get(17)?,
        eeff_columns: names(r.get(18)?),
        exo_base_cents: r.get(19)?,
        exo_columns: names(r.get(20)?),
        imported_at: r.get(21)?,
        updated_at: r.get(22)?,
    })
}

impl EinvoiceDocInput {
    fn validated(&self) -> AppResult<()> {
        if self.document_id.trim().is_empty() {
            return Err(AppError::user("Un documento no tiene identificador (CUFE/CUDE o NIT emisor + número)."));
        }
        if self.category != "sale" && self.category != "return" {
            return Err(AppError::user(format!("El documento {} no está clasificado como factura ni como nota crédito.", self.document_id)));
        }
        let year_ok = self.issue_date.len() == 10 && self.issue_date[..4].parse::<i64>().map_or(false, |y| (2000..=2100).contains(&y));
        if !year_ok {
            return Err(AppError::user(format!("El documento {} no tiene una fecha de emisión válida.", self.document_id)));
        }
        Ok(())
    }

    fn year(&self) -> i64 {
        self.issue_date[..4].parse().unwrap_or(0)
    }

    /// Lo que cuenta para los formatos: si no cambia nada de esto, la reimportación es la misma información.
    fn same_as(&self, d: &EinvoiceDoc) -> bool {
        d.issue_date == self.issue_date
            && d.doc_type_key == self.doc_type_key
            && d.category == self.category
            && d.receiver_nit_raw == self.receiver_nit_raw
            && d.receiver_name == self.receiver_name
            && d.total_cents == self.total_cents
            && d.iva_cents == self.iva_cents
            && d.eeff_base_cents == self.eeff_base_cents
            && d.exo_base_cents == self.exo_base_cents
            && d.exo_columns == self.exo_columns
            && d.eeff_columns == self.eeff_columns
    }
}

/// Guarda (o actualiza) los documentos de una empresa. Todo o nada; una reimportación del mismo documento nunca duplica.
pub fn save_docs(conn: &mut Connection, input: &SaveEinvoiceInput) -> AppResult<SaveEinvoiceOutcome> {
    for d in &input.docs {
        d.validated()?;
    }
    let tx = conn.transaction()?;
    let exists: bool = tx.query_row("SELECT COUNT(*) > 0 FROM companies WHERE id = ?1", [input.company_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::user("La empresa no existe."));
    }
    let mut outcome = SaveEinvoiceOutcome::default();
    let mut seen = std::collections::HashSet::new();
    let mut plan: Vec<(&EinvoiceDocInput, Option<EinvoiceDoc>)> = Vec::new();
    for d in &input.docs {
        // Dentro del mismo archivo el documento repetido cuenta una sola vez.
        if !seen.insert(d.document_id.clone()) {
            outcome.unchanged += 1;
            continue;
        }
        let old = tx.query_row(&format!("SELECT {DOC_COLUMNS} FROM exo_einvoice_docs WHERE company_id = ?1 AND document_id = ?2"), params![input.company_id, d.document_id], map_doc).optional()?;
        if let Some(o) = &old {
            if !d.same_as(o) {
                outcome.conflicts.push(d.document_id.clone());
            }
        }
        plan.push((d, old));
    }
    if !outcome.conflicts.is_empty() && !input.replace {
        return Ok(outcome);
    }
    outcome.conflicts.clear();
    let now = now_iso();
    let mut years = std::collections::BTreeSet::new();
    for (d, old) in plan {
        let eeff = serde_json::to_string(&d.eeff_columns)?;
        let exo = serde_json::to_string(&d.exo_columns)?;
        match old {
            None => {
                tx.execute(
                    "INSERT INTO exo_einvoice_docs (company_id, document_id, year, issue_date, doc_type, doc_type_key, category, number, file_name, sheet, row_number, status, receiver_nit_raw, receiver_name, total_cents, iva_cents, eeff_base_cents, eeff_columns, exo_base_cents, exo_columns, imported_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21)",
                    params![input.company_id, d.document_id, d.year(), d.issue_date, d.doc_type, d.doc_type_key, d.category, d.number, d.file_name, d.sheet, d.row_number, d.status, d.receiver_nit_raw, d.receiver_name, d.total_cents, d.iva_cents, d.eeff_base_cents, eeff, d.exo_base_cents, exo, now],
                )?;
                outcome.inserted += 1;
                years.insert(d.year());
            }
            Some(o) if d.same_as(&o) => outcome.unchanged += 1,
            Some(o) => {
                tx.execute(
                    "UPDATE exo_einvoice_docs SET year = ?1, issue_date = ?2, doc_type = ?3, doc_type_key = ?4, category = ?5, number = ?6, file_name = ?7, sheet = ?8, row_number = ?9, status = ?10, receiver_nit_raw = ?11, receiver_name = ?12, total_cents = ?13, iva_cents = ?14, eeff_base_cents = ?15, eeff_columns = ?16, exo_base_cents = ?17, exo_columns = ?18, updated_at = ?19 WHERE id = ?20",
                    params![d.year(), d.issue_date, d.doc_type, d.doc_type_key, d.category, d.number, d.file_name, d.sheet, d.row_number, d.status, d.receiver_nit_raw, d.receiver_name, d.total_cents, d.iva_cents, d.eeff_base_cents, eeff, d.exo_base_cents, exo, now, o.id],
                )?;
                outcome.updated += 1;
                years.insert(o.year);
                years.insert(d.year());
            }
        }
    }
    tx.commit()?;
    outcome.years = years.into_iter().collect();
    Ok(outcome)
}

pub fn list_docs(conn: &Connection, company_id: i64, year: i64) -> AppResult<Vec<EinvoiceDoc>> {
    let mut stmt = conn.prepare(&format!("SELECT {DOC_COLUMNS} FROM exo_einvoice_docs WHERE company_id = ?1 AND year = ?2 ORDER BY issue_date, document_id"))?;
    let rows = stmt.query_map(params![company_id, year], map_doc)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EinvoiceCustomer {
    pub company_id: i64,
    pub doc_number: String,
    pub doc_type_code: String,
    #[serde(default)]
    pub dv: String,
    #[serde(default)]
    pub first_surname: String,
    #[serde(default)]
    pub second_surname: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub other_names: String,
    #[serde(default)]
    pub business_name: String,
    #[serde(default)]
    pub confirmed_at: String,
    #[serde(default)]
    pub updated_at: String,
}

pub fn list_customers(conn: &Connection, company_id: i64) -> AppResult<Vec<EinvoiceCustomer>> {
    let mut stmt = conn.prepare("SELECT company_id, doc_number, doc_type_code, dv, first_surname, second_surname, first_name, other_names, business_name, confirmed_at, updated_at FROM exo_einvoice_customers WHERE company_id = ?1 ORDER BY doc_number")?;
    let rows = stmt
        .query_map([company_id], |r| {
            Ok(EinvoiceCustomer { company_id: r.get(0)?, doc_number: r.get(1)?, doc_type_code: r.get(2)?, dv: r.get(3)?, first_surname: r.get(4)?, second_surname: r.get(5)?, first_name: r.get(6)?, other_names: r.get(7)?, business_name: r.get(8)?, confirmed_at: r.get(9)?, updated_at: r.get(10)? })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Confirma la identidad de un cliente: el tipo de documento debe existir y estar activo, y los nombres deben corresponder al tipo.
pub fn save_customer(conn: &Connection, c: &EinvoiceCustomer) -> AppResult<()> {
    let number = c.doc_number.trim();
    if number.is_empty() {
        return Err(AppError::user("Falta el número de identificación del cliente."));
    }
    let active: bool = conn.query_row("SELECT COUNT(*) > 0 FROM exo_document_types WHERE code = ?1 AND is_active = 1", [c.doc_type_code.trim()], |r| r.get(0))?;
    if !active {
        return Err(AppError::user("Elige un tipo de documento del catálogo de Exógena."));
    }
    let juridical = c.doc_type_code.trim() == "31";
    if juridical && c.business_name.trim().is_empty() {
        return Err(AppError::user("Un NIT necesita razón social."));
    }
    if juridical && c.dv.trim().is_empty() {
        return Err(AppError::user("Un NIT necesita su DV."));
    }
    if !juridical && (c.first_surname.trim().is_empty() || c.first_name.trim().is_empty()) && c.business_name.trim().is_empty() {
        return Err(AppError::user("Indica primer apellido y primer nombre (o la razón social)."));
    }
    let now = now_iso();
    conn.execute(
        "INSERT INTO exo_einvoice_customers (company_id, doc_number, doc_type_code, dv, first_surname, second_surname, first_name, other_names, business_name, confirmed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
         ON CONFLICT(company_id, doc_number) DO UPDATE SET doc_type_code = excluded.doc_type_code, dv = excluded.dv, first_surname = excluded.first_surname, second_surname = excluded.second_surname,
            first_name = excluded.first_name, other_names = excluded.other_names, business_name = excluded.business_name, confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at",
        params![c.company_id, number, c.doc_type_code.trim(), c.dv.trim(), c.first_surname.trim(), c.second_surname.trim(), c.first_name.trim(), c.other_names.trim(), c.business_name.trim(), now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run_pending(&mut conn).unwrap();
        conn.execute("INSERT INTO companies (id, razon_social, nit, created_at, updated_at) VALUES (1, 'E', '900738791', 'x', 'x')", []).unwrap();
        conn
    }

    fn doc(id: &str, date: &str, category: &str, total: i64) -> EinvoiceDocInput {
        EinvoiceDocInput {
            document_id: id.into(),
            issue_date: date.into(),
            doc_type: "Factura electrónica".into(),
            doc_type_key: "factura electronica".into(),
            category: category.into(),
            number: "FE1".into(),
            file_name: "ventas.xlsx".into(),
            sheet: "Ventas".into(),
            row_number: 2,
            status: String::new(),
            receiver_nit_raw: "900.111.222-1".into(),
            receiver_name: "CLIENTE SAS".into(),
            total_cents: total,
            iva_cents: 1900,
            eeff_base_cents: total - 1900,
            eeff_columns: vec!["IVA".into()],
            exo_base_cents: Some(total - 1900),
            exo_columns: vec!["IVA".into()],
        }
    }

    #[test]
    fn reimporting_does_not_duplicate_and_changes_need_confirmation() {
        let mut conn = db();
        let input = SaveEinvoiceInput { company_id: 1, replace: false, docs: vec![doc("a", "2025-03-01", "sale", 11_900), doc("b", "2026-01-05", "return", 5_000)] };
        let first = save_docs(&mut conn, &input).unwrap();
        assert_eq!((first.inserted, first.updated, first.unchanged), (2, 0, 0));
        assert_eq!(first.years, vec![2025, 2026]);
        let again = save_docs(&mut conn, &input).unwrap();
        assert_eq!((again.inserted, again.updated, again.unchanged), (0, 0, 2));
        assert_eq!(list_docs(&conn, 1, 2025).unwrap().len(), 1, "cada documento queda en el año de su fecha de emisión");
        assert_eq!(list_docs(&conn, 1, 2026).unwrap().len(), 1);

        let changed = SaveEinvoiceInput { company_id: 1, replace: false, docs: vec![doc("a", "2025-03-01", "sale", 23_800), doc("c", "2025-04-01", "sale", 100)] };
        let held = save_docs(&mut conn, &changed).unwrap();
        assert_eq!(held.conflicts, vec!["a".to_string()]);
        assert_eq!(list_docs(&conn, 1, 2025).unwrap().len(), 1, "sin confirmación no se guarda nada");
        let replaced = save_docs(&mut conn, &SaveEinvoiceInput { replace: true, ..changed }).unwrap();
        assert_eq!((replaced.inserted, replaced.updated), (1, 1));
        assert_eq!(list_docs(&conn, 1, 2025).unwrap().iter().find(|d| d.document_id == "a").unwrap().total_cents, 23_800);
    }

    #[test]
    fn invalid_documents_are_rejected() {
        let mut conn = db();
        let mut bad = doc("a", "2025-03-01", "ignore", 1);
        assert!(save_docs(&mut conn, &SaveEinvoiceInput { company_id: 1, replace: false, docs: vec![bad.clone()] }).is_err());
        bad.category = "sale".into();
        bad.issue_date = "sin fecha".into();
        assert!(save_docs(&mut conn, &SaveEinvoiceInput { company_id: 1, replace: false, docs: vec![bad] }).is_err());
    }

    #[test]
    fn customer_identity_is_validated_and_reused() {
        let conn = db();
        let mut c = EinvoiceCustomer { company_id: 1, doc_number: "1020304050".into(), doc_type_code: "13".into(), dv: String::new(), first_surname: "PEREZ".into(), second_surname: String::new(), first_name: "ANA".into(), other_names: String::new(), business_name: String::new(), confirmed_at: String::new(), updated_at: String::new() };
        save_customer(&conn, &c).unwrap();
        c.first_name = "ANA MARIA".into();
        save_customer(&conn, &c).unwrap();
        let all = list_customers(&conn, 1).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].first_name, "ANA MARIA");
        c.doc_type_code = "99999".into();
        assert!(save_customer(&conn, &c).is_err());
        c.doc_type_code = "31".into();
        assert!(save_customer(&conn, &c).is_err(), "un NIT necesita razón social y DV");
    }
}
