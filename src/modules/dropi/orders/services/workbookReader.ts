import type { Cell, Sheet, Workbook } from "../../../../types/excel";
import { cellDate, compareDates, MONTHS_ES, formatDateShort, type SimpleDate } from "../../../../utils/dates";
import { formatInteger } from "../../../../utils/format";
import { DropiError, type DropiOrderRow, type InvalidMoneyCell, type ParsedOrdersFile, type ReadResult } from "../types";
import { statusKey } from "./statuses";

/** Encabezados propios del reporte completo de órdenes de Dropi. */
const SIGNATURE = [
  "FECHA DE REPORTE",
  "ID",
  "HORA",
  "FECHA",
  "NOMBRE CLIENTE",
  "NÚMERO GUIA",
  "ESTATUS",
  "VALOR FACTURADO",
  "VALOR DE COMPRA EN PRODUCTOS",
  "PRECIO FLETE",
  "COSTO DEVOLUCION FLETE",
  "TOTAL EN PRECIOS DE PROVEEDOR",
];

/** Columnas sin las cuales no se calcula el cierre. */
export const REQUIRED = {
  id: "ID",
  status: "ESTATUS",
  purchase: "VALOR DE COMPRA EN PRODUCTOS",
  supplier: "TOTAL EN PRECIOS DE PROVEEDOR",
  freight: "PRECIO FLETE",
  returnFreight: "COSTO DEVOLUCION FLETE",
} as const;

/** Columnas informativas (búsqueda, empresa y periodo). */
const OPTIONAL = {
  guide: "NÚMERO GUIA",
  invoice: "NUMERO DE FACTURA",
  customer: "NOMBRE CLIENTE",
  date: "FECHA",
  company: "RAZON SOCIAL PARA FACTURACION",
} as const;

/** Una hoja es candidata si su encabezado tiene al menos esta cantidad de columnas del reporte. */
const MIN_SIGNATURE = 4;
/** El encabezado se busca en las primeras filas de cada hoja. */
const HEADER_SCAN_ROWS = 20;

/** Encabezado comparable: como los estados (sin tildes, mayúsculas, "_" y espacios). */
const headerKey = statusKey;
const SIGNATURE_KEYS = SIGNATURE.map(headerKey);

function cellText(cell: Cell | undefined): string {
  if (!cell) return "";
  switch (cell.t) {
    case "s":
    case "d":
    case "x":
      return cell.v.trim();
    case "n":
      return String(cell.v);
    case "b":
      return cell.v ? "VERDADERO" : "FALSO";
    default:
      return "";
  }
}

const isEmpty = (cell: Cell | undefined) => !cell || cell.t === "e" || (cell.t === "s" && !cell.v.trim());

/**
 * Importe de una celda en centavos. Vacía = 0. Acepta números de Excel y
 * textos como "99900", "14505.5", "$ 99.900" o "14.505,50".
 * null = valor no válido (texto que no es un importe).
 */
export function moneyCents(cell: Cell | undefined): number | null {
  if (isEmpty(cell)) return 0;
  let value: number;
  if (cell!.t === "n") {
    value = cell!.v;
  } else if (cell!.t === "s") {
    const t = cell!.v.replace(/[$\s]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(t) && !/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
      value = Number(t); // 99900 · 14505.5
    } else if (/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(t)) {
      value = Number(t.replace(/\./g, "").replace(",", ".")); // 99.900 · 14.505,50
    } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) {
      value = Number(t.replace(/,/g, "")); // 14,505.50
    } else {
      return null;
    }
  } else {
    return null;
  }
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** ID como texto: 87878765 (número de Excel) y "87878765" son el mismo pedido. */
const orderId = cellText;

interface HeaderMatch {
  rowIndex: number;
  /** Clave normalizada → índice de columna (primera aparición). */
  columns: Map<string, number>;
  score: number;
}

function findHeader(sheet: Sheet): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  sheet.rows.slice(0, HEADER_SCAN_ROWS).forEach((row, rowIndex) => {
    const columns = new Map<string, number>();
    row.forEach((cell, i) => {
      const key = headerKey(cellText(cell));
      if (key && !columns.has(key)) columns.set(key, i);
    });
    const score = SIGNATURE_KEYS.filter((k) => columns.has(k)).length;
    if (score > (best?.score ?? 0)) best = { rowIndex, columns, score };
  });
  return best && (best as HeaderMatch).score >= MIN_SIGNATURE ? best : null;
}

const missingRequired = (h: HeaderMatch) => Object.values(REQUIRED).filter((name) => !h.columns.has(headerKey(name)));

/** Filas con datos debajo del encabezado (se omiten las totalmente vacías en las columnas requeridas). */
function dataRowIndexes(sheet: Sheet, h: HeaderMatch): number[] {
  const cols = Object.values(REQUIRED).map((name) => h.columns.get(headerKey(name))!);
  const out: number[] = [];
  for (let r = h.rowIndex + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    if (cols.some((c) => !isEmpty(row[c]))) out.push(r);
  }
  return out;
}

function monthPeriod(dates: SimpleDate[]): string | undefined {
  if (dates.length === 0) return undefined;
  const sorted = [...dates].sort(compareDates);
  const [min, max] = [sorted[0], sorted[sorted.length - 1]];
  if (min.year === max.year && min.month === max.month) {
    const month = MONTHS_ES[min.month - 1];
    return `${month[0]}${month.slice(1).toLowerCase()} ${min.year}`;
  }
  return `${formatDateShort(min)} a ${formatDateShort(max)}`;
}

