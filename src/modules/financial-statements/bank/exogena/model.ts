import type { SyncProposal } from "../../../../types/exogena";
import type { BankAccountLifecycle, BankExoReview, BankProfile, BatchSummary, GmfRule, InterestRule } from "../../../../types/fs";
import { isEmptyPeriodBatch } from "../../../../types/fs";
import { centsToPesos, roundPesos } from "../../../exogena/domain/numbers";
import type { Problem } from "../../../exogena/domain/problems";
import { maskAccount } from "../../generator/checks";
import { destStatus, emptyCounts, SEVERITY_ORDER, type DestCounts, type DestStatus, type Severity } from "../../purchases/domain/status";
import { lastDayOfMonth, periodLabel } from "../../shared/money";
import { GMF_PERCENT, gmfRuleKey, gmfState, interestRuleKey, interestState, statementMonths, type ExoConcept, type StatementExoPayload } from "../bankAccounting";
import { bankExoPath, bankImportPath } from "./paths";

/**
 * Extractos bancarios → Exógena 1012, 1007 y 1011.
 *
 * Todo se calcula desde los extractos persistidos (lotes `bank` con su `metadata.exogena`), la ficha del banco, las reglas por
 * banco + concepto (GMF e intereses), el ciclo de vida de las cuentas y las decisiones del usuario: nada depende de lo que
 * esté abierto en pantalla, así un reinicio o un respaldo restaurado dan el mismo resultado.
 *
 *  - 1012 (concepto 1110): saldo final del extracto de DICIEMBRE de cada banco (cuentas sumadas). Un mes distinto nunca lo sustituye.
 *  - 1007 (concepto 4003): intereses generados de todos los meses importados del año, por banco.
 *  - 1011 (concepto 8211): el 50 % del GMF anual de todos los bancos y cuentas, en UNA fila para la empresa.
 */

export type BankExoFormat = "1012" | "1007" | "1011";
export const BANK_EXO_FORMATS: BankExoFormat[] = ["1012", "1007", "1011"];
export const BANK_EXO_CONCEPT: Record<BankExoFormat, string> = { "1012": "1110", "1007": "4003", "1011": "8211" };
export const BANK_EXO_DEST_LABEL: Record<BankExoFormat, string> = { "1012": "Formato 1012", "1007": "Formato 1007", "1011": "Formato 1011" };
export const BANK_EXO_SOURCE = "Extractos bancarios";
export const UNKNOWN_BANK = "Banco sin identificar";

/** Texto de las columnas fijas: tipo de documento NIT y país Colombia. */
export const NIT_DOC_TYPE = "31";
export const COLOMBIA_CODE = "169";

// ---------------------------------------------------------------------------
// Extractos
// ---------------------------------------------------------------------------

export interface ExoStatement {
  batchId: number;
  bank: string;
  bankKey: string;
  accountNumber: string;
  accountKey: string;
  periodStart: string;
  periodEnd: string;
  /** Mes AAAA-MM al que pertenece el extracto (el del cierre del periodo). */
  endMonth: string;
  /** Meses que cubre el periodo (para la cobertura). */
  months: string[];
  status: BatchSummary["status"];
  replacedBy: number | null;
  fileName: string;
  createdAt: string;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  movementCount: number;
  /** null = extracto enviado antes de existir los datos de Exógena: hay que reimportarlo. */
  payload: StatementExoPayload | null;
}

/** Mayúsculas y un solo espacio entre palabras (igual que `bank_key` en el backend). */
export const bankKeyOf = (bank: string) => bank.split(/\s+/).filter(Boolean).join(" ").toUpperCase();

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function parsePayload(value: unknown): StatementExoPayload | null {
  const raw = value as { version?: unknown; concepts?: unknown } | null | undefined;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.concepts)) return null;
  const concepts: ExoConcept[] = [];
  for (const c of raw.concepts as Partial<ExoConcept>[]) {
    if (typeof c?.description !== "string" || (c.dc !== "D" && c.dc !== "C") || typeof c.totalCents !== "number") return null;
    concepts.push({ description: c.description, dc: c.dc, count: typeof c.count === "number" ? c.count : 0, totalCents: c.totalCents, movements: Array.isArray(c.movements) ? c.movements : [] });
  }
  return { version: 1, concepts };
}

