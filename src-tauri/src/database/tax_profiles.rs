//! Perfil tributario con vigencia: responsabilidad frente al IVA de la empresa (48), régimen fiscal del proveedor, concepto 1001
//! sugerido por PUC y conceptos de Exógena por año. Todo con historial: un cambio aplica desde su fecha efectiva y nunca
//! recalcula lo anterior.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::normalize::iso_date_or_empty;
use crate::services::time::now_iso;

// ---------------------------------------------------------------------------
// Historial de IVA de la empresa
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompanyVatEntry {
    pub company_id: i64,
    pub effective_date: String,
    pub responsible: bool,
    pub source: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanyVatEntryInput {
    pub company_id: i64,
    pub effective_date: String,
    pub responsible: bool,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub note: String,
}

fn required_date(value: &str, label: &str) -> AppResult<String> {
    let d = iso_date_or_empty(value, label)?;
    if d.is_empty() {
        return Err(AppError::user(format!("{label} es obligatoria.")));
    }
    Ok(d)
}

pub fn list_vat_history(conn: &Connection, company_id: Option<i64>) -> AppResult<Vec<CompanyVatEntry>> {
    Ok(conn
        .prepare("SELECT company_id, effective_date, responsible, source, note, created_at FROM company_vat_history WHERE (?1 IS NULL OR company_id = ?1) ORDER BY company_id, effective_date")?
        .query_map([company_id], |r| Ok(CompanyVatEntry { company_id: r.get(0)?, effective_date: r.get(1)?, responsible: r.get::<_, i64>(2)? != 0, source: r.get(3)?, note: r.get(4)?, created_at: r.get(5)? }))?
        .collect::<Result<_, _>>()?)
}

pub fn save_vat_entry(conn: &Connection, input: &CompanyVatEntryInput) -> AppResult<()> {
    let date = required_date(&input.effective_date, "La fecha de vigencia")?;
    let source = if input.source == "rut" { "rut" } else { "manual" };
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", [input.company_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::user("La empresa no existe o fue eliminada."));
    }
    let note: String = input.note.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(300).collect();
    conn.execute(
        "INSERT INTO company_vat_history (company_id, effective_date, responsible, source, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(company_id, effective_date) DO UPDATE SET responsible = excluded.responsible, source = excluded.source, note = excluded.note",
        params![input.company_id, date, input.responsible, source, note, now_iso()],
    )?;
    Ok(())
}

pub fn delete_vat_entry(conn: &Connection, company_id: i64, effective_date: &str) -> AppResult<()> {
    conn.execute("DELETE FROM company_vat_history WHERE company_id = ?1 AND effective_date = ?2", params![company_id, effective_date])?;
    Ok(())
}

