import type { BankConceptMapping, BankReclassInput, BatchSummary, GmfRule, InterestRule, Movement, MovementEdit, Period } from "../../../../types/fs";
import { normalizeKey } from "../../../../utils/text";
import { gmfRuleKey, gmfState, interestRuleKey, interestState, type GmfState, type InterestState } from "../bankAccounting";
import { toExoStatements, type BankExoAlert, type ExoStatement } from "../exogena/model";

/**
 * Extractos ya importados: todo sale de lo persistido (lotes, movimientos enviados a Estados Financieros, reglas y
 * auditoría), sin volver a leer ningún PDF. Funciones puras: la pantalla solo pinta lo que aquí se calcula.
 */

export type StatementStatusFilter = "" | "vigente" | "reemplazado" | "anulado" | "enviado" | "pendiente" | "alertas";

export const STATUS_FILTER_LABEL: Record<Exclude<StatementStatusFilter, "">, string> = {
  vigente: "Vigente",
  reemplazado: "Reemplazado",
  anulado: "Anulado",
  enviado: "Enviado a EEFF",
  pendiente: "Pendiente",
  alertas: "Con alertas",
};

export interface TxLine {
  key: string;
  date: string;
  description: string;
  /** Valor absoluto de la transacción. */
  cents: number;
  dc: "D" | "C" | null;
  /** Concepto del extracto al que pertenece (el agrupado de Estados Financieros). */
  concept: string;
  /** Movimiento vigente enviado a EEFF que la contiene (null si no se envió). */
  movementId: number | null;
  txIndex: number | null;
  sent: boolean;
  pucCode: string | null;
  pucConcept: string;
  /** Cómo está en Estados Financieros: enviada, GMF (50 % del neto) o no enviada. */
  destination: "eeff" | "gmf" | "not-sent";
  /** Regla banco + concepto → PUC frente a lo que tiene hoy. */
  rule: { kind: "follows" | "differs" | "none"; pucCode?: string };
  /** PUC del que se reclasificó por última vez (si fue manual). */
  reclassifiedFrom: string | null;
  interest: InterestState;
  gmf: GmfState;
}

export interface StatementHistoryEvent {
  at: string;
  kind: "imported" | "replaced" | "replaces" | "reclassified";
  text: string;
}

export interface ImportedStatement {
  batchId: number;
  companyId: number;
  bank: string;
  account: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  importedAt: string;
  status: BatchSummary["status"];
  replacedBy: number | null;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  movementCount: number;
  lines: TxLine[];
  /** Movimientos vigentes enviados a Estados Financieros. */
  sentMovements: Movement[];
  sentCents: number;
  sentToEeff: boolean;
  /** Extracto enviado antes de guardar el detalle para Exógena (hay que reimportarlo para 1007 y 1011). */
  legacy: boolean;
  interestCents: number;
  gmfGrossCents: number;
  gmfReportedCents: number;
  alerts: BankExoAlert[];
  history: StatementHistoryEvent[];
}

export interface ImportedInput {
  companyId: number;
  batches: BatchSummary[];
  movements: Movement[];
  edits: MovementEdit[];
  mappings: BankConceptMapping[];
  gmfRules: GmfRule[];
  interestRules: InterestRule[];
  alerts: BankExoAlert[];
}

const txCents = (t: { amountCents?: number }) => Math.abs(t.amountCents ?? 0);
const asTxs = (v: unknown): { date?: string; description?: string; amountCents?: number }[] => (Array.isArray(v) ? (v as { amountCents?: number }[]) : []);

