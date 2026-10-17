import { isEmptyPeriodBatch, SOURCE_LABEL, type BankAccountLifecycle, type BankBalance, type BatchSummary, type Employee, type FsSource, type Movement, type PayrollRow } from "../../../types/fs";
import { employeeKey, findAbsences, type Absence } from "../payroll/calc";
import { monthsBetween, periodLabel } from "../shared/money";
import { periodsPerYear } from "../tax-obligations/services/effects";
import type { TaxEmptyPeriod, TaxPeriodicity, TaxReturn, VatPeriodicity } from "../tax-obligations/types";
import { statementMonths } from "../bank/bankAccounting";
import { isBalanced, pendingBankBalances, type BankBalanceStatus, type Statements } from "./engine";

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
  /** El mes está cubierto solo por un registro «periodo sin actividad» (✓ Sin compras…). */
  emptyDeclared?: boolean;
}

export interface CoverageRow {
  source: FsSource;
  label: string;
  cells: Record<string, CoverageCell>;
  /** Meses del rango sin información. */
  missing: string[];
  /** La fuente no tiene nada en el rango (no se considera faltante mes a mes). */
  empty: boolean;
  /** Solo extractos: el detalle por banco y cuenta del que sale la fila. */
  bank?: BankCoverage;
  /**
   * Fuente que no es mensual (Saldos iniciales = foto de apertura; Ajustes =
   * puntuales): un mes sin datos no falta. `snapshotDates`: fechas de apertura
   * activas hasta la fecha final (incluso anteriores al rango).
   */
  notMonthly?: { snapshotDates: string[] };
}

/** Fuentes que no se esperan mes a mes. */
export const NOT_MONTHLY_SOURCES: FsSource[] = ["opening", "adjustment"];

/**
 * Qué meses del rango tienen información de cada fuente, sin suponer que se
 * importó en orden (enero, febrero, abril y junio cargados → faltan marzo, mayo, julio y agosto).
 */
export function coverage(
  start: string,
  end: string,
  movements: Movement[],
  balances: BankBalance[],
  batches: BatchSummary[],
  lifecycles: BankAccountLifecycle[] = [],
): { months: string[]; rows: CoverageRow[] } {
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
    if (source === "bank") {
      // Una sola marca global sería engañosa: el mes está completo solo si TODAS las cuentas lo tienen.
      const bank = bankCoverage(months, movements, balances, batches, lifecycles);
      for (const m of months) {
        const c = bank.cells[m];
        // Un mes en que ninguna cuenta estaba abierta («No aplica») no falta.
        const loaded = c.total > 0 ? c.loaded === c.total : bank.banks.length > 0 && c.notApplicable > 0;
        cells[m] = { loaded, batches: c.batches, records: c.loaded };
      }
      // Sin saldo del mes final la fuente bancaria tampoco está completa.
      const last = months[months.length - 1];
      if (last && bank.finalBalanceMissing > 0) cells[last] = { ...cells[last], loaded: false };
      const missing = months.filter((m) => !cells[m].loaded);
      return { source, label: SOURCE_LABEL[source], cells, missing, empty: bank.banks.length === 0, bank };
    }
    for (const m of movements) {
      if (m.source !== source) continue;
      const active = m.status === "active";
      if (source === "payroll") {
        // Nómina: el mes cubierto es el de la planilla (periodStart–periodEnd), no el de la fecha contable de pago de sus aportes.
        const b = batchById.get(m.batchId);
        if (b?.periodStart) {
          for (const month of monthsBetween(b.periodStart, b.periodEnd ?? b.periodStart)) add(month, m.batchId, active);
          continue;
        }
      }
      if (m.accountingDate >= start && m.accountingDate <= end) add(m.accountingDate.slice(0, 7), m.batchId, active);
    }
    // «Registrar periodo sin …»: el mes queda cubierto sin movimientos.
    for (const b of batches) {
      if (b.source !== source || !isEmptyPeriodBatch(b) || !b.periodStart) continue;
      const cell = cells[b.periodStart.slice(0, 7)];
      if (!cell) continue;
      if (!cell.batches.includes(b)) cell.batches.push(b);
      if (b.status !== "active") continue;
      if (!cell.loaded) cell.emptyDeclared = true;
      cell.loaded = true;
    }
    if (NOT_MONTHLY_SOURCES.includes(source)) {
      const snapshotDates = source === "opening" ? [...new Set(movements.filter((m) => m.source === "opening" && m.status === "active" && m.accountingDate <= end).map((m) => m.accountingDate))].sort() : [];
      const empty = source === "opening" ? snapshotDates.length === 0 : months.every((m) => !cells[m].loaded);
      return { source, label: SOURCE_LABEL[source], cells, missing: [], empty, notMonthly: { snapshotDates } };
    }
    const missing = months.filter((m) => !cells[m].loaded);
    return { source, label: SOURCE_LABEL[source], cells, missing, empty: missing.length === months.length };
  });
  return { months, rows };
}