/// ¿Era responsable de IVA durante el periodo? `None` = se desconoce (sin historial anterior al fin del periodo).
/// Se usa la entrada vigente al inicio del periodo; si ninguna lo era, la primera posterior dentro del periodo cuenta si es responsable.
pub fn vat_responsible_in(conn: &Connection, company_id: i64, period_start: &str, period_end: &str) -> AppResult<Option<bool>> {
    let at_start: Option<i64> = conn
        .query_row(
            "SELECT responsible FROM company_vat_history WHERE company_id = ?1 AND effective_date <= ?2 ORDER BY effective_date DESC LIMIT 1",
            params![company_id, period_start],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(v) = at_start {
        if v != 0 {
            return Ok(Some(true));
        }
    }
    let during: i64 = conn.query_row(
        "SELECT COUNT(*) FROM company_vat_history WHERE company_id = ?1 AND effective_date > ?2 AND effective_date <= ?3 AND responsible = 1",
        params![company_id, period_start, period_end],
        |r| r.get(0),
    )?;
    if during > 0 {
        return Ok(Some(true));
    }
    let any: i64 = conn.query_row("SELECT COUNT(*) FROM company_vat_history WHERE company_id = ?1 AND effective_date <= ?2", params![company_id, period_end], |r| r.get(0))?;
    Ok(if any == 0 { None } else { Some(false) })
}

// ---------------------------------------------------------------------------
// Historial fiscal del proveedor
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SupplierFiscalEntry {
    pub supplier_nit: String,
    pub effective_date: String,
    pub regime: String,
    pub source: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupplierFiscalEntryInput {
    pub supplier_nit: String,
    pub effective_date: String,
    pub regime: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub note: String,
}

/// Códigos tributarios de un régimen («O-13;O-23», «R-99-PN»), sin repetir y ordenados; sin códigos, el texto normalizado.
pub fn regime_key(value: &str) -> String {
    let upper = value.to_uppercase();
    let chars: Vec<char> = upper.chars().collect();
    let mut codes = std::collections::BTreeSet::new();
    let mut i = 0;
    while i < chars.len() {
        let boundary = i == 0 || !chars[i - 1].is_ascii_alphanumeric();
        if boundary && (chars[i] == 'O' || chars[i] == 'R') {
            let mut j = i + 1;
            while j < chars.len() && chars[j] == ' ' {
                j += 1;
            }
            if j < chars.len() && chars[j] == '-' {
                j += 1;
                while j < chars.len() && chars[j] == ' ' {
                    j += 1;
                }
                let digits: String = chars[j..].iter().take_while(|c| c.is_ascii_digit()).take(2).collect();
                if !digits.is_empty() {
                    let mut end = j + digits.len();
                    let mut code = format!("{}-{:0>2}", chars[i], digits);
                    if chars.get(end) == Some(&'-') && chars.get(end + 1) == Some(&'P') && matches!(chars.get(end + 2), Some('N') | Some('J')) {
                        code.push_str(&format!("-P{}", chars[end + 2]));
                        end += 3;
                    }
                    if !chars.get(end).is_some_and(|c| c.is_ascii_digit()) {
                        codes.insert(code);
                    }
                    i = end;
                    continue;
                }
            }
        }
        i += 1;
    }
    if codes.is_empty() {
        value.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
    } else {
        codes.into_iter().collect::<Vec<_>>().join(";")
    }
}

/// O-15 (autorretenedor) y O-47 (régimen simple de tributación): no generan retención en la fuente.
pub fn is_exempt_regime(regime: &str) -> bool {
    regime_key(regime).split(';').any(|c| c == "O-15" || c == "O-47")
}

/// Régimen del historial vigente en una fecha (la última entrada con fecha efectiva anterior o igual).
pub fn regime_at(conn: &Connection, supplier_nit: &str, date: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT regime FROM supplier_fiscal_history WHERE supplier_nit = ?1 AND effective_date <= ?2 ORDER BY effective_date DESC LIMIT 1",
            params![supplier_nit, date],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn list_fiscal_history(conn: &Connection, supplier_nit: Option<&str>) -> AppResult<Vec<SupplierFiscalEntry>> {
    Ok(conn
        .prepare("SELECT supplier_nit, effective_date, regime, source, note, created_at FROM supplier_fiscal_history WHERE (?1 IS NULL OR supplier_nit = ?1) ORDER BY supplier_nit, effective_date")?
        .query_map([supplier_nit], |r| Ok(SupplierFiscalEntry { supplier_nit: r.get(0)?, effective_date: r.get(1)?, regime: r.get(2)?, source: r.get(3)?, note: r.get(4)?, created_at: r.get(5)? }))?
        .collect::<Result<_, _>>()?)
}

/// Deja `suppliers.fiscal_regime` en el régimen vigente más reciente del historial (si el proveedor existe).
fn sync_supplier_regime(conn: &Connection, nit: &str) -> AppResult<()> {
    let latest: Option<String> = conn
        .query_row("SELECT regime FROM supplier_fiscal_history WHERE supplier_nit = ?1 ORDER BY effective_date DESC LIMIT 1", [nit], |r| r.get(0))
        .optional()?;
    if let Some(regime) = latest {
        conn.execute("UPDATE suppliers SET fiscal_regime = ?1, fiscal_checked_at = ?2, updated_at = ?2 WHERE nit = ?3", params![regime, now_iso(), nit])?;
    }
    Ok(())
}

pub fn save_fiscal_entry(conn: &Connection, input: &SupplierFiscalEntryInput) -> AppResult<()> {
    let date = required_date(&input.effective_date, "La fecha de vigencia")?;
    let nit = input.supplier_nit.trim();
    let regime: String = input.regime.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(250).collect();
    if nit.is_empty() || regime.is_empty() {
        return Err(AppError::user("Escribe el proveedor y su régimen fiscal."));
    }
    let source = if ["factura", "manual", "proveedor"].contains(&input.source.as_str()) { input.source.as_str() } else { "manual" };
    let note: String = input.note.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(300).collect();
    conn.execute(
        "INSERT INTO supplier_fiscal_history (supplier_nit, effective_date, regime, source, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(supplier_nit, effective_date) DO UPDATE SET regime = excluded.regime, source = excluded.source, note = excluded.note",
        params![nit, date, regime, source, note, now_iso()],
    )?;
    sync_supplier_regime(conn, nit)
}

pub fn delete_fiscal_entry(conn: &Connection, supplier_nit: &str, effective_date: &str) -> AppResult<()> {
    conn.execute("DELETE FROM supplier_fiscal_history WHERE supplier_nit = ?1 AND effective_date = ?2", params![supplier_nit, effective_date])?;
    sync_supplier_regime(conn, supplier_nit)
}

/// Llamado por `set_fiscal_regime` del proveedor: si el régimen cambió de verdad, queda en el historial desde hoy
/// (conservando antes el anterior como punto de partida si el historial estaba vacío).
pub fn record_regime_change(conn: &Connection, nit: &str, previous: Option<&str>, new_regime: &str) -> AppResult<()> {
    let new_regime = new_regime.trim();
    if new_regime.is_empty() || previous.is_some_and(|p| regime_key(p) == regime_key(new_regime)) {
        return Ok(());
    }
    let has_history: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM supplier_fiscal_history WHERE supplier_nit = ?1)", [nit], |r| r.get(0))?;
    if !has_history {
        if let Some(p) = previous.map(str::trim).filter(|p| !p.is_empty()) {
            conn.execute(
                "INSERT INTO supplier_fiscal_history (supplier_nit, effective_date, regime, source, note, created_at) VALUES (?1, '1900-01-01', ?2, 'proveedor', 'Régimen anterior', ?3)",
                params![nit, p, now_iso()],
            )?;
        }
    }
    let today = &now_iso()[..10];
    conn.execute(
        "INSERT INTO supplier_fiscal_history (supplier_nit, effective_date, regime, source, note, created_at) VALUES (?1, ?2, ?3, 'proveedor', '', ?4)
         ON CONFLICT(supplier_nit, effective_date) DO UPDATE SET regime = excluded.regime",
        params![nit, today, new_regime, now_iso()],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Concepto 1001 por PUC
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PucConcept1001 {
    pub puc_code: String,
    pub concept_code: String,
}

pub fn list_puc_concepts(conn: &Connection) -> AppResult<Vec<PucConcept1001>> {
    Ok(conn
        .prepare("SELECT puc_code, concept_code FROM puc_concept_1001 ORDER BY puc_code")?
        .query_map([], |r| Ok(PucConcept1001 { puc_code: r.get(0)?, concept_code: r.get(1)? }))?
        .collect::<Result<_, _>>()?)
}

/// Código de concepto: numérico (de 2 a 8 dígitos) o un único concepto que abarca un rango, escrito «5029 a 5035».
pub fn valid_concept_code(code: &str) -> bool {
    if code.len() >= 2 && code.len() <= 8 && code.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    match code.split_once(" a ") {
        Some((a, b)) => a.len() == 4 && b.len() == 4 && a.chars().chain(b.chars()).all(|c| c.is_ascii_digit()) && a < b,
        None => false,
    }
}

/// «5029 a 5035 – Gastos pagados por anticipado» es UN concepto configurable, no siete. Una base que ya tuviera las siete filas de
/// sistema (de una versión de desarrollo) o un backup que las traiga se unifica: lo que usara 5029…5035 pasa al concepto único.
/// Idempotente; se ejecuta al iniciar y tras restaurar.
pub fn unify_prepaid_concept(conn: &Connection) -> AppResult<()> {
    const OLD: &str = "('5029', '5030', '5031', '5032', '5033', '5034', '5035')";
    conn.execute_batch(&format!(
        "INSERT OR IGNORE INTO exo_year_concepts (format_code, year, code, description, valid_from, valid_to, is_active, is_system, updated_at)
         SELECT format_code, year, '5029 a 5035', description, valid_from, valid_to, is_active, is_system, updated_at
         FROM exo_year_concepts WHERE format_code = '1001' AND code IN {OLD} AND description = 'Gastos pagados por anticipado' GROUP BY year;
         DELETE FROM exo_year_concepts WHERE format_code = '1001' AND code IN {OLD} AND description = 'Gastos pagados por anticipado';
         UPDATE purchase_line_class SET concept_1001 = '5029 a 5035' WHERE concept_1001 IN {OLD};
         UPDATE purchase_rules SET concept_1001 = '5029 a 5035' WHERE concept_1001 IN {OLD};
         UPDATE purchase_rule_history SET concept_1001 = '5029 a 5035' WHERE concept_1001 IN {OLD};
         UPDATE puc_concept_1001 SET concept_code = '5029 a 5035' WHERE concept_code IN {OLD};"
    ))?;
    Ok(())
}

pub fn set_puc_concept(conn: &Connection, puc_code: &str, concept_code: Option<&str>) -> AppResult<()> {
    let code = puc_code.trim();
    if code.is_empty() || !code.chars().all(|c| c.is_ascii_digit()) || code.len() > 12 {
        return Err(AppError::user("El código PUC no es válido."));
    }
    match concept_code.map(str::trim).filter(|c| !c.is_empty()) {
        None => {
            conn.execute("DELETE FROM puc_concept_1001 WHERE puc_code = ?1", [code])?;
        }
        Some(c) => {
            if !valid_concept_code(c) || (c.len() < 4 && !c.contains(" a ")) {
                return Err(AppError::user("El concepto 1001 debe tener 4 dígitos o ser un rango como «5029 a 5035»."));
            }
            conn.execute(
                "INSERT INTO puc_concept_1001 (puc_code, concept_code, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(puc_code) DO UPDATE SET concept_code = excluded.concept_code, updated_at = excluded.updated_at",
                params![code, c, now_iso()],
            )?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Conceptos de Exógena por año
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YearConcept {
    pub format_code: String,
    pub year: i64,
    pub code: String,
    pub description: String,
    pub valid_from: String,
    pub valid_to: String,
    pub is_active: bool,
    pub is_system: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YearConceptInput {
    pub format_code: String,
    pub year: i64,
    pub code: String,
    pub description: String,
    pub valid_from: String,
    #[serde(default)]
    pub valid_to: String,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YearConceptAudit {
    pub id: i64,
    pub format_code: String,
    pub year: i64,
    pub code: String,
    pub action: String,
    pub old_value: String,
    pub new_value: String,
    pub changed_at: String,
}

fn map_concept(r: &rusqlite::Row) -> rusqlite::Result<YearConcept> {
    Ok(YearConcept { format_code: r.get(0)?, year: r.get(1)?, code: r.get(2)?, description: r.get(3)?, valid_from: r.get(4)?, valid_to: r.get(5)?, is_active: r.get::<_, i64>(6)? != 0, is_system: r.get::<_, i64>(7)? != 0 })
}

fn valid_format(code: &str) -> AppResult<()> {
    if code.is_empty() || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::user("El código del formato no es válido."));
    }
    Ok(())
}

fn year_audit(conn: &Connection, format: &str, year: i64, code: &str, action: &str, old: &str, new: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO exo_year_concept_audit (format_code, year, code, action, old_value, new_value, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![format, year, code, action, old, new, now_iso()],
    )?;
    Ok(())
}

pub fn list_year_concepts(conn: &Connection, format_code: &str, year: Option<i64>) -> AppResult<Vec<YearConcept>> {
    valid_format(format_code)?;
    Ok(conn
        .prepare("SELECT format_code, year, code, description, valid_from, valid_to, is_active, is_system FROM exo_year_concepts WHERE format_code = ?1 AND (?2 IS NULL OR year = ?2) ORDER BY year, code")?
        .query_map(params![format_code, year], map_concept)?
        .collect::<Result<_, _>>()?)
}

fn describe(c: &YearConcept) -> String {
    format!("{} · {} · {} a {}{}", c.code, c.description, c.valid_from, if c.valid_to.is_empty() { "…" } else { &c.valid_to }, if c.is_active { "" } else { " · inactivo" })
}

pub fn save_year_concept(conn: &mut Connection, input: &YearConceptInput) -> AppResult<()> {
    valid_format(&input.format_code)?;
    if !(2000..=2100).contains(&input.year) {
        return Err(AppError::user("El año no es válido."));
    }
    let code = input.code.trim();
    if !valid_concept_code(code) {
        return Err(AppError::user("El código del concepto debe ser numérico (de 2 a 8 dígitos) o un rango como «5029 a 5035»."));
    }
    let description = input.description.split_whitespace().collect::<Vec<_>>().join(" ");
    if description.chars().count() < 3 || description.chars().count() > 300 {
        return Err(AppError::user("Escribe el nombre del concepto (de 3 a 300 caracteres)."));
    }
    let valid_from = required_date(&input.valid_from, "La vigencia desde")?;
    let valid_to = iso_date_or_empty(&input.valid_to, "La vigencia hasta")?;
    if !valid_to.is_empty() && valid_to < valid_from {
        return Err(AppError::user("La vigencia hasta no puede ser anterior a la vigencia desde."));
    }
    let tx = conn.transaction()?;
    let old = tx
        .query_row(
            "SELECT format_code, year, code, description, valid_from, valid_to, is_active, is_system FROM exo_year_concepts WHERE format_code = ?1 AND year = ?2 AND code = ?3",
            params![input.format_code, input.year, code],
            map_concept,
        )
        .optional()?;
    let now = now_iso();
    match old {
        None => {
            tx.execute(
                "INSERT INTO exo_year_concepts (format_code, year, code, description, valid_from, valid_to, is_active, is_system, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
                params![input.format_code, input.year, code, description, valid_from, valid_to, input.is_active, now],
            )?;
            let new = YearConcept { format_code: input.format_code.clone(), year: input.year, code: code.into(), description, valid_from, valid_to, is_active: input.is_active, is_system: false };
            year_audit(&tx, &input.format_code, input.year, code, "add", "", &describe(&new))?;
        }
        Some(old) => {
            let new = YearConcept { description, valid_from, valid_to, is_active: input.is_active, ..old.clone() };
            tx.execute(
                "UPDATE exo_year_concepts SET description = ?1, valid_from = ?2, valid_to = ?3, is_active = ?4, updated_at = ?5 WHERE format_code = ?6 AND year = ?7 AND code = ?8",
                params![new.description, new.valid_from, new.valid_to, new.is_active, now, input.format_code, input.year, code],
            )?;
            if old.description != new.description || old.valid_from != new.valid_from || old.valid_to != new.valid_to {
                year_audit(&tx, &input.format_code, input.year, code, "edit", &describe(&old), &describe(&new))?;
            }
            if old.is_active != new.is_active {
                year_audit(&tx, &input.format_code, input.year, code, if new.is_active { "activate" } else { "deactivate" }, &describe(&old), &describe(&new))?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn delete_year_concept(conn: &mut Connection, format_code: &str, year: i64, code: &str) -> AppResult<()> {
    valid_format(format_code)?;
    let tx = conn.transaction()?;
    let old = tx
        .query_row("SELECT format_code, year, code, description, valid_from, valid_to, is_active, is_system FROM exo_year_concepts WHERE format_code = ?1 AND year = ?2 AND code = ?3", params![format_code, year, code], map_concept)
        .optional()?
        .ok_or_else(|| AppError::user("El concepto no existe."))?;
    if old.is_system {
        return Err(AppError::user("Un concepto oficial no se elimina; desactívalo."));
    }
    tx.execute("DELETE FROM exo_year_concepts WHERE format_code = ?1 AND year = ?2 AND code = ?3", params![format_code, year, code])?;
    year_audit(&tx, format_code, year, code, "delete", &describe(&old), "")?;
    tx.commit()?;
    Ok(())
}

/// Copia los conceptos de un año a otro (solo los que no existan; las copias son editables). Las vigencias se trasladan al año destino.
pub fn copy_year_concepts(conn: &mut Connection, format_code: &str, from_year: i64, to_year: i64) -> AppResult<i64> {
    valid_format(format_code)?;
    if !(2000..=2100).contains(&to_year) || from_year == to_year {
        return Err(AppError::user("El año de destino no es válido."));
    }
    let tx = conn.transaction()?;
    let source: Vec<YearConcept> = tx
        .prepare("SELECT format_code, year, code, description, valid_from, valid_to, is_active, is_system FROM exo_year_concepts WHERE format_code = ?1 AND year = ?2 ORDER BY code")?
        .query_map(params![format_code, from_year], map_concept)?
        .collect::<Result<_, _>>()?;
    let shift = |d: &str| if d.len() == 10 { format!("{to_year}{}", &d[4..]) } else { d.to_string() };
    let mut copied = 0;
    for c in source {
        let n = tx.execute(
            "INSERT OR IGNORE INTO exo_year_concepts (format_code, year, code, description, valid_from, valid_to, is_active, is_system, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
            params![format_code, to_year, c.code, c.description, shift(&c.valid_from), shift(&c.valid_to), c.is_active, now_iso()],
        )?;
        if n > 0 {
            copied += 1;
            year_audit(&tx, format_code, to_year, &c.code, "copy", &format!("{from_year}"), &describe(&c))?;
        }
    }
    tx.commit()?;
    Ok(copied)
}

pub fn list_year_concept_audit(conn: &Connection, format_code: &str, year: Option<i64>, limit: i64) -> AppResult<Vec<YearConceptAudit>> {
    valid_format(format_code)?;
    Ok(conn
        .prepare("SELECT id, format_code, year, code, action, old_value, new_value, changed_at FROM exo_year_concept_audit WHERE format_code = ?1 AND (?2 IS NULL OR year = ?2) ORDER BY id DESC LIMIT ?3")?
        .query_map(params![format_code, year, limit.clamp(1, 1000)], |r| {
            Ok(YearConceptAudit { id: r.get(0)?, format_code: r.get(1)?, year: r.get(2)?, code: r.get(3)?, action: r.get(4)?, old_value: r.get(5)?, new_value: r.get(6)?, changed_at: r.get(7)? })
        })?
        .collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run_pending(&mut c).unwrap();
        c
    }

    fn company(c: &Connection) {
        c.execute("INSERT INTO companies (id, razon_social, nit, created_at, updated_at) VALUES (1, 'KAES SAS', '901748281', 'x', 'x')", []).unwrap();
    }

    fn vat(c: &Connection, date: &str, responsible: bool) {
        save_vat_entry(c, &CompanyVatEntryInput { company_id: 1, effective_date: date.into(), responsible, source: "rut".into(), note: String::new() }).unwrap();
    }

    #[test]
    fn vat_history_applies_from_its_effective_date() {
        let c = db();
        company(&c);
        assert_eq!(vat_responsible_in(&c, 1, "2026-01-01", "2026-02-28").unwrap(), None, "sin historial se desconoce");
        vat(&c, "2024-08-05", true);
        vat(&c, "2026-03-01", false);
        assert_eq!(vat_responsible_in(&c, 1, "2026-01-01", "2026-02-28").unwrap(), Some(true));
        assert_eq!(vat_responsible_in(&c, 1, "2026-03-01", "2026-04-30").unwrap(), Some(false), "un cambio no recalcula lo anterior, aplica desde su vigencia");
        assert_eq!(vat_responsible_in(&c, 1, "2026-01-01", "2026-04-30").unwrap(), Some(true));
        assert_eq!(vat_responsible_in(&c, 1, "2020-01-01", "2020-02-29").unwrap(), None);
        assert!(save_vat_entry(&c, &CompanyVatEntryInput { company_id: 1, effective_date: "2026-13-01".into(), responsible: true, source: String::new(), note: String::new() }).is_err());
        assert!(save_vat_entry(&c, &CompanyVatEntryInput { company_id: 9, effective_date: "2026-01-01".into(), responsible: true, source: String::new(), note: String::new() }).is_err());
        vat(&c, "2026-03-01", true);
        assert_eq!(list_vat_history(&c, Some(1)).unwrap().len(), 2);
        delete_vat_entry(&c, 1, "2026-03-01").unwrap();
        assert_eq!(list_vat_history(&c, None).unwrap().len(), 1);
        c.execute("DELETE FROM companies WHERE id = 1", []).unwrap();
        assert!(list_vat_history(&c, None).unwrap().is_empty(), "se borra en cascada con la empresa");
    }

    #[test]
    fn regime_key_ignores_order_and_spacing() {
        assert_eq!(regime_key("O-23;O-13"), regime_key("o - 13 ; O-23"));
        assert_eq!(regime_key("R-99-PN"), "R-99-PN");
        assert_ne!(regime_key("O-13"), regime_key("O-15"));
        assert_eq!(regime_key("Gran  Contribuyente"), "gran contribuyente");
    }

    #[test]
    fn fiscal_history_keeps_each_regime_and_follows_regime_changes() {
        let c = db();
        c.execute("INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at, fiscal_regime) VALUES ('900319753', 'PRICESMART', 'purchase', 'x', 'x', 'O-13;O-23')", []).unwrap();
        // Cambio de orden = mismo régimen: no genera historial.
        record_regime_change(&c, "900319753", Some("O-13;O-23"), "O-23;O-13").unwrap();
        assert!(list_fiscal_history(&c, Some("900319753")).unwrap().is_empty());
        // Cambio real: conserva el anterior y agrega el nuevo desde hoy.
        record_regime_change(&c, "900319753", Some("O-13;O-23"), "O-15").unwrap();
        let h = list_fiscal_history(&c, Some("900319753")).unwrap();
        assert_eq!((h.len(), h[0].effective_date.as_str(), h[0].regime.as_str(), h[1].regime.as_str()), (2, "1900-01-01", "O-13;O-23", "O-15"));
        save_fiscal_entry(&c, &SupplierFiscalEntryInput { supplier_nit: "900319753".into(), effective_date: "2999-01-01".into(), regime: "O-47".into(), source: "manual".into(), note: String::new() }).unwrap();
        assert_eq!(list_fiscal_history(&c, None).unwrap().len(), 3);
        let current = |c: &Connection| c.query_row("SELECT fiscal_regime FROM suppliers WHERE nit = '900319753'", [], |r| r.get::<_, String>(0)).unwrap();
        assert_eq!(current(&c), "O-47");
        delete_fiscal_entry(&c, "900319753", "2999-01-01").unwrap();
        assert_eq!(list_fiscal_history(&c, Some("900319753")).unwrap().len(), 2);
        assert_eq!(current(&c), "O-15");
        assert!(save_fiscal_entry(&c, &SupplierFiscalEntryInput { supplier_nit: "".into(), effective_date: "2026-06-01".into(), regime: "O-47".into(), source: String::new(), note: String::new() }).is_err());
    }

    #[test]
    fn migration_seeds_history_from_existing_regimes() {
        let mut c = Connection::open_in_memory().unwrap();
        for m in migrations::MIGRATIONS.iter().filter(|m| m.version <= 26) {
            if m.rebuilds_tables {
                c.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
            }
            migrations::ensure_migrations_table(&c).unwrap();
            c.execute_batch(m.sql).unwrap();
            c.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, 'x')", params![m.version, m.name]).unwrap();
        }
        c.execute("INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at, fiscal_regime) VALUES ('1', 'A', 'purchase', 'x', 'x', 'O-15')", []).unwrap();
        c.execute("INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at) VALUES ('2', 'B', 'purchase', 'x', 'x')", []).unwrap();
        assert_eq!(migrations::run_pending(&mut c).unwrap(), vec!["027_purchases_costs_exogena".to_string(), "028_rate_versions_aliases".to_string(), "029_document_type_aliases".to_string(), "030_payroll_social_security".to_string(), "031_puc_group_mappings".to_string(), "032_einvoice_exogena".to_string(), "033_purchase_totals_rule".to_string(), "034_bank_exogena".to_string()]);
        let h = list_fiscal_history(&c, None).unwrap();
        assert_eq!((h.len(), h[0].supplier_nit.as_str(), h[0].effective_date.as_str()), (1, "1", "1900-01-01"));
        let n: i64 = c.query_row("SELECT COUNT(*) FROM suppliers", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn puc_concept_1001_suggestions() {
        let c = db();
        set_puc_concept(&c, "613505", Some("5004")).unwrap();
        set_puc_concept(&c, "613505", Some("5005")).unwrap();
        assert_eq!(list_puc_concepts(&c).unwrap(), vec![PucConcept1001 { puc_code: "613505".into(), concept_code: "5005".into() }]);
        assert!(set_puc_concept(&c, "613505", Some("50")).is_err());
        assert!(set_puc_concept(&c, "61x", Some("5004")).is_err());
        set_puc_concept(&c, "613505", None).unwrap();
        assert!(list_puc_concepts(&c).unwrap().is_empty());
    }

    #[test]
    fn the_1001_catalog_is_seeded_for_2025_and_editable_in_2026() {
        let mut c = db();
        let y25 = list_year_concepts(&c, "1001", Some(2025)).unwrap();
        let y26 = list_year_concepts(&c, "1001", Some(2026)).unwrap();
        assert_eq!((y25.len(), y26.len()), (18, 18));
        assert!(y25.iter().all(|x| x.is_system && x.is_active) && y26.iter().all(|x| !x.is_system));
        assert_eq!(y25.iter().find(|x| x.code == "5002").unwrap().description, "Honorarios");
        assert_eq!(y25.iter().filter(|x| x.description == "Gastos pagados por anticipado").map(|x| x.code.as_str()).collect::<Vec<_>>(), vec!["5029 a 5035"]);
        assert!(list_year_concepts(&c, "1001", None).unwrap().len() == 36 && list_year_concepts(&c, "1009", None).unwrap().is_empty());
        let input = |year: i64, code: &str, d: &str, active: bool| YearConceptInput { format_code: "1001".into(), year, code: code.into(), description: d.into(), valid_from: format!("{year}-01-01"), valid_to: format!("{year}-12-31"), is_active: active };
        // Oficial: se edita y se desactiva (todo editable), pero no se elimina.
        save_year_concept(&mut c, &input(2025, "5002", "Honorarios y similares", false)).unwrap();
        let audit = list_year_concept_audit(&c, "1001", Some(2025), 50).unwrap();
        assert!(audit.iter().any(|a| a.action == "edit") && audit.iter().any(|a| a.action == "deactivate"));
        assert!(delete_year_concept(&mut c, "1001", 2025, "5002").is_err());
        save_year_concept(&mut c, &input(2026, "5999", "Concepto propio", true)).unwrap();
        delete_year_concept(&mut c, "1001", 2026, "5999").unwrap();
        assert!(delete_year_concept(&mut c, "1001", 2026, "5999").is_err());
        assert!(save_year_concept(&mut c, &input(2026, "5x", "Concepto", true)).is_err());
        assert!(save_year_concept(&mut c, &YearConceptInput { valid_to: "2025-01-01".into(), ..input(2026, "5998", "Concepto", true) }).is_err());
        // Copia: solo agrega lo que falta.
        assert_eq!(copy_year_concepts(&mut c, "1001", 2025, 2027).unwrap(), 18);
        assert_eq!(copy_year_concepts(&mut c, "1001", 2025, 2027).unwrap(), 0);
        assert_eq!(list_year_concepts(&c, "1001", Some(2027)).unwrap()[0].valid_from, "2027-01-01");
    }

    #[test]
    fn prepaid_expenses_is_one_configurable_concept_not_seven() {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::run_pending(&mut c).unwrap();
        for year in [2025, 2026] {
            let rows = list_year_concepts(&c, "1001", Some(year)).unwrap();
            assert_eq!(rows.iter().filter(|r| r.code.starts_with("50") && (5029..=5035).contains(&r.code.parse::<i64>().unwrap_or(0))).count(), 0);
            let one: Vec<_> = rows.iter().filter(|r| r.code == "5029 a 5035").collect();
            assert_eq!(one.len(), 1);
            assert_eq!(one[0].description, "Gastos pagados por anticipado");
            assert_eq!(rows.len(), 18, "los 17 conceptos restantes más el único de gastos pagados por anticipado");
        }
        assert!(valid_concept_code("5029 a 5035") && valid_concept_code("5002") && !valid_concept_code("5035 a 5029") && !valid_concept_code("50 a 51") && !valid_concept_code("abc"));
        // Es configurable: se puede renombrar y cambiar su vigencia.
        let mut input = YearConceptInput { format_code: "1001".into(), year: 2026, code: "5029 a 5035".into(), description: "Gastos diferidos".into(), valid_from: "2026-01-01".into(), valid_to: "2026-12-31".into(), is_active: true };
        save_year_concept(&mut c, &input).unwrap();
        input.description = "Gastos pagados por anticipado".into();
        save_year_concept(&mut c, &input).unwrap();
        set_puc_concept(&c, "170505", Some("5029 a 5035")).unwrap();
    }

    #[test]
    fn legacy_seven_rows_are_unified_and_references_follow() {
        let c = db();
        c.execute("DELETE FROM exo_year_concepts WHERE code = '5029 a 5035'", []).unwrap();
        for code in ["5029", "5030", "5035"] {
            c.execute("INSERT INTO exo_year_concepts (format_code, year, code, description, valid_from, valid_to, is_active, is_system, updated_at) VALUES ('1001', 2025, ?1, 'Gastos pagados por anticipado', '2025-01-01', '2025-12-31', 1, 1, 'x')", [code]).unwrap();
        }
        c.execute("INSERT INTO puc_concept_1001 (puc_code, concept_code, updated_at) VALUES ('170505', '5031', 'x')", []).unwrap();
        unify_prepaid_concept(&c).unwrap();
        unify_prepaid_concept(&c).unwrap();
        let rows = list_year_concepts(&c, "1001", Some(2025)).unwrap();
        assert_eq!(rows.iter().filter(|r| r.code == "5029 a 5035").count(), 1);
        assert!(!rows.iter().any(|r| r.code == "5030"));
        assert_eq!(list_puc_concepts(&c).unwrap()[0].concept_code, "5029 a 5035");
    }
}
