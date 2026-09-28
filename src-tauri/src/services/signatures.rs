//! Imágenes PNG de firmas: archivos dentro de <datos>/signatures, referenciados
//! por nombre (`<32 hex>.png`) desde SQLite. Nunca se guardan rutas absolutas ni
//! se depende del archivo original que eligió el usuario.
//!
//! Flujo: al seleccionar, el PNG se valida y se copia aquí con un nombre nuevo
//! (aún sin referencia). Al guardar, SQLite pasa a apuntar a ese archivo y solo
//! entonces se elimina el anterior. Si el usuario cancela, el archivo nuevo queda
//! sin referencia y se limpia en el siguiente arranque; el anterior no se toca.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};

use crate::error::{AppError, AppResult};
use crate::services::logos;

pub const MAX_SIGNATURE_BYTES: u64 = 5 * 1024 * 1024;
const INVALID_PNG: &str = "El archivo seleccionado no es un PNG válido.";

/// Solo acepta nombres generados por la app: 32 hex + `.png`.
pub fn is_valid_name(name: &str) -> bool {
    name.strip_suffix(".png")
        .is_some_and(|stem| stem.len() == 32 && stem.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()))
}

fn path_for(dir: &Path, name: &str) -> Option<PathBuf> {
    is_valid_name(name).then(|| dir.join(name))
}

fn random_name() -> AppResult<String> {
    let mut buf = [0u8; 16];
    getrandom::fill(&mut buf).map_err(|_| AppError::user("No fue posible guardar la imagen de la firma."))?;
    let hex: String = buf.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{hex}.png"))
}

/// Decodifica el PNG completo: descarta archivos renombrados o dañados.
pub fn is_valid_png(bytes: &[u8]) -> bool {
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return false;
    }
    let Ok(mut reader) = png::Decoder::new(std::io::Cursor::new(bytes)).read_info() else {
        return false;
    };
    let mut buf = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut buf).is_ok()
}

/// Valida y guarda una copia exacta (sin recortar ni convertir) en el directorio de firmas.
pub fn import_from_bytes(dir: &Path, bytes: &[u8]) -> AppResult<String> {
    if bytes.len() as u64 > MAX_SIGNATURE_BYTES {
        return Err(AppError::user("La firma supera el tamaño máximo de 5 MB."));
    }
    if !is_valid_png(bytes) {
        return Err(AppError::user(INVALID_PNG));
    }
    let name = random_name()?;
    let final_path = dir.join(&name);
    // Escritura atómica: nunca queda un PNG a medias con nombre definitivo.
    let tmp = dir.join(format!(".{name}.tmp"));
    let written = std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, &final_path));
    if let Err(e) = written {
        eprintln!("[signatures] {e}");
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::user("No fue posible guardar la imagen de la firma."));
    }
    Ok(name)
}

pub fn import_from_path(dir: &Path, source: &Path) -> AppResult<String> {
    let is_png = source.extension().is_some_and(|e| e.eq_ignore_ascii_case("png"));
    let meta = std::fs::metadata(source).map_err(|_| AppError::user("No fue posible cargar la firma. Intenta seleccionarla nuevamente."))?;
    if !is_png || !meta.is_file() {
        return Err(AppError::user(INVALID_PNG));
    }
    if meta.len() > MAX_SIGNATURE_BYTES {
        return Err(AppError::user("La firma supera el tamaño máximo de 5 MB."));
    }
    let bytes = std::fs::read(source).map_err(|_| AppError::user("No fue posible cargar la firma. Intenta seleccionarla nuevamente."))?;
    import_from_bytes(dir, &bytes)
}

/// Bytes del PNG guardado, solo si existe y sigue siendo un PNG válido.
pub fn read_valid(dir: &Path, name: &str) -> Option<Vec<u8>> {
    let bytes = std::fs::read(path_for(dir, name)?).ok()?;
    is_valid_png(&bytes).then_some(bytes)
}

pub fn is_available(dir: &Path, name: &str) -> bool {
    path_for(dir, name).is_some_and(|p| p.is_file())
}

