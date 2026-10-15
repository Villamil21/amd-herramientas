import type { BankAccountLifecycle, BatchInput, BatchSummary, GmfRule, MovementInput } from "../../../types/fs";
import { slashToIso } from "../shared/money";

/**
 * Capa contable de los extractos bancarios. Cada banco conserva su lector y su
 * análisis; aquí solo se normaliza lo que Estados Financieros necesita:
 * cuenta, periodo, saldo final y los conceptos agrupados con su naturaleza.
 */

export interface AccountingMovement {
  date: string;
  description: string;
  amountCents: number;
}

export interface AccountingConcept {
  /** Clave del grupo en el análisis del banco. */
  key: string;
  /** Descripción exacta del concepto (la misma del agrupado). */
  description: string;
  /** D = salida del banco (débito/cargo); C = entrada (crédito/abono). */
  dc: "D" | "C";
  count: number;
  /** Valor absoluto del total del grupo. */
  totalCents: number;
  movements: AccountingMovement[];
}

export interface AccountingStatement {
  bank: string;
  accountNumber?: string;
  /** AAAA-MM-DD. */
  periodFrom?: string;
  periodTo?: string;
  /** Saldo inicial del extracto (para detectar una posible apertura). */
  openingBalanceCents?: number;
  closingBalanceCents?: number;
  concepts: AccountingConcept[];
}

/** Grupos por signo (Bancolombia, Davivienda, Iris Bank). Los de valor cero no tienen nada que enviar. */
export function fromSignedGroups(
  statement: { bank: string; accountNumber?: string; periodFrom?: string; periodTo?: string; totals: { previousBalanceCents?: number; currentBalanceCents?: number } },
  groups: {
    key: string;
    description: string;
    sign: "positive" | "negative" | "zero";
    count: number;
    totalCents: number;
    movements: { fullDate?: string; date: string; description: string; valueCents: number }[];
  }[],
): AccountingStatement {
  return {
    bank: statement.bank,
    accountNumber: statement.accountNumber,
    periodFrom: slashToIso(statement.periodFrom),
    periodTo: slashToIso(statement.periodTo),
    openingBalanceCents: statement.totals.previousBalanceCents,
    closingBalanceCents: statement.totals.currentBalanceCents,
    concepts: groups
      .filter((g) => g.sign !== "zero")
      .map((g) => ({
        key: g.key,
        description: g.description,
        dc: g.sign === "negative" ? "D" : "C",
        count: g.count,
        totalCents: Math.abs(g.totalCents),
        movements: g.movements.map((m) => ({ date: m.fullDate ?? m.date, description: m.description, amountCents: m.valueCents })),
      })),
  };
}

/** Grupos por tipo crédito / débito (Bancoomeva, Coopcentral, BBVA). */
export function fromTypedGroups(
  statement: { bank: string; accountNumber?: string; periodFrom?: string; periodTo?: string },
  closingBalanceCents: number | undefined,
  openingBalanceCents: number | undefined,
  groups: {
    key: string;
    description?: string;
    concept?: string;
    transactionType: "credit" | "debit";
    count: number;
    totalCents: number;
    movements: { date?: string; operationDate?: string; applicationDate?: string; description?: string; concept?: string; amountCents: number }[];
  }[],
): AccountingStatement {
  return {
    bank: statement.bank,
    accountNumber: statement.accountNumber,
    periodFrom: slashToIso(statement.periodFrom),
    periodTo: slashToIso(statement.periodTo),
    openingBalanceCents,
    closingBalanceCents,
    concepts: groups.map((g) => ({
      key: g.key,
      description: g.description ?? g.concept ?? "",
      dc: g.transactionType === "debit" ? "D" : "C",
      count: g.count,
      totalCents: Math.abs(g.totalCents),
      movements: g.movements.map((m) => ({ date: m.date ?? m.operationDate ?? m.applicationDate ?? "", description: m.description ?? m.concept ?? "", amountCents: m.amountCents })),
    })),
  };
}

/** Destino de un concepto en ESTE extracto. «Seleccionar» no es válido para enviar; «No enviar» nunca se guarda como regla. */
export type Destination = "select" | "send" | "skip";

export interface ConceptDecision {
  destination: Destination;
  pucCode?: string;
}

/** Clave global de la asociación banco + concepto exacto → PUC. */
export const conceptMappingKey = (bank: string, description: string) => `${bank}|${description}`;

export function pendingConcepts(statement: AccountingStatement, decisions: Record<string, ConceptDecision>): number {
  return statement.concepts.filter((c) => {
    const d = decisions[c.key];
    return !d || d.destination === "select" || (d.destination === "send" && !d.pucCode);
  }).length;
}

/** Identifica el extracto: empresa + banco + cuenta + periodo. */
export const statementDedupeKey = (s: AccountingStatement) => `bank:${s.bank}:${s.accountNumber ?? ""}:${s.periodFrom ?? ""}:${s.periodTo ?? ""}`;

