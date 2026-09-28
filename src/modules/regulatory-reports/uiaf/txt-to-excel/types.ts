/**
 * Reporte UIAF en TXT: encabezado de control, registros de detalle separados
 * por "|" (26 campos) y registro final de control.
 *
 * Todos los campos se conservan como texto, exactamente como vienen en el
 * archivo (ceros a la izquierda, identificadores largos, "-1", espacios).
 */
import type { CheckStatus } from "../../../bank-analysis/shared/types";

/** Las 26 columnas del registro de detalle, en el orden del TXT. */
export const UIAF_COLUMNS = [
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
] as const;

export const UIAF_FIELD_COUNT = UIAF_COLUMNS.length;

/** Posición (base 0) de los campos que usa la lógica. */
export const FIELD = { recordNumber: 0, codeType: 2 } as const;

export interface UiafRecord {
  /** Línea del TXT (base 1). */
  line: number;
  /** Los 26 campos, tal cual. */
  values: string[];
}

export interface UiafInvalidLine {
  line: number;
  text: string;
  /** Campos encontrados al separar por "|". */
  fieldCount: number;
  reason: string;
}

/** Encabezado: «         0» + código de la entidad + fecha de corte + cantidad + "X". */
export interface UiafHeader {
  entityCode: string;
  reportDate: string;
  declaredCount: number;
}

/** Cierre: «         0» + código de la entidad + cantidad + "X…". */
export interface UiafFooter {
  entityCode: string;
  declaredCount: number;
}

export interface UiafControlLine<T> {
  line: number;
  text: string;
  /** undefined si la línea no tiene la estructura esperada. */
  parsed?: T;
}

/** Registros de un mismo Código Tipo, en el orden del TXT. */
export interface UiafTypeGroup {
  codeType: string;
  /** Nombre de la hoja exportada (compatible con el Excel de referencia). */
  sheetName: string;
  /** Nombre en la interfaz. */
  label: string;
  known: boolean;
  records: UiafRecord[];
}

export interface UiafReport {
  encoding: "utf-8" | "windows-1252";
  header?: UiafControlLine<UiafHeader>;
  footer?: UiafControlLine<UiafFooter>;
  /** Líneas entre el encabezado y el cierre (válidas + inválidas). */
  detailLines: number;
  records: UiafRecord[];
  invalid: UiafInvalidLine[];
  groups: UiafTypeGroup[];
}

export interface UiafCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** Mensajes para el usuario (los primeros casos si son muchos). */
  details?: string[];
}

export interface UiafValidation {
  valid: boolean;
  checks: UiafCheck[];
}

export interface UiafAnalysis {
  report: UiafReport;
  validation: UiafValidation;
}