/** Lotes de extractos (activos, reemplazados y anulados) con lo que Exógena necesita; los «periodos sin …» no son extractos. */
export function toExoStatements(batches: BatchSummary[]): ExoStatement[] {
  const out: ExoStatement[] = [];
  for (const b of batches) {
    if (b.source !== "bank" || isEmptyPeriodBatch(b) || !b.periodStart || !b.periodEnd) continue;
    const meta = b.metadata ?? {};
    const bank = text(meta.bank) || UNKNOWN_BANK;
    const accountNumber = text(meta.accountNumber);
    const bankKey = bankKeyOf(bank);
    out.push({
      batchId: b.id,
      bank,
      bankKey,
      accountNumber,
      accountKey: `${bankKey}|${accountNumber}`,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      endMonth: b.periodEnd.slice(0, 7),
      months: statementMonths(b.periodStart, b.periodEnd),
      status: b.status,
      replacedBy: b.replacedBy,
      fileName: b.fileName,
      createdAt: b.createdAt,
      openingBalanceCents: num(meta.openingBalanceCents),
      closingBalanceCents: num(meta.closingBalanceCents),
      movementCount: num(meta.movementCount) ?? 0,
      payload: parsePayload(meta.exogena),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export interface BankExoAction {
  label: string;
  path: string;
}

export interface BankExoAlert {
  /** Estable entre cálculos. */
  id: string;
  code: string;
  severity: Severity;
  dests: BankExoFormat[];
  title: string;
  why: string;
  how: string;
  actions: BankExoAction[];
  /** Situación revisable: el usuario decide incluirla o excluirla y la decisión queda guardada. */
  review?: { key: string; value: string; includeLabel: string; excludeLabel: string };
  /** Banco / cuenta / mes que la originan (para abrir la cobertura exacta). */
  ref?: { bank: string; account?: string; month?: string };
}

export type MonthState = "loaded" | "replaced" | "voided" | "pending" | "na";

export interface MonthCell {
  month: string;
  /** La cuenta se espera ese mes (no es anterior a su apertura ni posterior a su cierre confirmados). */
  applicable: boolean;
  state: MonthState;
  /** Extractos vigentes que cubren el mes. */
  active: ExoStatement[];
  /** Extractos reemplazados o anulados que tocaron el mes (historial). */
  history: ExoStatement[];
  /** Formatos que este mes bloquea (por una alerta con ese banco, cuenta y mes). */
  blocks: BankExoFormat[];
  /** Valores del mes (solo con extracto vigente). */
  interestCents: number;
  gmfCents: number;
  closingBalanceCents: number | null;
}

export type DecemberState = "value" | "missing" | "no-balance" | "review" | "excluded" | "closed" | "not-open";

export interface DecemberResult {
  state: DecemberState;
  statement: ExoStatement | null;
  balanceCents: number | null;
  /** Extractos que ese diciembre reemplazó (trazabilidad). */
  replaced: ExoStatement[];
}

export interface AccountModel {
  key: string;
  bank: string;
  bankKey: string;
  accountNumber: string;
  label: string;
  lifecycle: BankAccountLifecycle | null;
  cells: MonthCell[];
  december: DecemberResult;
}

export type BankCoverageState = "complete" | "partial" | "missing" | "na";

export interface BankModel {
  bank: string;
  bankKey: string;
  profile: BankProfile | null;
  accounts: AccountModel[];
  coverage: BankCoverageState;
  loadedMonths: number;
  expectedMonths: number;
  /** Intereses del año (solo conceptos confirmados) y GMF neto del año de este banco, en centavos. */
  interestCents: number;
  gmfCents: number;
  decemberCents: number | null;
  /** Formatos que algún pendiente de este banco bloquea. */
  blocks: BankExoFormat[];
}

export interface Audit1012Row {
  bank: string;
  nit: string;
  accounts: { accountNumber: string; batchId: number; fileName: string; period: string; month: string; closingBalanceCents: number; replacedBatchIds: number[]; decision: string }[];
  totalCents: number;
  /** Siempre diciembre del año: un saldo de otro mes nunca lo sustituye. */
  usedMonth: string;
  substitutedByOtherMonth: false;
}

export interface Audit1007Row {
  bank: string;
  nit: string;
  months: { month: string; cents: number; items: { batchId: number; fileName: string; account: string; concept: string; date: string; description: string; cents: number }[] }[];
  totalCents: number;
}

export interface Audit1011 {
  grossCents: number;
  percent: number;
  reportedCents: number;
  reportedPesos: number;
  banks: { bank: string; grossCents: number; months: { month: string; grossCents: number; statements: { batchId: number; fileName: string; account: string; concepts: { description: string; count: number; cents: number }[] }[] }[] }[];
}

export interface BankExoResult {
  year: number;
  banks: BankModel[];
  alerts: BankExoAlert[];
  records: Record<BankExoFormat, SyncProposal[]>;
  audit: { f1012: Audit1012Row[]; f1007: Audit1007Row[]; f1011: Audit1011 };
  counts: Record<BankExoFormat, DestCounts>;
  status: Record<BankExoFormat, DestStatus>;
  /** Extractos vigentes del año con datos (sirve para decir «sin extractos» en vez de «listo»). */
  statementsInYear: number;
}

export interface BankExoInput {
  companyId: number;
  year: number;
  batches: BatchSummary[];
  profiles: BankProfile[];
  gmfRules: GmfRule[];
  interestRules: InterestRule[];
  lifecycles: BankAccountLifecycle[];
  reviews: BankExoReview[];
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthName = (m: string) => periodLabel(m).toLowerCase();

/** Claves en orden alfabético en todos los niveles: lo guardado en SQLite vuelve así y la comparación de «cambió» lo exige. */
export function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonical) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])])) as T;
  return value;
}

const compare = (a: ExoStatement, b: ExoStatement) => a.periodEnd.localeCompare(b.periodEnd) || a.createdAt.localeCompare(b.createdAt) || a.batchId - b.batchId;

/** ¿La cuenta se espera ese mes? Antes de su apertura o después de su cierre confirmados, no. */
function applies(lifecycle: BankAccountLifecycle | null, month: string): boolean {
  if (!lifecycle) return true;
  if (lifecycle.openedPeriod && month < lifecycle.openedPeriod) return false;
  if (lifecycle.closedPeriod && month > lifecycle.closedPeriod) return false;
  return true;
}