// ---------------------------------------------------------------------------
// GMF (Gravamen a los Movimientos Financieros, 4x1000)
// ---------------------------------------------------------------------------

/** Porcentaje del GMF neto que se lleva a Estados Financieros. */
export const GMF_PERCENT = 50;

/** Mayúsculas, sin tildes y con un solo espacio entre palabras (puntos, guiones y barras cuentan como espacio). */
const normalizeConcept = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/**
 * Palabras que identifican el GMF en el concepto bancario. Tolerante a
 * mayúsculas, tildes, espacios y abreviaturas simples («4 X 1000», «MOV.
 * FINANCIEROS»), pero no convierte cualquier impuesto en GMF: «IMPUESTO» solo,
 * IVA o retenciones no coinciden.
 */
const GMF_PATTERNS: RegExp[] = [/\bGMF\b/, /\b4 ?X ?(1 ?000|MIL)\b/, /\b4 ?POR ?(1 ?000|MIL)\b/, /\bGRAVAMEN\b/, /\bMOV(S|TOS?|IMIENTOS?)? ?FINANC(IEROS?)?\b/];

export function isGmfConcept(description: string): boolean {
  const text = normalizeConcept(description);
  return GMF_PATTERNS.some((p) => p.test(text));
}

/**
 * Estado GMF de un concepto: la regla guardada para banco + concepto exacto
 * manda; sin regla, la detección por palabra clave es solo una sugerencia.
 */
export type GmfState = "confirmed" | "rejected" | "suggested" | "none";

export const gmfRuleKey = (bank: string, description: string) => `${bank}|${description}`;

export function gmfState(bank: string, description: string, rules: Map<string, GmfRule>): GmfState {
  const rule = rules.get(gmfRuleKey(bank, description));
  if (rule) return rule.isGmf ? "confirmed" : "rejected";
  return isGmfConcept(description) ? "suggested" : "none";
}

/** 50 % del GMF neto, con su signo (si las devoluciones superan los cargos queda negativo). */
export const gmfAccountingCents = (netCents: number) => Math.sign(netCents) * Math.round((Math.abs(netCents) * GMF_PERCENT) / 100);

// ---------------------------------------------------------------------------
// Apertura y cierre de cuentas (siempre los confirma el usuario)
// ---------------------------------------------------------------------------

export interface LifecycleQuestion {
  kind: "closed" | "opened";
  /** AAAA-MM del extracto (fin para el cierre, inicio para la apertura). */
  period: string;
}

/** Extractos anteriores de la misma empresa + banco + cuenta (activos o reemplazados). */
export const hasEarlierStatement = (statement: AccountingStatement, batches: BatchSummary[]) =>
  batches.some(
    (b) =>
      b.source === "bank" &&
      b.status !== "voided" &&
      String(b.metadata?.bank ?? "").trim() === statement.bank.trim() &&
      String(b.metadata?.accountNumber ?? "").trim() === (statement.accountNumber ?? "").trim() &&
      Boolean(b.periodStart) &&
      Boolean(statement.periodFrom) &&
      b.periodStart! < statement.periodFrom!,
  );

/**
 * Preguntas pendientes sobre la cuenta del extracto. Un saldo en 0 nunca se
 * interpreta solo:
 * - Saldo final 0 → «¿Fue cerrada en este periodo?» (salvo que ya se respondió para este mes).
 * - Saldo inicial 0 SIN ningún extracto anterior de la cuenta → «¿Fue abierta en este periodo?».
 *   Con historial anterior no se pregunta: puede ser solo que se gastó todo el saldo.
 */
export function lifecycleQuestions(statement: AccountingStatement, lifecycle: BankAccountLifecycle | null | undefined, earlierStatement: boolean): LifecycleQuestion[] {
  const out: LifecycleQuestion[] = [];
  const answered = (action: string, period: string) => lifecycle?.events.some((e) => e.action === action && e.period === period) ?? false;
  const end = statement.periodTo?.slice(0, 7);
  if (end && statement.closingBalanceCents === 0 && lifecycle?.closedPeriod !== end && !answered("kept_active", end)) out.push({ kind: "closed", period: end });
  const start = statement.periodFrom?.slice(0, 7);
  const knownEarlier = Boolean(lifecycle?.openedPeriod && start && lifecycle.openedPeriod < start);
  if (start && statement.openingBalanceCents === 0 && !earlierStatement && !knownEarlier && lifecycle?.openedPeriod !== start && !answered("existed_before", start))
    out.push({ kind: "opened", period: start });
  return out;
}

