import { SOURCE_LABEL, type BankBalance, type BatchSummary, type Employee, type FsSource, type Movement, type PayrollRow } from "../../../types/fs";
import { employeeKey, findAbsences, type Absence } from "../payroll/calc";
import { monthsBetween } from "../shared/money";
import { isBalanced, type Statements } from "./engine";

/**
 * Revisión del periodo: fuentes y cobertura mensual, duplicados y la lista de
 * verificación antes de marcar «Cuadrado» o cerrar. Funciones puras.
 */

export const COVERAGE_SOURCES: FsSource[] = ["purchases", "sales_einvoice", "sales_tpsv", "payroll", "bank", "opening", "adjustment"];

export interface CoverageCell {
  loaded: boolean;
  /** Importaciones con información de ese mes (activas o reemplazadas). */
  batches: BatchSummary[];
  records: number;
}

export interface CoverageRow {
  source: FsSource;
  label: string;
  cells: Record<string, CoverageCell>;
  /** Meses del rango sin información. */
  missing: string[];
  /** La fuente no tiene nada en el rango (no se considera faltante mes a mes). */
  empty: boolean;
}

/**
 * Qué meses del rango tienen información de cada fuente, sin suponer que se
 * importó en orden (enero, febrero, abril y junio cargados → faltan marzo, mayo, julio y agosto).
 */
export function coverage(start: string, end: string, movements: Movement[], balances: BankBalance[], batches: BatchSummary[]): { months: string[]; rows: CoverageRow[] } {
  const months = monthsBetween(start, end);
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const rows: CoverageRow[] = COVERAGE_SOURCES.map((source) => {
    const cells: Record<string, CoverageCell> = Object.fromEntries(months.map((m) => [m, { loaded: false, batches: [], records: 0 }]));
    const add = (month: string, batchId: number, active: boolean) => {
      const cell = cells[month];
      if (!cell) return;
      if (active) {
        cell.loaded = true;
        cell.records++;
      }
      const b = batchById.get(batchId);
      if (b && !cell.batches.includes(b)) cell.batches.push(b);
    };
    for (const m of movements) if (m.source === source && m.accountingDate >= start && m.accountingDate <= end) add(m.accountingDate.slice(0, 7), m.batchId, m.status === "active");
    if (source === "bank") for (const b of balances) if (b.balanceDate >= start && b.balanceDate <= end) add(b.balanceDate.slice(0, 7), b.batchId, b.active);
    const missing = months.filter((m) => !cells[m].loaded);
    return { source, label: SOURCE_LABEL[source], cells, missing, empty: missing.length === months.length };
  });
  return { months, rows };
}

export interface DuplicateGroup {
  source: FsSource;
  documentId: string;
  batchIds: number[];
}

/** Un mismo documento activo en más de una importación (no debería existir: el envío lo impide). */
export function activeDuplicates(movements: Movement[]): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  for (const m of movements) {
    if (m.status !== "active" || !m.documentId) continue;
    const key = `${m.source}|${m.documentId}`;
    const g = groups.get(key) ?? { source: m.source, documentId: m.documentId, batchIds: [] };
    if (!g.batchIds.includes(m.batchId)) g.batchIds.push(m.batchId);
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.batchIds.length > 1);
}

/** Posibles retiros sin resolver en los meses de nómina del rango. */
export function payrollAbsences(start: string, end: string, employees: Employee[], rows: PayrollRow[]): (Absence & { period: string })[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const periods = [...new Set(rows.map((r) => r.period))].filter((p) => p >= start.slice(0, 7) && p <= end.slice(0, 7)).sort();
  return periods.flatMap((period) => {
    const present = new Set(rows.filter((r) => r.period === period).map((r) => byId.get(r.employeeId)).filter(Boolean).map((e) => employeeKey(e!.docType, e!.docNumber)));
    return findAbsences(period, present, employees, rows).map((a) => ({ ...a, period }));
  });
}

export interface CheckItem {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export function checklist(s: Statements, other: Statements, duplicates: DuplicateGroup[], absences: unknown[], payrollWithoutArea: number): CheckItem[] {
  const balanced = isBalanced(s);
  const sameResult = s.eerr.beforeTax === other.eerr.beforeTax;
  const blocking = [!balanced, s.unclassified.length > 0, duplicates.length > 0, absences.length > 0, !sameResult].filter(Boolean).length;
  return [
    { id: "balanced", label: "Activo = Pasivo + Patrimonio", ok: balanced },
    { id: "classified", label: "Todos los PUC clasificados o excluidos", ok: s.unclassified.length === 0, detail: s.unclassified.length ? `${s.unclassified.length} sin clasificar` : undefined },
    { id: "blocking", label: "Sin alertas bloqueantes", ok: blocking === 0 },
    { id: "payroll", label: "Nómina revisada", ok: payrollWithoutArea === 0, detail: payrollWithoutArea ? `${payrollWithoutArea} empleados sin área` : undefined },
    { id: "liquidations", label: "Sin empleados pendientes de liquidación", ok: absences.length === 0, detail: absences.length ? `${absences.length} pendientes` : undefined },
    { id: "bank", label: "Sin conceptos bancarios pendientes", ok: true, detail: "Un extracto no se envía con conceptos en «Seleccionar»." },
    { id: "sales", label: "Sin ventas pendientes", ok: true, detail: "Las ventas no se envían con tipos de documento sin clasificar." },
    { id: "duplicates", label: "Sin duplicados activos", ok: duplicates.length === 0, detail: duplicates.length ? `${duplicates.length} documentos en más de una importación` : undefined },
    { id: "eerr", label: "Resultado EERR validado", ok: s.unclassified.length === 0 && Number.isFinite(s.eerr.beforeTax) },
    { id: "presentation", label: "Presentación Banco/OTC no altera resultado", ok: sameResult, detail: sameResult ? undefined : `Diferencia: ${(s.eerr.beforeTax - other.eerr.beforeTax) / 100}` },
  ];
}
