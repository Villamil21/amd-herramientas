//! Estados Financieros: catálogo de cuentas, movimientos contables por empresa,
//! nómina, ajustes y periodos. Valores en centavos enteros (exactos).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::clean;

pub const SECTIONS: [&str; 11] = [
    "asset_current",
    "asset_noncurrent",
    "liability_current",
    "liability_noncurrent",
    "equity",
    "income",
    "costs",
    "admin_expenses",
    "sales_expenses",
    "other_income",
    "other_expenses",
];

/// Secciones donde el usuario puede crear líneas nuevas (ESF completo; en EERR, por ahora, los gastos operacionales).
pub const CREATABLE_SECTIONS: [&str; 7] = ["asset_current", "asset_noncurrent", "liability_current", "liability_noncurrent", "equity", "admin_expenses", "sales_expenses"];

pub const SOURCES: [&str; 8] = ["purchases", "bank", "payroll", "sales_einvoice", "sales_tpsv", "crypto_ops", "opening", "adjustment"];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsLine {
    pub id: i64,
    pub section: String,
    pub name: String,
    pub sort_order: i64,
    pub role: Option<String>,
    pub is_active: bool,
    /// Tiene movimientos o mapeos: no se puede eliminar físicamente (solo desactivar).
    pub has_history: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsSection {
    pub section: String,
    pub representative_line_id: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsCatalog {
    pub lines: Vec<FsLine>,
    pub sections: Vec<FsSection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsPucMapping {
    pub puc_code: String,
    pub line_id: Option<i64>,
    pub excluded: bool,
    pub updated_at: String,
    /// De dónde viene la decisión: `manual` (cuenta puntual), `group` (grupo de cuatro dígitos).
    pub origin: String,
}

pub fn validate_section(section: &str) -> AppResult<()> {
    if SECTIONS.contains(&section) {
        Ok(())
    } else {
        Err(AppError::user("La sección no es válida."))
    }
}

pub fn validate_line_name(name: &str) -> AppResult<String> {
    let name = clean(name, 120);
    if name.is_empty() {
        return Err(AppError::user("Escribe el nombre de la línea."));
    }
    Ok(name)
}

/// ISO AAAA-MM-DD válido (sin hora).
pub fn validate_iso_date(value: &str, label: &str) -> AppResult<()> {
    let ok = value.len() == 10
        && value.as_bytes()[4] == b'-'
        && value.as_bytes()[7] == b'-'
        && value.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && (1..=12).contains(&value[5..7].parse::<u32>().unwrap_or(0))
        && (1..=31).contains(&value[8..10].parse::<u32>().unwrap_or(0));
    if ok {
        Ok(())
    } else {
        Err(AppError::user(format!("{label}: la fecha no es válida.")))
    }
}

// ---------------------------------------------------------------------------
// Lotes y movimientos
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MovementInput {
    pub accounting_date: String,
    pub concept_key: String,
    pub document_id: String,
    pub document_number: String,
    pub document_type: String,
    pub supplier_id: Option<i64>,
    pub supplier_nit: String,
    pub supplier_name: String,
    pub employee_id: Option<i64>,
    pub employment_id: Option<i64>,
    pub bank: String,
    pub account_number: String,
    pub puc_code: String,
    pub description: String,
    pub amount_cents: i64,
    pub dc: Option<String>,
    pub settles_on: Option<String>,
    pub detail: Option<Value>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankBalanceInput {
    pub bank: String,
    pub account_number: String,
    pub balance_date: String,
    pub balance_cents: i64,
    pub puc_code: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankConceptMappingInput {
    pub bank: String,
    pub concept: String,
    pub puc_code: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRowInput {
    pub employee_id: i64,
    pub employment_id: i64,
    pub period: String,
    pub payment_date: String,
    #[serde(default)]
    pub detail: Option<Value>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DecisionInput {
    pub document_key: String,
    pub decision: String,
    #[serde(default)]
    pub detail: String,
}

/// Envío de un submódulo a Estados Financieros. Todo o nada.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchInput {
    pub company_id: i64,
    pub source: String,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub period_label: String,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    /// Identifica el envío (ej. «bank:BBVA:0013…:2026-08»). Vacío = solo se revisan los documentos.
    #[serde(default)]
    pub dedupe_key: String,
    /// El usuario ya eligió «Reemplazar» ante un envío o documentos repetidos.
    #[serde(default)]
    pub replace: bool,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub movements: Vec<MovementInput>,
    #[serde(default)]
    pub bank_balances: Vec<BankBalanceInput>,
    #[serde(default)]
    pub bank_concept_mappings: Vec<BankConceptMappingInput>,
    #[serde(default)]
    pub payroll_rows: Vec<PayrollRowInput>,
    #[serde(default)]
    pub decisions: Vec<DecisionInput>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    pub id: i64,
    pub company_id: i64,
    pub source: String,
    pub file_name: String,
    pub period_label: String,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub dedupe_key: String,
    pub record_count: i64,
    pub total_cents: i64,
    pub status: String,
    pub replaced_by: Option<i64>,
    pub metadata: Value,
    pub created_at: String,
}

/// Resultado de un envío: enviado, o detenido porque ya existe (el usuario decide).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SendOutcome {
    #[serde(rename_all = "camelCase")]
    Sent { batch_id: i64, replaced_batch_ids: Vec<i64>, invalidated_periods: i64 },
    #[serde(rename_all = "camelCase")]
    Duplicate { batches: Vec<BatchSummary>, repeated_documents: i64 },
}

/// Fuentes que admiten «Registrar periodo sin …» (compras, nómina, ventas, operaciones).
pub const EMPTY_PERIOD_SOURCES: [&str; 4] = ["purchases", "payroll", "sales_einvoice", "sales_tpsv"];

/// Periodo declarado sin actividad: cubre los meses en el Generador sin crear movimientos.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyPeriodInput {
    pub company_id: i64,
    pub source: String,
    /// Meses AAAA-MM sin actividad.
    pub months: Vec<String>,
    /// Texto de la confirmación explícita que aceptó el usuario (queda en la trazabilidad).
    pub confirmation: String,
    /// El usuario ya vio la advertencia de que alguno de los meses tiene información real.
    #[serde(default)]
    pub allow_with_data: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum EmptyPeriodOutcome {
    #[serde(rename_all = "camelCase")]
    Registered { batch_ids: Vec<i64> },
    /// Meses con información real activa: se detiene para pedir la advertencia explícita.
    #[serde(rename_all = "camelCase")]
    HasData { months: Vec<String> },
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Movement {
    pub id: i64,
    pub company_id: i64,
    pub batch_id: i64,
    pub accounting_date: String,
    pub source: String,
    pub concept_key: String,
    pub document_id: String,
    pub document_number: String,
    pub document_type: String,
    pub supplier_id: Option<i64>,
    pub supplier_nit: String,
    pub supplier_name: String,
    pub employee_id: Option<i64>,
    pub employment_id: Option<i64>,
    pub bank: String,
    pub account_number: String,
    pub puc_code: String,
    pub puc_concept: String,
    pub description: String,
    pub amount_cents: i64,
    pub dc: Option<String>,
    pub settles_on: Option<String>,
    pub status: String,
    pub detail: Value,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankBalance {
    pub id: i64,
    pub batch_id: i64,
    pub bank: String,
    pub account_number: String,
    pub balance_date: String,
    pub balance_cents: i64,
    pub puc_code: String,
    /// Su lote está activo (no fue reemplazado).
    pub active: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankAccount {
    pub id: i64,
    pub company_id: i64,
    pub bank: String,
    pub account_number: String,
    pub puc_code: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankConceptMapping {
    pub bank: String,
    pub concept: String,
    pub puc_code: String,
}

/// Ciclo de vida de una cuenta bancaria (empresa + banco + número): periodos AAAA-MM.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankAccountLifecycle {
    pub company_id: i64,
    pub bank: String,
    pub account_number: String,
    pub opened_period: Option<String>,
    pub closed_period: Option<String>,
    pub status: String,
    pub updated_at: String,
    pub events: Vec<BankAccountEvent>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankAccountEvent {
    pub bank: String,
    pub account_number: String,
    pub action: String,
    pub period: Option<String>,
    pub note: String,
    pub previous: Value,
    pub created_at: String,
}

/// Respuesta del usuario sobre una cuenta: `opened` / `closed` (con su periodo),
/// `kept_active` / `existed_before` (solo quedan en la auditoría) o `edited`
/// (apertura y cierre tal como quedan; None = sin dato).
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankLifecycleInput {
    pub company_id: i64,
    pub bank: String,
    pub account_number: String,
    pub action: String,
    #[serde(default)]
    pub period: Option<String>,
    #[serde(default)]
    pub opened_period: Option<String>,
    #[serde(default)]
    pub closed_period: Option<String>,
    #[serde(default)]
    pub note: String,
}

/// Banco + concepto exacto → es GMF (4x1000) o no.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GmfRule {
    pub bank: String,
    pub concept: String,
    pub is_gmf: bool,
    pub origin: String,
    pub confirmed: bool,
    pub updated_at: String,
}

/// Banco + concepto exacto → es interés generado (ingreso financiero del 1007) o no.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InterestRule {
    pub bank: String,
    pub concept: String,
    pub is_interest: bool,
    pub origin: String,
    pub confirmed: bool,
    pub updated_at: String,
}

/// Ficha persistente del banco como informado en Exógena (1012, 1007): NIT sin DV, DV calculado, razón social,
/// tipo de documento NIT (31) y país Colombia (169).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankProfile {
    pub bank_key: String,
    pub bank: String,
    pub nit: String,
    pub dv: String,
    pub business_name: String,
    pub doc_type_code: String,
    pub country_code: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankProfileInput {
    pub bank: String,
    pub nit: String,
    pub business_name: String,
}

/// Decisión del usuario sobre una situación revisable de un extracto para Exógena.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankExoReview {
    pub company_id: i64,
    pub year: i64,
    pub review_key: String,
    pub decision: String,
    pub note: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PucSetting {
    pub key: String,
    pub puc_code: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SalesDocType {
    pub normalized_label: String,
    pub original_label: String,
    pub category: String,
}

// ---------------------------------------------------------------------------
// Nómina
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeArea {
    pub area: String,
    pub effective_from: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Employment {
    pub id: i64,
    pub number: i64,
    pub hire_date: String,
    pub end_date: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Liquidation {
    pub id: i64,
    pub employee_id: i64,
    pub employment_id: i64,
    pub liquidation_date: String,
    pub last_period: String,
    pub prima_cents: i64,
    pub cesantias_cents: i64,
    pub intereses_cents: i64,
    pub vacaciones_cents: i64,
    pub notes: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AbsenceJustification {
    pub employee_id: i64,
    pub period: String,
    pub justification: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Employee {
    pub id: i64,
    pub company_id: i64,
    pub doc_type: String,
    pub doc_number: String,
    pub name: String,
    pub areas: Vec<EmployeeArea>,
    pub employments: Vec<Employment>,
    pub liquidations: Vec<Liquidation>,
    pub justifications: Vec<AbsenceJustification>,
    pub events: Vec<EmployeeEvent>,
    /// Nombre separado en apellidos y nombres (2276). Solo vale con `confirmed_at`.
    pub name_parts: EmployeeNameParts,
}

#[derive(Debug, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeNameParts {
    pub first_surname: String,
    pub second_surname: String,
    pub first_name: String,
    pub other_names: String,
    pub confirmed_at: Option<String>,
}

/// Separación del nombre propuesta o confirmada por el usuario. `confirm: false` solo guarda la propuesta.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeNamePartsInput {
    #[serde(default)]
    pub first_surname: String,
    #[serde(default)]
    pub second_surname: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub other_names: String,
    #[serde(default)]
    pub confirm: bool,
}

/// Decisión guardada con un lote (p. ej. entidades de la planilla confirmadas por el usuario).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsDecision {
    pub id: i64,
    pub batch_id: i64,
    pub source: String,
    pub document_key: String,
    pub decision: String,
    pub detail: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRow {
    pub id: i64,
    pub batch_id: i64,
    pub employee_id: i64,
    pub employment_id: i64,
    pub period: String,
    pub payment_date: String,
    pub detail: Value,
    /// Operador de la planilla del lote («Aportes en Línea», «MiPlanilla»…). Vacío en lotes sin ese dato.
    pub provider: String,
    pub batch_file_name: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeInput {
    pub company_id: i64,
    pub doc_type: String,
    pub doc_number: String,
    pub name: String,
    pub hire_date: String,
    pub area: String,
    /// AAAA-MM desde el que rige el área.
    pub effective_from: String,
    #[serde(default)]
    pub name_parts: Option<EmployeeNamePartsInput>,
}

/// Edición de la ficha. El área nueva rige desde `area_from` (AAAA-MM) y nunca
/// reescribe los meses anteriores; la fecha de ingreso es la de la vinculación vigente.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeUpdateInput {
    pub employee_id: i64,
    pub doc_type: String,
    pub doc_number: String,
    pub name: String,
    pub hire_date: String,
    #[serde(default)]
    pub area: Option<String>,
    #[serde(default)]
    pub area_from: Option<String>,
    #[serde(default)]
    pub name_parts: Option<EmployeeNamePartsInput>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeEvent {
    pub action: String,
    pub previous: Value,
    pub next: Value,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiquidationInput {
    pub employment_id: i64,
    pub liquidation_date: String,
    pub last_period: String,
    #[serde(default)]
    pub notes: String,
}

pub fn validate_area(area: &str) -> AppResult<()> {
    if matches!(area, "admin" | "sales") {
        Ok(())
    } else {
        Err(AppError::user("Elige el área contable: Administración o Ventas."))
    }
}

pub fn validate_period(period: &str) -> AppResult<()> {
    let ok = period.len() == 7 && period.as_bytes()[4] == b'-' && period[..4].parse::<u32>().is_ok() && (1..=12).contains(&period[5..].parse::<u32>().unwrap_or(0));
    if ok {
        Ok(())
    } else {
        Err(AppError::user("El periodo no es válido (AAAA-MM)."))
    }
}

// ---------------------------------------------------------------------------
// Ajustes y periodos
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AdjustmentInput {
    pub company_id: i64,
    pub accounting_date: String,
    pub puc_code: String,
    pub reason: String,
    /// Valor que tenía la cuenta antes del ajuste (lo calcula el generador).
    pub previous_cents: i64,
    pub adjustment_type: String,
    pub input_cents: i64,
}

/// Edición individual de un movimiento desde «Movimientos contables».
/// `status`: "active" corrige valores (nueva versión); "ignored" / "voided" solo cambian el estado.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MovementEditInput {
    pub movement_id: i64,
    pub accounting_date: String,
    pub puc_code: String,
    pub puc_concept: String,
    pub description: String,
    pub amount_cents: i64,
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MovementEdit {
    pub id: i64,
    pub company_id: i64,
    pub original_movement_id: i64,
    pub new_movement_id: Option<i64>,
    pub reason: String,
    pub origin: String,
    pub previous: Value,
    pub next: Value,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AdjustmentHistoryEntry {
    pub previous: Value,
    pub edited_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Adjustment {
    pub id: i64,
    pub company_id: i64,
    pub movement_id: i64,
    pub accounting_date: String,
    pub puc_code: String,
    pub concept: String,
    pub reason: String,
    pub previous_cents: i64,
    pub adjustment_type: String,
    pub input_cents: i64,
    pub final_cents: i64,
    pub created_at: String,
    pub updated_at: String,
    pub history: Vec<AdjustmentHistoryEntry>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeriodEvent {
    pub action: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatementVersion {
    pub id: i64,
    pub version: i64,
    pub file_name: String,
    pub snapshot: Value,
    pub generated_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Period {
    pub id: i64,
    pub company_id: i64,
    pub start_date: String,
    pub end_date: String,
    pub presentation: String,
    pub status: String,
    pub validation_hash: Option<String>,
    pub review_reason: String,
    pub closed_snapshot: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub events: Vec<PeriodEvent>,
    pub versions: Vec<StatementVersion>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeriodKey {
    pub company_id: i64,
    pub start_date: String,
    pub end_date: String,
    pub presentation: String,
}

impl PeriodKey {
    pub fn validated(self) -> AppResult<Self> {
        validate_iso_date(&self.start_date, "Fecha inicial")?;
        validate_iso_date(&self.end_date, "Fecha final")?;
        if self.start_date > self.end_date {
            return Err(AppError::user("La fecha inicial no puede ser posterior a la fecha final."));
        }
        if !matches!(self.presentation.as_str(), "bank" | "otc") {
            return Err(AppError::user("Elige la presentación."));
        }
        Ok(self)
    }
}

/// Transacciones de un movimiento bancario enviado (posiciones dentro de `detail.movements`) que se reclasifican.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankReclassItem {
    pub movement_id: i64,
    pub tx_indexes: Vec<usize>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankReclassInput {
    pub batch_id: i64,
    pub puc_code: String,
    pub reason: String,
    /// El usuario vio que un periodo «Cuadrado» o con PDF generado pasará a «Requiere nueva revisión».
    #[serde(default)]
    pub acknowledge_approved: bool,
    pub items: Vec<BankReclassItem>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankReclassChange {
    pub edit_id: i64,
    pub original_movement_id: i64,
    pub moved_movement_id: i64,
    pub remainder_movement_id: Option<i64>,
    pub moved_cents: i64,
    pub transactions: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankReclassOutcome {
    pub batch_id: i64,
    pub moved_cents: i64,
    pub transactions: i64,
    pub changes: Vec<BankReclassChange>,
    pub invalidated_periods: i64,
}

/// Cambio guardado sobre un concepto de un extracto enviado, todavía sin aplicar a Estados Financieros.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankPendingEdit {
    pub id: i64,
    pub company_id: i64,
    pub batch_id: i64,
    pub concept: String,
    /// `send` | `skip`.
    pub destination: String,
    pub puc_code: String,
    pub is_gmf: bool,
    pub previous: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankPendingEditInput {
    pub batch_id: i64,
    pub concept: String,
    pub destination: String,
    #[serde(default)]
    pub puc_code: String,
    #[serde(default)]
    pub is_gmf: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankApplyInput {
    pub batch_id: i64,
    pub reason: String,
    #[serde(default)]
    pub acknowledge_approved: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankApplyOutcome {
    pub batch_id: i64,
    pub concepts: i64,
    pub invalidated_periods: i64,
    pub log_ids: Vec<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankEditLogEntry {
    pub id: i64,
    pub company_id: i64,
    pub batch_id: i64,
    pub concept: String,
    pub reason: String,
    pub previous: Value,
    pub next: Value,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankMonthNa {
    pub company_id: i64,
    pub bank_key: String,
    pub account_number: String,
    pub month: String,
    pub reason: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankMonthNaInput {
    pub company_id: i64,
    pub bank: String,
    #[serde(default)]
    pub account_number: String,
    pub month: String,
    pub reason: String,
}

/// Decisión sobre «interés generado (1007)» tomada desde el detalle de un extracto.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankInterestDecisionInput {
    pub company_id: i64,
    pub bank: String,
    pub concept: String,
    /// `confirm` (es interés) · `reject` (no es interés) · `remove` (quita la regla y vuelve a la sugerencia por texto).
    pub decision: String,
    /// `auto` si el usuario confirma la sugerencia por texto; `manual` en cualquier otro caso.
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub reason: String,
    /// Valor del concepto (abonos) en el extracto desde el que se decidió.
    #[serde(default)]
    pub amount_cents: i64,
    /// Extractos vigentes de la empresa con ese banco y concepto a los que alcanza la regla.
    #[serde(default)]
    pub batch_ids: Vec<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BankInterestLogEntry {
    pub id: i64,
    pub company_id: i64,
    pub bank: String,
    pub concept: String,
    pub decision: String,
    pub previous: String,
    pub next: String,
    pub amount_cents: i64,
    pub batch_ids: Vec<i64>,
    pub reason: String,
    pub created_at: String,
}
