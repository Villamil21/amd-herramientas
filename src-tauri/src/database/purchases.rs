//! Compras, costos y exógena: facturas de compra persistentes por NIT del comprador y año de expedición.
//!
//! Aquí solo se guarda el ORIGEN (documento leído, con sus líneas en `data`) y las decisiones del usuario (clasificación por
//! línea, reglas, banderas por documento, homologación de encabezados). La lectura del PDF y todo el cálculo (EEFF, 1001, 1005,
//! 1006) viven en el frontend y se recalculan siempre desde estos datos.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::database::tax_profiles;
use crate::error::{AppError, AppResult};
use crate::services::time::now_iso;

const MAX_FILES: usize = 20_000;
const MAX_DOC_BYTES: usize = 2_000_000;
const FLAG_KINDS: [&str; 3] = ["name_confirm", "retention_decision", "exclude"];

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseUpload {
    pub id: i64,
    pub folder_name: String,
    pub buyer_nit: String,
    pub file_count: i64,
    pub summary: Value,
    pub imported_at: String,
    /// Documentos de esta carga dentro del alcance consultado.
    pub document_count: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseDocument {
    pub id: i64,
    pub upload_id: i64,
    pub file_name: String,
    pub buyer_nit: String,
    pub buyer_name: String,
    pub year: Option<i64>,
    pub issue_date: Option<String>,
    pub issuer_nit: String,
    pub issuer_name: String,
    pub number_key: String,
    pub total_cents: Option<i64>,
    pub title_key: String,
    pub cufe: Option<String>,
    pub fingerprint: String,
    pub status: String,
    pub duplicate_of: Option<i64>,
    pub data: Value,
    pub imported_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LineClass {
    pub document_id: i64,
    pub line_index: i64,
    pub puc_code: String,
    pub concept_1001: String,
    pub retention: Value,
    pub rule_id: Option<i64>,
    pub scope: String,
    pub confirmed_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocFlag {
    pub document_id: i64,
    pub kind: String,
    pub value: String,
    pub decided_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: i64,
    pub buyer_nit: String,
    pub year: Option<i64>,
    pub event: String,
    pub detail: Value,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PurchasesState {
    pub uploads: Vec<PurchaseUpload>,
    pub documents: Vec<PurchaseDocument>,
    pub line_classes: Vec<LineClass>,
    pub flags: Vec<DocFlag>,
    pub audit: Vec<AuditEntry>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseScope {
    pub buyer_nit: String,
    pub year: Option<i64>,
    pub documents: i64,
    pub current: i64,
    pub evidence: i64,
    pub uploads: i64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseDocFileInput {
    pub file_name: String,
    #[serde(default)]
    pub buyer_nit: String,
    #[serde(default)]
    pub buyer_name: String,
    #[serde(default)]
    pub year: Option<i64>,
    #[serde(default)]
    pub issue_date: Option<String>,
    #[serde(default)]
    pub issuer_nit: String,
    #[serde(default)]
    pub issuer_name: String,
    #[serde(default)]
    pub number_key: String,
    #[serde(default)]
    pub total_cents: Option<i64>,
    #[serde(default)]
    pub title_key: String,
    #[serde(default)]
    pub cufe: Option<String>,
    pub fingerprint: String,
    pub data: Value,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavePurchaseUploadInput {
    pub folder_name: String,
    #[serde(default)]
    pub buyer_nit: String,
    pub files: Vec<PurchaseDocFileInput>,
    #[serde(default)]
    pub summary: Value,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedDocument {
    pub file_name: String,
    pub id: i64,
    pub status: String,
    pub duplicate_of: Option<i64>,
    /// Mismo documento en todo (fecha y total): un duplicado exacto. Falso = versión con diferencias.
    pub same_content: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavePurchaseUploadOutcome {
    pub upload_id: i64,
    pub documents: Vec<SavedDocument>,
    /// Facturas que ya estaban vigentes con exactamente el mismo contenido (otra carga): no se vuelven a guardar ni crean evidencia.
    pub unchanged: i64,
}

/// Carga vigente cuyo conjunto de facturas coincide exactamente con el de una carpeta nueva.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IdenticalUpload {
    pub upload_id: i64,
    pub folder_name: String,
    pub imported_at: String,
    pub document_count: i64,
}

/// Archivo de la carpeta nueva al reemplazar una carga idéntica: solo su nombre y la huella de su contenido.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFile {
    pub file_name: String,
    pub fingerprint: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LineClassInput {
    pub document_id: i64,
    pub line_index: i64,
    #[serde(default)]
    pub puc_code: String,
    #[serde(default)]
    pub concept_1001: String,
    #[serde(default)]
    pub retention: Value,
    #[serde(default)]
    pub save_rule: bool,
    #[serde(default)]
    pub supplier_nit: String,
    #[serde(default)]
    pub product_key: String,
    #[serde(default)]
    pub product_label: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseRule {
    pub id: i64,
    pub supplier_nit: String,
    pub product_key: String,
    pub product_label: String,
    pub puc_code: String,
    pub concept_1001: String,
    pub retention: Value,
    pub uses: i64,
    pub source_document_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleHistory {
    pub id: i64,
    pub rule_id: i64,
    pub supplier_nit: String,
    pub product_key: String,
    pub puc_code: String,
    pub concept_1001: String,
    pub retention: Value,
    pub source_document_id: Option<i64>,
    pub changed_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitleType {
    pub title_key: String,
    pub display_title: String,
    pub kind: String,
    pub is_system: bool,
}

fn parse_json(text: String) -> Value {
    serde_json::from_str(&text).unwrap_or(Value::Null)
}

fn retention_text(v: &Value) -> AppResult<String> {
    if v.is_null() {
        return Ok("[]".into());
    }
    if !v.is_array() {
        return Err(AppError::user("La retención de la línea no es válida."));
    }
    Ok(serde_json::to_string(v)?)
}

/// Auditoría del comprador y el año (`None` = documento sin fecha).
pub fn audit(conn: &Connection, buyer_nit: &str, year: Option<i64>, event: &str, detail: &Value) -> AppResult<()> {
    conn.execute(
        "INSERT INTO purchase_audit (buyer_nit, year, event, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![buyer_nit, year, event, serde_json::to_string(detail)?, now_iso()],
    )?;
    Ok(())
}

/// Filtro de año: `None` todos · `Some(0)` solo documentos sin fecha · `Some(n)` ese año.
fn year_filter(year: Option<i64>) -> (i64, i64) {
    match year {
        None => (0, 0),
        Some(0) => (1, 0),
        Some(n) => (2, n),
    }
}

const YEAR_SQL: &str = "(?2 = 0 OR (?2 = 1 AND {c}.year IS NULL) OR (?2 = 2 AND {c}.year = ?3))";

fn year_sql(alias: &str) -> String {
    YEAR_SQL.replace("{c}", alias)
}

pub fn state(conn: &Connection, buyer_nit: &str, year: Option<i64>) -> AppResult<PurchasesState> {
    let (mode, y) = year_filter(year);
    let d = year_sql("d");
    let documents: Vec<PurchaseDocument> = conn
        .prepare(&format!(
            "SELECT d.id, d.upload_id, d.file_name, d.buyer_nit, d.buyer_name, d.year, d.issue_date, d.issuer_nit, d.issuer_name, d.number_key, d.total_cents,
                    d.title_key, d.cufe, d.fingerprint, d.status, d.duplicate_of, d.data, d.imported_at
             FROM purchase_documents d WHERE d.buyer_nit = ?1 AND {d} ORDER BY d.issue_date, d.id"
        ))?
        .query_map(params![buyer_nit, mode, y], |r| {
            Ok(PurchaseDocument {
                id: r.get(0)?,
                upload_id: r.get(1)?,
                file_name: r.get(2)?,
                buyer_nit: r.get(3)?,
                buyer_name: r.get(4)?,
                year: r.get(5)?,
                issue_date: r.get(6)?,
                issuer_nit: r.get(7)?,
                issuer_name: r.get(8)?,
                number_key: r.get(9)?,
                total_cents: r.get(10)?,
                title_key: r.get(11)?,
                cufe: r.get(12)?,
                fingerprint: r.get(13)?,
                status: r.get(14)?,
                duplicate_of: r.get(15)?,
                data: parse_json(r.get(16)?),
                imported_at: r.get(17)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let uploads: Vec<PurchaseUpload> = conn
        .prepare(&format!(
            "SELECT u.id, u.folder_name, u.buyer_nit, u.file_count, u.summary, u.imported_at, COUNT(d.id)
             FROM purchase_uploads u JOIN purchase_documents d ON d.upload_id = u.id
             WHERE d.buyer_nit = ?1 AND {d} GROUP BY u.id ORDER BY u.imported_at, u.id"
        ))?
        .query_map(params![buyer_nit, mode, y], |r| {
            Ok(PurchaseUpload { id: r.get(0)?, folder_name: r.get(1)?, buyer_nit: r.get(2)?, file_count: r.get(3)?, summary: parse_json(r.get(4)?), imported_at: r.get(5)?, document_count: r.get(6)? })
        })?
        .collect::<Result<_, _>>()?;
    let line_classes = conn
        .prepare(&format!(
            "SELECT c.document_id, c.line_index, c.puc_code, c.concept_1001, c.retention, c.rule_id, c.scope, c.confirmed_at
             FROM purchase_line_class c JOIN purchase_documents d ON d.id = c.document_id
             WHERE d.buyer_nit = ?1 AND {d} ORDER BY c.document_id, c.line_index"
        ))?
        .query_map(params![buyer_nit, mode, y], |r| {
            Ok(LineClass { document_id: r.get(0)?, line_index: r.get(1)?, puc_code: r.get(2)?, concept_1001: r.get(3)?, retention: parse_json(r.get(4)?), rule_id: r.get(5)?, scope: r.get(6)?, confirmed_at: r.get(7)? })
        })?
        .collect::<Result<_, _>>()?;
    let flags = conn
        .prepare(&format!(
            "SELECT f.document_id, f.kind, f.value, f.decided_at FROM purchase_doc_flags f JOIN purchase_documents d ON d.id = f.document_id
             WHERE d.buyer_nit = ?1 AND {d} ORDER BY f.document_id, f.kind"
        ))?
        .query_map(params![buyer_nit, mode, y], |r| Ok(DocFlag { document_id: r.get(0)?, kind: r.get(1)?, value: r.get(2)?, decided_at: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    let a = year_sql("a");
    let audit = conn
        .prepare(&format!("SELECT a.id, a.buyer_nit, a.year, a.event, a.detail, a.created_at FROM purchase_audit a WHERE a.buyer_nit = ?1 AND {a} ORDER BY a.id DESC LIMIT 300"))?
        .query_map(params![buyer_nit, mode, y], |r| Ok(AuditEntry { id: r.get(0)?, buyer_nit: r.get(1)?, year: r.get(2)?, event: r.get(3)?, detail: parse_json(r.get(4)?), created_at: r.get(5)? }))?
        .collect::<Result<_, _>>()?;
    Ok(PurchasesState { uploads, documents, line_classes, flags, audit })
}

pub fn list_scopes(conn: &Connection) -> AppResult<Vec<PurchaseScope>> {
    Ok(conn
        .prepare(
            "SELECT buyer_nit, year, COUNT(*), SUM(status = 'current'), SUM(status = 'evidence'), COUNT(DISTINCT upload_id)
             FROM purchase_documents GROUP BY buyer_nit, year ORDER BY buyer_nit, year",
        )?
        .query_map([], |r| Ok(PurchaseScope { buyer_nit: r.get(0)?, year: r.get(1)?, documents: r.get(2)?, current: r.get(3)?, evidence: r.get(4)?, uploads: r.get(5)? }))?
        .collect::<Result<_, _>>()?)
}

fn validate_upload(input: &SavePurchaseUploadInput) -> AppResult<()> {
    if input.folder_name.trim().is_empty() {
        return Err(AppError::user("La carpeta no tiene nombre."));
    }
    if input.files.is_empty() {
        return Err(AppError::user("La carga no tiene facturas para guardar."));
    }
    if input.files.len() > MAX_FILES {
        return Err(AppError::user("La carga tiene demasiados archivos."));
    }
    for f in &input.files {
        if f.file_name.trim().is_empty() || f.fingerprint.trim().is_empty() {
            return Err(AppError::user("Un archivo de la carga no es válido."));
        }
        if let Some(y) = f.year {
            if !(2000..=2100).contains(&y) {
                return Err(AppError::user("El año de una factura no es válido."));
            }
        }
        if serde_json::to_string(&f.data)?.len() > MAX_DOC_BYTES {
            return Err(AppError::user(format!("La factura «{}» es demasiado grande para guardarse.", f.file_name)));
        }
    }
    Ok(())
}

/// Guarda una carga completa en una transacción. Un documento con el mismo comprador + emisor + número (o, sin número, el mismo
/// CUFE) que uno vigente se guarda como evidencia: no afecta resultados salvo sustitución explícita.
pub fn save_upload(conn: &mut Connection, input: &SavePurchaseUploadInput) -> AppResult<SavePurchaseUploadOutcome> {
    validate_upload(input)?;
    let tx = conn.transaction()?;
    let now = now_iso();
    tx.execute(
        "INSERT INTO purchase_uploads (folder_name, buyer_nit, file_count, summary, imported_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![input.folder_name.trim(), input.buyer_nit, input.files.len() as i64, serde_json::to_string(&input.summary)?, now],
    )?;
    let upload_id = tx.last_insert_rowid();
    let mut saved = Vec::new();
    let mut unchanged = 0_i64;
    let mut touched: std::collections::BTreeMap<(String, Option<i64>), (i64, i64)> = Default::default();
    for f in &input.files {
        let current: Option<(i64, Option<String>, Option<i64>, String, i64)> = if !f.number_key.is_empty() {
            tx.query_row(
                "SELECT id, issue_date, total_cents, fingerprint, upload_id FROM purchase_documents WHERE buyer_nit = ?1 AND issuer_nit = ?2 AND number_key = ?3 AND status = 'current' ORDER BY id LIMIT 1",
                params![f.buyer_nit, f.issuer_nit, f.number_key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?
        } else if let Some(cufe) = f.cufe.as_ref().filter(|c| !c.is_empty()) {
            tx.query_row(
                "SELECT id, issue_date, total_cents, fingerprint, upload_id FROM purchase_documents WHERE buyer_nit = ?1 AND cufe = ?2 AND status = 'current' ORDER BY id LIMIT 1",
                params![f.buyer_nit, cufe],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?
        } else {
            None
        };
        // Mismo contenido que una factura vigente de una carga anterior: no hay nada que decidir ni que guardar.
        if let Some((_, _, _, fp, up)) = &current {
            if *up != upload_id && *fp == f.fingerprint {
                unchanged += 1;
                continue;
            }
        }
        let (status, duplicate_of, same) = match &current {
            Some((id, date, total, _, _)) => ("evidence", Some(*id), *date == f.issue_date && *total == f.total_cents),
            None => ("current", None, false),
        };
        tx.execute(
            "INSERT INTO purchase_documents (upload_id, file_name, buyer_nit, buyer_name, year, issue_date, issuer_nit, issuer_name, number_key, total_cents, title_key, cufe,
                                             fingerprint, status, duplicate_of, data, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                upload_id, f.file_name, f.buyer_nit, f.buyer_name, f.year, f.issue_date, f.issuer_nit, f.issuer_name, f.number_key, f.total_cents, f.title_key, f.cufe, f.fingerprint,
                status, duplicate_of, serde_json::to_string(&f.data)?, now
            ],
        )?;
        let id = tx.last_insert_rowid();
        let entry = touched.entry((f.buyer_nit.clone(), f.year)).or_insert((0, 0));
        entry.0 += 1;
        if duplicate_of.is_some() {
            entry.1 += 1;
        }
        saved.push(SavedDocument { file_name: f.file_name.clone(), id, status: status.into(), duplicate_of, same_content: same });
    }
    for ((nit, year), (count, duplicates)) in touched {
        audit(&tx, &nit, year, "import", &serde_json::json!({ "folder": input.folder_name.trim(), "documents": count, "duplicates": duplicates }))?;
    }
    if saved.is_empty() {
        // Todo era idéntico a lo vigente: no queda ni una carga vacía (se descarta la transacción).
        return Ok(SavePurchaseUploadOutcome { upload_id: 0, documents: saved, unchanged });
    }
    tx.commit()?;
    Ok(SavePurchaseUploadOutcome { upload_id, documents: saved, unchanged })
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

/// Carga vigente (con al menos una factura vigente) del mismo comprador cuyo conjunto de huellas es exactamente el de la carpeta nueva.
pub fn find_identical_upload(conn: &Connection, buyer_nit: &str, fingerprints: &[String]) -> AppResult<Option<IdenticalUpload>> {
    if fingerprints.is_empty() {
        return Ok(None);
    }
    let wanted = sorted(fingerprints.to_vec());
    let mut stmt = conn.prepare(
        "SELECT u.id, u.folder_name, u.imported_at FROM purchase_uploads u
         WHERE u.buyer_nit = ?1 AND EXISTS (SELECT 1 FROM purchase_documents d WHERE d.upload_id = u.id AND d.status = 'current') ORDER BY u.id",
    )?;
    let uploads: Vec<(i64, String, String)> = stmt.query_map([buyer_nit], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
    for (id, folder_name, imported_at) in uploads {
        let have = sorted(conn.prepare("SELECT fingerprint FROM purchase_documents WHERE upload_id = ?1")?.query_map([id], |r| r.get::<_, String>(0))?.collect::<Result<_, _>>()?);
        if have == wanted {
            return Ok(Some(IdenticalUpload { upload_id: id, folder_name, imported_at, document_count: have.len() as i64 }));
        }
    }
    Ok(None)
}

/// Reemplaza una carga idéntica: actualiza el nombre de la carpeta y de los archivos sobre las MISMAS facturas. No crea facturas,
/// evidencias ni cargas, así que clasificaciones, confirmaciones, reglas y banderas siguen donde estaban y nada cambia en cobertura,
/// conteos, Estados Financieros ni Exógena.
pub fn replace_identical_upload(conn: &mut Connection, upload_id: i64, folder_name: &str, files: &[ReplaceFile]) -> AppResult<i64> {
    if folder_name.trim().is_empty() {
        return Err(AppError::user("La carpeta no tiene nombre."));
    }
    let tx = conn.transaction()?;
    let buyer_nit: String = tx
        .query_row("SELECT buyer_nit FROM purchase_uploads WHERE id = ?1", [upload_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| AppError::user("La carga ya no existe."))?;
    let fingerprints: Vec<String> = files.iter().map(|f| f.fingerprint.clone()).collect();
    if find_identical_upload(&tx, &buyer_nit, &fingerprints)?.map(|u| u.upload_id) != Some(upload_id) {
        return Err(AppError::user("La carpeta ya no coincide con la carga existente. Vuelve a importarla."));
    }
    let mut by_fp: std::collections::HashMap<String, Vec<i64>> = Default::default();
    {
        let mut stmt = tx.prepare("SELECT id, fingerprint FROM purchase_documents WHERE upload_id = ?1 ORDER BY id")?;
        for row in stmt.query_map([upload_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
            let (id, fp) = row?;
            by_fp.entry(fp).or_default().push(id);
        }
    }
    for f in files {
        let id = by_fp.get_mut(&f.fingerprint).filter(|v| !v.is_empty()).map(|v| v.remove(0)).ok_or_else(|| AppError::user("La carga no coincide."))?;
        tx.execute("UPDATE purchase_documents SET file_name = ?1 WHERE id = ?2", params![f.file_name, id])?;
    }
    tx.execute("UPDATE purchase_uploads SET folder_name = ?1, file_count = ?2, imported_at = ?3 WHERE id = ?4", params![folder_name.trim(), files.len() as i64, now_iso(), upload_id])?;
    let scopes: Vec<(Option<i64>, i64)> = tx
        .prepare("SELECT year, COUNT(*) FROM purchase_documents WHERE upload_id = ?1 GROUP BY year")?
        .query_map([upload_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (year, count) in scopes {
        audit(&tx, &buyer_nit, year, "reimport_identical", &serde_json::json!({ "folder": folder_name.trim(), "documents": count }))?;
    }
    tx.commit()?;
    Ok(files.len() as i64)
}

/// Sustituye el documento vigente por una evidencia (autorización explícita del usuario). Las líneas del nuevo quedan «Por confirmar».
pub fn substitute_document(conn: &mut Connection, id: i64) -> AppResult<()> {
    let tx = conn.transaction()?;
    let row: Option<(String, String, Option<i64>, Option<i64>, String)> = tx
        .query_row("SELECT status, buyer_nit, year, duplicate_of, file_name FROM purchase_documents WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .optional()?;
    let (status, nit, year, previous, file) = row.ok_or_else(|| AppError::user("El documento no existe o fue eliminado."))?;
    let previous = match (status.as_str(), previous) {
        ("evidence", Some(p)) => p,
        _ => return Err(AppError::user("Solo se puede sustituir con un documento que sea evidencia de un duplicado.")),
    };
    tx.execute("UPDATE purchase_documents SET status = 'superseded' WHERE id = ?1", [previous])?;
    tx.execute("UPDATE purchase_documents SET status = 'current', duplicate_of = NULL WHERE id = ?1", [id])?;
    tx.execute("UPDATE purchase_documents SET duplicate_of = ?1 WHERE duplicate_of = ?2 AND id <> ?1", params![id, previous])?;
    // El anterior queda como evidencia histórica de la nueva versión.
    tx.execute("UPDATE purchase_documents SET duplicate_of = ?1 WHERE id = ?2", params![id, previous])?;
    audit(&tx, &nit, year, "substitute", &serde_json::json!({ "documentId": id, "replacedId": previous, "fileName": file }))?;
    tx.commit()?;
    Ok(())
}

fn valid_puc(code: &str) -> bool {
    code.is_empty() || ((4..=12).contains(&code.len()) && code.chars().all(|c| c.is_ascii_digit()))
}

/// PUC especial «7305 — NO APLICA»: la línea queda excluida de EEFF y Exógena, sin concepto 1001 ni retenciones.
pub const NOT_APPLICABLE_PUC: &str = "7305";

fn valid_concept(code: &str) -> bool {
    code.is_empty() || (code.len() == 4 && code.chars().all(|c| c.is_ascii_digit()))
}

fn rule_snapshot(tx: &Connection, rule_id: i64, source_document_id: Option<i64>) -> AppResult<()> {
    tx.execute(
        "INSERT INTO purchase_rule_history (rule_id, supplier_nit, product_key, puc_code, concept_1001, retention, source_document_id, changed_at)
         SELECT id, supplier_nit, product_key, puc_code, concept_1001, retention, ?2, ?3 FROM purchase_rules WHERE id = ?1",
        params![rule_id, source_document_id, now_iso()],
    )?;
    Ok(())
}

/// Confirma la clasificación de líneas. Con `save_rule` también guarda (o actualiza, con historial) la regla producto/proveedor;
/// sin ella la clasificación vale solo para esa factura y la regla existente no se toca.
pub fn save_line_classes(conn: &mut Connection, inputs: &[LineClassInput]) -> AppResult<()> {
    if inputs.is_empty() {
        return Ok(());
    }
    for i in inputs {
        if !valid_puc(&i.puc_code) {
            return Err(AppError::user("El código PUC debe tener entre 4 y 12 dígitos."));
        }
        if !valid_concept(&i.concept_1001) {
            return Err(AppError::user("El concepto 1001 debe tener 4 dígitos."));
        }
        if i.puc_code.is_empty() && i.concept_1001.is_empty() {
            return Err(AppError::user("Elige al menos el código PUC o el concepto 1001 de la línea."));
        }
        if i.line_index < 0 {
            return Err(AppError::user("La línea no es válida."));
        }
        if i.save_rule && (i.supplier_nit.trim().is_empty() || i.product_key.trim().is_empty()) {
            return Err(AppError::user("Para guardar la regla se necesita el proveedor y el producto."));
        }
    }
    let tx = conn.transaction()?;
    let now = now_iso();
    let mut summary: std::collections::BTreeMap<i64, (String, Option<i64>, i64, bool)> = Default::default();
    for i in inputs {
        let (nit, year, issuer_nit, issue_date, data): (String, Option<i64>, String, Option<String>, String) = tx
            .query_row("SELECT buyer_nit, year, issuer_nit, issue_date, data FROM purchase_documents WHERE id = ?1", [i.document_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .optional()?
            .ok_or_else(|| AppError::user("La factura no existe o fue eliminada."))?;
        // Con 7305 no puede quedar ningún concepto ni retención guardados (ni en la línea ni en la regla); tampoco con un proveedor
        // O-15 / O-47 en la fecha de la factura, que no genera retención.
        let not_applicable = i.puc_code == NOT_APPLICABLE_PUC;
        let no_retention = not_applicable || exempt_on_invoice(&tx, &issuer_nit, issue_date.as_deref(), &parse_json(data))?;
        let concept_1001 = if not_applicable { "" } else { i.concept_1001.as_str() };
        let retention = if no_retention { "[]".to_string() } else { retention_text(&i.retention)? };
        let mut rule_id: Option<i64> = None;
        if i.save_rule {
            let existing: Option<(i64, String, String, String)> = tx
                .query_row("SELECT id, puc_code, concept_1001, retention FROM purchase_rules WHERE supplier_nit = ?1 AND product_key = ?2", params![i.supplier_nit, i.product_key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .optional()?;
            match existing {
                Some((id, puc, concept, ret)) => {
                    let changed = puc != i.puc_code || concept != concept_1001 || ret != retention;
                    tx.execute(
                        "UPDATE purchase_rules SET puc_code = ?1, concept_1001 = ?2, retention = ?3, product_label = CASE WHEN ?4 <> '' THEN ?4 ELSE product_label END, uses = uses + 1,
                                source_document_id = ?5, updated_at = ?6 WHERE id = ?7",
                        params![i.puc_code, concept_1001, retention, i.product_label, i.document_id, now, id],
                    )?;
                    if changed {
                        rule_snapshot(&tx, id, Some(i.document_id))?;
                    }
                    rule_id = Some(id);
                }
                None => {
                    tx.execute(
                        "INSERT INTO purchase_rules (supplier_nit, product_key, product_label, puc_code, concept_1001, retention, uses, source_document_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?8)",
                        params![i.supplier_nit, i.product_key, i.product_label, i.puc_code, concept_1001, retention, i.document_id, now],
                    )?;
                    let id = tx.last_insert_rowid();
                    rule_snapshot(&tx, id, Some(i.document_id))?;
                    rule_id = Some(id);
                }
            }
        }
        tx.execute(
            "INSERT INTO purchase_line_class (document_id, line_index, puc_code, concept_1001, retention, rule_id, scope, confirmed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(document_id, line_index) DO UPDATE SET puc_code = excluded.puc_code, concept_1001 = excluded.concept_1001, retention = excluded.retention,
                 rule_id = excluded.rule_id, scope = excluded.scope, confirmed_at = excluded.confirmed_at",
            params![i.document_id, i.line_index, i.puc_code, concept_1001, retention, rule_id, if i.save_rule { "rule" } else { "invoice" }, now],
        )?;
        let entry = summary.entry(i.document_id).or_insert((nit, year, 0, false));
        entry.2 += 1;
        entry.3 |= i.save_rule;
    }
    for (doc, (nit, year, lines, rule)) in summary {
        audit(&tx, &nit, year, "classify", &serde_json::json!({ "documentId": doc, "lines": lines, "savedRule": rule }))?;
    }
    tx.commit()?;
    Ok(())
}

fn is_empty_retention(text: &str) -> bool {
    serde_json::from_str::<Value>(text).ok().and_then(|v| v.as_array().map(|a| a.is_empty())).unwrap_or(true)
}

/// ¿El proveedor era O-15 / O-47 en la fecha de la factura? Rige el historial vigente en esa fecha; sin entrada, lo que trae la factura.
fn exempt_on_invoice(conn: &Connection, supplier_nit: &str, issue_date: Option<&str>, data: &Value) -> AppResult<bool> {
    if let Some(date) = issue_date.filter(|d| !d.is_empty()) {
        if let Some(regime) = tax_profiles::regime_at(conn, supplier_nit, date)? {
            return Ok(tax_profiles::is_exempt_regime(&regime));
        }
    }
    Ok(data["issuer"]["fiscalCodes"].as_array().is_some_and(|codes| codes.iter().filter_map(Value::as_str).any(|c| c == "O-15" || c == "O-47")))
}

/// Resultado de `clean_exempt_retention`.
#[derive(Debug, Default, Serialize, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExemptCleanup {
    /// Reglas producto/proveedor de Compras a las que se les quitó la retención.
    pub rules: i64,
    /// Reglas predeterminadas de retención del proveedor (Proveedores) eliminadas.
    pub supplier_rules: i64,
    /// Líneas confirmadas cuya retención calculada automáticamente se corrigió a cero.
    pub lines: i64,
    /// Líneas que se dejaron intactas porque la factura trae retención informada por el emisor (decide el usuario).
    pub kept_informed: i64,
}

/// Aplica la regla «O-15 / O-47 no generan retención»:
///  - Proveedores cuyo régimen VIGENTE HOY es O-15/O-47: se quita la retención de sus reglas de Compras y se eliminan sus reglas
///    predeterminadas de retención, así las compras futuras ya no la proponen.
///  - Líneas confirmadas de facturas cuyo proveedor era O-15/O-47 EN LA FECHA DE LA FACTURA: su retención calculada se corrige a cero
///    y queda en la auditoría. Si la factura trae retención informada por el emisor no se toca (la decide el usuario).
/// Las facturas anteriores a la fecha efectiva del régimen no se alteran. Es idempotente: sin nada que corregir no escribe nada.
pub fn clean_exempt_retention(conn: &Connection) -> AppResult<ExemptCleanup> {
    let mut out = ExemptCleanup::default();
    let today = now_iso()[..10].to_string();

    let nits: Vec<String> = conn
        .prepare("SELECT nit FROM suppliers UNION SELECT supplier_nit FROM supplier_fiscal_history")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for nit in nits {
        let has_history: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM supplier_fiscal_history WHERE supplier_nit = ?1)", [&nit], |r| r.get(0))?;
        let regime = if has_history {
            tax_profiles::regime_at(conn, &nit, &today)?
        } else {
            conn.query_row("SELECT fiscal_regime FROM suppliers WHERE nit = ?1", [&nit], |r| r.get::<_, Option<String>>(0)).optional()?.flatten()
        };
        if !regime.as_deref().is_some_and(tax_profiles::is_exempt_regime) {
            continue;
        }
        let rules: Vec<(i64, String)> = conn
            .prepare("SELECT id, retention FROM purchase_rules WHERE supplier_nit = ?1")?
            .query_map([&nit], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (id, retention) in rules.into_iter().filter(|(_, r)| !is_empty_retention(r)) {
            conn.execute("UPDATE purchase_rules SET retention = '[]', updated_at = ?1 WHERE id = ?2", params![now_iso(), id])?;
            rule_snapshot(conn, id, None)?;
            audit(conn, "", None, "exempt-rule-clean", &serde_json::json!({ "ruleId": id, "supplierNit": nit, "regime": regime, "previous": parse_json(retention) }))?;
            out.rules += 1;
        }
        let removed = conn.execute("DELETE FROM supplier_withholding_rules WHERE is_default = 1 AND supplier_id IN (SELECT id FROM suppliers WHERE nit = ?1)", [&nit])?;
        if removed > 0 {
            audit(conn, "", None, "exempt-supplier-rules-clean", &serde_json::json!({ "supplierNit": nit, "regime": regime, "removed": removed }))?;
            out.supplier_rules += removed as i64;
        }
    }

    #[allow(clippy::type_complexity)]
    let lines: Vec<(i64, i64, String, String, String, Option<String>, String, Option<i64>, String)> = conn
        .prepare(
            "SELECT c.document_id, c.line_index, c.retention, d.issuer_nit, d.buyer_nit, d.issue_date, d.data, d.year, d.status
             FROM purchase_line_class c JOIN purchase_documents d ON d.id = c.document_id
             WHERE d.status = 'current' AND c.retention <> '[]'",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)))?
        .collect::<Result<_, _>>()?;
    for (document_id, line_index, retention, issuer_nit, buyer_nit, issue_date, data, year, _) in lines {
        if is_empty_retention(&retention) {
            continue;
        }
        let data = parse_json(data);
        if !exempt_on_invoice(conn, &issuer_nit, issue_date.as_deref(), &data)? {
            continue;
        }
        if data["retefuenteCents"].as_i64().unwrap_or(0) > 0 {
            out.kept_informed += 1;
            continue;
        }
        conn.execute("UPDATE purchase_line_class SET retention = '[]' WHERE document_id = ?1 AND line_index = ?2", params![document_id, line_index])?;
        audit(
            conn,
            &buyer_nit,
            year,
            "exempt-retention-clean",
            &serde_json::json!({ "documentId": document_id, "lineIndex": line_index, "supplierNit": issuer_nit, "issueDate": issue_date, "previous": parse_json(retention), "reason": "Proveedor O-15 / O-47 en la fecha de la factura: la retención calculada automáticamente se corrige a cero." }),
        )?;
        out.lines += 1;
    }
    Ok(out)
}

pub fn delete_line_class(conn: &Connection, document_id: i64, line_index: i64) -> AppResult<()> {
    conn.execute("DELETE FROM purchase_line_class WHERE document_id = ?1 AND line_index = ?2", params![document_id, line_index])?;
    Ok(())
}

pub fn set_doc_flag(conn: &Connection, document_id: i64, kind: &str, value: &str) -> AppResult<()> {
    if !FLAG_KINDS.contains(&kind) {
        return Err(AppError::user("La decisión no es válida."));
    }
    let (nit, year): (String, Option<i64>) = conn
        .query_row("SELECT buyer_nit, year FROM purchase_documents WHERE id = ?1", [document_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| AppError::user("La factura no existe o fue eliminada."))?;
    conn.execute(
        "INSERT INTO purchase_doc_flags (document_id, kind, value, decided_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(document_id, kind) DO UPDATE SET value = excluded.value, decided_at = excluded.decided_at",
        params![document_id, kind, value, now_iso()],
    )?;
    audit(conn, &nit, year, "flag", &serde_json::json!({ "documentId": document_id, "kind": kind, "value": value }))
}

pub fn delete_doc_flag(conn: &Connection, document_id: i64, kind: &str) -> AppResult<()> {
    conn.execute("DELETE FROM purchase_doc_flags WHERE document_id = ?1 AND kind = ?2", params![document_id, kind])?;
    Ok(())
}

fn map_rule(r: &rusqlite::Row) -> rusqlite::Result<PurchaseRule> {
    Ok(PurchaseRule {
        id: r.get(0)?,
        supplier_nit: r.get(1)?,
        product_key: r.get(2)?,
        product_label: r.get(3)?,
        puc_code: r.get(4)?,
        concept_1001: r.get(5)?,
        retention: parse_json(r.get(6)?),
        uses: r.get(7)?,
        source_document_id: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

pub fn list_rules(conn: &Connection) -> AppResult<Vec<PurchaseRule>> {
    Ok(conn
        .prepare("SELECT id, supplier_nit, product_key, product_label, puc_code, concept_1001, retention, uses, source_document_id, created_at, updated_at FROM purchase_rules ORDER BY supplier_nit, product_key")?
        .query_map([], map_rule)?
        .collect::<Result<_, _>>()?)
}

pub fn list_rule_history(conn: &Connection, rule_id: Option<i64>) -> AppResult<Vec<RuleHistory>> {
    Ok(conn
        .prepare(
            "SELECT id, rule_id, supplier_nit, product_key, puc_code, concept_1001, retention, source_document_id, changed_at
             FROM purchase_rule_history WHERE (?1 IS NULL OR rule_id = ?1) ORDER BY id",
        )?
        .query_map([rule_id], |r| {
            Ok(RuleHistory { id: r.get(0)?, rule_id: r.get(1)?, supplier_nit: r.get(2)?, product_key: r.get(3)?, puc_code: r.get(4)?, concept_1001: r.get(5)?, retention: parse_json(r.get(6)?), source_document_id: r.get(7)?, changed_at: r.get(8)? })
        })?
        .collect::<Result<_, _>>()?)
}

pub fn update_rule(conn: &mut Connection, id: i64, puc_code: &str, concept_1001: &str, retention: &Value) -> AppResult<()> {
    if !valid_puc(puc_code) || !valid_concept(concept_1001) || (puc_code.is_empty() && concept_1001.is_empty()) {
        return Err(AppError::user("La regla necesita un código PUC (4 a 12 dígitos) o un concepto 1001 (4 dígitos)."));
    }
    let tx = conn.transaction()?;
    let not_applicable = puc_code == NOT_APPLICABLE_PUC;
    let n = tx.execute(
        "UPDATE purchase_rules SET puc_code = ?1, concept_1001 = ?2, retention = ?3, updated_at = ?4 WHERE id = ?5",
        params![puc_code, if not_applicable { "" } else { concept_1001 }, if not_applicable { "[]".to_string() } else { retention_text(retention)? }, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::user("La regla no existe o fue eliminada."));
    }
    rule_snapshot(&tx, id, None)?;
    tx.commit()?;
    Ok(())
}

/// Elimina la regla; las clasificaciones ya confirmadas conservan sus valores (`rule_id` queda vacío).
pub fn delete_rule(conn: &Connection, id: i64) -> AppResult<()> {
    let n = conn.execute("DELETE FROM purchase_rules WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::user("La regla no existe o fue eliminada."));
    }
    Ok(())
}

pub fn list_title_types(conn: &Connection) -> AppResult<Vec<TitleType>> {
    Ok(conn
        .prepare("SELECT title_key, display_title, kind, is_system FROM purchase_title_types ORDER BY is_system DESC, title_key")?
        .query_map([], |r| Ok(TitleType { title_key: r.get(0)?, display_title: r.get(1)?, kind: r.get(2)?, is_system: r.get::<_, i64>(3)? != 0 }))?
        .collect::<Result<_, _>>()?)
}

pub fn save_title_type(conn: &Connection, title_key: &str, display_title: &str, kind: &str) -> AppResult<()> {
    let key = title_key.trim();
    let display = display_title.split_whitespace().collect::<Vec<_>>().join(" ");
    if key.is_empty() || display.is_empty() {
        return Err(AppError::user("El encabezado del documento no puede estar vacío."));
    }
    if kind != "purchase" && kind != "return" {
        return Err(AppError::user("El tipo debe ser Compra o Devolución de compra."));
    }
    let system: Option<(bool, String)> = conn
        .query_row("SELECT is_system, kind FROM purchase_title_types WHERE title_key = ?1", [key], |r| Ok((r.get::<_, i64>(0)? != 0, r.get(1)?)))
        .optional()?;
    if let Some((true, current)) = &system {
        if current != kind {
            return Err(AppError::user("El tipo de un encabezado oficial no se puede cambiar."));
        }
    }
    conn.execute(
        "INSERT INTO purchase_title_types (title_key, display_title, kind, is_system, updated_at) VALUES (?1, ?2, ?3, 0, ?4)
         ON CONFLICT(title_key) DO UPDATE SET display_title = CASE WHEN is_system = 1 THEN display_title ELSE excluded.display_title END,
                                              kind = CASE WHEN is_system = 1 THEN kind ELSE excluded.kind END, updated_at = excluded.updated_at",
        params![key, display, kind, now_iso()],
    )?;
    Ok(())
}

pub fn delete_title_type(conn: &Connection, title_key: &str) -> AppResult<()> {
    let system: Option<bool> = conn.query_row("SELECT is_system FROM purchase_title_types WHERE title_key = ?1", [title_key], |r| Ok(r.get::<_, i64>(0)? != 0)).optional()?;
    match system {
        None => Err(AppError::user("El encabezado no existe.")),
        Some(true) => Err(AppError::user("Un encabezado oficial no se elimina.")),
        Some(false) => {
            conn.execute("DELETE FROM purchase_title_types WHERE title_key = ?1", [title_key])?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations;

    pub fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run_pending(&mut c).unwrap();
        c
    }

    pub fn file(name: &str, number: &str, date: &str, total: i64) -> PurchaseDocFileInput {
        PurchaseDocFileInput {
            file_name: name.into(),
            buyer_nit: "901748281".into(),
            buyer_name: "KAES SAS".into(),
            year: Some(date[..4].parse().unwrap()),
            issue_date: Some(date.into()),
            issuer_nit: "900319753".into(),
            issuer_name: "PRICESMART".into(),
            number_key: number.into(),
            total_cents: Some(total),
            title_key: "factura electronica de venta".into(),
            cufe: None,
            fingerprint: format!("fp-{name}"),
            data: serde_json::json!({ "lines": [{ "description": "A" }, { "description": "B" }] }),
        }
    }

    pub fn upload(c: &mut Connection, files: Vec<PurchaseDocFileInput>) -> SavePurchaseUploadOutcome {
        save_upload(c, &SavePurchaseUploadInput { folder_name: "Mayo".into(), buyer_nit: "901748281".into(), files, summary: serde_json::json!({}) }).unwrap()
    }

    #[test]
    fn duplicates_become_evidence_and_scopes_count_them() {
        let mut c = db();
        let first = upload(&mut c, vec![file("a.pdf", "COFE1", "2026-05-10", 1000), file("a-copia.pdf", "COFE1", "2026-05-10", 1000), file("b.pdf", "COFE2", "2025-12-31", 500)]);
        assert_eq!(first.documents[0].status, "current");
        assert_eq!((first.documents[1].status.as_str(), first.documents[1].duplicate_of, first.documents[1].same_content), ("evidence", Some(first.documents[0].id), true));
        // Otra carga: misma factura con total distinto → evidencia con diferencias; no afecta lo vigente.
        let second = upload(&mut c, vec![file("a-v2.pdf", "COFE1", "2026-05-10", 1200)]);
        assert_eq!((second.documents[0].status.as_str(), second.documents[0].same_content), ("evidence", false));
        let st = state(&c, "901748281", Some(2026)).unwrap();
        assert_eq!(st.documents.len(), 3);
        assert_eq!(st.documents.iter().filter(|d| d.status == "current").count(), 1);
        assert_eq!(state(&c, "901748281", Some(2025)).unwrap().documents.len(), 1, "las de otro año quedan en su período");
        assert_eq!(state(&c, "901748281", None).unwrap().documents.len(), 4);
        assert_eq!(st.uploads.len(), 2);
        assert!(st.audit.iter().any(|a| a.event == "import"));
        let scopes = list_scopes(&c).unwrap();
        let s2026 = scopes.iter().find(|s| s.year == Some(2026)).unwrap();
        assert_eq!((s2026.documents, s2026.current, s2026.evidence, s2026.uploads), (3, 1, 2, 2));
    }

    fn folder() -> Vec<PurchaseDocFileInput> {
        vec![file("a.pdf", "COFE1", "2026-05-10", 1000), file("b.pdf", "COFE2", "2026-05-11", 500), file("c.pdf", "COFE3", "2025-12-31", 700)]
    }
    fn fps(files: &[PurchaseDocFileInput]) -> Vec<String> {
        files.iter().map(|f| f.fingerprint.clone()).collect()
    }
    fn classify(c: &mut Connection, document_id: i64) {
        save_line_classes(c, &[LineClassInput { document_id, line_index: 0, puc_code: "613505".into(), concept_1001: "5004".into(), retention: Value::Null, save_rule: false, supplier_nit: String::new(), product_key: String::new(), product_label: String::new() }]).unwrap();
    }
    fn counts(c: &Connection) -> (i64, i64, i64, i64) {
        let n = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        (n("SELECT COUNT(*) FROM purchase_uploads"), n("SELECT COUNT(*) FROM purchase_documents"), n("SELECT COUNT(*) FROM purchase_documents WHERE status = 'evidence'"), n("SELECT COUNT(*) FROM purchase_line_class"))
    }

    #[test]
    fn identical_folder_is_detected_and_a_different_one_is_not() {
        let mut c = db();
        assert!(find_identical_upload(&c, "901748281", &fps(&folder())).unwrap().is_none(), "sin cargas previas no hay coincidencia");
        let first = upload(&mut c, folder());
        let found = find_identical_upload(&c, "901748281", &fps(&folder())).unwrap().expect("misma carpeta");
        assert_eq!((found.upload_id, found.document_count), (first.upload_id, 3));
        // El orden de los archivos no importa; otra empresa, un archivo de más o de menos o un contenido distinto, sí.
        let mut shuffled = folder();
        shuffled.reverse();
        assert!(find_identical_upload(&c, "901748281", &fps(&shuffled)).unwrap().is_some());
        assert!(find_identical_upload(&c, "900000000", &fps(&folder())).unwrap().is_none());
        assert!(find_identical_upload(&c, "901748281", &fps(&folder()[..2])).unwrap().is_none());
        let mut changed = folder();
        changed[1].fingerprint = "otra-huella".into();
        assert!(find_identical_upload(&c, "901748281", &fps(&changed)).unwrap().is_none());
    }

    #[test]
    fn replacing_an_identical_upload_creates_nothing_and_keeps_every_decision() {
        let mut c = db();
        let first = upload(&mut c, folder());
        let ids: Vec<i64> = first.documents.iter().map(|d| d.id).collect();
        classify(&mut c, ids[0]);
        set_doc_flag(&c, ids[1], "exclude", "1").unwrap();
        let before = counts(&c);
        let scopes_before = list_scopes(&c).unwrap();
        let state_before = state(&c, "901748281", Some(2026)).unwrap();

        // Misma carpeta con otro nombre y archivos renombrados (mismo contenido).
        let mut again = folder();
        for (i, f) in again.iter_mut().enumerate() {
            let fp = f.fingerprint.clone();
            f.file_name = format!("copia-{i}.pdf");
            f.fingerprint = fp;
        }
        let up = find_identical_upload(&c, "901748281", &fps(&again)).unwrap().unwrap();
        let rf: Vec<ReplaceFile> = again.iter().map(|f| ReplaceFile { file_name: f.file_name.clone(), fingerprint: f.fingerprint.clone() }).collect();
        replace_identical_upload(&mut c, up.upload_id, "Mayo (revisada)", &rf).unwrap();

        assert_eq!(counts(&c), before, "ni cargas, ni facturas, ni evidencias, ni clasificaciones nuevas");
        assert_eq!(list_scopes(&c).unwrap(), scopes_before, "cobertura y conteos por empresa y año no cambian");
        let after = state(&c, "901748281", Some(2026)).unwrap();
        assert_eq!(after.documents.iter().map(|d| (d.id, d.status.clone(), d.fingerprint.clone())).collect::<Vec<_>>(), state_before.documents.iter().map(|d| (d.id, d.status.clone(), d.fingerprint.clone())).collect::<Vec<_>>());
        assert_eq!(after.line_classes, state_before.line_classes, "la clasificación confirmada se conserva");
        assert_eq!(after.flags, state_before.flags, "las decisiones sobre la factura se conservan");
        assert_eq!(after.uploads[0].folder_name, "Mayo (revisada)");
        assert!(after.documents.iter().any(|d| d.file_name == "copia-0.pdf"));
        assert!(after.audit.iter().any(|a| a.event == "reimport_identical"));
    }

    #[test]
    fn replacing_requires_the_set_to_still_match() {
        let mut c = db();
        let first = upload(&mut c, folder());
        let mut changed: Vec<ReplaceFile> = folder().iter().map(|f| ReplaceFile { file_name: f.file_name.clone(), fingerprint: f.fingerprint.clone() }).collect();
        changed[0].fingerprint = "distinta".into();
        assert!(replace_identical_upload(&mut c, first.upload_id, "X", &changed).is_err());
        assert_eq!(counts(&c).1, 3);
    }

    #[test]
    fn partially_modified_folder_only_asks_about_the_documents_that_really_changed() {
        let mut c = db();
        let first = upload(&mut c, folder());
        classify(&mut c, first.documents[0].id);
        let before = counts(&c);
        // a.pdf y c.pdf no cambian; b.pdf trae otro total (nueva huella) y d.pdf es una factura nueva.
        let mut next = folder();
        next[1].total_cents = Some(600);
        next[1].fingerprint = "fp-b-v2".into();
        next.push(file("d.pdf", "COFE4", "2026-05-12", 900));
        assert!(find_identical_upload(&c, "901748281", &fps(&next)).unwrap().is_none(), "con cambios reales no es una carga idéntica");
        let out = upload(&mut c, next);

        assert_eq!(out.unchanged, 2, "a.pdf y c.pdf no se vuelven a guardar");
        assert_eq!(out.documents.len(), 2);
        let b = out.documents.iter().find(|d| d.file_name == "b.pdf").unwrap();
        assert_eq!((b.status.as_str(), b.same_content), ("evidence", false), "la factura distinta sí queda para decidir");
        assert_eq!(out.documents.iter().find(|d| d.file_name == "d.pdf").unwrap().status, "current");
        let after = counts(&c);
        assert_eq!((after.1 - before.1, after.2 - before.2), (2, 1), "solo la distinta (evidencia) y la nueva");
        assert_eq!(after.3, before.3, "la clasificación de las intactas no se toca");
    }

    #[test]
    fn a_folder_whose_invoices_are_all_unchanged_leaves_no_trace() {
        let mut c = db();
        upload(&mut c, folder());
        let before = counts(&c);
        let out = upload(&mut c, folder());
        assert_eq!((out.upload_id, out.unchanged, out.documents.len()), (0, 3, 0));
        assert_eq!(counts(&c), before);
    }

    #[test]
    fn documents_without_date_are_stored_and_found_by_year_zero() {
        let mut c = db();
        let mut f = file("x.pdf", "N1", "2026-01-01", 1);
        f.year = None;
        f.issue_date = None;
        upload(&mut c, vec![f]);
        assert_eq!(state(&c, "901748281", Some(0)).unwrap().documents.len(), 1);
        assert_eq!(state(&c, "901748281", Some(2026)).unwrap().documents.len(), 0);
    }

    #[test]
    fn substitution_requires_authorization_and_leaves_lines_unconfirmed() {
        let mut c = db();
        let first = upload(&mut c, vec![file("a.pdf", "COFE1", "2026-05-10", 1000)]);
        let old = first.documents[0].id;
        save_line_classes(&mut c, &[LineClassInput { document_id: old, line_index: 0, puc_code: "613505".into(), concept_1001: "5004".into(), retention: Value::Null, save_rule: false, supplier_nit: String::new(), product_key: String::new(), product_label: String::new() }]).unwrap();
        let second = upload(&mut c, vec![file("a-v2.pdf", "COFE1", "2026-05-10", 1200)]);
        let new = second.documents[0].id;
        assert!(substitute_document(&mut c, old).is_err(), "un vigente no se sustituye");
        substitute_document(&mut c, new).unwrap();
        let st = state(&c, "901748281", Some(2026)).unwrap();
        let status = |id: i64| st.documents.iter().find(|d| d.id == id).unwrap().status.clone();
        assert_eq!((status(old).as_str(), status(new).as_str()), ("superseded", "current"));
        assert!(st.line_classes.iter().all(|l| l.document_id != new), "las líneas nuevas quedan por confirmar");
        assert!(st.audit.iter().any(|a| a.event == "substitute"));
        // Con la nueva ya vigente, un tercer archivo igual se vuelve a comparar contra ella.
        let third = upload(&mut c, vec![file("a-v3.pdf", "COFE1", "2026-05-10", 1200)]);
        assert_eq!(third.documents[0].duplicate_of, Some(new));
    }

    #[test]
    fn rules_keep_history_and_invoice_scope_does_not_touch_them() {
        let mut c = db();
        let up = upload(&mut c, vec![file("a.pdf", "N1", "2026-05-10", 1000), file("b.pdf", "N2", "2026-05-11", 2000)]);
        let (d1, d2) = (up.documents[0].id, up.documents[1].id);
        let input = |doc: i64, puc: &str, rule: bool| LineClassInput {
            document_id: doc,
            line_index: 0,
            puc_code: puc.into(),
            concept_1001: "5004".into(),
            retention: serde_json::json!([{ "rateId": 3 }]),
            save_rule: rule,
            supplier_nit: "900319753".into(),
            product_key: "comida perro".into(),
            product_label: "Comida Perro".into(),
        };
        save_line_classes(&mut c, &[input(d1, "613505", true)]).unwrap();
        let rule = list_rules(&c).unwrap();
        assert_eq!((rule.len(), rule[0].uses, rule[0].puc_code.as_str()), (1, 1, "613505"));
        // Solo esta factura: la regla no cambia.
        save_line_classes(&mut c, &[input(d2, "519520", false)]).unwrap();
        assert_eq!(list_rules(&c).unwrap()[0].puc_code, "613505");
        let st = state(&c, "901748281", Some(2026)).unwrap();
        let l2 = st.line_classes.iter().find(|l| l.document_id == d2).unwrap();
        assert_eq!((l2.scope.as_str(), l2.rule_id, l2.puc_code.as_str()), ("invoice", None, "519520"));
        // Reconfirmar con otra cuenta cambia la regla y deja historial.
        save_line_classes(&mut c, &[input(d2, "519520", true)]).unwrap();
        let rule = &list_rules(&c).unwrap()[0];
        assert_eq!((rule.uses, rule.puc_code.as_str()), (2, "519520"));
        assert_eq!(list_rule_history(&c, Some(rule.id)).unwrap().len(), 2);
        update_rule(&mut c, rule.id, "613510", "5004", &serde_json::json!([])).unwrap();
        assert_eq!(list_rule_history(&c, None).unwrap().len(), 3);
        // Borrar la regla conserva lo confirmado.
        delete_rule(&c, rule.id).unwrap();
        let st = state(&c, "901748281", Some(2026)).unwrap();
        assert!(st.line_classes.iter().all(|l| l.rule_id.is_none()) && st.line_classes.len() == 2);
        assert!(delete_rule(&c, rule.id).is_err());
    }

    #[test]
    fn puc_7305_clears_concept_and_retention_in_line_and_rule() {
        let mut c = db();
        let up = upload(&mut c, vec![file("a.pdf", "N1", "2026-05-10", 1000)]);
        let id = up.documents[0].id;
        let input = |puc: &str, concept: &str, ret: Value| LineClassInput { document_id: id, line_index: 0, puc_code: puc.into(), concept_1001: concept.into(), retention: ret, save_rule: true, supplier_nit: "900319753".into(), product_key: "bolsa".into(), product_label: "Bolsa".into() };
        save_line_classes(&mut c, &[input("613505", "5004", serde_json::json!([{ "rateId": 3 }]))]).unwrap();
        // Cambiar a 7305 aunque se envíen datos viejos: nada queda guardado.
        save_line_classes(&mut c, &[input("7305", "5004", serde_json::json!([{ "rateId": 3 }]))]).unwrap();
        let st = state(&c, "901748281", Some(2026)).unwrap();
        let l = &st.line_classes[0];
        assert_eq!((l.puc_code.as_str(), l.concept_1001.as_str(), l.retention.as_array().map_or(0, |a| a.len())), ("7305", "", 0));
        let rule = &list_rules(&c).unwrap()[0];
        assert_eq!((rule.puc_code.as_str(), rule.concept_1001.as_str(), rule.retention.as_array().map_or(0, |a| a.len())), ("7305", "", 0));
        // Volver a una cuenta normal guarda otra vez sus datos.
        save_line_classes(&mut c, &[input("613505", "5004", serde_json::json!([{ "rateId": 3 }]))]).unwrap();
        assert_eq!(state(&c, "901748281", Some(2026)).unwrap().line_classes[0].concept_1001, "5004");
        // Editar la regla a 7305 también la limpia.
        let rid = list_rules(&c).unwrap()[0].id;
        update_rule(&mut c, rid, "7305", "5004", &serde_json::json!([{ "rateId": 3 }])).unwrap();
        let rule = &list_rules(&c).unwrap()[0];
        assert_eq!((rule.concept_1001.as_str(), rule.retention.as_array().map_or(0, |a| a.len())), ("", 0));
    }

    #[test]
    fn exempt_suppliers_lose_rules_and_automatic_retention_without_touching_history() {
        let mut c = db();
        let nit = "900319753";
        c.execute("INSERT INTO suppliers (nit, business_name, vat_type, created_at, updated_at, fiscal_regime) VALUES (?1, 'PRICESMART', 'purchase', 'x', 'x', 'O-13')", [nit]).unwrap();
        let save = |c: &Connection, date: &str, regime: &str| {
            tax_profiles::save_fiscal_entry(c, &tax_profiles::SupplierFiscalEntryInput { supplier_nit: nit.into(), effective_date: date.into(), regime: regime.into(), source: "manual".into(), note: String::new() }).unwrap()
        };
        save(&c, "2026-01-01", "O-13");
        let mut informed = file("c.pdf", "N3", "2026-06-12", 1000);
        informed.data = serde_json::json!({ "lines": [{ "description": "A" }], "retefuenteCents": 5000 });
        let up = upload(&mut c, vec![file("a.pdf", "N1", "2026-03-10", 1000), file("b.pdf", "N2", "2026-06-10", 1000), informed]);
        let ids: Vec<i64> = up.documents.iter().map(|d| d.id).collect();
        for id in &ids {
            c.execute("INSERT INTO purchase_line_class (document_id, line_index, puc_code, concept_1001, retention, scope, confirmed_at) VALUES (?1, 0, '613505', '5004', '[{\"rateId\":3}]', 'rule', 'x')", [id]).unwrap();
        }
        c.execute("INSERT INTO purchase_rules (supplier_nit, product_key, puc_code, concept_1001, retention, created_at, updated_at) VALUES (?1, 'bolsa', '613505', '5004', '[{\"rateId\":3}]', 'x', 'x')", [nit]).unwrap();
        let sid: i64 = c.query_row("SELECT id FROM suppliers WHERE nit = ?1", [nit], |r| r.get(0)).unwrap();
        c.execute("INSERT INTO supplier_withholding_rules (supplier_id, rate_id, base_mode, is_default, created_at, updated_at) VALUES (?1, 3, 'invoice_subtotal', 1, 'x', 'x')", [sid]).unwrap();
        let retention_of = |c: &Connection, id: i64| -> String { c.query_row("SELECT retention FROM purchase_line_class WHERE document_id = ?1", [id], |r| r.get(0)).unwrap() };

        // Mientras el proveedor no sea O-15/O-47 no se toca nada.
        assert_eq!(clean_exempt_retention(&c).unwrap(), ExemptCleanup::default());

        // O-15 desde el 1 de mayo: la factura de marzo (anterior) conserva su retención; la de junio se corrige; la informada se deja.
        save(&c, "2026-05-01", "O-15");
        assert_eq!(clean_exempt_retention(&c).unwrap(), ExemptCleanup { rules: 1, supplier_rules: 1, lines: 1, kept_informed: 1 });
        assert_eq!(retention_of(&c, ids[0]), "[{\"rateId\":3}]");
        assert_eq!(retention_of(&c, ids[1]), "[]");
        assert_eq!(retention_of(&c, ids[2]), "[{\"rateId\":3}]");
        assert_eq!(list_rules(&c).unwrap()[0].retention.as_array().map_or(99, |a| a.len()), 0);
        assert_eq!(list_rules(&c).unwrap()[0].puc_code, "613505", "la regla conserva PUC y concepto");
        assert_eq!(c.query_row::<i64, _, _>("SELECT COUNT(*) FROM purchase_rule_history WHERE retention = '[]'", [], |r| r.get(0)).unwrap(), 1);
        let corrections: i64 = c.query_row("SELECT COUNT(*) FROM purchase_audit WHERE event = 'exempt-retention-clean' AND detail LIKE '%rateId%'", [], |r| r.get(0)).unwrap();
        assert_eq!(corrections, 1, "la corrección queda auditada con el valor anterior");
        // Idempotente: la segunda pasada solo vuelve a contar la informada.
        assert_eq!(clean_exempt_retention(&c).unwrap(), ExemptCleanup { kept_informed: 1, ..Default::default() });

        // Guardar una línea de una factura exenta nunca deja retención, aunque la pantalla la envíe.
        let input = |ret: Value| LineClassInput { document_id: ids[1], line_index: 0, puc_code: "613505".into(), concept_1001: "5004".into(), retention: ret, save_rule: true, supplier_nit: nit.into(), product_key: "bolsa".into(), product_label: "Bolsa".into() };
        save_line_classes(&mut c, &[input(serde_json::json!([{ "rateId": 3 }]))]).unwrap();
        assert_eq!(retention_of(&c, ids[1]), "[]");
        assert_eq!(list_rules(&c).unwrap()[0].retention.as_array().map_or(99, |a| a.len()), 0);

        // Volver a un régimen con retención desde julio: la factura de agosto sí guarda retención y la de junio sigue exenta.
        save(&c, "2026-07-01", "O-13");
        let aug = upload(&mut c, vec![file("d.pdf", "N4", "2026-08-05", 1000)]).documents[0].id;
        let mut august = input(serde_json::json!([{ "rateId": 3 }]));
        august.document_id = aug;
        save_line_classes(&mut c, &[august]).unwrap();
        assert_eq!(retention_of(&c, aug), "[{\"rateId\":3}]");
        assert_eq!(clean_exempt_retention(&c).unwrap().lines, 0);
        assert_eq!(retention_of(&c, ids[1]), "[]");
    }

    #[test]
    fn invoice_codes_decide_when_the_supplier_has_no_history() {
        let mut c = db();
        let mut simple = file("a.pdf", "N1", "2026-03-10", 1000);
        simple.data = serde_json::json!({ "lines": [{ "description": "A" }], "issuer": { "fiscalCodes": ["O-47"] } });
        let id = upload(&mut c, vec![simple]).documents[0].id;
        let input = LineClassInput { document_id: id, line_index: 0, puc_code: "613505".into(), concept_1001: "5004".into(), retention: serde_json::json!([{ "rateId": 3 }]), save_rule: false, supplier_nit: "900319753".into(), product_key: "bolsa".into(), product_label: "Bolsa".into() };
        save_line_classes(&mut c, &[input]).unwrap();
        let stored: String = c.query_row("SELECT retention FROM purchase_line_class WHERE document_id = ?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(stored, "[]");
    }

    #[test]
    fn line_validation_and_flags() {
        let mut c = db();
        let up = upload(&mut c, vec![file("a.pdf", "N1", "2026-05-10", 1000)]);
        let id = up.documents[0].id;
        let bad = |puc: &str, concept: &str| LineClassInput { document_id: id, line_index: 0, puc_code: puc.into(), concept_1001: concept.into(), retention: Value::Null, save_rule: false, supplier_nit: String::new(), product_key: String::new(), product_label: String::new() };
        assert!(save_line_classes(&mut c, &[bad("12", "")]).is_err());
        assert!(save_line_classes(&mut c, &[bad("", "50")]).is_err());
        assert!(save_line_classes(&mut c, &[bad("", "")]).is_err());
        save_line_classes(&mut c, &[bad("", "5004")]).unwrap();
        delete_line_class(&c, id, 0).unwrap();
        assert!(set_doc_flag(&c, id, "otra", "x").is_err());
        set_doc_flag(&c, id, "name_confirm", "process").unwrap();
        set_doc_flag(&c, id, "name_confirm", "ignore").unwrap();
        let st = state(&c, "901748281", None).unwrap();
        assert_eq!((st.flags.len(), st.flags[0].value.as_str()), (1, "ignore"));
        delete_doc_flag(&c, id, "name_confirm").unwrap();
        assert!(state(&c, "901748281", None).unwrap().flags.is_empty());
        assert!(set_doc_flag(&c, 999, "exclude", "1").is_err());
    }

    #[test]
    fn title_types_are_seeded_and_protected() {
        let c = db();
        let list = list_title_types(&c).unwrap();
        assert_eq!(list.iter().filter(|t| t.is_system).count(), 2);
        assert_eq!(list.iter().find(|t| t.title_key == "nota credito electronica").unwrap().kind, "return");
        assert!(save_title_type(&c, "nota credito electronica", "NOTA CRÉDITO ELECTRÓNICA", "purchase").is_err());
        save_title_type(&c, "documento soporte", "Documento soporte", "purchase").unwrap();
        save_title_type(&c, "documento soporte", "Documento soporte", "return").unwrap();
        assert_eq!(list_title_types(&c).unwrap().iter().find(|t| t.title_key == "documento soporte").unwrap().kind, "return");
        assert!(delete_title_type(&c, "nota credito electronica").is_err());
        delete_title_type(&c, "documento soporte").unwrap();
        assert!(delete_title_type(&c, "documento soporte").is_err());
    }

    #[test]
    fn exogena_accepts_1001_1005_1006_and_eeff_purchases_batch_is_replaced_by_its_key() {
        use crate::database::{exogena, fs};
        use crate::models::exogena::{ApplySyncInput, SyncProposal};
        use crate::models::fs::{BatchInput, MovementInput};
        let mut c = db();
        c.execute("INSERT INTO companies (id, razon_social, nit, created_at, updated_at) VALUES (1, 'KAES SAS', '901748281', 'x', 'x')", []).unwrap();
        for code in ["1001", "1005", "1006"] {
            let proposal = SyncProposal { source_key: format!("tercero:900319753|{code}"), origin: "estados_financieros".into(), origin_ref: "factura".into(), data: serde_json::json!({ "docNumber": "900319753" }) };
            let input = ApplySyncInput { company_id: 1, year: 2026, format_code: code.into(), source: "Compras".into(), proposals: vec![proposal], remove_missing: true, source_fingerprint: None, overwrite_manual: vec![], summary: Value::Null };
            exogena::apply_sync(&mut c, &input.validated().unwrap()).unwrap();
            assert_eq!(exogena::list_records(&c, 1, 2026, code).unwrap().len(), 1);
            exogena::set_status(&c, 1, 2026, code, "listo", "").unwrap();
        }
        assert_eq!(exogena::list_status(&c, 1, 2026).unwrap().len(), 3);
        let batch = |cents: i64| BatchInput {
            company_id: 1,
            source: "purchases".into(),
            file_name: "Compras 2026".into(),
            period_label: "Compras · 2026".into(),
            period_start: Some("2026-01-01".into()),
            period_end: Some("2026-12-31".into()),
            dedupe_key: "purchases:2026".into(),
            replace: true,
            metadata: None,
            movements: vec![MovementInput { accounting_date: "2026-05-10".into(), puc_code: "513595".into(), amount_cents: cents, document_id: "COFE1".into(), ..Default::default() }],
            bank_balances: vec![],
            bank_concept_mappings: vec![],
            payroll_rows: vec![],
            decisions: vec![],
        };
        fs::send_batch(&mut c, &batch(1000)).unwrap();
        fs::send_batch(&mut c, &batch(2500)).unwrap();
        let active: Vec<i64> = fs::list_movements(&c, 1).unwrap().into_iter().filter(|m| m.status == "active").map(|m| m.amount_cents).collect();
        assert_eq!(active, vec![2500], "el envío anual reemplaza al anterior con la misma clave");
    }
}
