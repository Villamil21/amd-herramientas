import type { BankEditLogEntry, BankMonthNa, BankPendingEdit, GmfRule, Period } from "../../../../types/fs";
import { gmfAccountingCents, type GmfState, type InterestState } from "../bankAccounting";
import { buildBankExoContribution, type AccountModel, type BankExoInput, type BankExoResult, type BankModel, type MonthCell } from "../exogena/model";
import { bankKeyOf, BANK_EXO_FORMATS, type BankExoFormat } from "../exogena/model";
import type { ImportedStatement, TxLine } from "../imported/model";
import { lastDayOfMonth, periodLabel } from "../../shared/money";

/**
 * Pantalla de un banco: cobertura por período (12 meses), detalle de cada extracto ya enviado, edición por concepto con
 * «Actualización pendiente» y lo que el banco aporta a 1012, 1007 y 1011. Funciones puras sobre lo persistido.
 */

export type MonthStatus = "sent" | "pending" | "update-pending" | "review" | "missing" | "na" | "not-ended";

export const MONTH_STATUS_TEXT: Record<MonthStatus, string> = {
  sent: "Enviado",
  pending: "Pendiente",
  "update-pending": "Actualización pendiente",
  review: "Requiere revisión",
  missing: "Falta",
  na: "No aplica",
  "not-ended": "Aún no termina",
};

export const MONTH_STATUS_TONE: Record<MonthStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  sent: "success",
  pending: "warning",
  "update-pending": "info",
  review: "danger",
  missing: "danger",
  na: "neutral",
  "not-ended": "neutral",
};

/** De lo que más atención pide a lo que menos: el estado de un mes con varias cuentas es el peor de ellas. */
const WORST_FIRST: MonthStatus[] = ["review", "missing", "update-pending", "pending", "sent", "not-ended", "na"];

export interface AccountMonth {
  account: string;
  label: string;
  status: MonthStatus;
  /** Extracto vigente que cubre el mes (el más reciente si hubiera varios). */
  statement: ImportedStatement | null;
  /** Por qué requiere revisión / qué falta. */
  reasons: string[];
  na: BankMonthNa | null;
  cell: MonthCell | null;
}

export interface BankMonth {
  month: string;
  status: MonthStatus;
  accounts: AccountMonth[];
  /** «Ene 2026 · 2 cuentas · Enviado». */
  text: string;
}

export const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** El mes ya terminó cuando su último día quedó atrás (el mes en curso y los futuros no se alertan como faltantes). */
export const monthEnded = (month: string, today: string) => lastDayOfMonth(month) < today;

const shortMonth = (m: string) => periodLabel(m).split(" ")[0].slice(0, 3);
export const monthTitle = (m: string) => `${shortMonth(m)} ${m.slice(0, 4)}`;

export interface BankHomeInput {
  bank: string;
  year: number;
  result: BankExoResult;
  statements: ImportedStatement[];
  pending: BankPendingEdit[];
  monthNa: BankMonthNa[];
  today: string;
}

