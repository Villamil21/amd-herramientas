//! Backup portable en JSON: empresas (con logos), conceptos, firmantes (con su
//! PNG), proveedores (con su configuración de retención), clasificación de
//! estados de Dropi, tabla de retenciones, UVT por año, títulos Factura / Nota,
//! tipos de documento de identidad, Tabla de Autorretenciones, tipos de
//! documento de Ventas y configuración.

use std::collections::BTreeMap;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::database::{companies, concepts, dropi, identity_documents, puc, self_withholding, signers, suppliers, vat_titles, withholding};
use crate::error::{AppError, AppResult};
use crate::models::company::{Company, CompanyInput};
use crate::models::concept::{Concept, ConceptInput};
use crate::models::dropi::{DropiStatusMapping, DropiStatusMappingInput};
use crate::models::identity_document::{IdentityDocumentType, IdentityDocumentTypeInput};
use crate::models::self_withholding::{
    normalize_ciiu, SalesDocumentTypeMapping, SalesDocumentTypeMappingInput, SelfWithholdingRate, SelfWithholdingRateInput,
};
use crate::models::signer::{CertificateSigner, CertificateSignerInput};
use crate::models::puc::SupplierPucCode;
use crate::models::supplier::{normalize_nit, Supplier, SupplierInput};
use crate::models::withholding::{
    validate_uvt, DocumentTitleMapping, DocumentTitleMappingInput, SupplierWithholdingRuleInput, UvtValue, WithholdingProfileInput,
    WithholdingRate, WithholdingRateInput,
};
use crate::services::{logos, signatures};
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

/// Firmante con su PNG embebido: el backup no depende de rutas de este Mac.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignerBackup {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub professional_document: String,
    /// Ausente en backups anteriores al certificado de ingresos.
    #[serde(default)]
    pub personal_document: String,
    pub created_at: String,
    pub updated_at: String,
    /// PNG en base64; `None` si la firma ya faltaba al exportar.
    pub signature_png_base64: Option<String>,
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
    /// `None` en backups anteriores a las firmas: al restaurarlos no se tocan los firmantes actuales.
    #[serde(default)]
    pub signers: Option<Vec<SignerBackup>>,
    /// `None` en backups anteriores a los proveedores: al restaurarlos no se tocan los proveedores actuales.
    #[serde(default)]
    pub suppliers: Option<Vec<Supplier>>,
    /// Dropi status mappings. `None` en backups anteriores: al restaurarlos no se tocan las reglas actuales.
    #[serde(default)]
    pub dropi_status_mappings: Option<Vec<DropiStatusMapping>>,
    /// Retención en la fuente. `None` en backups anteriores: al restaurarlos se conservan los datos actuales.
    #[serde(default)]
    pub withholding_rates: Option<Vec<WithholdingRate>>,
    #[serde(default)]
    pub uvt_values: Option<Vec<UvtValue>>,
    #[serde(default)]
    pub document_title_mappings: Option<Vec<DocumentTitleMapping>>,
    /// Tipos de documento del certificado de ingresos. `None` en backups anteriores: se conservan los actuales.
    #[serde(default)]
    pub identity_document_types: Option<Vec<IdentityDocumentType>>,
    /// Retención en la fuente ventas. `None` en backups anteriores: se conservan la tabla y las clasificaciones actuales.
    #[serde(default)]
    pub self_withholding_rates: Option<Vec<SelfWithholdingRate>>,
    #[serde(default)]
    pub sales_document_types: Option<Vec<SalesDocumentTypeMapping>>,
    /// IVA de compras: títulos clasificados como Factura electrónica / Nota crédito. `None` en backups anteriores: se conservan los actuales.
    #[serde(default)]
    pub vat_document_titles: Option<Vec<DocumentTitleMapping>>,
    /// Códigos PUC por factura: títulos clasificados como Factura electrónica / Nota crédito. `None` en backups anteriores: se conservan los actuales.
    /// El catálogo PUC no va en el backup: es una tabla fija de la app.
    #[serde(default)]
    pub puc_document_titles: Option<Vec<DocumentTitleMapping>>,
    /// Códigos PUC usados con cada proveedor (identificado por su NIT). `None` en backups anteriores: se conservan los actuales.
    #[serde(default)]
    pub supplier_puc_codes: Option<Vec<SupplierPucCode>>,
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
    /// `None` si el backup es anterior a las firmas.
    pub signers: Option<usize>,
    /// `None` si el backup es anterior a los proveedores.
    pub suppliers: Option<usize>,
    /// `None` si el backup es anterior a la clasificación de estados de Dropi.
    pub dropi_status_mappings: Option<usize>,
    /// `None` si el backup es anterior a Retención en la fuente.
    pub withholding_rates: Option<usize>,
    pub uvt_values: Option<usize>,
    pub document_title_mappings: Option<usize>,
    /// `None` si el backup es anterior al certificado de ingresos.
    pub identity_document_types: Option<usize>,
    /// `None` si el backup es anterior a Retención en la fuente ventas.
    pub self_withholding_rates: Option<usize>,
    pub sales_document_types: Option<usize>,
    /// `None` si el backup es anterior a la clasificación de títulos de IVA de compras.
    pub vat_document_titles: Option<usize>,
    /// `None` si el backup es anterior a Códigos PUC por factura.
    pub puc_document_titles: Option<usize>,
    /// `None` si el backup es anterior a los códigos PUC por proveedor.
    pub supplier_puc_codes: Option<usize>,
}

