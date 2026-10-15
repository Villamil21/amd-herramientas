import type { BatchInput, MovementInput } from "../../../types/fs";
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
  closingBalanceCents?: number;
  concepts: AccountingConcept[];
}

/** Grupos por signo (Bancolombia, Davivienda, Iris Bank). Los de valor cero no tienen nada que enviar. */
export function fromSignedGroups(
  statement: { bank: string; accountNumber?: string; periodFrom?: string; periodTo?: string; totals: { currentBalanceCents?: number } },
  groups: { key: string; description: string; sign: "positive" | "negative" | "zero"; count: number; totalCents: number; movements: { fullDate?: string; date: string; description: string; valueCents: number }[] }[],
): AccountingStatement {
  return {
    bank: statement.bank,
    accountNumber: statement.accountNumber,
    periodFrom: slashToIso(statement.periodFrom),
    periodTo: slashToIso(statement.periodTo),
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
  groups: { key: string; description?: string; concept?: string; transactionType: "credit" | "debit"; count: number; totalCents: number; movements: { date?: string; operationDate?: string; applicationDate?: string; description?: string; concept?: string; amountCents: number }[] }[],
): AccountingStatement {
  return {
    bank: statement.bank,
    accountNumber: statement.accountNumber,
    periodFrom: slashToIso(statement.periodFrom),
    periodTo: slashToIso(statement.periodTo),
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

/**
 * Un movimiento por concepto enviado (total agrupado, con el vínculo a sus
 * movimientos originales) y la foto del saldo final con el PUC de la cuenta.
 */
export function buildBankBatch(companyId: number, statement: AccountingStatement, fileName: string, decisions: Record<string, ConceptDecision>, balancePuc: string): BatchInput {
  const date = statement.periodTo!;
  const movements: MovementInput[] = [];
  const mappings: { bank: string; concept: string; pucCode: string }[] = [];
  for (const c of statement.concepts) {
    const d = decisions[c.key];
    if (d?.destination !== "send" || !d.pucCode) continue;
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
  return {
    companyId,
    source: "bank",
    fileName,
    periodLabel: `${statement.bank} ${statement.accountNumber ?? ""} · ${statement.periodFrom} a ${statement.periodTo}`,
    periodStart: statement.periodFrom,
    periodEnd: statement.periodTo,
    dedupeKey: statementDedupeKey(statement),
    metadata: { bank: statement.bank, accountNumber: statement.accountNumber, skipped: statement.concepts.filter((c) => decisions[c.key]?.destination === "skip").map((c) => c.description) },
    movements,
    bankBalances: statement.closingBalanceCents === undefined ? [] : [{ bank: statement.bank, accountNumber: statement.accountNumber ?? "", balanceDate: date, balanceCents: statement.closingBalanceCents, pucCode: balancePuc }],
    bankConceptMappings: mappings,
  };
}
