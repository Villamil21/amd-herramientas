import { formatMoneyCents } from "../../../../utils/format";
import type { BancoomevaCheck, BancoomevaGroup, BancoomevaStatement, BancoomevaSummary, BancoomevaValidation } from "../types";

const MAX_LISTED = 5;

export const RECONCILIATION_WARNING = "Advertencia: los movimientos extraídos no concilian con los totales del extracto.";

/**
 * Controles sobre lo extraído. Nunca modifican movimientos: si algo no
 * cuadra, solo se informa. El análisis queda validado únicamente si los
 * débitos y créditos coinciden con TOTAL DEBITO y TOTAL CREDITO, saldo
 * inicial + créditos − débitos = saldo final, la secuencia de saldos cuadra
 * y no hay filas anómalas, sin interpretar ni totales distintos entre páginas.
 */
export function validateBancoomeva(statement: BancoomevaStatement, groups: BancoomevaGroup[], summary: BancoomevaSummary): BancoomevaValidation {
  const t = statement.totals;
  const checks: BancoomevaCheck[] = [
    grouping(statement, groups),
    compare("debits", "Suma de débitos = TOTAL DEBITO", t.totalDebitsCents, summary.totalDebitsCents),
    compare("credits", "Suma de créditos = TOTAL CREDITO", t.totalCreditsCents, summary.totalCreditsCents),
    reconciliation(statement, summary),
    summaryConsistency(statement),
    balanceChain(statement),
  ];
  if (statement.totalsMismatchPages.length > 0) {
    checks.push({
      id: "repeated-totals",
      label: "Totales repetidos en cada página",
      status: "failed",
      detail: `El bloque de totales de la(s) página(s) ${statement.totalsMismatchPages.join(", ")} no coincide con el de las demás páginas.`,
    });
  }
  if (statement.anomalies.length > 0) {
    checks.push({
      id: "anomalies",
      label: "Filas con valor en VALOR DEBITO y VALOR CREDITO",
      status: "failed",
      detail: `${statement.anomalies.length} fila(s) traen valor en ambas columnas; no se clasificaron ni se sumaron. Revísalas en el extracto.`,
    });
  }
  if (statement.issues.length > 0) {
    checks.push({ id: "issues", label: "Filas sin interpretar", status: "failed", detail: `Se encontraron ${statement.issues.length} fila(s) en la tabla cuyo contenido no pudo interpretarse.` });
  }
  const confirmed = ["debits", "credits", "reconciliation"].every((id) => checks.find((c) => c.id === id)?.status === "ok");
  return { validated: confirmed && checks.every((c) => c.status !== "failed"), checks };
}

function compare(id: string, label: string, expected: number | undefined, actual: number): BancoomevaCheck {
  if (expected === undefined) return { id, label, status: "unavailable", detail: "No se encontró este dato en el bloque de totales del extracto." };
  if (expected === actual) return { id, label, status: "ok" };
  return {
    id,
    label,
    status: "failed",
    detail: `El extracto indica ${formatMoneyCents(expected)} y los movimientos suman ${formatMoneyCents(actual)} (diferencia ${formatMoneyCents(actual - expected)}).`,
  };
}

/** Suma de los grupos = suma de los movimientos, por tipo (error interno si no). */
function grouping({ movements }: BancoomevaStatement, groups: BancoomevaGroup[]): BancoomevaCheck {
  const sum = (type: "credit" | "debit") => groups.filter((g) => g.transactionType === type).reduce((s, g) => s + g.totalCents, 0);
  const credits = movements.reduce((s, m) => s + m.creditCents, 0);
  const debits = movements.reduce((s, m) => s + m.debitCents, 0);
  const count = groups.reduce((s, g) => s + g.count, 0);
  const ok = sum("credit") === credits && sum("debit") === debits && count === movements.length;
  return {
    id: "grouping",
    label: "Suma de grupos igual a la suma de movimientos",
    status: ok ? "ok" : "failed",
    detail: ok ? undefined : "Error interno de agrupación: los totales de los grupos no coinciden con los movimientos.",
  };
}