pub fn build(conn: &Connection, logos_dir: &Path, signatures_dir: &Path, app_version: &str) -> AppResult<BackupFile> {
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
        signers: Some(
            signers::list(conn, None)?
                .into_iter()
                .map(|s| SignerBackup {
                    signature_png_base64: signatures::read_valid(signatures_dir, &s.signature_file).map(|b| STANDARD.encode(b)),
                    id: s.id,
                    name: s.name,
                    role: s.role,
                    professional_document: s.professional_document,
                    personal_document: s.personal_document,
                    created_at: s.created_at,
                    updated_at: s.updated_at,
                })
                .collect(),
        ),
        suppliers: Some(suppliers::list(conn, None)?),
        dropi_status_mappings: Some(dropi::list(conn)?),
        withholding_rates: Some(withholding::list_rates(conn)?),
        uvt_values: Some(withholding::list_uvt(conn)?),
        document_title_mappings: Some(withholding::list_titles(conn)?),
        identity_document_types: Some(identity_documents::list(conn)?),
        self_withholding_rates: Some(self_withholding::list_rates(conn)?),
        sales_document_types: Some(self_withholding::list_types(conn)?),
        vat_document_titles: Some(vat_titles::list(conn)?),
        puc_document_titles: Some(puc::list_titles(conn)?),
        supplier_puc_codes: Some(puc::list_all_supplier_codes(conn)?),
    })
}

fn supplier_input(s: &Supplier) -> SupplierInput {
    SupplierInput { nit: s.nit.clone(), business_name: s.business_name.clone(), vat_type: s.vat_type.clone() }
}

fn supplier_profile(s: &Supplier) -> WithholdingProfileInput {
    WithholdingProfileInput {
        person_type: s.person_type.clone(),
        rules: s
            .withholding_rules
            .iter()
            .map(|r| SupplierWithholdingRuleInput { rate_id: r.rate_id, base_mode: r.base_mode.clone(), is_default: r.is_default })
            .collect(),
    }
}

fn rate_input(r: &WithholdingRate) -> WithholdingRateInput {
    WithholdingRateInput { retention_type: r.retention_type.clone(), name: r.name.clone(), base_uvt_centi: r.base_uvt_centi, rate_bp: r.rate_bp }
}

fn title_input(m: &DocumentTitleMapping) -> DocumentTitleMappingInput {
    DocumentTitleMappingInput { normalized_title: m.normalized_title.clone(), display_title: m.display_title.clone(), category: m.category.clone() }
}

fn dropi_input(m: &DropiStatusMapping) -> DropiStatusMappingInput {
    DropiStatusMappingInput {
        normalized_status: m.normalized_status.clone(),
        display_status: m.display_status.clone(),
        category: m.category.clone(),
    }
}

fn self_rate_input(r: &SelfWithholdingRate) -> SelfWithholdingRateInput {
    SelfWithholdingRateInput { ciiu_code: r.ciiu_code.clone(), economic_activity: r.economic_activity.clone(), rate_bp: r.rate_bp }
}

fn sales_type_input(m: &SalesDocumentTypeMapping) -> SalesDocumentTypeMappingInput {
    SalesDocumentTypeMappingInput { normalized_label: m.normalized_label.clone(), original_label: m.original_label.clone(), category: m.category.clone() }
}