function accountMonth(input: BankHomeInput, account: { number: string; label: string }, cell: MonthCell | null, month: string): AccountMonth {
  const bankKey = bankKeyOf(input.bank);
  const na = input.monthNa.find((n) => n.bankKey === bankKey && n.accountNumber === account.number && n.month === month) ?? null;
  const active = cell?.active ?? [];
  const batchIds = new Set(active.map((s) => s.batchId));
  const statements = input.statements.filter((s) => batchIds.has(s.batchId) && s.status === "active");
  const statement = statements.length > 0 ? [...statements].sort((a, b) => b.importedAt.localeCompare(a.importedAt) || b.batchId - a.batchId)[0] : null;
  const base = { account: account.number, label: account.label, statement, na, cell };
  if (!statement) {
    if (na) return { ...base, status: "na", reasons: [na.reason] };
    if (cell && !cell.applicable) return { ...base, status: "na", reasons: ["La cuenta no estaba abierta o ya estaba cerrada."] };
    if (!monthEnded(month, input.today)) return { ...base, status: "not-ended", reasons: [] };
    const gone = cell?.history.length ? ["Su extracto fue reemplazado o anulado y no hay uno vigente."] : [];
    return { ...base, status: "missing", reasons: gone };
  }
  const reasons: string[] = [];
  if (statements.length > 1) reasons.push("Hay más de un extracto vigente para este mes.");
  if (statement.legacy) reasons.push("Se envió antes de guardar el detalle para Exógena: reimpórtalo con «Reemplazar» para 1007 y 1011.");
  for (const a of statement.alerts) if (a.ref?.month === undefined || a.ref.month === month) reasons.push(a.title);
  if (cell && cell.blocks.length > 0 && reasons.length === 0) reasons.push(`Bloquea ${cell.blocks.join(", ")}.`);
  const undecided = statement.lines.filter((l) => !l.sent && !statement.skipped.includes(l.concept));
  const suggested = statement.lines.filter((l) => l.interest === "suggested" || l.gmf === "suggested");
  if (suggested.length > 0) reasons.push(`Hay ${new Set(suggested.map((l) => l.concept)).size} concepto(s) con posible interés o GMF sin confirmar.`);
  const hasPending = input.pending.some((p) => p.batchId === statement.batchId);
  if (reasons.length > 0) return { ...base, status: "review", reasons };
  if (hasPending) return { ...base, status: "update-pending", reasons: ["Hay cambios guardados que aún no se aplicaron a Estados Financieros."] };
  if (!statement.sentToEeff || undecided.length > 0) return { ...base, status: "pending", reasons: undecided.length > 0 ? [`Faltan decisiones sobre ${new Set(undecided.map((l) => l.concept)).size} concepto(s).`] : ["El extracto no se ha enviado a Estados Financieros."] };
  return { ...base, status: "sent", reasons: [] };
}

export function buildBankHome(input: BankHomeInput): { months: BankMonth[]; accounts: AccountModel[]; bank: BankModel | null } {
  const bank = input.result.banks.find((b) => b.bankKey === bankKeyOf(input.bank)) ?? null;
  const accounts = bank?.accounts ?? [];
  const list = accounts.length > 0 ? accounts.map((a) => ({ number: a.accountNumber, label: a.label })) : [{ number: "", label: "Sin cuenta registrada" }];
  const months = Array.from({ length: 12 }, (_, i) => `${input.year}-${String(i + 1).padStart(2, "0")}`).map((month): BankMonth => {
    const rows = list.map((a) => accountMonth(input, a, accounts.find((x) => x.accountNumber === a.number)?.cells.find((c) => c.month === month) ?? null, month));
    const relevant = rows.filter((r) => r.status !== "na");
    const status = relevant.length === 0 ? "na" : WORST_FIRST.find((s) => relevant.some((r) => r.status === s))!;
    const count = accounts.length > 0 ? rows.filter((r) => r.statement || r.status !== "na").length : 0;
    const accountsText = accounts.length === 0 ? "sin cuentas" : `${count} ${count === 1 ? "cuenta" : "cuentas"}`;
    return { month, status, accounts: rows, text: `${monthTitle(month)} · ${accountsText} · ${MONTH_STATUS_TEXT[status]}` };
  });
  return { months, accounts, bank };
}

// ---------------------------------------------------------------------------
// Conceptos de un extracto ya enviado
// ---------------------------------------------------------------------------

export type ConceptState = "sent" | "pending" | "not-applicable" | "update-pending" | "review";

export const CONCEPT_STATE_TEXT: Record<ConceptState, string> = { sent: "Enviado", pending: "Pendiente", "not-applicable": "No aplica", "update-pending": "Cambio sin actualizar", review: "Requiere revisión" };
export const CONCEPT_STATE_TONE: Record<ConceptState, "success" | "warning" | "danger" | "info" | "neutral"> = { sent: "success", pending: "warning", "not-applicable": "neutral", "update-pending": "info", review: "danger" };

export interface Classification {
  destination: "send" | "skip";
  pucCode: string;
  pucConcept: string;
  isGmf: boolean;
}