pub fn read_data_url(dir: &Path, name: &str) -> Option<String> {
    read_valid(dir, name).map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

/// Comprueba que la firma referenciada exista antes de registrarla en SQLite.
pub fn ensure_exists(dir: &Path, name: &str) -> AppResult<()> {
    if read_valid(dir, name).is_none() {
        return Err(AppError::user("La imagen de firma guardada ya no está disponible."));
    }
    Ok(())
}

/// Eliminar un archivo que ya no existe no es un error.
pub fn remove(dir: &Path, name: &str) {
    if let Some(path) = path_for(dir, name) {
        let _ = std::fs::remove_file(path);
    }
}

/// Elimina firmas que ningún firmante referencia (selecciones canceladas) y temporales.
pub fn remove_orphans(dir: &Path, referenced: &[String]) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let stale_tmp = name.starts_with('.') && name.ends_with(".png.tmp");
        if stale_tmp || (is_valid_name(&name) && !referenced.contains(&name)) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Migración de versiones anteriores, que guardaban la firma junto a los logos.
/// Si el archivo antiguo existe se mueve a `signatures/`; si no, el firmante se
/// conserva y queda como «firma faltante». Devuelve cuántas se migraron.
pub fn migrate_legacy(dir: &Path, logos_dir: &Path, referenced: &[String]) -> usize {
    let mut moved = 0;
    for name in referenced {
        if !is_valid_name(name) || dir.join(name).exists() {
            continue;
        }
        let Ok(old) = logos::path_for(logos_dir, name) else { continue };
        let Ok(bytes) = std::fs::read(&old) else { continue };
        if !is_valid_png(&bytes) {
            continue;
        }
        let tmp = dir.join(format!(".{name}.tmp"));
        if std::fs::write(&tmp, &bytes).and_then(|_| std::fs::rename(&tmp, dir.join(name))).is_ok() {
            let _ = std::fs::remove_file(old);
            moved += 1;
        } else {
            let _ = std::fs::remove_file(&tmp);
        }
    }
    moved
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// PNG RGBA de 1×1 px, transparente.
    pub fn png_1px() -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[0, 0, 0, 0]).unwrap();
        writer.finish().unwrap();
        out
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("amd-sig-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn names() {
        assert!(is_valid_name("0123456789abcdef0123456789abcdef.png"));
        assert!(!is_valid_name("0123456789abcdef0123456789abcdef.jpg"));
        assert!(!is_valid_name("../0123456789abcdef0123456789abcd.png"));
        assert!(!is_valid_name(""));
    }

    #[test]
    fn decodes_real_png_and_rejects_fakes() {
        assert!(is_valid_png(&png_1px()));
        assert!(!is_valid_png(b"\x89PNG\r\n\x1a\nnot really"));
        assert!(!is_valid_png(&[0xFF, 0xD8, 0xFF, 0xE0]));
        let dir = temp_dir("fake");
        assert!(import_from_bytes(&dir, b"hola").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn copy_survives_deleting_the_original() {
        let dir = temp_dir("copy");
        let original = dir.join("firma-escritorio.png");
        let png = png_1px();
        std::fs::write(&original, &png).unwrap();
        let store = dir.join("signatures");
        std::fs::create_dir_all(&store).unwrap();
        let name = import_from_path(&store, &original).unwrap();
        std::fs::remove_file(&original).unwrap();
        assert_eq!(read_valid(&store, &name), Some(png), "copia idéntica, sin modificar");
        assert!(read_data_url(&store, &name).unwrap().starts_with("data:image/png;base64,"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn orphans_keep_referenced() {
        let dir = temp_dir("orphans");
        let kept = import_from_bytes(&dir, &png_1px()).unwrap();
        let cancelled = import_from_bytes(&dir, &png_1px()).unwrap();
        remove_orphans(&dir, &[kept.clone()]);
        assert!(dir.join(&kept).exists());
        assert!(!dir.join(&cancelled).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn migrates_legacy_signatures_from_logos() {
        let root = temp_dir("legacy");
        let (store, logos_dir) = (root.join("signatures"), root.join("logos"));
        std::fs::create_dir_all(&store).unwrap();
        std::fs::create_dir_all(&logos_dir).unwrap();
        let present = logos::import_from_bytes(&logos_dir, "png", &png_1px()).unwrap();
        let missing = "0123456789abcdef0123456789abcdef.png".to_string();
        assert_eq!(migrate_legacy(&store, &logos_dir, &[present.clone(), missing.clone()]), 1);
        assert!(is_available(&store, &present));
        assert!(!logos_dir.join(&present).exists());
        assert!(!is_available(&store, &missing));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