fn signer_input(s: &SignerBackup) -> CertificateSignerInput {
    CertificateSignerInput {
        name: s.name.clone(),
        role: s.role.clone(),
        professional_document: s.professional_document.clone(),
        personal_document: s.personal_document.clone(),
        // Marcador para validar nombre, cargo y documento; el archivo real se asigna al restaurar.
        signature_file: "-".into(),
    }
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
    for s in file.signers.iter().flatten() {
        signer_input(s)
            .validated()
            .map_err(|e| AppError::user(format!("Firmante «{}» del backup: {}", s.name, e.0)))?;
    }
    let mut nits = std::collections::HashSet::new();
    for s in file.suppliers.iter().flatten() {
        let v = supplier_input(s)
            .validated()
            .map_err(|e| AppError::user(format!("Proveedor «{}» del backup: {}", s.business_name, e.0)))?;
        if !nits.insert(v.nit.clone()) {
            return Err(AppError::user(format!("El backup tiene dos proveedores con el NIT {}.", v.nit)));
        }
        supplier_profile(s)
            .validated()
            .map_err(|e| AppError::user(format!("Proveedor «{}» del backup: {}", s.business_name, e.0)))?;
    }
    let mut rate_names = std::collections::HashSet::new();
    for r in file.withholding_rates.iter().flatten() {
        let v = rate_input(r)
            .validated()
            .map_err(|e| AppError::user(format!("Concepto de retención «{}» del backup: {}", r.name, e.0)))?;
        if !rate_names.insert((v.retention_type, v.name.to_lowercase())) {
            return Err(AppError::user(format!("El backup tiene repetido el concepto de retención «{}».", r.name)));
        }
    }
    let mut years = std::collections::HashSet::new();
    for u in file.uvt_values.iter().flatten() {
        validate_uvt(u.year, u.value_pesos).map_err(|e| AppError::user(format!("UVT {} del backup: {}", u.year, e.0)))?;
        if !years.insert(u.year) {
            return Err(AppError::user(format!("El backup tiene dos valores UVT para {}.", u.year)));
        }
    }
    let mut titles = std::collections::HashSet::new();
    for m in file.document_title_mappings.iter().flatten() {
        let v = title_input(m)
            .validated()
            .map_err(|e| AppError::user(format!("Título «{}» del backup: {}", m.display_title, e.0)))?;
        if !titles.insert(v.normalized_title.clone()) {
            return Err(AppError::user(format!("El backup tiene dos clasificaciones para el título «{}».", v.display_title)));
        }
    }
    let mut vat_titles_seen = std::collections::HashSet::new();
    for m in file.vat_document_titles.iter().flatten() {
        let v = title_input(m)
            .validated()
            .map_err(|e| AppError::user(format!("Título de IVA «{}» del backup: {}", m.display_title, e.0)))?;
        if !vat_titles_seen.insert(v.normalized_title.clone()) {
            return Err(AppError::user(format!("El backup tiene dos clasificaciones de IVA para el título «{}».", v.display_title)));
        }
    }
    let mut puc_titles_seen = std::collections::HashSet::new();
    for m in file.puc_document_titles.iter().flatten() {
        let v = title_input(m)
            .validated()
            .map_err(|e| AppError::user(format!("Título de Códigos PUC «{}» del backup: {}", m.display_title, e.0)))?;
        if !puc_titles_seen.insert(v.normalized_title.clone()) {
            return Err(AppError::user(format!("El backup tiene dos clasificaciones de Códigos PUC para el título «{}».", v.display_title)));
        }
    }
    let mut statuses = std::collections::HashSet::new();
    for m in file.dropi_status_mappings.iter().flatten() {
        let v = dropi_input(m)
            .validated()
            .map_err(|e| AppError::user(format!("Estado de Dropi «{}» del backup: {}", m.display_status, e.0)))?;
        if !statuses.insert(v.normalized_status.clone()) {
            return Err(AppError::user(format!("El backup tiene dos reglas para el estado de Dropi «{}».", v.display_status)));
        }
    }
    let mut type_names = std::collections::HashSet::new();
    for t in file.identity_document_types.iter().flatten() {
        let v = identity_type_input(t)
            .validated()
            .map_err(|e| AppError::user(format!("Tipo de documento «{}» del backup: {}", t.name, e.0)))?;
        if !type_names.insert(v.name.to_lowercase()) {
            return Err(AppError::user(format!("El backup tiene repetido el tipo de documento «{}».", v.name)));
        }
    }
    let mut ciiu_codes = std::collections::HashSet::new();
    for r in file.self_withholding_rates.iter().flatten() {
        self_rate_input(r)
            .validated()
            .map_err(|e| AppError::user(format!("Código CIIU {} de la Tabla de Autorretenciones del backup: {}", r.ciiu_code, e.0)))?;
        if !ciiu_codes.insert(normalize_ciiu(&r.ciiu_code)) {
            return Err(AppError::user(format!("El backup tiene repetido el Código CIIU {} en la Tabla de Autorretenciones.", r.ciiu_code)));
        }
    }
    let mut sales_types = std::collections::HashSet::new();
    for m in file.sales_document_types.iter().flatten() {
        let v = sales_type_input(m)
            .validated()
            .map_err(|e| AppError::user(format!("Tipo de documento de ventas «{}» del backup: {}", m.original_label, e.0)))?;
        if !sales_types.insert(v.normalized_label.clone()) {
            return Err(AppError::user(format!("El backup tiene dos clasificaciones para el tipo de documento «{}».", v.original_label)));
        }
    }
    Ok(file)
}

