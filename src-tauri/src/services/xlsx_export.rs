//! Escritura de libros .xlsx con rust_xlsxwriter.
//!
//! El frontend decide qué hojas, columnas y filas exportar (ya calculadas y
//! probadas allá); aquí solo se da formato: encabezado, números con separador
//! de miles y dos decimales, filtro y primera fila fija.

use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, XlsxError};
use serde::Deserialize;

use crate::error::{AppError, AppResult};

const MAX_SHEETS: usize = 10;
const MAX_ROWS: usize = 200_000;
const MAX_COLUMNS: usize = 30;

#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ColumnKind {
    Text,
    /// Valor monetario en pesos con centavos (#,##0.00).
    Money,
    Integer,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportColumn {
    pub header: String,
    pub kind: ColumnKind,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ExportCell {
    Number(f64),
    Text(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSheet {
    pub name: String,
    pub columns: Vec<ExportColumn>,
    pub rows: Vec<Vec<Option<ExportCell>>>,
}

/// Nombre de hoja válido para Excel: máximo 31 caracteres y sin []:*?/\.
fn sheet_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if "[]:*?/\\".contains(c) { ' ' } else { c })
        .collect::<String>()
        .trim()
        .chars()
        .take(31)
        .collect();
    if clean.is_empty() {
        "Hoja".into()
    } else {
        clean
    }
}

fn xlsx_error(e: XlsxError) -> AppError {
    eprintln!("[xlsx] {e}");
    AppError::user("No se pudo generar el archivo Excel.")
}

pub fn build_workbook(sheets: &[ExportSheet]) -> AppResult<Vec<u8>> {
    if sheets.is_empty() || sheets.len() > MAX_SHEETS {
        return Err(AppError::user("No hay información para exportar."));
    }
    let header = Format::new()
        .set_bold()
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_background_color(Color::RGB(0x0D141A))
        .set_border_bottom(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    let money = Format::new().set_num_format("#,##0.00");
    let integer = Format::new().set_num_format("0");

    let mut book = Workbook::new();
    for sheet in sheets {
        if sheet.columns.is_empty() || sheet.columns.len() > MAX_COLUMNS || sheet.rows.len() > MAX_ROWS {
            return Err(AppError::user("La información a exportar excede el tamaño permitido."));
        }
        let ws = book.add_worksheet();
        ws.set_name(sheet_name(&sheet.name)).map_err(xlsx_error)?;
        for (c, col) in sheet.columns.iter().enumerate() {
            ws.write_string_with_format(0, c as u16, &col.header, &header).map_err(xlsx_error)?;
        }
        for (r, row) in sheet.rows.iter().enumerate() {
            let r = (r + 1) as u32;
            for (c, cell) in row.iter().enumerate().take(sheet.columns.len()) {
                let col = c as u16;
                match (cell, sheet.columns[c].kind) {
                    (None, _) => {}
                    (Some(ExportCell::Number(n)), ColumnKind::Money) => {
                        ws.write_number_with_format(r, col, *n, &money).map_err(xlsx_error)?;
                    }
                    (Some(ExportCell::Number(n)), ColumnKind::Integer) => {
                        ws.write_number_with_format(r, col, *n, &integer).map_err(xlsx_error)?;
                    }
                    (Some(ExportCell::Number(n)), ColumnKind::Text) => {
                        ws.write_number(r, col, *n).map_err(xlsx_error)?;
                    }
                    (Some(ExportCell::Text(s)), _) => {
                        ws.write_string(r, col, s).map_err(xlsx_error)?;
                    }
                }
            }
        }
        let last_col = (sheet.columns.len() - 1) as u16;
        ws.autofilter(0, 0, sheet.rows.len() as u32, last_col).map_err(xlsx_error)?;
        ws.set_freeze_panes(1, 0).map_err(xlsx_error)?;
        ws.autofit();
    }
    book.save_to_buffer().map_err(xlsx_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_valid_xlsx() {
        let sheets = vec![ExportSheet {
            name: "Resumen".into(),
            columns: vec![
                ExportColumn { header: "Descripción".into(), kind: ColumnKind::Text },
                ExportColumn { header: "Cantidad".into(), kind: ColumnKind::Integer },
                ExportColumn { header: "Total".into(), kind: ColumnKind::Money },
            ],
            rows: vec![vec![
                Some(ExportCell::Text("ABONO".into())),
                Some(ExportCell::Number(2.0)),
                Some(ExportCell::Number(-126530.6)),
            ]],
        }];
        let bytes = build_workbook(&sheets).unwrap();
        assert!(bytes.starts_with(b"PK"));
    }

    #[test]
    fn sanitizes_sheet_names() {
        assert_eq!(sheet_name("Movimientos: 2026/01"), "Movimientos  2026 01");
        assert_eq!(sheet_name("  "), "Hoja");
        assert_eq!(sheet_name(&"x".repeat(40)).len(), 31);
    }

    #[test]
    fn rejects_empty_exports() {
        assert!(build_workbook(&[]).is_err());
    }
}