/** Un extracto enviado (activo, reemplazado o anulado) con lo que el detalle del mes necesita. */
export interface BankStatementInfo {
  batch: BatchSummary;
  bank: string;
  accountNumber: string;
  /** Meses AAAA-MM que cubre el periodo del extracto. */
  months: string[];
  /** Movimientos originales del extracto (los agrupados por concepto enviados). */
  movementCount: number;
  closingBalanceCents: number | null;
  /** Envíos que este extracto reemplazó. */
  replaced: BatchSummary[];
}

/** Mes de una cuenta, banco o del total: cuántas cuentas lo tienen activo y qué extractos lo tocan. */
export interface BankCell {
  loaded: number;
  total: number;
  statements: BankStatementInfo[];
  batches: BatchSummary[];
  /** Algún extracto de ese mes fue reemplazado (el historial sigue visible en el detalle). */
  hasReplaced: boolean;
  /** Cuentas para las que el mes «No aplica» (antes de su apertura o después de su cierre): no se esperan. */
  notApplicable: number;
}

export interface BankAccountCoverage {
  key: string;
  bank: string;
  accountNumber: string;
  cells: Record<string, BankCell>;
  missing: string[];
  /** Último mes con extracto activo, en cualquier fecha (no solo el rango). */
  lastMonth: string | null;
  /** Falta el saldo del mes final del rango: el ESF de esta cuenta queda pendiente. */
  finalBalanceMissing: boolean;
  /** Apertura / cierre confirmados por el usuario (si hay). */
  lifecycle: BankAccountLifecycle | null;
}

export interface BankCoverageGroup {
  bank: string;
  accounts: BankAccountCoverage[];
  cells: Record<string, BankCell>;
  missingCount: number;
}

export interface BankCoverage {
  banks: BankCoverageGroup[];
  cells: Record<string, BankCell>;
  /** Pares cuenta + mes sin extracto activo en el rango. */
  missingCount: number;
  accountsWithMissing: number;
  /** Cuentas sin saldo del mes final (pendientes en el ESF). */
  finalBalanceMissing: number;
}

/** «••••7491»; sin número, «Sin número de cuenta». */
export const maskAccount = (accountNumber: string) => {
  const digits = accountNumber.replace(/\D/g, "");
  return digits ? `••••${digits.slice(-4)}` : accountNumber.trim() || "Sin número de cuenta";
};

const accountKey = (bank: string, accountNumber: string) => `${bank.trim()}|${accountNumber.trim()}`;

/** Extractos de la empresa con su banco, cuenta y meses, tomados de lo que quedó registrado al enviar. */
export function bankStatements(movements: Movement[], balances: BankBalance[], batches: BatchSummary[]): BankStatementInfo[] {
  const bankBatches = batches.filter((b) => b.source === "bank");
  return bankBatches.map((batch) => {
    const own = movements.filter((m) => m.batchId === batch.id);
    const ownBalances = balances.filter((b) => b.batchId === batch.id);
    const meta = batch.metadata ?? {};
    const bank = String(meta.bank ?? own[0]?.bank ?? ownBalances[0]?.bank ?? "").trim() || "Banco sin identificar";
    const accountNumber = String(meta.accountNumber ?? own[0]?.accountNumber ?? ownBalances[0]?.accountNumber ?? "").trim();
    const months =
      batch.periodStart && batch.periodEnd ? statementMonths(batch.periodStart, batch.periodEnd) : [...new Set([...own.map((m) => m.accountingDate), ...ownBalances.map((b) => b.balanceDate)].map((d) => d.slice(0, 7)))].sort();
    const movementCount = own.reduce((sum, m) => sum + (typeof m.detail?.count === "number" ? m.detail.count : 1), 0);
    const balance = [...ownBalances].sort((a, b) => b.balanceDate.localeCompare(a.balanceDate))[0];
    return { batch, bank, accountNumber, months, movementCount, closingBalanceCents: balance ? balance.balanceCents : null, replaced: bankBatches.filter((b) => b.replacedBy === batch.id) };
  });
}

