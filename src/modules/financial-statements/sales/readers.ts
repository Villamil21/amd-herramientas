import type { Cell, Sheet, Workbook } from "../../../types/excel";
import { cellDate } from "../../../utils/dates";
import { cellAmount } from "../../../utils/numbers";
import { normalizeKey } from "../../../utils/text";
import { normalizeNit } from "../shared/companyMatch";

/**
 * Lectores de Ventas. Las hojas y columnas se ubican por sus encabezados,
 * nunca por posición ni por letras de Excel.
 */

const text = (cell: Cell | undefined) => (cell && (cell.t === "s" || cell.t === "d") ? cell.v.trim() : cell && cell.t === "n" ? String(cell.v) : "");
const iso = (cell: Cell | undefined) => {
  const d = cellDate(cell);
  return d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : undefined;
};

/** Primera fila (entre las 10 primeras) que tiene todos los encabezados pedidos. */
function findHeader(sheet: Sheet, required: string[]): { row: number; columns: Map<string, number>; headers: string[] } | undefined {
  for (let r = 0; r < Math.min(10, sheet.rows.length); r++) {
    const headers = sheet.rows[r].map((c) => normalizeKey(text(c)));
    const columns = new Map<string, number>();
    headers.forEach((h, i) => {
      if (h && !columns.has(h)) columns.set(h, i);
    });
    if (required.every((h) => columns.has(h))) return { row: r, columns, headers };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Facturación electrónica (DIAN)
// ---------------------------------------------------------------------------

const EINVOICE_HEADERS = ["tipo de documento", "cufe/cude", "folio", "prefijo", "fecha emision", "nit emisor", "nombre emisor", "iva", "rete ica", "total"];

export interface EInvoiceRow {
  sheet: string;
  /** Fila en Excel (1 = encabezado). */
  rowNumber: number;
  docType: string;
  docTypeKey: string;
  cufe: string;
  number: string;
  /** AAAA-MM-DD; sin definir si la fecha no se pudo leer. */
  issueDate?: string;
  issuerNit: string;
  issuerName: string;
  receiverNit: string;
  receiverName: string;
  totalCents: number;
  /** Suma de todas las columnas desde IVA hasta Rete ICA (inclusive). */
  taxesCents: number;
  /** Base de Estados Financieros = Total − impuestos y retenciones (IVA … Rete ICA). No cambia. */
  baseCents: number;
  /** Valor de «IVA» (primera columna del rango), en centavos. */
  ivaCents: number;
  /** Cada columna del rango IVA … Rete ICA (en el orden de `taxColumns`), en centavos: sirve para calcular la base de Exógena. */
  columnCents: number[];
  status: string;
  issue?: string;
}

export interface EInvoiceRead {
  sheets: string[];
  /** Columnas sumadas para la base (IVA … Rete ICA), tal como aparecen. */
  taxColumns: string[];
  rows: EInvoiceRow[];
}

export class SalesFormatError extends Error {}

/**
 * Base de cada documento = Total − SUMA(columnas desde «IVA» hasta «Rete ICA»).
 * Si hay una hoja llamada «Ventas» se usa solo esa (el archivo de la DIAN
 * también trae «Compras» con los mismos encabezados).
 */
export function readEInvoiceWorkbook(book: Workbook): EInvoiceRead {
  const candidates = book.sheets.map((sheet) => ({ sheet, header: findHeader(sheet, EINVOICE_HEADERS) })).filter((c) => c.header);
  if (candidates.length === 0) {
    throw new SalesFormatError("No se encontró una hoja con los encabezados de facturación electrónica (Tipo de documento, CUFE/CUDE, Fecha Emisión, NIT Emisor, IVA … Rete ICA, Total).");
  }
  const sales = candidates.filter((c) => normalizeKey(c.sheet.name).includes("venta"));
  const used = sales.length ? sales : candidates;
  const rows: EInvoiceRow[] = [];
  let taxColumns: string[] = [];
  for (const { sheet, header } of used) {
    const col = (name: string) => header!.columns.get(name)!;
    const from = col("iva");
    const to = col("rete ica");
    if (to < from) throw new SalesFormatError(`En la hoja «${sheet.name}» la columna «Rete ICA» está antes de «IVA».`);
    taxColumns = sheet.rows[header!.row].slice(from, to + 1).map(text);
    const status = header!.columns.get("estado");
    const receiverNit = header!.columns.get("nit receptor");
    const receiverName = header!.columns.get("nombre receptor");
    for (let r = header!.row + 1; r < sheet.rows.length; r++) {
      const cells = sheet.rows[r];
      if (!cells || cells.every((c) => !text(c))) continue;
      const total = cellAmount(cells[col("total")]);
      let taxes = 0;
      let bad = total === null;
      const columnCents: number[] = [];
      for (let c = from; c <= to; c++) {
        const v = cellAmount(cells[c]);
        if (v === null) bad = true;
        else taxes += v;
        columnCents.push(Math.round((v ?? 0) * 100));
      }
      const issueDate = iso(cells[col("fecha emision")]);
      const docType = text(cells[col("tipo de documento")]);
      const totalCents = Math.round((total ?? 0) * 100);
      const taxesCents = Math.round(taxes * 100);
      const row: EInvoiceRow = {
        sheet: sheet.name,
        rowNumber: r + 1,
        docType,
        docTypeKey: normalizeKey(docType),
        cufe: text(cells[col("cufe/cude")]).toLowerCase(),
        number: `${text(cells[col("prefijo")])}${text(cells[col("folio")])}`,
        issueDate,
        issuerNit: normalizeNit(text(cells[col("nit emisor")])),
        issuerName: text(cells[col("nombre emisor")]),
        receiverNit: receiverNit === undefined ? "" : text(cells[receiverNit]),
        receiverName: receiverName === undefined ? "" : text(cells[receiverName]),
        totalCents,
        taxesCents,
        baseCents: totalCents - taxesCents,
        ivaCents: columnCents[0] ?? 0,
        columnCents,
        status: status === undefined ? "" : text(cells[status]),
      };
      if (bad) row.issue = "Hay valores que no son números en Total o en las columnas de impuestos.";
      else if (!issueDate) row.issue = "No se pudo leer la «Fecha Emisión».";
      else if (!docType) row.issue = "Falta el «Tipo de documento».";
      rows.push(row);
    }
  }
  return { sheets: used.map((u) => u.sheet.name), taxColumns, rows };
}

// ---------------------------------------------------------------------------
// Alcance de la base de Exógena (1007): Total − (IVA … ICUI)
// ---------------------------------------------------------------------------

/**
 * Encabezados que se reconocen como el impuesto «ICUI» (impuesto al consumo de productos ultraprocesados), ya normalizados
 * (sin tildes, en minúsculas). Es la configuración de la plantilla: si el Excel usa otro nombre y no está aquí, el alcance NO se
 * adivina: el usuario elige explícitamente hasta qué columna se resta.
 */
export const ICUI_HEADER_ALIASES = ["icui", "ic ultraprocesados", "ic ultraprocesado", "icui ultraprocesados", "impuesto al consumo de ultraprocesados", "impuesto al consumo ultraprocesados", "impuesto consumo ultraprocesados", "impuesto al consumo de productos ultraprocesados"];

export interface ExoScope {
  /** Columnas restadas, desde «IVA» hasta la última (en el orden del Excel). */
  columns: string[];
  /** Encabezado con que termina la resta («ICUI» o el equivalente / el elegido por el usuario). */
  lastColumn: string;
  resolvedBy: "header" | "manual";
}

/** Último índice del rango con un encabezado equivalente a ICUI; -1 si el Excel no lo trae. */
export function icuiIndex(taxColumns: readonly string[]): number {
  return taxColumns.findIndex((h) => ICUI_HEADER_ALIASES.includes(normalizeKey(h)));
}

/**
 * Alcance de la resta del 1007. Con ICUI (o un equivalente configurado) se resuelve solo; si no, solo vale la columna que el
 * usuario eligió. Sin ninguna de las dos devuelve `undefined`: el 1007 queda pendiente, nunca se asume un alcance.
 */
export function resolveExoScope(taxColumns: readonly string[], manualLast?: string): ExoScope | undefined {
  const auto = icuiIndex(taxColumns);
  if (auto >= 0) return { columns: taxColumns.slice(0, auto + 1), lastColumn: taxColumns[auto], resolvedBy: "header" };
  const manual = manualLast ? taxColumns.indexOf(manualLast) : -1;
  if (manual >= 0) return { columns: taxColumns.slice(0, manual + 1), lastColumn: taxColumns[manual], resolvedBy: "manual" };
  return undefined;
}

/** Base del 1007 de un documento = Total − suma de las columnas del alcance (IVA … ICUI). */
export const exoBaseCents = (row: Pick<EInvoiceRow, "totalCents" | "columnCents">, scope: ExoScope): number =>
  row.totalCents - row.columnCents.slice(0, scope.columns.length).reduce((a, b) => a + b, 0);

/** ID fuerte del documento: CUFE/CUDE o, sin él, NIT emisor + número. */
export const einvoiceDocumentId = (r: EInvoiceRow) => r.cufe || `${r.issuerNit}|${r.number}`;

// ---------------------------------------------------------------------------
// Reporte de operaciones (TPSV)
// ---------------------------------------------------------------------------

const TPSV_HEADERS = ["n° registro", "fecha", "codigo tipo", "monto acumulado"];

export type TpsvKind = "buy" | "sell";

export interface TpsvRow {
  sheet: string;
  rowNumber: number;
  registro: string;
  date?: string;
  typeCode: string;
  kind?: TpsvKind;
  /** «Monto Acumulado» (nunca «Monto Acumulado 2»), en centavos. */
  amountCents: number;
  /** Huella del registro: N° Registro + Fecha + Código Tipo + Monto Acumulado. */
  fingerprint: string;
  issue?: string;
  /** La misma huella ya apareció antes en el archivo (no se suma dos veces). */
  repeated?: boolean;
}

export interface TpsvRead {
  sheets: string[];
  rows: TpsvRow[];
}

/**
 * Columnas del TXT del reporte de operaciones, en el mismo orden que el Excel
 * equivalente (26 campos separados por «|»). La primera línea (cabecera del
 * reporte) y la última (cierre) no tienen «|» y se omiten.
 */
export const TPSV_TXT_COLUMNS = [
  "N° Registro",
  "Fecha",
  "Código Tipo",
  "N° Identificación",
  "Tipo Documento",
  "N° ID Relacionado",
  "Nombres",
  "Apellidos",
  "País",
  "Código Postal / Región",
  "Tipo Cuenta",
  "N° Cuenta / Wallet",
  "N° Cuenta / Wallet (2)",
  "Moneda",
  "Monto Transacción",
  "Monto Acumulado",
  "Monto Transacción 2",
  "Monto Acumulado 2",
  "Identificador Cuenta",
  "Código Entidad",
  "NIT Entidad",
  "Nombre Entidad",
  "Razón Social",
  "País Entidad",
  "Entidad (2)",
  "País Entidad (2)",
];

/**
 * TXT del reporte de operaciones → la misma estructura interna que el Excel
 * (una hoja «TXT» con los encabezados del Excel), para leerlo con
 * `readTpsvWorkbook` y aplicar exactamente las mismas reglas.
 */
export function tpsvTextToWorkbook(fileName: string, content: string): Workbook {
  const rows: Cell[][] = [TPSV_TXT_COLUMNS.map((h) => ({ t: "s", v: h }) as Cell)];
  for (const line of content.split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    rows.push(
      line.split("|").map((v): Cell => {
        const value = v.trim();
        // Números puros (montos, códigos) como número: «4576200» no se confunde con miles.
        return /^-?\d+(\.\d+)?$/.test(value) && value.length < 16 ? { t: "n", v: Number(value) } : { t: "s", v: value };
      }),
    );
  }
  if (rows.length === 1) throw new SalesFormatError("El TXT no tiene filas del reporte de operaciones (campos separados por «|»).");
  const width = rows.slice(1).reduce((w, r) => Math.max(w, r.length), 0);
  if (width < 16) throw new SalesFormatError(`El TXT no tiene la estructura del reporte de operaciones: se esperaban ${TPSV_TXT_COLUMNS.length} campos por fila.`);
  return { fileName, sheets: [{ name: "TXT", rows }] };
}

/** Revisa todas las hojas con la estructura válida: compras y ventas pueden venir en hojas distintas. */
export function readTpsvWorkbook(book: Workbook): TpsvRead {
  const used = book.sheets.map((sheet) => ({ sheet, header: findHeader(sheet, TPSV_HEADERS) })).filter((c) => c.header);
  if (used.length === 0) throw new SalesFormatError("No se encontró una hoja con los encabezados del reporte de operaciones (N° Registro, Fecha, Código Tipo, Monto Acumulado).");
  const seen = new Set<string>();
  const rows: TpsvRow[] = [];
  for (const { sheet, header } of used) {
    const col = (name: string) => header!.columns.get(name)!;
    for (let r = header!.row + 1; r < sheet.rows.length; r++) {
      const cells = sheet.rows[r];
      if (!cells || cells.every((c) => !text(c))) continue;
      const registro = text(cells[col("n° registro")]);
      const date = iso(cells[col("fecha")]);
      const typeCode = text(cells[col("codigo tipo")]).replace(/\.0+$/, "");
      const amount = cellAmount(cells[col("monto acumulado")]);
      const amountCents = Math.round((amount ?? 0) * 100);
      const fingerprint = `${registro}|${date ?? ""}|${typeCode}|${amountCents}`;
      const row: TpsvRow = { sheet: sheet.name, rowNumber: r + 1, registro, date, typeCode, kind: typeCode === "2" ? "buy" : typeCode === "3" ? "sell" : undefined, amountCents, fingerprint };
      if (amount === null) row.issue = "«Monto Acumulado» no es un número.";
      else if (!date) row.issue = "No se pudo leer la «Fecha».";
      if (seen.has(fingerprint)) row.repeated = true;
      seen.add(fingerprint);
      rows.push(row);
    }
  }
  return { sheets: used.map((u) => u.sheet.name), rows };
}