export function buildImportedStatements(input: ImportedInput): ImportedStatement[] {
  const exo = new Map(toExoStatements(input.batches).map((s) => [s.batchId, s]));
  const mappingByKey = new Map(input.mappings.map((m) => [`${m.bank}|${m.concept}`, m.pucCode]));
  const gmfMap = new Map(input.gmfRules.map((r) => [gmfRuleKey(r.bank, r.concept), r]));
  const interestMap = new Map(input.interestRules.map((r) => [interestRuleKey(r.bank, r.concept), r]));
  const byBatch = new Map<number, Movement[]>();
  for (const m of input.movements) (byBatch.get(m.batchId) ?? byBatch.set(m.batchId, []).get(m.batchId)!).push(m);
  const out: ImportedStatement[] = [];

  for (const batch of input.batches) {
    const st = exo.get(batch.id);
    if (!st) continue;
    const mine = byBatch.get(batch.id) ?? [];
    const sentMovements = mine.filter((m) => m.status === "active" && (m.conceptKey === "bank.concept" || m.conceptKey === "bank.gmf"));
    const lines: TxLine[] = [];
    const coveredConcepts = new Set<string>();

    for (const m of sentMovements) {
      coveredConcepts.add(m.description);
      const raw = (m.detail as { reclassified?: unknown } | null)?.reclassified;
      const manual = (Array.isArray(raw) ? raw[raw.length - 1] : raw) as { from?: string } | null | undefined;
      const saved = mappingByKey.get(`${st.bank}|${m.description}`);
      asTxs(m.detail?.movements).forEach((t, i) => {
        const dc = m.dc;
        lines.push({
          key: `${m.id}:${i}`,
          date: t.date ?? "",
          description: t.description ?? m.description,
          cents: txCents(t),
          dc,
          concept: m.description,
          movementId: m.id,
          txIndex: i,
          sent: true,
          pucCode: m.pucCode,
          pucConcept: m.pucConcept,
          destination: m.conceptKey === "bank.gmf" ? "gmf" : "eeff",
          rule: saved === undefined ? { kind: "none" } : { kind: saved === m.pucCode ? "follows" : "differs", pucCode: saved },
          reclassifiedFrom: manual?.from ?? null,
          interest: interestState(st.bank, m.description, dc ?? "D", interestMap),
          gmf: gmfState(st.bank, m.description, gmfMap),
        });
      });
    }
    // Conceptos que el usuario eligió «No enviar» (o que el extracto trae pero no tienen movimiento): se ven, no se reclasifican.
    for (const c of st.payload?.concepts ?? []) {
      if (coveredConcepts.has(c.description)) continue;
      c.movements.forEach((t, i) =>
        lines.push({
          key: `x:${c.description}:${i}`,
          date: t.date,
          description: t.description,
          cents: Math.abs(t.amountCents),
          dc: c.dc,
          concept: c.description,
          movementId: null,
          txIndex: null,
          sent: false,
          pucCode: null,
          pucConcept: "",
          destination: "not-sent",
          rule: { kind: "none" },
          reclassifiedFrom: null,
          interest: interestState(st.bank, c.description, c.dc, interestMap),
          gmf: gmfState(st.bank, c.description, gmfMap),
        }),
      );
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description) || a.key.localeCompare(b.key));

    // Intereses (abonos con regla confirmada) y GMF (cargos − devoluciones de conceptos con regla confirmada), como los usa Exógena.
    let interestCents = 0;
    let gmfGross = 0;
    for (const c of st.payload?.concepts ?? []) {
      if (interestState(st.bank, c.description, c.dc, interestMap) === "confirmed" && c.dc === "C") interestCents += c.totalCents;
      if (gmfState(st.bank, c.description, gmfMap) === "confirmed") gmfGross += c.dc === "D" ? c.totalCents : -c.totalCents;
    }
    const gmfReported = sentMovements.filter((m) => m.conceptKey === "bank.gmf").reduce((s, m) => s + (m.dc === "D" ? m.amountCents : -m.amountCents), 0);

    const history: StatementHistoryEvent[] = [{ at: batch.createdAt, kind: "imported", text: `Importado desde ${batch.fileName || "archivo"}.` }];
    if (batch.status === "replaced" && batch.replacedBy) history.push({ at: batch.createdAt, kind: "replaced", text: `Reemplazado por el extracto #${batch.replacedBy}.` });
    for (const other of input.batches) if (other.replacedBy === batch.id) history.push({ at: batch.createdAt, kind: "replaces", text: `Reemplaza al extracto #${other.id} (${other.fileName || "archivo"}).` });
    const ids = new Set(mine.map((m) => m.id));
    for (const e of input.edits) {
      if (e.origin !== "bank_reclass" || !ids.has(e.originalMovementId)) continue;
      const n = e.next.transactions?.length ?? 0;
      history.push({ at: e.createdAt, kind: "reclassified", text: `${n} transacci${n === 1 ? "ón" : "ones"} de «${e.previous.description}» pasaron de ${e.previous.pucCode} a ${e.next.pucCode} (${e.next.amountCents / 100}). Motivo: ${e.reason}` });
    }
    history.sort((a, b) => a.at.localeCompare(b.at));

    out.push({
      batchId: batch.id,
      companyId: batch.companyId,
      bank: st.bank,
      account: st.accountNumber,
      periodStart: st.periodStart,
      periodEnd: st.periodEnd,
      fileName: batch.fileName,
      importedAt: batch.createdAt,
      status: batch.status,
      replacedBy: batch.replacedBy,
      openingBalanceCents: st.openingBalanceCents,
      closingBalanceCents: st.closingBalanceCents,
      movementCount: st.movementCount,
      lines,
      sentMovements,
      sentCents: sentMovements.reduce((s, m) => s + m.amountCents, 0),
      sentToEeff: sentMovements.length > 0 || input.movements.some((m) => m.batchId === batch.id && m.status === "adjusted"),
      legacy: st.payload === null,
      interestCents,
      gmfGrossCents: gmfGross,
      gmfReportedCents: gmfReported,
      alerts: statementAlerts(input.alerts, st),
      history,
    });
  }
  return out.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.bank.localeCompare(b.bank, "es") || b.batchId - a.batchId);
}

