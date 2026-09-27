//! Logos de empresas: archivos dentro de <datos>/logos, referenciados por
//! nombre desde SQLite. Nunca se guardan rutas absolutas.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};

use crate::error::{AppError, AppResult};

pub const MAX_LOGO_BYTES: u64 = 5 * 1024 * 1024;

pub fn mime_for(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        _ => None,
    }
}

fn ext_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// Solo acepta nombres generados por la app: 32 hex + extensión permitida.
pub fn is_valid_logo_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    stem.len() == 32
        && stem.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        && mime_for(ext).is_some()
}

fn random_name(ext: &str) -> AppResult<String> {
    let mut buf = [0u8; 16];
    getrandom::fill(&mut buf).map_err(|_| AppError::user("No se pudo guardar el logo."))?;
    let hex: String = buf.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{hex}.{ext}"))
}

fn check_signature(bytes: &[u8], ext: &str) -> bool {
    match ext {
        "png" => bytes.starts_with(&[0x89, b'P', b'N', b'G']),
        "jpg" | "jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        _ => false,
    }
}

/// Valida y copia una imagen elegida por el usuario al directorio de logos.
pub fn import_from_bytes(logos_dir: &Path, ext: &str, bytes: &[u8]) -> AppResult<String> {
    let ext = if ext == "jpeg" { "jpg" } else { ext };
    if mime_for(ext).is_none() {
        return Err(AppError::user("El logo debe ser una imagen PNG o JPG."));
    }
    if bytes.len() as u64 > MAX_LOGO_BYTES {
        return Err(AppError::user("El logo supera el tamaño máximo de 5 MB."));
    }
    if !check_signature(bytes, ext) {
        return Err(AppError::user("El archivo seleccionado no es una imagen PNG o JPG válida."));
    }
    let name = random_name(ext)?;
    std::fs::write(logos_dir.join(&name), bytes)?;
    Ok(name)
}

pub fn import_from_path(logos_dir: &Path, source: &Path) -> AppResult<String> {
    let meta = std::fs::metadata(source)?;
    if !meta.is_file() {
        return Err(AppError::user("Selecciona un archivo de imagen."));
    }
    if meta.len() > MAX_LOGO_BYTES {
        return Err(AppError::user("El logo supera el tamaño máximo de 5 MB."));
    }
    let bytes = std::fs::read(source)?;
    import_from_bytes(logos_dir, &ext_of(source), &bytes)
}

pub fn path_for(logos_dir: &Path, name: &str) -> AppResult<PathBuf> {
    if !is_valid_logo_name(name) {
        return Err(AppError::user("La referencia del logo no es válida."));
    }
    Ok(logos_dir.join(name))
}

pub fn read_data_url(logos_dir: &Path, name: &str) -> AppResult<Option<String>> {
    let path = path_for(logos_dir, name)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)?;
    let mime = mime_for(&ext_of(&path)).unwrap_or("image/png");
    Ok(Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes))))
}

pub fn remove(logos_dir: &Path, name: &str) {
    if let Ok(path) = path_for(logos_dir, name) {
        let _ = std::fs::remove_file(path);
    }
}

/// Elimina logos que ninguna empresa referencia (p. ej. formularios cancelados).
pub fn remove_orphans(logos_dir: &Path, referenced: &[String]) {
    let Ok(entries) = std::fs::read_dir(logos_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_valid_logo_name(&name) && !referenced.contains(&name) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logo_names() {
        assert!(is_valid_logo_name("0123456789abcdef0123456789abcdef.png"));
        assert!(!is_valid_logo_name("../../etc/passwd"));
        assert!(!is_valid_logo_name("0123456789abcdef0123456789abcdef.gif"));
        assert!(!is_valid_logo_name("0123456789ABCDEF0123456789abcdef.png"));
    }

    #[test]
    fn rejects_fake_images() {
        let dir = std::env::temp_dir();
        assert!(import_from_bytes(&dir, "png", b"not a png").is_err());
    }
}