/**
 * Un movimiento por concepto enviado (total agrupado, con el vínculo a sus
 * movimientos originales) y la foto del saldo final con el PUC de la cuenta.
 *
 * GMF confirmado (`gmf`: descripciones exactas): las salidas y entradas del
 * mismo concepto y PUC se netean y se envía el 50 % del neto en un solo
 * movimiento; el valor del extracto se conserva completo en el detalle. La otra
 * mitad no se envía a ninguna cuenta.
 */
export function buildBankBatch(
  companyId: number,
  statement: AccountingStatement,
  fileName: string,
  decisions: Record<string, ConceptDecision>,
  balancePuc: string,
  gmf: Map<string, "auto" | "manual"> = new Map(),
): BatchInput {
  const date = statement.periodTo!;
  const movements: MovementInput[] = [];
  const mappings: { bank: string; concept: string; pucCode: string }[] = [];
  const gmfGroups = new Map<string, { description: string; pucCode: string; concepts: AccountingConcept[] }>();
  for (const c of statement.concepts) {
    const d = decisions[c.key];
    if (d?.destination !== "send" || !d.pucCode) continue;
    if (gmf.has(c.description)) {
      const k = `${c.description}|${d.pucCode}`;
      const g = gmfGroups.get(k) ?? { description: c.description, pucCode: d.pucCode, concepts: [] };
      g.concepts.push(c);
      gmfGroups.set(k, g);
      mappings.push({ bank: statement.bank, concept: c.description, pucCode: d.pucCode });
      continue;
    }
    movements.push({
      accountingDate: date,
      conceptKey: "bank.concept",
      documentId: `${statement.bank}|${statement.accountNumber}|${statement.periodFrom}|${statement.periodTo}|${c.key}`,
      documentType: c.dc === "D" ? "Salida" : "Entrada",
      bank: statement.bank,
      accountNumber: statement.accountNumber ?? "",
      pucCode: d.pucCode,
      description: c.description,
      amountCents: c.totalCents,
      dc: c.dc,
      // Dirección bancaria normalizada (salida/entrada): el signo contable sale de ella y de la cuenta destino, no del signo del extracto.
      detail: { statement: fileName, period: `${statement.periodFrom} a ${statement.periodTo}`, account: statement.accountNumber, direction: c.dc === "D" ? "outflow" : "inflow", count: c.count, movements: c.movements },
    });
    mappings.push({ bank: statement.bank, concept: c.description, pucCode: d.pucCode });
  }
  for (const g of gmfGroups.values()) {
    const outflow = g.concepts.filter((c) => c.dc === "D").reduce((s, c) => s + c.totalCents, 0);
    const inflow = g.concepts.filter((c) => c.dc === "C").reduce((s, c) => s + c.totalCents, 0);
    const net = outflow - inflow;
    const value = gmfAccountingCents(net);
    if (value === 0) continue;
    movements.push({
      accountingDate: date,
      conceptKey: "bank.gmf",
      documentId: `${statement.bank}|${statement.accountNumber}|${statement.periodFrom}|${statement.periodTo}|gmf|${g.description}|${g.pucCode}`,
      documentType: "GMF",
      bank: statement.bank,
      accountNumber: statement.accountNumber ?? "",
      pucCode: g.pucCode,
      description: g.description,
      amountCents: Math.abs(value),
      // Neto positivo = salida (gasto); negativo = devoluciones mayores que los cargos.
      dc: value > 0 ? "D" : "C",
      detail: {
        statement: fileName,
        period: `${statement.periodFrom} a ${statement.periodTo}`,
        account: statement.accountNumber,
        direction: value > 0 ? "outflow" : "inflow",
        count: g.concepts.reduce((s, c) => s + c.count, 0),
        gmf: { confirmed: true, origin: gmf.get(g.description), percent: GMF_PERCENT, outflowCents: outflow, inflowCents: inflow, originalNetCents: net, accountingCents: value },
        movements: g.concepts.flatMap((c) => c.movements),
      },
    });
  }
  return {
    companyId,
    source: "bank",
    fileName,
    periodLabel: `${statement.bank} ${statement.accountNumber ?? ""} · ${statement.periodFrom} a ${statement.periodTo}`,
    periodStart: statement.periodFrom,
    periodEnd: statement.periodTo,
    dedupeKey: statementDedupeKey(statement),
    metadata: {
      bank: statement.bank,
      accountNumber: statement.accountNumber,
      skipped: statement.concepts.filter((c) => decisions[c.key]?.destination === "skip").map((c) => c.description),
      ...(gmfGroups.size > 0 && { gmf: [...new Set([...gmfGroups.values()].map((g) => g.description))], gmfPercent: GMF_PERCENT }),
    },
    movements,
    bankBalances: statement.closingBalanceCents === undefined ? [] : [{ bank: statement.bank, accountNumber: statement.accountNumber ?? "", balanceDate: date, balanceCents: statement.closingBalanceCents, pucCode: balancePuc }],
    bankConceptMappings: mappings,
  };
}