/** Alertas de Exógena que nombran el banco y la cuenta del extracto (y, si traen mes, uno que el extracto cubre). */
export function statementAlerts(alerts: BankExoAlert[], st: ExoStatement): BankExoAlert[] {
  if (st.status !== "active") return [];
  return alerts.filter((a) => {
    if (!a.ref) return false;
    if (a.ref.bank.trim().toUpperCase() !== st.bankKey) return false;
    if (a.ref.account !== undefined && a.ref.account !== st.accountNumber) return false;
    return a.ref.month === undefined || st.months.includes(a.ref.month);
  });
}

export interface ImportedFilters {
  bank: string;
  account: string;
  /** AAAA-MM o vacío. */
  month: string;
  status: StatementStatusFilter;
  text: string;
}

export const EMPTY_IMPORTED_FILTERS: ImportedFilters = { bank: "", account: "", month: "", status: "", text: "" };

const hasText = (s: ImportedStatement, needle: string) =>
  [s.bank, s.account, s.fileName, ...s.lines.flatMap((l) => [l.description, l.concept, l.pucCode ?? "", l.pucConcept])].some((v) => normalizeKey(v).includes(needle));

export function matchesStatus(s: ImportedStatement, status: StatementStatusFilter): boolean {
  switch (status) {
    case "":
      return true;
    case "vigente":
      return s.status === "active";
    case "reemplazado":
      return s.status === "replaced";
    case "anulado":
      return s.status === "voided";
    case "enviado":
      return s.status === "active" && s.sentToEeff;
    case "pendiente":
      return s.status === "active" && (!s.sentToEeff || s.legacy);
    case "alertas":
      return s.alerts.length > 0 || (s.status === "active" && s.legacy);
  }
}

export function filterStatements(list: ImportedStatement[], f: ImportedFilters): ImportedStatement[] {
  const needle = normalizeKey(f.text);
  return list.filter(
    (s) =>
      (!f.bank || s.bank === f.bank) &&
      (!f.account || s.account === f.account) &&
      (!f.month || s.periodEnd.slice(0, 7) === f.month) &&
      matchesStatus(s, f.status) &&
      (!needle || hasText(s, needle)),
  );
}