export interface ConceptRow {
  description: string;
  type: "Salida" | "Ingreso" | "Salida e ingreso";
  count: number;
  outflowCents: number;
  inflowCents: number;
  /** Lo que se lleva a EEFF hoy (0 si no se envía). */
  sentCents: number;
  transactions: TxLine[];
  current: Classification;
  /** Más de una cuenta PUC vigente (por una reclasificación anterior por transacciones). */
  mixedPuc: boolean;
  pending: BankPendingEdit | null;
  effective: Classification;
  state: ConceptState;
  gmfLabel: string;
  interest: InterestState;
  gmf: GmfState;
  ruleText: string;
  /** El extracto guarda el detalle suficiente para cambiar el destino o el GMF (no es de los enviados antes de Exógena). */
  hasDetail: boolean;
  history: BankEditLogEntry[];
}

const TYPE_BY = (out: number, inn: number): ConceptRow["type"] => (out > 0 && inn > 0 ? "Salida e ingreso" : inn > 0 ? "Ingreso" : "Salida");

export function buildConceptRows(statement: ImportedStatement, pending: BankPendingEdit[], log: BankEditLogEntry[]): ConceptRow[] {
  const byConcept = new Map<string, TxLine[]>();
  for (const l of statement.lines) (byConcept.get(l.concept) ?? byConcept.set(l.concept, []).get(l.concept)!).push(l);
  const rows: ConceptRow[] = [];
  for (const [description, lines] of byConcept) {
    const sentLines = lines.filter((l) => l.sent);
    const movements = statement.sentMovements.filter((m) => m.description === description);
    const first = movements[0];
    const out = lines.filter((l) => l.dc === "D").reduce((s, l) => s + l.cents, 0);
    const inn = lines.filter((l) => l.dc === "C").reduce((s, l) => s + l.cents, 0);
    const edit = pending.find((p) => p.batchId === statement.batchId && p.concept === description) ?? null;
    const current: Classification = first ? { destination: "send", pucCode: first.pucCode, pucConcept: first.pucConcept, isGmf: movements.some((m) => m.conceptKey === "bank.gmf") } : { destination: "skip", pucCode: "", pucConcept: "", isGmf: false };
    const effective: Classification = edit ? { destination: edit.destination, pucCode: edit.pucCode, pucConcept: "", isGmf: edit.isGmf } : current;
    const suggested = lines.some((l) => l.interest === "suggested" || l.gmf === "suggested");
    const sample = lines[0];
    const state: ConceptState = edit ? "update-pending" : suggested ? "review" : current.destination === "send" ? "sent" : statement.skipped.includes(description) ? "not-applicable" : "pending";
    const mine = log.filter((e) => e.batchId === statement.batchId && e.concept === description);
    const lastEdit = mine[mine.length - 1];
    const ruleText = lastEdit ? `Editado el ${lastEdit.createdAt.slice(0, 10)}: ${lastEdit.reason}` : sample?.reclassifiedFrom ? `Reclasificado desde ${sample.reclassifiedFrom}` : sentLines[0]?.rule.kind === "follows" ? "Regla banco + concepto" : sentLines[0]?.rule.kind === "differs" ? `Distinta de la regla (${sentLines[0].rule.pucCode})` : current.destination === "send" ? "Elegido al importar" : statement.skipped.includes(description) ? "«No enviar» al importar" : "Sin decisión";
    rows.push({
      description,
      type: TYPE_BY(out, inn),
      count: lines.length,
      outflowCents: out,
      inflowCents: inn,
      sentCents: movements.reduce((s, m) => s + (m.dc === "C" ? -m.amountCents : m.amountCents), 0),
      transactions: lines,
      current,
      mixedPuc: new Set(movements.map((m) => m.pucCode)).size > 1,
      pending: edit,
      effective,
      state,
      gmfLabel: current.isGmf ? "GMF · 50 % del neto" : sample?.gmf === "suggested" ? "Posible GMF (sin confirmar)" : sample?.gmf === "rejected" ? "No es GMF" : sample?.gmf === "confirmed" ? "GMF confirmado (sin aplicar)" : "—",
      interest: sample?.interest ?? "none",
      gmf: sample?.gmf ?? "none",
      ruleText,
      hasDetail: !statement.legacy,
      history: mine,
    });
  }
  return rows.sort((a, b) => b.outflowCents + b.inflowCents - (a.outflowCents + a.inflowCents) || a.description.localeCompare(b.description, "es"));
}