/** SALDO INICIAL + créditos extraídos − débitos extraídos = SALDO FINAL. */
function reconciliation({ totals: t }: BancoomevaStatement, summary: BancoomevaSummary): BancoomevaCheck {
  const label = "Saldo inicial + créditos − débitos = saldo final";
  if (t.openingBalanceCents === undefined || t.closingBalanceCents === undefined) {
    const missing = [t.openingBalanceCents === undefined && "SALDO INICIAL", t.closingBalanceCents === undefined && "SALDO FINAL"].filter(Boolean).join(" ni ");
    return { id: "reconciliation", label, status: "unavailable", detail: `No se encontró ${missing} en el extracto.` };
  }
  const expected = t.openingBalanceCents + summary.totalCreditsCents - summary.totalDebitsCents;
  if (expected === t.closingBalanceCents) return { id: "reconciliation", label, status: "ok" };
  return {
    id: "reconciliation",
    label,
    status: "failed",
    detail: `${RECONCILIATION_WARNING} Con los movimientos el saldo final sería ${formatMoneyCents(expected)} y el extracto indica ${formatMoneyCents(t.closingBalanceCents)} (diferencia ${formatMoneyCents(expected - t.closingBalanceCents)}).`,
  };
}

/** Coherencia del propio bloque de totales: SALDO INICIAL + TOTAL CREDITO − TOTAL DEBITO = SALDO FINAL. */
function summaryConsistency({ totals: t }: BancoomevaStatement): BancoomevaCheck {
  const id = "summary";
  const label = "SALDO INICIAL + TOTAL CREDITO − TOTAL DEBITO = SALDO FINAL";
  const { openingBalanceCents: opening, totalCreditsCents: credits, totalDebitsCents: debits, closingBalanceCents: closing } = t;
  if (opening === undefined || credits === undefined || debits === undefined || closing === undefined) {
    return { id, label, status: "unavailable", detail: "No se pudieron leer todos los valores del bloque de totales." };
  }
  const expected = opening + credits - debits;
  if (expected === closing) return { id, label, status: "ok" };
  return { id, label, status: "failed", detail: `El bloque de totales da ${formatMoneyCents(expected)} y el extracto indica ${formatMoneyCents(closing)} (diferencia ${formatMoneyCents(expected - closing)}).` };
}

/** Saldo anterior − débito + crédito = saldo de cada fila (detecta filas omitidas, duplicadas o columnas mal leídas). */
function balanceChain(s: BancoomevaStatement): BancoomevaCheck {
  const label = "Secuencia de saldos";
  const rows = [...s.movements, ...s.anomalies].sort((a, b) => a.index - b.index);
  if (rows.length === 0 || rows.some((r) => r.balanceCents === undefined)) {
    return { id: "balances", label, status: "unavailable", detail: "No todas las filas incluyen el saldo." };
  }
  const breaks: string[] = [];
  let previous = s.totals.openingBalanceCents;
  for (const r of rows) {
    const expected = previous === undefined ? undefined : previous - r.debitCents + r.creditCents;
    if (expected !== undefined && expected !== r.balanceCents) {
      breaks.push(`Página ${r.page}, ${r.date} ${r.description}: se esperaba saldo ${formatMoneyCents(expected)} y el extracto muestra ${formatMoneyCents(r.balanceCents!)}.`);
    }
    previous = r.balanceCents;
  }
  const closing = s.totals.closingBalanceCents;
  if (closing !== undefined && previous !== closing) {
    breaks.push(`El saldo de la última fila (${formatMoneyCents(previous!)}) no coincide con SALDO FINAL (${formatMoneyCents(closing)}).`);
  }
  if (breaks.length === 0) return { id: "balances", label, status: "ok" };
  const listed = breaks.slice(0, MAX_LISTED).join(" ");
  const more = breaks.length > MAX_LISTED ? ` (y ${breaks.length - MAX_LISTED} más)` : "";
  return { id: "balances", label, status: "failed", detail: `${breaks.length} fila(s) no cuadran con el saldo. ${listed}${more}` };
}