fn identity_type_input(t: &IdentityDocumentType) -> IdentityDocumentTypeInput {
    IdentityDocumentTypeInput { name: t.name.clone(), is_numeric: t.is_numeric }
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
        ciiu_code: c.ciiu_code.clone(),
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
        signers: file.signers.as_ref().map(Vec::len),
        suppliers: file.suppliers.as_ref().map(Vec::len),
        dropi_status_mappings: file.dropi_status_mappings.as_ref().map(Vec::len),
        withholding_rates: file.withholding_rates.as_ref().map(Vec::len),
        uvt_values: file.uvt_values.as_ref().map(Vec::len),
        document_title_mappings: file.document_title_mappings.as_ref().map(Vec::len),
        identity_document_types: file.identity_document_types.as_ref().map(Vec::len),
        self_withholding_rates: file.self_withholding_rates.as_ref().map(Vec::len),
        sales_document_types: file.sales_document_types.as_ref().map(Vec::len),
        vat_document_titles: file.vat_document_titles.as_ref().map(Vec::len),
        puc_document_titles: file.puc_document_titles.as_ref().map(Vec::len),
        supplier_puc_codes: file.supplier_puc_codes.as_ref().map(Vec::len),
    }
}

/// Escribe las firmas del backup en el almacenamiento actual. Si una falla, borra las ya escritas.
fn write_signatures(signatures_dir: &Path, list: &[SignerBackup]) -> AppResult<Vec<String>> {
    let mut written: Vec<String> = Vec::new();
    for s in list {
        let result = match &s.signature_png_base64 {
            Some(data) => STANDARD
                .decode(data)
                .map_err(|_| AppError::user(format!("La firma de «{}» en el backup está dañada.", s.name)))
                .and_then(|bytes| signatures::import_from_bytes(signatures_dir, &bytes)),
            // Ya faltaba al exportar: el firmante se restaura como «firma faltante».
            None => Ok(String::new()),
        };
        match result {
            Ok(name) => written.push(name),
            Err(e) => {
                written.iter().for_each(|n| signatures::remove(signatures_dir, n));
                return Err(e);
            }
        }
    }
    Ok(written)
}

