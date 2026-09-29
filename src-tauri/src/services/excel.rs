//! Lectura de libros Excel (.xlsx / .xls) con calamine.
//!
//! Rust solo entrega las celdas con su tipo original (número, texto, fecha);
//! la interpretación contable (encabezados, signos, bases) vive en el
//! frontend, en servicios puros y probados.

use std::path::Path;

use calamine::{open_workbook_auto, Data, Reader};
use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const MAX_EXCEL_BYTES: u64 = 50 * 1024 * 1024;
const MAX_ROWS: usize = 100_000;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum Cell {
    #[serde(rename = "e")]
    Empty,
    #[serde(rename = "n")]
    Number(f64),
    #[serde(rename = "s")]
    Text(String),
    #[serde(rename = "b")]
    Bool(bool),
    /// Fecha ya normalizada a AAAA-MM-DD.
    #[serde(rename = "d")]
    Date(String),
    #[serde(rename = "x")]
    Error(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub name: String,
    pub rows: Vec<Vec<Cell>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workbook {
    pub file_name: String,
    pub sheets: Vec<Sheet>,
}

fn convert(cell: &Data) -> Cell {
    match cell {
        Data::Empty => Cell::Empty,
        Data::Int(i) => Cell::Number(*i as f64),
        Data::Float(f) => Cell::Number(*f),
        Data::String(s) => {
            if s.trim().is_empty() {
                Cell::Empty
            } else {
                Cell::Text(s.clone())
            }
        }
        Data::Bool(b) => Cell::Bool(*b),
        Data::DateTime(dt) if dt.is_datetime() => {
            let (y, m, d, ..) = dt.to_ymd_hms_milli();
            Cell::Date(format!("{y:04}-{m:02}-{d:02}"))
        }
        Data::DateTime(dt) => Cell::Number(dt.as_f64()),
        Data::DateTimeIso(s) => Cell::Date(s.chars().take(10).collect()),
        Data::DurationIso(s) => Cell::Text(s.clone()),
        Data::Error(e) => Cell::Error(e.to_string()),
    }
}

pub fn is_excel_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .as_deref(),
        Some("xlsx") | Some("xls")
    )
}

pub fn read_workbook(path: &Path) -> AppResult<Workbook> {
    if !is_excel_path(path) {
        return Err(AppError::user("El archivo debe ser un Excel (.xlsx o .xls)."));
    }
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() {
        return Err(AppError::user("Selecciona un archivo de Excel."));
    }
    if meta.len() > MAX_EXCEL_BYTES {
        return Err(AppError::user("El archivo de Excel supera el tamaño máximo de 50 MB."));
    }

    let mut book = open_workbook_auto(path).map_err(|e| {
        eprintln!("[excel] {e}");
        AppError::user("No se pudo abrir el archivo. Verifica que sea un Excel válido y que no esté protegido con contraseña.")
    })?;

    let mut sheets = Vec::new();
    for name in book.sheet_names() {
        let range = match book.worksheet_range(&name) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[excel] hoja {name}: {e}");
                continue;
            }
        };
        // calamine recorta el rango al primer dato; se rellenan las filas y
        // columnas iniciales para que los números de fila coincidan con Excel.
        let (start_row, start_col) = range.start().unwrap_or((0, 0));
        let mut rows: Vec<Vec<Cell>> = (0..start_row).map(|_| Vec::new()).collect();
        for row in range.rows().take(MAX_ROWS) {
            let mut out: Vec<Cell> = (0..start_col).map(|_| Cell::Empty).collect();
            out.extend(row.iter().map(convert));
            while matches!(out.last(), Some(Cell::Empty)) {
                out.pop();
            }
            rows.push(out);
        }
        while matches!(rows.last(), Some(r) if r.is_empty()) {
            rows.pop();
        }
        sheets.push(Sheet { name, rows });
    }

    if sheets.iter().all(|s| s.rows.is_empty()) {
        return Err(AppError::user("El archivo de Excel no contiene datos."));
    }

    Ok(Workbook {
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        sheets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_reference_workbook_when_available() {
        // El Excel de referencia vive fuera del proyecto; la prueba se omite si no está.
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../Sources/Facturacion Obedservices.xlsx");
        if !path.exists() {
            return;
        }
        let book = read_workbook(&path).unwrap();
        let rows = &book.sheets[0].rows;
        assert_eq!(rows[0][0], Cell::Text("Tipo de documento".into()));
        assert_eq!(rows.len(), 4, "las filas vacías finales se descartan");
        assert_eq!(rows[1][29], Cell::Number(1_406_580.0));
    }

    /// Vuelca un libro real a JSON (mismo formato que recibe el frontend) para
    /// las pruebas de vitest con archivos reales. Se omite sin las variables:
    /// EXCEL_DUMP_IN=<libro.xlsx> EXCEL_DUMP_OUT=<salida.json> cargo test dump_workbook_json
    #[test]
    fn dump_workbook_json() {
        let (Ok(input), Ok(output)) = (std::env::var("EXCEL_DUMP_IN"), std::env::var("EXCEL_DUMP_OUT")) else {
            return;
        };
        let book = read_workbook(Path::new(&input)).unwrap();
        std::fs::write(output, serde_json::to_vec(&book).unwrap()).unwrap();
    }

    #[test]
    fn rejects_other_extensions() {
        assert!(read_workbook(Path::new("/tmp/archivo.csv")).is_err());
    }
}
