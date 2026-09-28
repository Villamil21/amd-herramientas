/**
 * Lector del TXT de reportes UIAF.
 *
 * Estructura (construida sobre un reporte real de 643 líneas):
 * - Línea 1, encabezado de control de ancho fijo, sin "|":
 *   «         0» (consecutivo 0 alineado a la derecha) + código de la entidad
 *   + fecha de corte AAAA-MM-DD + cantidad de registros alineada a la derecha
 *   + "X". Ej. «         0210012652026-01-31       641X».
 * - Registros de detalle: 26 campos separados por "|".
 * - Última línea, cierre de control: «         0» + código de la entidad +
 *   cantidad de registros + "XXXXXXXXXXX".
 *
 * Nada se normaliza: solo se quita el fin de línea (\r\n o \n). Una línea
 * que no tiene exactamente 26 campos se informa como inválida; nunca se
 * desplazan ni se reconstruyen columnas.
 */
import { StatementError } from "../../../../bank-analysis/shared/types";
import { FIELD, UIAF_FIELD_COUNT, type UiafFooter, type UiafHeader, type UiafInvalidLine, type UiafRecord, type UiafReport, type UiafTypeGroup } from "../types";

export const UIAF_MESSAGES = {
  format: "El archivo no tiene la estructura UIAF esperada.",
  empty: "El archivo está vacío.",
} as const;

/** Hojas del Excel de referencia para los Códigos Tipo conocidos. */
const KNOWN_TYPES: Record<string, string> = { "2": "Transacciones", "3": "Sheet1" };

const HEADER = /^ *0(\d+)(\d{4}-\d{2}-\d{2}) *(\d+) *X+ *$/;
const FOOTER = /^ *0(\d+) +(\d+) *X+ *$/;

/** UTF-8 (con o sin BOM); si no es UTF-8 válido, Windows-1252 (ANSI), habitual en estos reportes. */
export function decodeUiafText(bytes: Uint8Array): { text: string; encoding: UiafReport["encoding"] } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

export function parseUiafHeader(text: string): UiafHeader | undefined {
  const m = HEADER.exec(text);
  return m ? { entityCode: m[1], reportDate: m[2], declaredCount: Number(m[3]) } : undefined;
}

export function parseUiafFooter(text: string): UiafFooter | undefined {
  const m = FOOTER.exec(text);
  return m ? { entityCode: m[1], declaredCount: Number(m[2]) } : undefined;
}

const isDetail = (line: string) => line.includes("|");

function typeGroup(codeType: string): Omit<UiafTypeGroup, "records"> {
  const known = KNOWN_TYPES[codeType];
  if (known) return { codeType, sheetName: known, label: `Código Tipo ${codeType}`, known: true };
  if (codeType === "") return { codeType, sheetName: "Sin Código Tipo", label: "Sin Código Tipo", known: false };
  return { codeType, sheetName: `Tipo ${codeType}`, label: `Código Tipo ${codeType}`, known: false };
}

export function parseUiafText(text: string, encoding: UiafReport["encoding"] = "utf-8"): UiafReport {
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  // El salto de línea final del archivo no es una línea más.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) throw new StatementError(UIAF_MESSAGES.empty);
  if (!lines.some(isDetail)) throw new StatementError(UIAF_MESSAGES.format);

  let start = 0;
  let end = lines.length;
  const report: UiafReport = { encoding, detailLines: 0, records: [], invalid: [], groups: [] };
  if (!isDetail(lines[0])) {
    report.header = { line: 1, text: lines[0], parsed: parseUiafHeader(lines[0]) };
    start = 1;
  }
  if (end - 1 > start && !isDetail(lines[end - 1])) {
    report.footer = { line: end, text: lines[end - 1], parsed: parseUiafFooter(lines[end - 1]) };
    end -= 1;
  }

  const groups = new Map<string, UiafTypeGroup>();
  for (let i = start; i < end; i++) {
    const text = lines[i];
    const line = i + 1;
    report.detailLines += 1;
    if (text.trim() === "") {
      report.invalid.push({ line, text, fieldCount: 0, reason: `La línea ${line} está vacía.` });
      continue;
    }
    const values = text.split("|");
    if (values.length !== UIAF_FIELD_COUNT) {
      report.invalid.push(invalidLine(line, text, values.length));
      continue;
    }
    const record: UiafRecord = { line, values };
    report.records.push(record);
    const code = values[FIELD.codeType];
    let group = groups.get(code);
    if (!group) groups.set(code, (group = { ...typeGroup(code), records: [] }));
    group.records.push(record);
  }

  // Siempre las hojas conocidas (aunque vengan vacías), luego los demás códigos en orden.
  for (const code of Object.keys(KNOWN_TYPES)) if (!groups.has(code)) groups.set(code, { ...typeGroup(code), records: [] });
  const rank = (g: UiafTypeGroup) => (g.known ? Object.keys(KNOWN_TYPES).indexOf(g.codeType) : Object.keys(KNOWN_TYPES).length);
  const byCode = new Intl.Collator("es", { numeric: true });
  report.groups = [...groups.values()].sort((a, b) => rank(a) - rank(b) || byCode.compare(a.codeType, b.codeType));
  return report;
}

function invalidLine(line: number, text: string, fieldCount: number): UiafInvalidLine {
  return { line, text, fieldCount, reason: `Línea ${line}: se esperaban ${UIAF_FIELD_COUNT} campos y se encontraron ${fieldCount}.` };
}

export function parseUiafBytes(bytes: Uint8Array): UiafReport {
  const { text, encoding } = decodeUiafText(bytes);
  return parseUiafText(text, encoding);
}