function emptyCell(): BankCell {
  return { loaded: 0, total: 0, statements: [], batches: [], hasReplaced: false, notApplicable: 0 };
}

/**
 * ¿La cuenta estaba abierta ese mes? Antes de la apertura confirmada o después
 * del cierre confirmado el mes «No aplica». Sin apertura conocida se espera
 * desde el inicio del rango; sin cierre, se sigue esperando.
 */
export function accountApplies(lifecycle: Pick<BankAccountLifecycle, "openedPeriod" | "closedPeriod"> | null | undefined, month: string): boolean {
  if (!lifecycle) return true;
  if (lifecycle.openedPeriod && month < lifecycle.openedPeriod) return false;
  if (lifecycle.closedPeriod && month > lifecycle.closedPeriod) return false;
  return true;
}

function mergeCells(months: string[], parts: Record<string, BankCell>[]): Record<string, BankCell> {
  return Object.fromEntries(
    months.map((m) => {
      const cell = emptyCell();
      for (const p of parts) {
        const c = p[m];
        cell.loaded += c.loaded;
        cell.total += c.total;
        cell.statements.push(...c.statements);
        cell.batches.push(...c.batches);
        cell.hasReplaced ||= c.hasReplaced;
        cell.notApplicable += c.notApplicable;
      }
      return [m, cell];
    }),
  );
}

/**
 * Cobertura de extractos por banco y por cuenta (empresa + banco + número de
 * cuenta + periodo). Solo aparecen las cuentas que la empresa ha enviado alguna
 * vez; cada una se espera en los meses del rango en que estuvo abierta (sin
 * apertura o cierre confirmados, en todos) y solo cuenta el extracto activo (uno
 * reemplazado o anulado se ve en el detalle, no marca el mes).
 */