function extract(workbook: Workbook, sheet: Sheet, h: HeaderMatch, sheetReason: string): ParsedOrdersFile {
  const col = (name: string) => h.columns.get(headerKey(name));
  const at = (row: Cell[], name: string) => {
    const c = col(name);
    return c === undefined ? undefined : row[c];
  };
  const optionalText = (row: Cell[], name: string) => {
    const c = col(name);
    if (c === undefined) return undefined;
    return cellText(row[c]) || undefined;
  };

  const rows: DropiOrderRow[] = [];
  const invalidMoney: InvalidMoneyCell[] = [];
  const rowsWithoutId: number[] = [];
  const rowsWithoutStatus: number[] = [];
  const companies = new Set<string>();
  const dates: SimpleDate[] = [];

  for (const r of dataRowIndexes(sheet, h)) {
    const row = sheet.rows[r];
    const rowNumber = r + 1;
    const money = (name: string) => {
      const cell = at(row, name);
      const cents = moneyCents(cell);
      if (cents === null) {
        invalidMoney.push({ rowNumber, column: name, text: cellText(cell) });
        return 0;
      }
      return cents;
    };
    const id = orderId(at(row, REQUIRED.id));
    const status = cellText(at(row, REQUIRED.status));
    if (!id) rowsWithoutId.push(rowNumber);
    if (!status) rowsWithoutStatus.push(rowNumber);

    const dateCell = at(row, OPTIONAL.date);
    const date = cellDate(dateCell);
    if (date) dates.push(date);
    const company = optionalText(row, OPTIONAL.company);
    if (company) companies.add(company);

    rows.push({
      rowNumber,
      id,
      status,
      statusKey: statusKey(status),
      purchaseCents: money(REQUIRED.purchase),
      supplierCents: money(REQUIRED.supplier),
      freightCents: money(REQUIRED.freight),
      returnFreightCents: money(REQUIRED.returnFreight),
      guide: optionalText(row, OPTIONAL.guide),
      invoice: optionalText(row, OPTIONAL.invoice),
      customer: optionalText(row, OPTIONAL.customer),
      date: date ? formatDateShort(date) : cellText(dateCell) || undefined,
    });
  }

  if (rows.length === 0) throw new DropiError(`La hoja «${sheet.name}» tiene los encabezados de órdenes de Dropi, pero no contiene órdenes.`);

  return {
    fileName: workbook.fileName,
    sheetName: sheet.name,
    sheetReason,
    ignoredSheets: workbook.sheets.filter((s) => s !== sheet).map((s) => s.name),
    rows,
    // Solo si el archivo trae una única razón social: no se adivina entre varias.
    company: companies.size === 1 ? [...companies][0] : undefined,
    period: monthPeriod(dates),
    invalidMoney,
    rowsWithoutId,
    rowsWithoutStatus,
  };
}

/**
 * Identifica la hoja de órdenes por sus encabezados (no por el nombre ni por
 * ser la más grande) y lee las columnas por nombre. Las hojas con pivotes o
 * resúmenes no tienen esos encabezados y se ignoran.
 *
 * `sheetName` fuerza una hoja (cuando el usuario la eligió).
 */
export function readOrdersWorkbook(workbook: Workbook, sheetName?: string): ReadResult {
  const matches = workbook.sheets.map((sheet) => ({ sheet, header: findHeader(sheet) })).filter((m) => m.header !== null) as {
    sheet: Sheet;
    header: HeaderMatch;
  }[];

  if (sheetName !== undefined) {
    const chosen = matches.find((m) => m.sheet.name === sheetName);
    if (!chosen) throw new DropiError(`La hoja «${sheetName}» no tiene la estructura de órdenes de Dropi.`);
    assertColumns(chosen.header);
    return { kind: "ok", file: extract(workbook, chosen.sheet, chosen.header, "Seleccionada por el usuario.") };
  }

  if (matches.length === 0) throw new DropiError("No se encontró una hoja con la estructura de órdenes de Dropi.");

  const complete = matches.filter((m) => missingRequired(m.header).length === 0);
  if (complete.length === 0) {
    // Se informa sobre la hoja que más se parece al reporte.
    const best = [...matches].sort((a, b) => b.header.score - a.header.score)[0];
    assertColumns(best.header);
  }

  if (complete.length === 1) {
    const [only] = complete;
    const reason = matches.length === 1 ? "Única hoja con los encabezados del reporte de órdenes." : "Única hoja con todas las columnas requeridas.";
    return { kind: "ok", file: extract(workbook, only.sheet, only.header, reason) };
  }

  // Varias hojas con la estructura: se usa la del conjunto de órdenes más completo.
  const counted = complete.map((m) => ({ ...m, rows: dataRowIndexes(m.sheet, m.header).length })).sort((a, b) => b.rows - a.rows);
  if (counted[0].rows === counted[1].rows) {
    return { kind: "choose-sheet", candidates: counted.map((c) => ({ name: c.sheet.name, rows: c.rows })) };
  }
  const others = counted
    .slice(1)
    .map((c) => `«${c.sheet.name}» (${formatInteger(c.rows)})`)
    .join(", ");
  const reason = `Tiene el conjunto de órdenes más completo (${formatInteger(counted[0].rows)} filas); también tienen la estructura: ${others}.`;
  return { kind: "ok", file: extract(workbook, counted[0].sheet, counted[0].header, reason) };
}

function assertColumns(header: HeaderMatch) {
  const missing = missingRequired(header);
  if (missing.length === 1) throw new DropiError(`El archivo no contiene la columna «${missing[0]}».`);
  if (missing.length > 1) throw new DropiError(`El archivo no contiene las columnas ${missing.map((m) => `«${m}»`).join(", ")}.`);
}
