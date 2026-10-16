//! Copias del RUT y de la Cámara de Comercio de cada empresa: archivos PDF dentro de
//! <datos>/company_documents, referenciados por nombre (`<32 hex>.pdf`) desde SQLite.
//! Nunca se guardan rutas absolutas ni se depende del archivo que eligió el usuario.
//!
//! Flujo: al cargar un PDF se valida y se copia aquí con un nombre nuevo (aún sin
//! referencia). Al guardar la empresa se registra como una versión más del historial.
//! Las versiones anteriores nunca se borran al cargar una nueva; los archivos que
//! quedaron sin referencia (formularios cancelados) se limpian en el siguiente arranque.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub const MAX_DOCUMENT_BYTES: u64 = 20 * 1024 * 1024;

pub fn is_valid_name(name: &str) -> bool {
    name.strip_suffix(".pdf")
        .is_some_and(|stem| stem.len() == 32 && stem.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()))
}

pub fn path_for(dir: &Path, name: &str) -> AppResult<PathBuf> {
    if !is_valid_name(name) {
        return Err(AppError::user("La referencia del documento no es válida."));
    }
    Ok(dir.join(name))
}

fn random_name() -> AppResult<String> {
    let mut buf = [0u8; 16];
    getrandom::fill(&mut buf).map_err(|_| AppError::user("No fue posible guardar el documento."))?;
    let hex: String = buf.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{hex}.pdf"))
}

/// Valida y guarda una copia exacta del PDF. Escritura atómica: nunca queda un archivo a medias.
pub fn import_from_bytes(dir: &Path, bytes: &[u8]) -> AppResult<String> {
    if bytes.is_empty() {
        return Err(AppError::user("El archivo está vacío."));
    }
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(AppError::user("El documento supera el tamaño máximo de 20 MB."));
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err(AppError::user("El archivo seleccionado no es un PDF válido."));
    }
    let name = random_name()?;
    let final_path = dir.join(&name);
    let tmp = dir.join(format!(".{name}.tmp"));
    if let Err(e) = std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, &final_path)) {
        eprintln!("[company-documents] {e}");
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::user("No fue posible guardar el documento en el almacenamiento de la aplicación."));
    }
    Ok(name)
}

pub fn import_from_path(dir: &Path, source: &Path) -> AppResult<(String, Vec<u8>)> {
    let is_pdf = source.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    let meta = std::fs::metadata(source).map_err(|_| AppError::user("No fue posible leer el archivo seleccionado."))?;
    if !is_pdf || !meta.is_file() {
        return Err(AppError::user("Selecciona un archivo PDF."));
    }
    if meta.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::user("El documento supera el tamaño máximo de 20 MB."));
    }
    let bytes = std::fs::read(source).map_err(|_| AppError::user("No fue posible leer el archivo seleccionado. Verifica que no esté en uso o protegido."))?;
    let name = import_from_bytes(dir, &bytes)?;
    Ok((name, bytes))
}

/// Lee el PDF guardado con errores claros si falta o no se puede leer.
pub fn read(dir: &Path, name: &str) -> AppResult<Vec<u8>> {
    let path = path_for(dir, name)?;
    if !path.exists() {
        return Err(AppError::user("El archivo de este documento ya no está en el almacenamiento de la aplicación."));
    }
    std::fs::read(&path).map_err(|e| {
        eprintln!("[company-documents] {e}");
        AppError::user("No fue posible leer el archivo del documento. Verifica los permisos de la carpeta de datos.")
    })
}

pub fn remove(dir: &Path, name: &str) {
    if let Ok(path) = path_for(dir, name) {
        let _ = std::fs::remove_file(path);
    }
}

/// Elimina archivos que ninguna versión referencia (formularios cancelados).
pub fn remove_orphans(dir: &Path, referenced: &[String]) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_valid_name(&name) && !referenced.contains(&name) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("amd-company-docs-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stores_and_reads_a_pdf_and_rejects_others() {
        let dir = temp("rw");
        let name = import_from_bytes(&dir, b"%PDF-1.4 contenido").unwrap();
        assert!(is_valid_name(&name));
        assert_eq!(read(&dir, &name).unwrap(), b"%PDF-1.4 contenido");
        assert!(import_from_bytes(&dir, b"no es pdf").is_err());
        assert!(import_from_bytes(&dir, b"").is_err());
        assert!(read(&dir, "../../etc/passwd").is_err());
        remove(&dir, &name);
        assert!(read(&dir, &name).unwrap_err().0.contains("ya no está"));
    }

    #[test]
    fn rejects_oversized_files() {
        let dir = temp("big");
        let mut big = b"%PDF-".to_vec();
        big.resize(MAX_DOCUMENT_BYTES as usize + 1, 0);
        assert!(import_from_bytes(&dir, &big).unwrap_err().0.contains("20 MB"));
    }

    #[test]
    fn orphan_cleanup_keeps_referenced_versions() {
        let dir = temp("orphans");
        let kept = import_from_bytes(&dir, b"%PDF-1.4 a").unwrap();
        let orphan = import_from_bytes(&dir, b"%PDF-1.4 b").unwrap();
        remove_orphans(&dir, std::slice::from_ref(&kept));
        assert!(read(&dir, &kept).is_ok());
        assert!(read(&dir, &orphan).is_err());
    }
}