export function bankCoverage(months: string[], movements: Movement[], balances: BankBalance[], batches: BatchSummary[], lifecycles: BankAccountLifecycle[] = []): BankCoverage {
  const statements = bankStatements(movements, balances, batches);
  const lifecycleByKey = new Map(lifecycles.map((l) => [accountKey(l.bank, l.accountNumber), l]));
  const accounts = new Map<string, BankAccountCoverage>();
  for (const s of statements) {
    const key = accountKey(s.bank, s.accountNumber);
    let account = accounts.get(key);
    if (!account) {
      const lifecycle = lifecycleByKey.get(key) ?? null;
      const cells = Object.fromEntries(months.map((m) => [m, accountApplies(lifecycle, m) ? { ...emptyCell(), total: 1 } : { ...emptyCell(), notApplicable: 1 }]));
      account = { key, bank: s.bank, accountNumber: s.accountNumber, cells, missing: [], lastMonth: null, finalBalanceMissing: false, lifecycle };
      accounts.set(key, account);
    }
    const active = s.batch.status === "active";
    if (active && s.months.length) {
      const last = s.months[s.months.length - 1];
      if (!account.lastMonth || last > account.lastMonth) account.lastMonth = last;
    }
    for (const m of s.months) {
      const cell = account.cells[m];
      if (!cell) continue;
      if (active) {
        cell.loaded = 1;
        // Un extracto activo en un mes «No aplica» igual se muestra como cargado.
        cell.total = 1;
        cell.notApplicable = 0;
      }
      if (s.batch.status === "replaced") cell.hasReplaced = true;
      cell.statements.push(s);
      cell.batches.push(s.batch);
    }
  }
  // Solo las cuentas con algún envío vigente o reemplazado: una cuenta con todo anulado no se «espera».
  const live = [...accounts.values()].filter((a) => statements.some((s) => accountKey(s.bank, s.accountNumber) === a.key && s.batch.status !== "voided"));
  const finalMonth = months[months.length - 1];
  for (const a of live) {
    a.missing = months.filter((m) => a.cells[m].total > 0 && a.cells[m].loaded === 0);
    // El mes final da el saldo del ESF: sin un saldo activo de ese mes la cuenta queda pendiente (aunque el extracto exista sin saldo).
    // Una cuenta cerrada (o aún no abierta) ese mes no tiene saldo pendiente: es 0.
    a.finalBalanceMissing =
      finalMonth !== undefined &&
      accountApplies(a.lifecycle, finalMonth) &&
      !balances.some((b) => b.active && accountKey(b.bank, b.accountNumber) === a.key && b.balanceDate.slice(0, 7) === finalMonth);
  }
  const byBank = new Map<string, BankAccountCoverage[]>();
  for (const a of live) byBank.set(a.bank, [...(byBank.get(a.bank) ?? []), a]);
  const banks = [...byBank.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es", { sensitivity: "base" }))
    .map(([bank, list]) => {
      const sorted = list.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
      return { bank, accounts: sorted, cells: mergeCells(months, sorted.map((a) => a.cells)), missingCount: sorted.reduce((n, a) => n + a.missing.length, 0) };
    });
  return {
    banks,
    cells: mergeCells(months, banks.map((b) => b.cells)),
    missingCount: banks.reduce((n, b) => n + b.missingCount, 0),
    accountsWithMissing: live.filter((a) => a.missing.length > 0).length,
    finalBalanceMissing: live.filter((a) => a.finalBalanceMissing).length,
  };
}

/**
 * Cobertura de obligaciones tributarias, cada impuesto con su propia
 * periodicidad: Retefuente por mes, IVA por periodo (bimestral o
 * cuatrimestral, sin convertirlo en meses) y Renta por año gravable.
 * Solo cuentan las declaraciones vigentes (no las reemplazadas).
 */
export interface TaxCoverage {
  vatPeriodicity: VatPeriodicity | null;
  withholding: Record<string, TaxReturn[]>;
  vat: { periodicity: TaxPeriodicity | null; periods: { key: string; year: number; period: number; months: string[]; returns: TaxReturn[] }[] };
  income: { year: number; returns: TaxReturn[] }[];
  counts: { withholding: number; vat: number; income: number };
  /** Periodos registrados «sin obligación» (clave: «withholding:2026-03», «vat:2026-2», «income:2025»). */
  empty: Set<string>;
}

export function taxCoverage(months: string[], returns: TaxReturn[], vatPeriodicity: VatPeriodicity | null, end: string, empties: TaxEmptyPeriod[] = []): TaxCoverage {
  const empty = new Set(
    empties
      .filter((e) => e.status === "active")
      .map((e) => (e.taxType === "withholding" ? `withholding:${e.year}-${String(e.period).padStart(2, "0")}` : e.taxType === "vat" ? `vat:${e.periodicity}:${e.year}-${e.period}` : `income:${e.year}`)),
  );
  const live = returns.filter((r) => r.supersededBy === null);
  const withholding = Object.fromEntries(months.map((m) => [m, live.filter((r) => r.taxType === "withholding" && r.periodStart.slice(0, 7) === m)]));
  const vatReturns = live.filter((r) => r.taxType === "vat");
  const periodicity = vatPeriodicity ?? vatReturns[vatReturns.length - 1]?.periodicity ?? null;
  const periods: TaxCoverage["vat"]["periods"] = [];
  if (periodicity && periodicity !== "annual" && periodicity !== "monthly") {
    const size = 12 / periodsPerYear(periodicity);
    for (const m of months) {
      const year = Number(m.slice(0, 4));
      const period = Math.floor((Number(m.slice(5, 7)) - 1) / size) + 1;
      const key = `${year}-${period}`;
      let p = periods.find((x) => x.key === key);
      if (!p) periods.push((p = { key, year, period, months: [], returns: vatReturns.filter((r) => r.year === year && r.period === period && r.periodicity === periodicity) }));
      p.months.push(m);
    }
  }
  const incomeReturns = live.filter((r) => r.taxType === "income");
  const years = incomeReturns.map((r) => r.year);
  const income: TaxCoverage["income"] = [];
  if (years.length) for (let y = Math.min(...years); y <= Math.max(...years, Number(end.slice(0, 4)) - 1); y++) income.push({ year: y, returns: incomeReturns.filter((r) => r.year === y) });
  return { vatPeriodicity, withholding, vat: { periodicity, periods }, income, counts: { withholding: returns.filter((r) => r.taxType === "withholding").length, vat: vatReturns.length, income: incomeReturns.length }, empty };
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

/** «BBVA ••••7491: no existe saldo final de septiembre 2026. Último saldo disponible: agosto 2026.» */
export function pendingBalanceText(b: BankBalanceStatus): string {
  const last = b.lastKnown ? ` Último saldo disponible: ${monthText(b.lastKnown.balanceDate.slice(0, 7))}.` : "";
  return `${b.bank} ${maskAccount(b.accountNumber)}: no existe saldo final de ${monthText(b.month)}.${last}`;
}

/** «2026-09» → «septiembre de 2026». */
export const monthText = (month: string) => periodLabel(month).toLowerCase().replace(" ", " de ");

export function checklist(s: Statements, other: Statements, duplicates: DuplicateGroup[], absences: unknown[], payrollWithoutArea: number, cryptoStale: { year: number; reason: string }[] = [], cryptoOutside: { year: number; cutoff: string }[] = [], range: { start: string; end: string } = { start: "", end: "" }): CheckItem[] {
  const balanced = isBalanced(s);
  const sameResult = s.eerr.beforeTax === other.eerr.beforeTax;
  const pendingBalances = pendingBankBalances(s);
  const taxBlocking = s.tax.issues.filter((i) => i.level === "blocking");
  const blocking = [!balanced, s.unclassified.length > 0, duplicates.length > 0, absences.length > 0, !sameResult, pendingBalances.length > 0, taxBlocking.length > 0, cryptoStale.length > 0, cryptoOutside.length > 0].filter(Boolean).length;
  return [
    { id: "balanced", label: "Activo = Pasivo + Patrimonio", ok: balanced },
    { id: "classified", label: "Todos los PUC clasificados o excluidos", ok: s.unclassified.length === 0, detail: s.unclassified.length ? `${s.unclassified.length} sin clasificar` : undefined },
    { id: "blocking", label: "Sin alertas bloqueantes", ok: blocking === 0 },
    { id: "payroll", label: "Nómina revisada", ok: payrollWithoutArea === 0, detail: payrollWithoutArea ? `${payrollWithoutArea} empleados sin área` : undefined },
    { id: "liquidations", label: "Sin empleados pendientes de liquidación", ok: absences.length === 0, detail: absences.length ? `${absences.length} pendientes` : undefined },
    { id: "bank", label: "Sin conceptos bancarios pendientes", ok: true, detail: "Un extracto no se envía con conceptos en «Seleccionar»." },
    {
      id: "bankBalance",
      label: "Saldo bancario del mes final",
      ok: pendingBalances.length === 0,
      detail: pendingBalances.length ? `Falta saldo bancario del mes final: ${pendingBalances.map((b) => `${b.bank} ${maskAccount(b.accountNumber)}`).join(", ")}` : undefined,
    },
    {
      id: "tax",
      label: "Obligaciones tributarias revisadas",
      ok: taxBlocking.length === 0,
      detail: taxBlocking.length ? `${taxBlocking.length} ${taxBlocking.length === 1 ? "pendiente" : "pendientes"}: ${taxBlocking[0].message}` : undefined,
    },
    {
      id: "crypto",
      label: "Transacciones Cripto al día",
      ok: cryptoStale.length === 0 && cryptoOutside.length === 0,
      detail: cryptoStale.length
        ? `El efecto de ${cryptoStale.map((c) => c.year).join(", ")} se retiró del cálculo porque no se puede recalcular${cryptoStale[0].reason ? `: ${cryptoStale[0].reason}` : ""}`
        : cryptoOutside.length
          ? `Transacciones Cripto está fechado al ${cryptoOutside.map((c) => c.cutoff).join(", ")} (según su última cobertura aceptada), fuera del rango ${range.start} a ${range.end}: su efecto (Ventas y Costo de ventas) no entra. Amplía el rango del Generador hasta esa fecha.`
          : undefined,
    },
    { id: "sales", label: "Sin ventas pendientes", ok: true, detail: "Las ventas no se envían con tipos de documento sin clasificar." },
    { id: "duplicates", label: "Sin duplicados activos", ok: duplicates.length === 0, detail: duplicates.length ? `${duplicates.length} documentos en más de una importación` : undefined },
    { id: "eerr", label: "Resultado EERR validado", ok: s.unclassified.length === 0 && Number.isFinite(s.eerr.beforeTax) },
    { id: "presentation", label: "Presentación Banco/OTC no altera resultado", ok: sameResult, detail: sameResult ? undefined : `Diferencia: ${(s.eerr.beforeTax - other.eerr.beforeTax) / 100}` },
  ];
}
