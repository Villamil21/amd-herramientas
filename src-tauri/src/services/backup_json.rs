//! Backup portable en JSON: empresas (con logos), conceptos y configuración.

use std::collections::BTreeMap;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::database::{companies, concepts};
use crate::error::{AppError, AppResult};
use crate::models::company::{Company, CompanyInput};
use crate::models::concept::{Concept, ConceptInput};
use crate::services::logos;
use crate::services::time::now_iso;
use crate::startup::LAST_RUN_VERSION_KEY;

pub const FORMAT: &str = "amd-herramientas-backup";
pub const FORMAT_VERSION: u32 = 1;
/// Claves internas que describen esta instalación, no preferencias del usuario.
const INTERNAL_SETTINGS: &[&str] = &[LAST_RUN_VERSION_KEY];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogoBlob {
    pub ext: String,
    pub data_base64: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanyBackup {
    #[serde(flatten)]
    pub company: Company,
    pub logo: Option<LogoBlob>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub format: String,
    pub format_version: u32,
    pub app_version: String,
    pub exported_at: String,
    pub companies: Vec<CompanyBackup>,
    pub concepts: Vec<Concept>,
    #[serde(default)]
    pub settings: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub file_name: String,
    pub app_version: String,
    pub exported_at: String,
    pub companies: usize,
    pub concepts: usize,
    pub settings: usize,
}

pub fn build(conn: &Connection, logos_dir: &Path, app_version: &str) -> AppResult<BackupFile> {
    let mut out = Vec::new();
    for company in companies::list(conn, None)? {
        let logo = match &company.logo_file {
            Some(name) => {
                let path = logos::path_for(logos_dir, name)?;
                if path.exists() {
                    Some(LogoBlob {
                        ext: name.rsplit_once('.').map(|(_, e)| e.to_string()).unwrap_or_default(),
                        data_base64: STANDARD.encode(std::fs::read(path)?),
                    })
                } else {
                    None
                }
            }
            None => None,
        };
        out.push(CompanyBackup { company, logo });
    }

    let mut settings = BTreeMap::new();
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = row?;
        if !INTERNAL_SETTINGS.contains(&k.as_str()) {
            settings.insert(k, v);
        }
    }

    Ok(BackupFile {
        format: FORMAT.into(),
        format_version: FORMAT_VERSION,
        app_version: app_version.into(),
        exported_at: now_iso(),
        companies: out,
        concepts: concepts::list(conn, None)?,
        settings,
    })
}

pub fn parse(bytes: &[u8]) -> AppResult<BackupFile> {
    let file: BackupFile = serde_json::from_slice(bytes)
        .map_err(|_| AppError::user("El archivo no es un backup válido de AMD Módulos."))?;
    if file.format != FORMAT {
        return Err(AppError::user("El archivo no es un backup válido de AMD Módulos."));
    }
    if file.format_version > FORMAT_VERSION {
        return Err(AppError::user(
            "El backup fue creado con una versión más reciente de la aplicación. Actualiza la aplicación e inténtalo de nuevo.",
        ));
    }
    // Valida todo antes de tocar la base.
    for c in &file.companies {
        company_input(&c.company).validated().map_err(|e| {
            AppError::user(format!("Empresa «{}» del backup: {}", c.company.razon_social, e.0))
        })?;
    }
    for c in &file.concepts {
        concept_input(c)
            .validated()
            .map_err(|e| AppError::user(format!("Concepto «{}» del backup: {}", c.nombre, e.0)))?;
    }
    Ok(file)
}

fn company_input(c: &Company) -> CompanyInput {
    CompanyInput {
        razon_social: c.razon_social.clone(),
        nit: c.nit.clone(),
        direccion: c.direccion.clone(),
        ciudad: c.ciudad.clone(),
        telefono: c.telefono.clone(),
        correo: c.correo.clone(),
        info_adicional: c.info_adicional.clone(),
        logo_file: None,
        dv: c.dv.clone(),
        subscribed_total_shares: c.subscribed_total_shares,
        subscribed_nominal_value: c.subscribed_nominal_value,
        paid_total_shares: c.paid_total_shares,
        paid_nominal_value: c.paid_nominal_value,
        shareholders: c.shareholders.clone(),
    }
}

fn concept_input(c: &Concept) -> ConceptInput {
    ConceptInput {
        nombre: c.nombre.clone(),
        tipo_retencion: c.tipo_retencion.clone(),
        tarifa_predeterminada: c.tarifa_predeterminada,
        unidad_tarifa: c.unidad_tarifa.clone(),
    }
}

pub fn summary(file_name: &str, file: &BackupFile) -> BackupSummary {
    BackupSummary {
        file_name: file_name.into(),
        app_version: file.app_version.clone(),
        exported_at: file.exported_at.clone(),
        companies: file.companies.len(),
        concepts: file.concepts.len(),
        settings: file.settings.len(),
    }
}

