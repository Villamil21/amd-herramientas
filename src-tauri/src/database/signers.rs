use rusqlite::{params, Connection, OptionalExtension, Row};
use crate::error::{AppError, AppResult};
use crate::models::signer::{CertificateSigner, CertificateSignerInput};
use crate::services::time::now_iso;

const COLUMNS: &str = "id, name, role, professional_document, signature_file, created_at, updated_at";
fn map(r: &Row) -> rusqlite::Result<CertificateSigner> { Ok(CertificateSigner { id: r.get(0)?, name: r.get(1)?, role: r.get(2)?, professional_document: r.get(3)?, signature_file: r.get(4)?, created_at: r.get(5)?, updated_at: r.get(6)?, signature_available: false }) }
pub fn list(conn: &Connection, search: Option<&str>) -> AppResult<Vec<CertificateSigner>> { let q = format!("%{}%", search.unwrap_or("").trim()); Ok(conn.prepare(&format!("SELECT {COLUMNS} FROM certificate_signers WHERE name LIKE ?1 OR role LIKE ?1 OR professional_document LIKE ?1 ORDER BY name COLLATE NOCASE"))?.query_map([q], map)?.collect::<Result<_, _>>()?) }
pub fn get(conn: &Connection, id: i64) -> AppResult<CertificateSigner> { conn.query_row(&format!("SELECT {COLUMNS} FROM certificate_signers WHERE id=?1"), [id], map).optional()?.ok_or_else(|| AppError::user("El firmante no existe o fue eliminado.")) }
pub fn insert(conn: &Connection, v: &CertificateSignerInput) -> AppResult<i64> { let now=now_iso(); conn.execute("INSERT INTO certificate_signers (name, role, professional_document, signature_file, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?5)", params![v.name,v.role,v.professional_document,v.signature_file,now])?; Ok(conn.last_insert_rowid()) }
pub fn update(conn: &Connection, id:i64, v:&CertificateSignerInput) -> AppResult<()> { if conn.execute("UPDATE certificate_signers SET name=?1,role=?2,professional_document=?3,signature_file=?4,updated_at=?5 WHERE id=?6",params![v.name,v.role,v.professional_document,v.signature_file,now_iso(),id])? == 0 { return Err(AppError::user("El firmante no existe o fue eliminado.")); } Ok(()) }
pub fn delete(conn:&Connection,id:i64)->AppResult<CertificateSigner>{let s=get(conn,id)?; conn.execute("DELETE FROM certificate_signers WHERE id=?1",[id])?;Ok(s)}
/// Restauración de backup: conserva id y fechas originales.
pub fn insert_full(conn: &Connection, s: &CertificateSigner) -> AppResult<()> { conn.execute("INSERT INTO certificate_signers (id, name, role, professional_document, signature_file, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![s.id,s.name,s.role,s.professional_document,s.signature_file,s.created_at,s.updated_at])?; Ok(()) }