const accountText = (bank: string, accountNumber: string) => `${bank} ${maskAccount(accountNumber)}`;

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

interface InterestItem {
  statement: ExoStatement;
  concept: string;
  cents: number;
  items: { date: string; description: string; cents: number }[];
}

export function buildBankExo(input: BankExoInput): BankExoResult {
  const { year } = input;
  const decemberMonth = `${year}-12`;
  const months = monthsOf(year);
  const profiles = new Map(input.profiles.map((p) => [p.bankKey, p]));
  const gmfRules = new Map(input.gmfRules.map((r) => [gmfRuleKey(r.bank, r.concept), r]));
  const interestRules = new Map(input.interestRules.map((r) => [interestRuleKey(r.bank, r.concept), r]));
  const lifecycles = new Map(input.lifecycles.map((l) => [`${bankKeyOf(l.bank)}|${l.accountNumber.trim()}`, l]));
  const reviews = new Map(input.reviews.filter((r) => r.year === year).map((r) => [r.reviewKey, r]));
  const alerts: BankExoAlert[] = [];
  const add = (a: Omit<BankExoAlert, "actions"> & { actions?: BankExoAction[] }) => alerts.push({ actions: [], ...a });
  const focusPath = (bank: string, account?: string, month?: string) =>
    account !== undefined && month ? bankExoPath({ kind: "month", companyId: input.companyId, year, bank, account, month }) : bankExoPath({ kind: "bank", companyId: input.companyId, year, bank });

  // Un extracto sin banco se señala aparte y no forma cuenta (no hay a quién informar).
  const all = toExoStatements(input.batches);
  const known = all.filter((s) => s.bank !== UNKNOWN_BANK);

  // Cuentas: las que tienen algún extracto vigente o reemplazado (una cuenta solo con extractos anulados no se espera).
  const accounts = new Map<string, ExoStatement[]>();
  for (const s of known) accounts.set(s.accountKey, [...(accounts.get(s.accountKey) ?? []), s]);
  const accountKeys = [...accounts.keys()].filter((k) => accounts.get(k)!.some((s) => s.status !== "voided")).sort();

  const active = all.filter((s) => s.status === "active");
  const activeInYear = active.filter((s) => s.endMonth.startsWith(`${year}-`));
  const unknownBank = activeInYear.filter((s) => s.bank === UNKNOWN_BANK);
  for (const s of unknownBank) {
    add({
      id: `no-bank:${s.batchId}`,
      code: "no-bank",
      severity: "block",
      dests: ["1012", "1007", "1011"],
      title: `El extracto ${s.fileName || `#${s.batchId}`} no tiene banco asociado`,
      why: "Sin banco no hay ficha, NIT ni razón social del informado, y no se puede saber a qué banco pertenecen su saldo, sus intereses ni su GMF.",
      how: "Reimporta el extracto desde el lector de su banco y reemplaza el envío anterior.",
      actions: [{ label: "Ver extractos", path: bankExoPath() }],
    });
  }

  // --- Extractos traslapados: la misma cuenta con dos extractos vigentes que cubren el mismo mes ---------------------------
  const overlapMonths = new Map<string, Set<string>>();
  for (const key of accountKeys) {
    const own = (accounts.get(key) ?? []).filter((s) => s.status === "active");
    const seen = new Map<string, ExoStatement[]>();
    for (const s of own) for (const m of s.months) seen.set(m, [...(seen.get(m) ?? []), s]);
    for (const [m, list] of seen) {
      if (list.length < 2 || !m.startsWith(`${year}-`)) continue;
      overlapMonths.set(key, (overlapMonths.get(key) ?? new Set()).add(m));
      const first = list[0];
      add({
        id: `overlap:${key}|${m}`,
        code: "overlap",
        severity: "block",
        dests: m === decemberMonth ? ["1012", "1007", "1011"] : ["1007", "1011"],
        title: `${accountText(first.bank, first.accountNumber)} · ${monthName(m)}: más de un extracto vigente`,
        why: `Los lotes ${list.map((s) => `#${s.batchId}`).join(" y ")} cubren el mismo mes de la misma cuenta: sus saldos, intereses y GMF no se pueden sumar dos veces ni elegir uno solo.`,
        how: "Reemplaza o anula el extracto que sobra desde Extractos bancarios.",
        actions: [{ label: "Abrir el mes", path: focusPath(first.bank, first.accountNumber, m) }],
        ref: { bank: first.bank, account: first.accountNumber, month: m },
      });
    }
  }

  // --- Extractos sin datos de Exógena (enviados antes de esta versión) ------------------------------------------------------
  const legacy = activeInYear.filter((s) => s.payload === null);
  for (const s of legacy) {
    add({
      id: `legacy:${s.batchId}`,
      code: "legacy-statement",
      severity: "block",
      dests: ["1007", "1011"],
      title: `${accountText(s.bank, s.accountNumber)} · ${monthName(s.endMonth)}: extracto sin datos de intereses y GMF`,
      why: "Se envió antes de que los extractos alimentaran Exógena: no guardó todos sus conceptos, así que sus intereses y su GMF no se pueden calcular sin suponer.",
      how: "Vuelve a importar el extracto y usa «Reemplazar envío anterior»; no se duplica nada.",
      actions: [{ label: `Importar extracto de ${s.bank}`, path: bankImportPath(s.bank) }, { label: "Abrir el mes", path: focusPath(s.bank, s.accountNumber, s.endMonth) }],
      ref: { bank: s.bank, account: s.accountNumber, month: s.endMonth },
    });
  }

  // --- Intereses y GMF de los extractos vigentes del año ----------------------------------------------------------------------
  const interestByBank = new Map<string, InterestItem[]>();
  const gmfByBank = new Map<string, { statement: ExoStatement; concept: ExoConcept; cents: number }[]>();
  const suggestedInterest = new Map<string, { bank: string; concept: string; statement: ExoStatement; cents: number }>();
  const suggestedGmf = new Map<string, { bank: string; concept: string; statement: ExoStatement; cents: number }>();
  for (const s of activeInYear) {
    if (!s.payload || s.bank === UNKNOWN_BANK) continue;
    for (const c of s.payload.concepts) {
      const gmf = gmfState(s.bank, c.description, gmfRules);
      if (gmf === "confirmed") {
        // GMF neto: cargos menos devoluciones.
        gmfByBank.set(s.bankKey, [...(gmfByBank.get(s.bankKey) ?? []), { statement: s, concept: c, cents: c.dc === "D" ? c.totalCents : -c.totalCents }]);
        continue;
      }
      if (gmf === "suggested") {
        const k = `${s.bankKey}|${c.description}`;
        if (!suggestedGmf.has(k)) suggestedGmf.set(k, { bank: s.bank, concept: c.description, statement: s, cents: 0 });
        suggestedGmf.get(k)!.cents += c.totalCents;
        continue;
      }
      const interest = interestState(s.bank, c.description, c.dc, interestRules);
      if (interest === "confirmed") {
        interestByBank.set(s.bankKey, [
          ...(interestByBank.get(s.bankKey) ?? []),
          { statement: s, concept: c.description, cents: c.dc === "C" ? c.totalCents : -c.totalCents, items: c.movements.map((m) => ({ date: m.date, description: m.description, cents: Math.abs(m.amountCents) * (c.dc === "C" ? 1 : -1) })) },
        ]);
      } else if (interest === "suggested") {
        const k = `${s.bankKey}|${c.description}`;
        if (!suggestedInterest.has(k)) suggestedInterest.set(k, { bank: s.bank, concept: c.description, statement: s, cents: 0 });
        suggestedInterest.get(k)!.cents += c.totalCents;
      }
    }
  }
  for (const [k, v] of [...suggestedInterest].sort(([a], [b]) => a.localeCompare(b))) {
    add({
      id: `interest-suggested:${k}`,
      code: "interest-suggested",
      severity: "pending",
      dests: ["1007"],
      title: `${v.bank}: «${v.concept}» parece un interés generado`,
      why: "Los abonos que mencionan intereses o rendimientos solo entran al 1007 cuando confirmas que son intereses; un abono, una transferencia o una consignación no son intereses.",
      how: "Abre el mes y marca el concepto como «Es interés» o «No es interés»; la decisión queda guardada para ese banco.",
      actions: [{ label: "Revisar el concepto", path: focusPath(v.bank, v.statement.accountNumber, v.statement.endMonth) }],
      ref: { bank: v.bank, account: v.statement.accountNumber, month: v.statement.endMonth },
    });
  }
  for (const [k, v] of [...suggestedGmf].sort(([a], [b]) => a.localeCompare(b))) {
    add({
      id: `gmf-suggested:${k}`,
      code: "gmf-suggested",
      severity: "pending",
      dests: ["1011"],
      title: `${v.bank}: «${v.concept}» parece GMF / 4x1000 sin confirmar`,
      why: "Un movimiento que parece GMF no entra al 1011 hasta que se confirma por banco y concepto exacto: no se incluye automáticamente.",
      how: "Abre el mes y confirma o quita el GMF del concepto; la regla queda guardada para ese banco.",
      actions: [{ label: "Revisar el concepto", path: focusPath(v.bank, v.statement.accountNumber, v.statement.endMonth) }],
      ref: { bank: v.bank, account: v.statement.accountNumber, month: v.statement.endMonth },
    });
  }

  // Intereses y GMF por mes / banco / cuenta (para la cobertura y la auditoría).
  const interestOf = (s: ExoStatement) => (interestByBank.get(s.bankKey) ?? []).filter((i) => i.statement.batchId === s.batchId).reduce((n, i) => n + i.cents, 0);
  const gmfOf = (s: ExoStatement) => (gmfByBank.get(s.bankKey) ?? []).filter((g) => g.statement.batchId === s.batchId).reduce((n, g) => n + g.cents, 0);

  // Decisiones sobre situaciones revisables.
  const decision = (key: string) => reviews.get(key)?.decision ?? null;

  // Intereses negativos / GMF negativo (las devoluciones superan los cobros): se revisan antes de incluir.
  const interestTotals = new Map<string, number>();
  for (const [bankKey, items] of interestByBank) {
    let total = items.reduce((n, i) => n + i.cents, 0);
    if (total < 0) {
      const key = `neg-interest:${bankKey}`;
      const bank = items[0].statement.bank;
      const d = decision(key);
      if (!d) {
        add({
          id: key,
          code: "interest-negative",
          severity: "pending",
          dests: ["1007"],
          title: `${bank}: los intereses del año dan un valor negativo (${formatCents(total)})`,
          why: "Un ingreso financiero no debería ser negativo: puede ser un concepto mal marcado como interés. No se incluye hasta que lo revises.",
          how: "Revisa los conceptos marcados como interés de este banco; si el valor es correcto, inclúyelo; si no, exclúyelo.",
          actions: [{ label: "Abrir el banco", path: focusPath(bank) }],
          review: { key, value: formatCents(total), includeLabel: "Incluir el valor negativo", excludeLabel: "Excluir del 1007" },
          ref: { bank },
        });
      }
      if (d !== "include") total = 0;
    }
    interestTotals.set(bankKey, total);
  }
  const gmfBankTotals = new Map<string, number>();
  let gmfGross = 0;
  for (const [bankKey, list] of gmfByBank) {
    const total = list.reduce((n, g) => n + g.cents, 0);
    gmfBankTotals.set(bankKey, total);
    gmfGross += total;
  }
  if (gmfGross < 0) {
    const key = "neg-gmf";
    const d = decision(key);
    if (!d) {
      add({
        id: key,
        code: "gmf-negative",
        severity: "pending",
        dests: ["1011"],
        title: `El GMF anual da un valor negativo (${formatCents(gmfGross)})`,
        why: "Las devoluciones de GMF superan a los cobros del año: es una naturaleza inesperada y no se incluye sin que la revises.",
        how: "Revisa los conceptos marcados como GMF; si el valor es correcto, inclúyelo; si no, exclúyelo.",
        actions: [{ label: "Abrir la cobertura", path: bankExoPath({ kind: "bank", companyId: input.companyId, year, bank: [...gmfByBank.values()][0][0].statement.bank }) }],
        review: { key, value: formatCents(gmfGross), includeLabel: "Incluir el valor negativo", excludeLabel: "Excluir del 1011" },
      });
    }
    if (d !== "include") gmfGross = 0;
  }

  // --- Cuentas, meses y diciembre -----------------------------------------------------------------------------------------------
  const bankModels = new Map<string, BankModel>();
  const accountModels: AccountModel[] = [];
  const records: Record<BankExoFormat, SyncProposal[]> = { "1012": [], "1007": [], "1011": [] };
  const audit1012: Audit1012Row[] = [];
  const audit1007: Audit1007Row[] = [];

  for (const key of accountKeys) {
    const statements = (accounts.get(key) ?? []).slice().sort(compare);
    const first = statements[0];
    const lifecycle = lifecycles.get(key) ?? null;
    const overlap = overlapMonths.get(key) ?? new Set<string>();
    const cells: MonthCell[] = months.map((month) => {
      const covering = statements.filter((s) => s.months.includes(month));
      const act = covering.filter((s) => s.status === "active");
      const history = covering.filter((s) => s.status !== "active");
      // Un extracto vigente en un mes que «no aplica» igual se ve como cargado.
      const applicable = applies(lifecycle, month) || act.length > 0;
      const state: MonthState = act.length ? "loaded" : history.some((s) => s.status === "replaced") ? "replaced" : history.length ? "voided" : applicable ? "pending" : "na";
      const closing = act.length === 1 ? act[0].closingBalanceCents : null;
      return {
        month,
        applicable,
        state,
        active: act,
        history,
        blocks: [],
        interestCents: act.reduce((n, s) => n + (s.endMonth === month ? interestOf(s) : 0), 0),
        gmfCents: act.reduce((n, s) => n + (s.endMonth === month ? gmfOf(s) : 0), 0),
        closingBalanceCents: closing,
      };
    });

    // 1012: solo el extracto de diciembre.
    const decStatements = statements.filter((s) => s.status === "active" && s.endMonth === decemberMonth).sort(compare);
    const dec = decStatements[decStatements.length - 1] ?? null;
    const closedByDec = Boolean(lifecycle?.closedPeriod && lifecycle.closedPeriod <= decemberMonth);
    const notOpenYet = Boolean(lifecycle?.openedPeriod && lifecycle.openedPeriod > decemberMonth);
    const label = accountText(first.bank, first.accountNumber);
    let december: DecemberResult;
    if (closedByDec) december = { state: "closed", statement: null, balanceCents: null, replaced: [] };
    else if (notOpenYet) december = { state: "not-open", statement: null, balanceCents: null, replaced: [] };
    else if (!dec) {
      december = { state: "missing", statement: null, balanceCents: null, replaced: [] };
      add({
        id: `no-december:${key}`,
        code: "december-missing",
        severity: "block",
        dests: ["1012"],
        title: `${label}: falta el extracto de diciembre de ${year}`,
        why: `El 1012 informa el saldo a 31 de diciembre y solo se toma del extracto de diciembre: no se usa el de otro mes ni se supone un saldo. ${lifecycle?.closedPeriod ? `La cuenta se registró cerrada en ${monthName(lifecycle.closedPeriod)}, después del año.` : "La cuenta sigue activa."}`,
        how: "Importa el extracto de diciembre de esta cuenta; si ya estaba cerrada o aún no existía, registra su cierre o apertura y deja de exigirse.",
        actions: [{ label: `Importar extracto de ${first.bank}`, path: bankImportPath(first.bank) }, { label: "Abrir cuenta y mes", path: focusPath(first.bank, first.accountNumber, decemberMonth) }],
        ref: { bank: first.bank, account: first.accountNumber, month: decemberMonth },
      });
      cells[11].blocks.push("1012");
    } else {
      const replaced = statements.filter((s) => s.replacedBy === dec.batchId);
      const closing = dec.closingBalanceCents;
      if (closing === null) {
        december = { state: "no-balance", statement: dec, balanceCents: null, replaced };
        add({
          id: `no-balance:${key}|${decemberMonth}`,
          code: "december-no-balance",
          severity: "block",
          dests: ["1012"],
          title: `${label}: el extracto de diciembre no trae saldo final`,
          why: "Sin saldo final no se puede informar el valor al 31 de diciembre ni se debe inventar.",
          how: "Reimporta el extracto desde el lector del banco (reemplazando el envío anterior).",
          actions: [{ label: `Importar extracto de ${first.bank}`, path: bankImportPath(first.bank) }, { label: "Abrir cuenta y mes", path: focusPath(first.bank, first.accountNumber, decemberMonth) }],
          ref: { bank: first.bank, account: first.accountNumber, month: decemberMonth },
        });
        cells[11].blocks.push("1012");
      } else {
        // Situaciones que no se clasifican en silencio: sobregiro (saldo negativo) y extracto de diciembre que no llega al 31.
        const keys: { key: string; title: string; why: string; value: string }[] = [];
        if (closing < 0) keys.push({ key: `overdraft:${key}|${decemberMonth}`, title: `${label}: saldo negativo al cierre de diciembre (${formatCents(closing)})`, why: "Un saldo negativo es un sobregiro o una naturaleza inesperada para una cuenta de ahorro o corriente: no se clasifica solo.", value: formatCents(closing) });
        if (dec.periodEnd !== lastDayOfMonth(decemberMonth)) keys.push({ key: `partial:${key}|${decemberMonth}`, title: `${label}: el extracto de diciembre termina el ${dec.periodEnd}, no el 31`, why: "El saldo del 1012 es el de 31 de diciembre: este extracto puede no reflejarlo (por ejemplo, si la cuenta se cerró o el extracto quedó incompleto).", value: formatCents(closing) });
        const pendingKeys = keys.filter((k) => !decision(k.key));
        const excluded = keys.some((k) => decision(k.key) === "exclude");
        for (const k of pendingKeys) {
          add({
            id: k.key,
            code: k.key.startsWith("overdraft") ? "overdraft" : "partial-december",
            severity: "pending",
            dests: ["1012"],
            title: k.title,
            why: k.why,
            how: "Revisa el extracto y decide si el saldo se incluye en el 1012 o se excluye; la decisión queda registrada.",
            actions: [{ label: "Abrir cuenta y mes", path: focusPath(first.bank, first.accountNumber, decemberMonth) }],
            review: { key: k.key, value: k.value, includeLabel: "Incluir en el 1012", excludeLabel: "Excluir del 1012" },
            ref: { bank: first.bank, account: first.accountNumber, month: decemberMonth },
          });
        }
        december = { state: pendingKeys.length ? "review" : excluded ? "excluded" : "value", statement: dec, balanceCents: closing, replaced };
        if (pendingKeys.length) cells[11].blocks.push("1012");
      }
    }

    // Cada celda con un pendiente de intereses/GMF del mes bloquea esos formatos.
    for (const cell of cells) {
      for (const s of cell.active) {
        if (s.payload === null) cell.blocks.push("1007", "1011");
        if (overlap.has(cell.month)) cell.blocks.push("1007", "1011");
      }
      for (const a of alerts) if (a.ref?.account === first.accountNumber && a.ref.month === cell.month && a.ref.bank === first.bank) cell.blocks.push(...(a.severity === "review" ? [] : a.dests));
      cell.blocks = BANK_EXO_FORMATS.filter((f) => cell.blocks.includes(f));
    }

    const model: AccountModel = { key, bank: first.bank, bankKey: first.bankKey, accountNumber: first.accountNumber, label, lifecycle, cells, december };
    accountModels.push(model);
  }

  // Meses sin extracto en cuentas activas: el 1007 y el 1011 solo suman los meses importados (no bloquea).
  for (const a of accountModels) {
    const gaps = a.cells.filter((c) => c.applicable && c.state !== "loaded").map((c) => c.month);
    if (gaps.length === 0) continue;
    add({
      id: `gaps:${a.key}`,
      code: "months-missing",
      severity: "review",
      dests: ["1007", "1011"],
      title: `${a.label}: ${plural(gaps.length, "mes sin extracto vigente", "meses sin extracto vigente")} en ${year}`,
      why: `Los intereses del 1007 y el GMF del 1011 suman solo los meses importados (faltan ${gaps.map(monthName).join(", ")}): si esos meses tuvieron intereses o GMF, los formatos quedan incompletos.`,
      how: "Importa los extractos faltantes, o registra la apertura o el cierre de la cuenta si no existía.",
      actions: [{ label: "Ver la cobertura", path: focusPath(a.bank, a.accountNumber, gaps[0]) }],
      ref: { bank: a.bank, account: a.accountNumber, month: gaps[0] },
    });
  }

  // --- Bancos, fichas y registros ---------------------------------------------------------------------------------------------------
  const bankKeys = [...new Set(accountModels.map((a) => a.bankKey))].sort();
  for (const bankKey of bankKeys) {
    const accs = accountModels.filter((a) => a.bankKey === bankKey);
    const bank = accs[0].bank;
    const profile = profiles.get(bankKey) ?? null;
    const applicableCells = accs.flatMap((a) => a.cells.filter((c) => c.applicable));
    const loaded = applicableCells.filter((c) => c.state === "loaded").length;
    const coverage: BankCoverageState = applicableCells.length === 0 ? "na" : loaded === applicableCells.length ? "complete" : loaded === 0 ? "missing" : "partial";

    const decemberAccounts = accs.filter((a) => a.december.state === "value");
    const expectsDecember = accs.some((a) => ["value", "missing", "no-balance", "review"].includes(a.december.state));
    const interestCents = interestTotals.get(bankKey) ?? 0;
    const hasInterest = interestCents !== 0;
    const needs: BankExoFormat[] = [...(expectsDecember ? (["1012"] as const) : []), ...(hasInterest ? (["1007"] as const) : [])];
    if (needs.length && !profile) {
      add({
        id: `profile:${bankKey}`,
        code: "profile-missing",
        severity: "block",
        dests: needs,
        title: `${bank}: falta la ficha del banco para Exógena`,
        why: "El banco se informa como tercero (NIT, DV y razón social) en el 1012 y el 1007. No se inventa el NIT ni la razón social: se configuran una sola vez y se reutilizan.",
        how: "Abre la ficha del banco y escribe su NIT (sin DV) y su razón social; el DV se calcula solo.",
        actions: [{ label: `Configurar ficha de ${bank}`, path: bankExoPath({ kind: "profile", bank }) }],
        ref: { bank },
      });
    }

    // 1012
    if (profile && decemberAccounts.length) {
      const total = decemberAccounts.reduce((n, a) => n + (a.december.balanceCents ?? 0), 0);
      const row: Audit1012Row = {
        bank,
        nit: profile.nit,
        accounts: decemberAccounts
          .map((a) => ({
            accountNumber: a.accountNumber,
            batchId: a.december.statement!.batchId,
            fileName: a.december.statement!.fileName,
            period: `${a.december.statement!.periodStart} a ${a.december.statement!.periodEnd}`,
            month: decemberMonth,
            closingBalanceCents: a.december.balanceCents!,
            replacedBatchIds: a.december.replaced.map((r) => r.batchId).sort((x, y) => x - y),
            decision: reviews.has(`overdraft:${a.key}|${decemberMonth}`) || reviews.has(`partial:${a.key}|${decemberMonth}`) ? "incluido tras revisión" : "automático",
          }))
          .sort((x, y) => x.accountNumber.localeCompare(y.accountNumber)),
        totalCents: total,
        usedMonth: decemberMonth,
        substitutedByOtherMonth: false,
      };
      audit1012.push(row);
      records["1012"].push({
        sourceKey: `banco-1012:${bankKey}`,
        origin: "estados_financieros",
        originRef: `${BANK_EXO_SOURCE} · ${bank} · ${plural(row.accounts.length, "cuenta", "cuentas")} · saldo al 31/12/${year}`,
        data: { ...thirdData(profile), concept: BANK_EXO_CONCEPT["1012"], balance: centsToPesos(total), exactCents: { balance: total }, audit: canonical(row) },
      });
    }

    // 1007
    const items = interestByBank.get(bankKey) ?? [];
    if (profile && hasInterest) {
      const byMonth = new Map<string, InterestItem[]>();
      for (const i of items) byMonth.set(i.statement.endMonth, [...(byMonth.get(i.statement.endMonth) ?? []), i]);
      const row: Audit1007Row = {
        bank,
        nit: profile.nit,
        months: [...byMonth.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, list]) => ({
            month,
            cents: list.reduce((n, i) => n + i.cents, 0),
            items: list.flatMap((i) => (i.items.length ? i.items : [{ date: "", description: i.concept, cents: i.cents }]).map((m) => ({ batchId: i.statement.batchId, fileName: i.statement.fileName, account: i.statement.accountNumber, concept: i.concept, date: m.date, description: m.description, cents: m.cents }))),
          })),
        totalCents: interestCents,
      };
      audit1007.push(row);
      records["1007"].push({
        sourceKey: `banco-1007:${bankKey}`,
        origin: "estados_financieros",
        originRef: `${BANK_EXO_SOURCE} · ${bank} · intereses de ${plural(row.months.length, "mes", "meses")}`,
        data: { ...thirdData(profile), concept: BANK_EXO_CONCEPT["1007"], grossIncome: centsToPesos(interestCents), returns: 0, exactCents: { grossIncome: interestCents }, audit: canonical(row) },
      });
    }

    const blocks = BANK_EXO_FORMATS.filter((f) => alerts.some((a) => a.severity !== "review" && a.dests.includes(f) && a.ref?.bank === bank) || accs.some((a) => a.cells.some((c) => c.blocks.includes(f))));
    bankModels.set(bankKey, {
      bank,
      bankKey,
      profile,
      accounts: accs,
      coverage,
      loadedMonths: loaded,
      expectedMonths: applicableCells.length,
      interestCents,
      gmfCents: gmfBankTotals.get(bankKey) ?? 0,
      decemberCents: decemberAccounts.length ? decemberAccounts.reduce((n, a) => n + (a.december.balanceCents ?? 0), 0) : null,
      blocks,
    });
  }

  // 1011: una sola fila anual para la empresa, con el 50 % aplicado una única vez al total.
  const audit1011: Audit1011 = {
    grossCents: gmfGross,
    percent: GMF_PERCENT,
    reportedCents: (gmfGross * GMF_PERCENT) / 100,
    reportedPesos: gmfGross === 0 ? 0 : roundPesos((gmfGross * GMF_PERCENT) / 100 / 100),
    banks: [...gmfByBank.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bankKey, list]) => {
        const byMonth = new Map<string, typeof list>();
        for (const g of list) byMonth.set(g.statement.endMonth, [...(byMonth.get(g.statement.endMonth) ?? []), g]);
        return {
          bank: list[0].statement.bank,
          grossCents: gmfBankTotals.get(bankKey) ?? 0,
          months: [...byMonth.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, g]) => ({
              month,
              grossCents: g.reduce((n, x) => n + x.cents, 0),
              statements: [...new Set(g.map((x) => x.statement.batchId))].sort((x, y) => x - y).map((id) => {
                const own = g.filter((x) => x.statement.batchId === id);
                return { batchId: id, fileName: own[0].statement.fileName, account: own[0].statement.accountNumber, concepts: own.map((x) => ({ description: x.concept.description, count: x.concept.count, cents: x.cents })) };
              }),
            })),
        };
      }),
  };
  if (gmfGross !== 0) {
    records["1011"].push({
      sourceKey: `banco-1011:${BANK_EXO_CONCEPT["1011"]}`,
      origin: "estados_financieros",
      originRef: `${BANK_EXO_SOURCE} · GMF de ${plural(audit1011.banks.length, "banco", "bancos")} · ${GMF_PERCENT} % deducible`,
      data: { concept: BANK_EXO_CONCEPT["1011"], balance: audit1011.reportedPesos, exactCents: { balance: audit1011.reportedCents }, audit: canonical(audit1011) },
    });
  }

  // Cada celda recibe las alertas que la mencionan; el orden final es estable.
  alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
  const counts = Object.fromEntries(BANK_EXO_FORMATS.map((f) => [f, emptyCounts()])) as Record<BankExoFormat, DestCounts>;
  for (const a of alerts) {
    if (a.severity === "info") continue;
    for (const d of a.dests) counts[d][a.severity] += 1;
  }
  const status = Object.fromEntries(BANK_EXO_FORMATS.map((f) => [f, destStatus(counts[f])])) as Record<BankExoFormat, DestStatus>;
  for (const f of BANK_EXO_FORMATS) records[f].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));

  return { year, banks: [...bankModels.values()].sort((a, b) => a.bank.localeCompare(b.bank, "es")), alerts, records, audit: { f1012: audit1012.sort((a, b) => a.bank.localeCompare(b.bank)), f1007: audit1007.sort((a, b) => a.bank.localeCompare(b.bank)), f1011: audit1011 }, counts, status, statementsInYear: activeInYear.length };
}