/// Reemplaza empresas, conceptos y configuración en una sola transacción.
pub fn restore(conn: &mut Connection, logos_dir: &Path, file: &BackupFile) -> AppResult<()> {
    // 1. Escribir logos nuevos (si algo falla después, se eliminan).
    let mut new_logos: Vec<Option<String>> = Vec::new();
    let cleanup = |names: &[Option<String>]| names.iter().flatten().for_each(|n| logos::remove(logos_dir, n));
    for c in &file.companies {
        let name = match &c.logo {
            Some(blob) => {
                let bytes = STANDARD
                    .decode(&blob.data_base64)
                    .map_err(|_| AppError::user("Un logo del backup está dañado."));
                match bytes.and_then(|b| logos::import_from_bytes(logos_dir, &blob.ext.to_ascii_lowercase(), &b)) {
                    Ok(n) => Some(n),
                    Err(e) => {
                        cleanup(&new_logos);
                        return Err(e);
                    }
                }
            }
            None => None,
        };
        new_logos.push(name);
    }

    let old_logos: Vec<String> = conn
        .prepare("SELECT logo_file FROM companies WHERE logo_file IS NOT NULL")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;

    // 2. Reemplazar datos en transacción.
    let result = (|| -> AppResult<()> {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM companies", [])?;
        tx.execute("DELETE FROM retention_concepts", [])?;
        let placeholders = INTERNAL_SETTINGS.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        tx.execute(
            &format!("DELETE FROM settings WHERE key NOT IN ({placeholders})"),
            rusqlite::params_from_iter(INTERNAL_SETTINGS.iter()),
        )?;
        for (c, logo) in file.companies.iter().zip(&new_logos) {
            let v = company_input(&c.company).validated()?;
            companies::insert_full(
                &tx,
                &Company {
                    id: c.company.id,
                    razon_social: v.razon_social,
                    nit: v.nit,
                    direccion: v.direccion,
                    ciudad: v.ciudad,
                    telefono: v.telefono,
                    correo: v.correo,
                    info_adicional: v.info_adicional,
                    logo_file: logo.clone(),
                    dv: v.dv,
                    subscribed_total_shares: v.subscribed_total_shares,
                    subscribed_nominal_value: v.subscribed_nominal_value,
                    paid_total_shares: v.paid_total_shares,
                    paid_nominal_value: v.paid_nominal_value,
                    shareholders: v.shareholders,
                    created_at: c.company.created_at.clone(),
                    updated_at: c.company.updated_at.clone(),
                },
            )?;
        }
        for c in &file.concepts {
            let v = concept_input(c).validated()?;
            concepts::insert_full(
                &tx,
                &Concept {
                    id: c.id,
                    nombre: v.nombre,
                    tipo_retencion: v.tipo_retencion,
                    tarifa_predeterminada: v.tarifa_predeterminada,
                    unidad_tarifa: v.unidad_tarifa,
                    created_at: c.created_at.clone(),
                    updated_at: c.updated_at.clone(),
                },
            )?;
        }
        for (k, v) in &file.settings {
            if !INTERNAL_SETTINGS.contains(&k.as_str()) {
                crate::database::set_setting(&tx, k, v)?;
            }
        }
        tx.commit()?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            old_logos.iter().for_each(|n| logos::remove(logos_dir, n));
            Ok(())
        }
        Err(e) => {
            cleanup(&new_logos);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_pending;

    const PNG_1PX: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1,
        8, 6, 0, 0, 0, 0x1F, 0x15, 0xC4, 0x89,
    ];

    #[test]
    fn export_then_restore_roundtrip() {
        let dir = std::env::temp_dir().join(format!("amd-json-bk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();

        let logo = logos::import_from_bytes(&dir, "png", PNG_1PX).unwrap();
        companies::insert(
            &conn,
            &CompanyInput {
                razon_social: "Empresa A".into(),
                nit: "900".into(),
                direccion: String::new(),
                ciudad: "Cali".into(),
                telefono: String::new(),
                correo: String::new(),
                info_adicional: String::new(),
                logo_file: Some(logo.clone()),
                dv: "1".into(),
                subscribed_total_shares: None,
                subscribed_nominal_value: None,
                paid_total_shares: None,
                paid_nominal_value: None,
                shareholders: vec![],
            },
        )
        .unwrap();
        concepts::insert(
            &conn,
            &ConceptInput {
                nombre: "ICA".into(),
                tipo_retencion: "ICA".into(),
                tarifa_predeterminada: Some(9.66),
                unidad_tarifa: "POR_MIL".into(),
            },
        )
        .unwrap();
        crate::database::set_setting(&conn, LAST_RUN_VERSION_KEY, "1.0.0").unwrap();

        let backup = build(&conn, &dir, "1.0.0").unwrap();
        assert!(!backup.settings.contains_key(LAST_RUN_VERSION_KEY));
        let json = serde_json::to_vec(&backup).unwrap();
        let parsed = parse(&json).unwrap();

        restore(&mut conn, &dir, &parsed).unwrap();
        let restored = companies::list(&conn, None).unwrap();
        assert_eq!(restored.len(), 1);
        let new_logo = restored[0].logo_file.clone().unwrap();
        assert_ne!(new_logo, logo, "el logo se reescribe con un nombre nuevo");
        assert!(dir.join(&new_logo).exists());
        assert!(!dir.join(&logo).exists(), "el logo anterior se elimina");
        assert_eq!(concepts::list(&conn, None).unwrap()[0].tarifa_predeterminada, Some(9.66));
        assert_eq!(
            crate::database::get_setting(&conn, LAST_RUN_VERSION_KEY).unwrap().as_deref(),
            Some("1.0.0"),
            "las claves internas se conservan"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_foreign_json() {
        assert!(parse(br#"{"hello": 1}"#).is_err());
    }
}