/// Reemplaza empresas, conceptos, firmantes, proveedores, estados de Dropi, tipos de documento, autorretenciones y configuración en una sola transacción.
pub fn restore(conn: &mut Connection, logos_dir: &Path, signatures_dir: &Path, file: &BackupFile) -> AppResult<()> {
    // 1. Escribir firmas y logos nuevos (si algo falla después, se eliminan).
    let new_signatures = match &file.signers {
        Some(list) => write_signatures(signatures_dir, list)?,
        None => Vec::new(),
    };
    let mut new_logos: Vec<Option<String>> = Vec::new();
    let cleanup = |names: &[Option<String>]| {
        names.iter().flatten().for_each(|n| logos::remove(logos_dir, n));
        new_signatures.iter().for_each(|n| signatures::remove(signatures_dir, n));
    };
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
    let old_signatures: Vec<String> = match &file.signers {
        Some(_) => conn
            .prepare("SELECT signature_file FROM certificate_signers")?
            .query_map([], |r| r.get(0))?
            .collect::<Result<_, _>>()?,
        None => Vec::new(),
    };

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
                    ciiu_code: v.ciiu_code,
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
        if let Some(list) = &file.signers {
            tx.execute("DELETE FROM certificate_signers", [])?;
            for (s, signature_file) in list.iter().zip(&new_signatures) {
                let v = signer_input(s).validated()?;
                signers::insert_full(
                    &tx,
                    &CertificateSigner {
                        id: s.id,
                        name: v.name,
                        role: v.role,
                        professional_document: v.professional_document,
                        personal_document: v.personal_document,
                        signature_file: signature_file.clone(),
                        created_at: s.created_at.clone(),
                        updated_at: s.updated_at.clone(),
                        signature_available: false,
                    },
                )?;
            }
        }
        // Un backup anterior a los códigos PUC por proveedor reemplaza los proveedores:
        // los códigos actuales se guardan por NIT para devolverlos a los que sigan existiendo.
        let kept_puc_codes = if file.suppliers.is_some() && file.supplier_puc_codes.is_none() { Some(puc::list_all_supplier_codes(&tx)?) } else { None };
        if let Some(list) = &file.suppliers {
            tx.execute("DELETE FROM supplier_withholding_rules", [])?;
            tx.execute("DELETE FROM supplier_puc_codes", [])?;
            tx.execute("DELETE FROM suppliers", [])?;
            for s in list {
                let v = supplier_input(s).validated()?;
                let profile = supplier_profile(s).validated()?;
                suppliers::insert_full(
                    &tx,
                    &Supplier {
                        id: s.id,
                        nit: v.nit,
                        business_name: v.business_name,
                        vat_type: v.vat_type,
                        created_at: s.created_at.clone(),
                        updated_at: s.updated_at.clone(),
                        person_type: profile.person_type,
                        fiscal_regime: s.fiscal_regime.clone(),
                        fiscal_checked_at: s.fiscal_checked_at.clone(),
                        withholding_rules: s.withholding_rules.clone(),
                    },
                )?;
            }
        }
        if let Some(list) = &file.dropi_status_mappings {
            tx.execute("DELETE FROM dropi_status_mappings", [])?;
            for m in list {
                let v = dropi_input(m).validated()?;
                dropi::insert_full(
                    &tx,
                    &DropiStatusMapping {
                        id: m.id,
                        normalized_status: v.normalized_status,
                        display_status: v.display_status,
                        category: v.category,
                        created_at: m.created_at.clone(),
                        updated_at: m.updated_at.clone(),
                    },
                )?;
            }
        }
        if let Some(list) = &file.withholding_rates {
            tx.execute("DELETE FROM withholding_rates", [])?;
            for r in list {
                let v = rate_input(r).validated()?;
                withholding::insert_rate_full(
                    &tx,
                    &WithholdingRate {
                        id: r.id,
                        retention_type: v.retention_type,
                        name: v.name,
                        base_uvt_centi: v.base_uvt_centi,
                        rate_bp: v.rate_bp,
                        sort_order: r.sort_order,
                        created_at: r.created_at.clone(),
                        updated_at: r.updated_at.clone(),
                    },
                )?;
            }
        }
        if let Some(list) = &file.uvt_values {
            tx.execute("DELETE FROM uvt_values", [])?;
            for u in list {
                withholding::insert_uvt_full(&tx, u)?;
            }
        }
        if let Some(list) = &file.document_title_mappings {
            tx.execute("DELETE FROM document_title_mappings", [])?;
            for m in list {
                let v = title_input(m).validated()?;
                withholding::insert_title_full(
                    &tx,
                    &DocumentTitleMapping {
                        id: m.id,
                        normalized_title: v.normalized_title,
                        display_title: v.display_title,
                        category: v.category,
                        created_at: m.created_at.clone(),
                        updated_at: m.updated_at.clone(),
                    },
                )?;
            }
        }
        if let Some(list) = &file.vat_document_titles {
            tx.execute("DELETE FROM vat_document_title_mappings", [])?;
            for m in list {
                let v = title_input(m).validated()?;
                vat_titles::insert_full(
                    &tx,
                    &DocumentTitleMapping {
                        id: m.id,
                        normalized_title: v.normalized_title,
                        display_title: v.display_title,
                        category: v.category,
                        created_at: m.created_at.clone(),
                        updated_at: m.updated_at.clone(),
                    },
                )?;
            }
        }
        if let Some(list) = &file.puc_document_titles {
            tx.execute("DELETE FROM puc_document_title_mappings", [])?;
            for m in list {
                let v = title_input(m).validated()?;
                puc::insert_title_full(
                    &tx,
                    &DocumentTitleMapping {
                        id: m.id,
                        normalized_title: v.normalized_title,
                        display_title: v.display_title,
                        category: v.category,
                        created_at: m.created_at.clone(),
                        updated_at: m.updated_at.clone(),
                    },
                )?;
            }
        }
        if let Some(list) = file.supplier_puc_codes.as_ref().or(kept_puc_codes.as_ref()) {
            tx.execute("DELETE FROM supplier_puc_codes", [])?;
            for c in list {
                let supplier_nit = normalize_nit(&c.supplier_nit);
                if !supplier_nit.is_empty() {
                    puc::insert_supplier_code_full(&tx, &SupplierPucCode { supplier_nit, ..c.clone() })?;
                }
            }
        }
        if let Some(list) = &file.identity_document_types {
            tx.execute("DELETE FROM identity_document_types", [])?;
            for t in list {
                let v = identity_type_input(t).validated()?;
                identity_documents::insert_full(
                    &tx,
                    &IdentityDocumentType {
                        id: t.id,
                        name: v.name,
                        is_numeric: v.is_numeric,
                        is_system: t.is_system,
                        created_at: t.created_at.clone(),
                        updated_at: t.updated_at.clone(),
                    },
                )?;
            }
        }
        if let Some(list) = &file.self_withholding_rates {
            tx.execute("DELETE FROM self_withholding_rates", [])?;
            for r in list {
                let v = self_rate_input(r).validated()?;
                self_withholding::insert_rate_full(
                    &tx,
                    &SelfWithholdingRate {
                        id: r.id,
                        normalized_code: normalize_ciiu(&v.ciiu_code),
                        ciiu_code: v.ciiu_code,
                        economic_activity: v.economic_activity,
                        rate_bp: v.rate_bp,
                        source: r.source.clone(),
                        created_at: r.created_at.clone(),
                        updated_at: r.updated_at.clone(),
                    },
                )?;
            }
        }
        if let Some(list) = &file.sales_document_types {
            tx.execute("DELETE FROM sales_document_type_mappings", [])?;
            for m in list {
                let v = sales_type_input(m).validated()?;
                self_withholding::insert_type_full(
                    &tx,
                    &SalesDocumentTypeMapping {
                        id: m.id,
                        normalized_label: v.normalized_label,
                        original_label: v.original_label,
                        category: v.category,
                        created_at: m.created_at.clone(),
                        updated_at: m.updated_at.clone(),
                    },
                )?;
            }
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
            old_signatures.iter().for_each(|n| signatures::remove(signatures_dir, n));
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
                ciiu_code: "0111".into(),
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
        let sig_dir = dir.join("signatures");
        std::fs::create_dir_all(&sig_dir).unwrap();
        let signature_png = signatures::tests::png_1px();
        let signature = signatures::import_from_bytes(&sig_dir, &signature_png).unwrap();
        signers::insert(
            &conn,
            &CertificateSignerInput {
                name: "Leidy Villamil".into(),
                role: "Contadora Pública".into(),
                professional_document: "TP-290048".into(),
                personal_document: "CC 1.192.729.629".into(),
                signature_file: signature.clone(),
            },
        )
        .unwrap();

        suppliers::insert(&conn, &SupplierInput { nit: "900319753".into(), business_name: "PRICESMART COLOMBIA S.A.S.".into(), vat_type: Some("purchase".into()) }).unwrap();
        let rule = |status: &str, category: &str| DropiStatusMappingInput {
            normalized_status: status.into(),
            display_status: status.into(),
            category: category.into(),
        };
        dropi::save_many(&mut conn, &[rule("EN TERMINAL DESTINO", "in_process"), rule("RECLAME EN OFICINA", "claim")]).unwrap();

        let mono = suppliers::list(&conn, None).unwrap()[0].id;
        suppliers::save_withholding_profile(
            &mut conn,
            mono,
            &WithholdingProfileInput {
                person_type: Some("PJ".into()),
                rules: vec![SupplierWithholdingRuleInput { rate_id: 6, base_mode: "invoice_subtotal".into(), is_default: true }],
            },
        )
        .unwrap();
        withholding::save_uvt(&conn, 2026, 50000).unwrap();
        withholding::update_rates(&mut conn, &[crate::models::withholding::WithholdingRateUpdate { id: 6, base_uvt_centi: 300, rate_bp: 450 }]).unwrap();
        withholding::save_titles(
            &mut conn,
            &[DocumentTitleMappingInput { normalized_title: "nota debito".into(), display_title: "NOTA DÉBITO".into(), category: "credit_note".into() }],
        )
        .unwrap();

        let id_6201 = self_withholding::list_rates(&conn).unwrap().into_iter().find(|r| r.normalized_code == "6201").unwrap().id;
        self_withholding::update_rates(&mut conn, &[crate::models::self_withholding::SelfWithholdingRateUpdate { id: id_6201, rate_bp: 150 }]).unwrap();
        self_withholding::save_types(
            &mut conn,
            &[SalesDocumentTypeMappingInput { normalized_label: "documento x".into(), original_label: "Documento X".into(), category: "credit_note".into() }],
        )
        .unwrap();

        let vat_title = |category: &str| DocumentTitleMappingInput { normalized_title: "documento nuevo xyz".into(), display_title: "DOCUMENTO NUEVO XYZ".into(), category: category.into() };
        vat_titles::save(&mut conn, &[vat_title("credit_note")]).unwrap();
        puc::save_titles(&mut conn, &[vat_title("credit_note")]).unwrap();
        let supplier_id = |conn: &Connection, nit: &str| suppliers::list(conn, None).unwrap().into_iter().find(|s| s.nit == nit).unwrap().id;
        // Proveedor creado desde Códigos PUC: sin Tipo IVA ni datos de retención.
        suppliers::insert(&conn, &SupplierInput { nit: "900999999".into(), business_name: "PROVEEDOR NUEVO SAS".into(), vat_type: None }).unwrap();
        puc::record_supplier_code(&conn, supplier_id(&conn, "900319753"), "513595").unwrap();
        puc::record_supplier_code(&conn, supplier_id(&conn, "900319753"), "513595").unwrap();
        puc::record_supplier_code(&conn, supplier_id(&conn, "900999999"), "110505").unwrap();
        let supplier_codes = puc::list_all_supplier_codes(&conn).unwrap();

        let passport = identity_documents::insert(&conn, &IdentityDocumentTypeInput { name: "Pasaporte".into(), is_numeric: false }).unwrap();

        let backup = build(&conn, &dir, &sig_dir, "1.0.0").unwrap();
        assert!(!backup.settings.contains_key(LAST_RUN_VERSION_KEY));
        let json = serde_json::to_vec(&backup).unwrap();
        assert!(!String::from_utf8_lossy(&json).contains(&*sig_dir.to_string_lossy()), "sin rutas absolutas");
        let parsed = parse(&json).unwrap();

        suppliers::insert(&conn, &SupplierInput { nit: "1".into(), business_name: "Otro".into(), vat_type: Some("service".into()) }).unwrap();
        dropi::save_many(&mut conn, &[rule("EN REPARTO", "claim")]).unwrap();
        withholding::save_uvt(&conn, 2026, 1).unwrap();
        withholding::update_rates(&mut conn, &[crate::models::withholding::WithholdingRateUpdate { id: 6, base_uvt_centi: 0, rate_bp: 0 }]).unwrap();
        identity_documents::delete(&conn, passport).unwrap();
        vat_titles::save(&mut conn, &[vat_title("invoice")]).unwrap();
        puc::save_titles(&mut conn, &[vat_title("invoice")]).unwrap();
        puc::record_supplier_code(&conn, supplier_id(&conn, "900319753"), "514010").unwrap();
        puc::record_supplier_code(&conn, supplier_id(&conn, "1"), "514010").unwrap();
        self_withholding::update_rates(&mut conn, &[crate::models::self_withholding::SelfWithholdingRateUpdate { id: id_6201, rate_bp: 0 }]).unwrap();
        let x = self_withholding::list_types(&conn).unwrap().into_iter().find(|t| t.normalized_label == "documento x").unwrap();
        self_withholding::delete_type(&conn, x.id).unwrap();
        identity_documents::insert(&conn, &IdentityDocumentTypeInput { name: "NIT".into(), is_numeric: true }).unwrap();
        restore(&mut conn, &dir, &sig_dir, &parsed).unwrap();
        let types: Vec<(i64, String, bool)> = identity_documents::list(&conn).unwrap().into_iter().map(|t| (t.id, t.name, t.is_system)).collect();
        assert_eq!(types.len(), 3, "los tipos de documento se reemplazan por los del backup");
        assert_eq!(types[2], (passport, "Pasaporte".into(), false));
        let s = suppliers::list(&conn, None).unwrap().into_iter().find(|s| s.nit == "900319753").unwrap();
        assert_eq!((s.person_type.as_deref(), s.withholding_rules.len()), (Some("PJ"), 1), "la configuración de retención se restaura");
        assert_eq!(withholding::list_uvt(&conn).unwrap()[0].value_pesos, 50000);
        let r6 = withholding::list_rates(&conn).unwrap().into_iter().find(|r| r.id == 6).unwrap();
        assert_eq!((r6.base_uvt_centi, r6.rate_bp), (300, 450));
        assert_eq!(withholding::list_titles(&conn).unwrap().len(), 3);
        let xyz = vat_titles::list(&conn).unwrap().into_iter().find(|t| t.normalized_title == "documento nuevo xyz").unwrap();
        assert_eq!(xyz.category, "credit_note", "la clasificación de títulos de IVA se restaura");
        let puc_xyz = puc::list_titles(&conn).unwrap().into_iter().find(|t| t.normalized_title == "documento nuevo xyz").unwrap();
        assert_eq!(puc_xyz.category, "credit_note", "la clasificación de títulos de Códigos PUC se restaura");
        assert_eq!(puc::list_codes(&conn).unwrap().len(), 2517, "el catálogo PUC no depende del backup");
        assert_eq!(puc::list_all_supplier_codes(&conn).unwrap(), supplier_codes, "los códigos PUC por proveedor se restauran con su uso");
        assert_eq!(puc::list_supplier_codes(&conn, supplier_id(&conn, "900319753")).unwrap(), ["513595"]);
        let minimal = suppliers::list(&conn, None).unwrap().into_iter().find(|s| s.nit == "900999999").unwrap();
        assert_eq!((minimal.vat_type, minimal.person_type), (None, None), "un proveedor sin Tipo IVA se restaura sin inventarlo");

        // Backup de una versión anterior (con proveedores, sin códigos PUC): los códigos actuales siguen en su proveedor.
        puc::record_supplier_code(&conn, supplier_id(&conn, "900319753"), "514010").unwrap();
        let older = BackupFile { supplier_puc_codes: None, ..parsed.clone() };
        restore(&mut conn, &dir, &sig_dir, &older).unwrap();
        let mut kept = puc::list_supplier_codes(&conn, supplier_id(&conn, "900319753")).unwrap();
        kept.sort();
        assert_eq!(kept, ["513595", "514010"]);
        assert_eq!(puc::list_supplier_codes(&conn, supplier_id(&conn, "900999999")).unwrap(), ["110505"]);
        let restored_rules: Vec<(String, String)> =
            dropi::list(&conn).unwrap().into_iter().map(|m| (m.normalized_status, m.category)).collect();
        assert_eq!(
            restored_rules,
            vec![("EN TERMINAL DESTINO".into(), "in_process".into()), ("RECLAME EN OFICINA".into(), "claim".into())],
            "las reglas de Dropi se reemplazan por las del backup"
        );
        let restored_suppliers = suppliers::list(&conn, None).unwrap();
        assert_eq!(restored_suppliers.iter().map(|s| (s.nit.as_str(), s.vat_type.as_deref())).collect::<Vec<_>>(), [("900319753", Some("purchase")), ("900999999", None)], "los proveedores se reemplazan");
        let restored_signers = signers::list(&conn, None).unwrap();
        assert_eq!(restored_signers.len(), 1);
        assert_eq!(restored_signers[0].personal_document, "CC 1.192.729.629");
        let new_signature = &restored_signers[0].signature_file;
        assert_ne!(new_signature, &signature);
        assert_eq!(signatures::read_valid(&sig_dir, new_signature), Some(signature_png));
        assert!(!sig_dir.join(&signature).exists(), "la firma anterior se elimina");
        let restored = companies::list(&conn, None).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].ciiu_code, "0111", "el Código CIIU se restaura con su cero inicial");
        let rates = self_withholding::list_rates(&conn).unwrap();
        assert_eq!(rates.len(), 501);
        assert_eq!(rates.iter().find(|r| r.id == id_6201).unwrap().rate_bp, 150, "la tarifa editada se restaura");
        assert_eq!(self_withholding::list_types(&conn).unwrap().len(), 3, "los tipos de documento de ventas se restauran");
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
    fn old_backup_without_suppliers_keeps_current_ones() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_pending(&mut conn).unwrap();
        let a = suppliers::insert(&conn, &SupplierInput { nit: "900".into(), business_name: "A".into(), vat_type: Some("purchase".into()) }).unwrap();
        puc::record_supplier_code(&conn, a, "513595").unwrap();
        dropi::save_many(
            &mut conn,
            &[DropiStatusMappingInput { normalized_status: "PENDIENTE".into(), display_status: "PENDIENTE".into(), category: "in_process".into() }],
        )
        .unwrap();
        let old = br#"{"format":"amd-herramientas-backup","formatVersion":1,"appVersion":"1.0.0","exportedAt":"x","companies":[],"concepts":[]}"#;
        let parsed = parse(old).unwrap();
        assert!(parsed.suppliers.is_none());
        let dir = std::env::temp_dir().join(format!("amd-json-old-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        restore(&mut conn, &dir, &dir, &parsed).unwrap();
        assert_eq!(suppliers::list(&conn, None).unwrap().len(), 1);
        assert_eq!(dropi::list(&conn).unwrap().len(), 1, "sin estados de Dropi en el backup se conservan los actuales");
        assert_eq!(withholding::list_rates(&conn).unwrap().len(), 15, "sin tabla de retenciones en el backup se conserva la actual");
        assert_eq!(withholding::list_uvt(&conn).unwrap().len(), 1);
        assert_eq!(withholding::list_titles(&conn).unwrap().len(), 2);
        assert_eq!(vat_titles::list(&conn).unwrap().len(), 6, "sin títulos de IVA en el backup se conservan los actuales");
        assert_eq!(puc::list_titles(&conn).unwrap().len(), 6, "sin títulos de Códigos PUC en el backup se conservan los actuales");
        assert_eq!(puc::list_supplier_codes(&conn, a).unwrap(), ["513595"], "sin códigos PUC por proveedor en el backup se conservan los actuales");
        assert_eq!(identity_documents::list(&conn).unwrap().len(), 2, "sin tipos de documento en el backup se conservan los actuales");
        assert_eq!(self_withholding::list_rates(&conn).unwrap().len(), 501, "sin Tabla de Autorretenciones en el backup se conserva la actual");
        assert_eq!(self_withholding::list_types(&conn).unwrap().len(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_fixed_dropi_status_in_backup() {
        let json = br#"{"format":"amd-herramientas-backup","formatVersion":1,"appVersion":"1.13.0","exportedAt":"x","companies":[],"concepts":[],
            "dropiStatusMappings":[{"id":1,"normalizedStatus":"ENTREGADO","displayStatus":"ENTREGADO","category":"claim","createdAt":"x","updatedAt":"x"}]}"#;
        assert!(parse(json).is_err());
    }

    #[test]
    fn rejects_foreign_json() {
        assert!(parse(br#"{"hello": 1}"#).is_err());
    }
}