/** Columnas fijas del informado: el banco es persona jurídica con NIT y domicilio en Colombia. */
function thirdData(profile: BankProfile) {
  return { docTypeCode: NIT_DOC_TYPE, docNumber: profile.nit, dv: profile.dv, firstSurname: "", secondSurname: "", firstName: "", otherNames: "", businessName: profile.businessName, countryCode: COLOMBIA_CODE };
}

function formatCents(cents: number): string {
  const pesos = Math.abs(cents) / 100;
  return `${cents < 0 ? "-" : ""}$ ${pesos.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Integración con los formatos de Exógena
// ---------------------------------------------------------------------------

/** Una alerta que bloquea o debe confirmarse impide dejar el formato listo; «Requiere revisión» solo advierte. */
export function problemsFromBankAlerts(alerts: readonly BankExoAlert[], dest: BankExoFormat): Problem[] {
  return alerts
    .filter((a) => a.severity !== "info" && a.dests.includes(dest))
    .map((a) => ({ level: a.severity === "review" ? ("warning" as const) : ("blocking" as const), message: `${a.title}: ${a.why} ${a.how}`, ...(a.actions[0] ? { action: a.actions[0] } : {}) }));
}

export interface BankExoContribution {
  result: BankExoResult;
  proposals: Record<BankExoFormat, SyncProposal[]>;
  problems: Record<BankExoFormat, Problem[]>;
}

export function buildBankExoContribution(input: BankExoInput): BankExoContribution {
  const result = buildBankExo(input);
  return { result, proposals: result.records, problems: Object.fromEntries(BANK_EXO_FORMATS.map((f) => [f, problemsFromBankAlerts(result.alerts, f)])) as Record<BankExoFormat, Problem[]> };
}