// ---------------------------------------------------------------------------
// Reclasificación
// ---------------------------------------------------------------------------

export interface ReclassGroup {
  movementId: number;
  concept: string;
  fromPuc: string;
  fromConcept: string;
  toPuc: string;
  toConcept: string;
  /** Transacciones que se mueven y total del concepto (si son menos, el resto queda con el PUC anterior). */
  txCount: number;
  txTotal: number;
  cents: number;
  restCents: number;
  accountingDate: string;
  txIndexes: number[];
}

export interface ReclassPreview {
  groups: ReclassGroup[];
  txCount: number;
  cents: number;
  /** Periodos de EEFF que tocan las fechas contables de lo movido. */
  periods: Period[];
  closed: Period[];
  approved: Period[];
  /** Cosas que impiden reclasificar esta selección. */
  errors: string[];
}

/** Resumen previo a guardar: clasificación anterior y nueva, valor y movimientos, y periodos de EEFF afectados. */
export function previewReclassification(statement: ImportedStatement, selectedKeys: Set<string>, toPuc: string | undefined, toConcept: string, periods: Period[]): ReclassPreview {
  const errors: string[] = [];
  const picked = statement.lines.filter((l) => selectedKeys.has(l.key));
  const byMovement = new Map<number, TxLine[]>();
  for (const l of picked) {
    if (!l.sent || l.movementId === null) {
      errors.push(`«${l.description}» (${l.date}) no se envió a Estados Financieros: no tiene PUC que reclasificar.`);
      continue;
    }
    (byMovement.get(l.movementId) ?? byMovement.set(l.movementId, []).get(l.movementId)!).push(l);
  }
  const groups: ReclassGroup[] = [];
  for (const [movementId, lines] of byMovement) {
    const movement = statement.sentMovements.find((m) => m.id === movementId);
    if (!movement) continue;
    const all = statement.lines.filter((l) => l.movementId === movementId);
    const total = all.reduce((s, l) => s + l.cents, 0);
    const cents = lines.reduce((s, l) => s + l.cents, 0);
    const whole = lines.length === all.length;
    if (toPuc && movement.pucCode === toPuc) errors.push(`«${movement.description}» ya está en el PUC ${toPuc}.`);
    if (!whole && movement.conceptKey === "bank.gmf") errors.push("El GMF se lleva como un solo valor (50 % del neto): selecciona todas sus transacciones.");
    if (!whole && total !== movement.amountCents) errors.push(`Las transacciones de «${movement.description}» no suman el valor enviado: reclasifica el concepto completo.`);
    groups.push({
      movementId,
      concept: movement.description,
      fromPuc: movement.pucCode,
      fromConcept: movement.pucConcept,
      toPuc: toPuc ?? "",
      toConcept,
      txCount: lines.length,
      txTotal: all.length,
      cents: whole ? movement.amountCents : cents,
      restCents: whole ? 0 : movement.amountCents - cents,
      accountingDate: movement.accountingDate,
      txIndexes: lines.map((l) => l.txIndex!).sort((a, b) => a - b),
    });
  }
  const dates = groups.map((g) => g.accountingDate);
  const affected = periods.filter((p) => dates.some((d) => d >= p.startDate && d <= p.endDate));
  return {
    groups,
    txCount: groups.reduce((s, g) => s + g.txCount, 0),
    cents: groups.reduce((s, g) => s + g.cents, 0),
    periods: affected,
    closed: affected.filter((p) => p.status === "closed"),
    approved: affected.filter((p) => p.status === "ready" || p.status === "pdf_generated"),
    errors: [...new Set(errors)],
  };
}

export function reclassInput(statement: ImportedStatement, preview: ReclassPreview, pucCode: string, reason: string, acknowledgeApproved: boolean): BankReclassInput {
  return { batchId: statement.batchId, pucCode, reason: reason.trim(), acknowledgeApproved, items: preview.groups.map((g) => ({ movementId: g.movementId, txIndexes: g.txIndexes })) };
}