/** Lo que valdría el concepto en EEFF con esa clasificación (GMF: 50 % del neto, una sola vez), con signo contable (salida +, entrada −). */
export function projectedCents(row: ConceptRow, c: Classification): number {
  if (c.destination === "skip") return 0;
  if (c.isGmf) return gmfAccountingCents(row.outflowCents - row.inflowCents);
  return row.outflowCents - row.inflowCents;
}

export const hasPending = (rows: ConceptRow[]) => rows.some((r) => r.pending);

// ---------------------------------------------------------------------------
// Resumen de confirmación
// ---------------------------------------------------------------------------

export interface ChangeLine {
  concept: string;
  before: Classification & { cents: number };
  after: Classification & { cents: number };
}

export interface FormatImpact {
  format: BankExoFormat;
  changed: boolean;
  before: string;
  after: string;
}

export interface ApplySummary {
  changes: ChangeLine[];
  beforeCents: number;
  afterCents: number;
  periods: Period[];
  closed: Period[];
  approved: Period[];
  impact: FormatImpact[];
  gmfRuleChanges: { concept: string; isGmf: boolean }[];
}

const sumBalance = (records: { data: { balance?: unknown; grossIncome?: unknown } }[]) => records.reduce((s, r) => s + Number(r.data.balance ?? r.data.grossIncome ?? 0), 0);

/** Antes y después de lo que el cambio pendiente de este extracto aporta a Exógena (hoy solo el GMF depende de lo que se edita). */
export function exogenaImpact(exo: BankExoInput, pending: BankPendingEdit[]): FormatImpact[] {
  const changes = pending.filter((p) => p.destination === "send" && p.isGmf !== Boolean(p.previous.isGmf));
  const rules = new Map(exo.gmfRules.map((r) => [`${r.bank}|${r.concept}`, r]));
  const bank = exo.batches.find((b) => b.id === pending[0]?.batchId)?.metadata?.bank;
  const nextRules: GmfRule[] = [...rules.values()];
  for (const p of changes) {
    const i = nextRules.findIndex((r) => r.bank === bank && r.concept === p.concept);
    const rule: GmfRule = { bank: String(bank ?? ""), concept: p.concept, isGmf: p.isGmf, origin: "manual", confirmed: true, updatedAt: "" };
    if (i >= 0) nextRules[i] = rule;
    else nextRules.push(rule);
  }
  const before = buildBankExoContribution(exo);
  const after = buildBankExoContribution({ ...exo, gmfRules: nextRules });
  const fmt = (n: number) => n.toLocaleString("es-CO");
  return BANK_EXO_FORMATS.map((format) => {
    const b = sumBalance(before.proposals[format]);
    const a = sumBalance(after.proposals[format]);
    return { format, changed: a !== b, before: fmt(b), after: fmt(a) };
  });
}

export function buildApplySummary(statement: ImportedStatement, rows: ConceptRow[], periods: Period[], exo: BankExoInput | null): ApplySummary {
  const edited = rows.filter((r) => r.pending);
  const changes = edited.map((r): ChangeLine => ({ concept: r.description, before: { ...r.current, cents: r.sentCents }, after: { ...r.effective, pucConcept: r.effective.pucConcept, cents: projectedCents(r, r.effective) } }));
  const date = statement.periodEnd;
  const affected = periods.filter((p) => date >= p.startDate && date <= p.endDate);
  return {
    changes,
    beforeCents: changes.reduce((s, c) => s + c.before.cents, 0),
    afterCents: changes.reduce((s, c) => s + c.after.cents, 0),
    periods: affected,
    closed: affected.filter((p) => p.status === "closed"),
    approved: affected.filter((p) => p.status === "ready" || p.status === "pdf_generated"),
    impact: exo ? exogenaImpact(exo, edited.map((r) => r.pending!)) : [],
    gmfRuleChanges: edited.filter((r) => r.effective.destination === "send" && r.effective.isGmf !== r.current.isGmf).map((r) => ({ concept: r.description, isGmf: r.effective.isGmf })),
  };
}
