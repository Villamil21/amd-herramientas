import type { ExogenaWorkbookInput } from "../../../services/exogenaService";
import type { ExoRecord, FormatStatusRow } from "../../../types/exogena";
import { FORMAT_STATUS_LABEL } from "../../../types/exogena";
import { formatMoneyCents } from "../../../utils/format";
import { findFormat, IMPLEMENTED_FORMATS } from "./formats";
import type { Reconciliation } from "./form1009";
import { exportInteger } from "./numbers";
import { blocking, type Problem } from "./problems";

/**
 * Exportación de Información Exógena: un único .xlsx con una hoja por formato implementado y aplicable (marcado «listo»).
 * Antes de exportar se bloquea, explicando por qué, cualquier formato que no esté listo ni marcado «No aplica», que tenga
 * pendientes o (1009) una diferencia de conciliación.
 */

export interface ExportBlocker {
  format: string;
  message: string;
}

export interface ExportState {
  statuses: Record<string, FormatStatusRow>;
  /** Pendientes calculados ahora mismo con los datos actuales (no solo el estado guardado). */
  problems: Record<string, Problem[]>;
  reconciliation1009: Reconciliation | null;
}

export function exportBlockers(state: ExportState): ExportBlocker[] {
  const out: ExportBlocker[] = [];
  let applicable = 0;
  for (const f of IMPLEMENTED_FORMATS) {
    const row = state.statuses[f.code];
    const status = row?.status ?? "en_preparacion";
    if (status === "no_aplica") continue;
    if (status !== "listo") {
      out.push({ format: f.code, message: `${f.code} está «${FORMAT_STATUS_LABEL[status]}»: márcalo como listo o como «No aplica» para poder exportar.` });
      continue;
    }
    applicable += 1;
    const stoppers = blocking(state.problems[f.code] ?? []);
    if (stoppers.length) out.push({ format: f.code, message: `${f.code} tiene ${stoppers.length} ${stoppers.length === 1 ? "pendiente" : "pendientes"} (${stoppers[0].message})` });
    if (f.code === "1009" && state.reconciliation1009 && state.reconciliation1009.differenceCents !== 0) {
      out.push({ format: "1009", message: `1009: la diferencia de conciliación con el ESF es ${formatMoneyCents(state.reconciliation1009.differenceCents)}; debe ser cero.` });
    }
  }
  if (out.length === 0 && applicable === 0) out.push({ format: "", message: "No hay formatos aplicables para exportar: todos están marcados «No aplica»." });
  return out;
}

const textOf = (v: unknown): string | null => {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s === "" ? null : s;
};

/** Orden estable de los registros dentro de la hoja. */
function sortRecords(code: string, records: ExoRecord[]): ExoRecord[] {
  const key = (r: ExoRecord) => (code === "1009" ? `${String(r.data.concept ?? "")}|${String(r.data.docNumber ?? "")}` : `${String(r.data.docNumber ?? "")}`);
  return [...records].sort((a, b) => key(a).localeCompare(key(b)) || a.id - b.id);
}

/** Valores de un registro en el orden de las columnas del formato: identificadores y códigos como texto, montos y porcentajes como enteros. */
export function rowOf(code: string, record: Pick<ExoRecord, "data">): (string | number | null)[] {
  const format = findFormat(code);
  if (!format?.columns) throw new Error(`El formato ${code} no está implementado.`);
  return format.columns.map((col) => {
    const v = record.data[col.key];
    if (col.kind === "integer") return typeof v === "number" && Number.isFinite(v) ? exportInteger(v) : null;
    return textOf(v);
  });
}

export function buildExportWorkbook(args: { company: { razonSocial: string; nit: string; dv: string }; year: number; statuses: Record<string, FormatStatusRow>; records: Record<string, ExoRecord[]> }): ExogenaWorkbookInput {
  const sheets = IMPLEMENTED_FORMATS.filter((f) => args.statuses[f.code]?.status === "listo").map((f) => ({
    name: f.code,
    title: f.sheetTitle,
    columns: f.columns!.map((c) => ({ header: c.header, kind: c.kind })),
    rows: sortRecords(f.code, args.records[f.code] ?? []).map((r) => rowOf(f.code, r)),
  }));
  return { companyName: args.company.razonSocial, companyNit: args.company.dv ? `${args.company.nit}-${args.company.dv}` : args.company.nit, year: args.year, sheets };
}

/** Nombre sugerido del archivo: Exogena_2025_RAZON_SOCIAL. */
export const suggestedExportName = (company: { razonSocial: string }, year: number) =>
  `Exogena_${year}_${company.razonSocial.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)}`;
