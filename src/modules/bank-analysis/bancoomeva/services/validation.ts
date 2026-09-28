import { formatMoneyCents } from "../../../../utils/format";
import type { BancoomevaAnomaly, BancoomevaCheck, BancoomevaGroup, BancoomevaMovement, BancoomevaStatement, BancoomevaSummary, BancoomevaValidation } from "../types";

const MAX_LISTED = 5;

export const RECONCILIATION_WARNING = "Advertencia: los movimientos extraídos no concilian con los totales del extracto.";

/**
 * Controles sobre lo extraído. Nunca modifican movimientos: si algo no
 * cuadra, solo se informa. El análisis queda validado únicamente si los
 * débitos y créditos coinciden con TOTAL DEBITO y TOTAL CREDITO, saldo
 * inicial + créditos − débitos = saldo final, las filas siguen el orden
 * visual, la secuencia de saldos cuadra y no hay filas anómalas, sin interpretar ni totales distintos entre páginas.
 */
export function validateBancoomeva(statement: BancoomevaStatement, groups: BancoomevaGroup[], summary: BancoomevaSummary): BancoomevaValidation {
  const t = statement.totals;
  const checks: BancoomevaCheck[] = [
    grouping(statement, groups),
    compare("debits", "Suma de débitos = TOTAL DEBITO", t.totalDebitsCents, summary.totalDebitsCents),
    compare("credits", "Suma de créditos = TOTAL CREDITO", t.totalCreditsCents, summary.totalCreditsCents),
    reconciliation(statement, summary),
    summaryConsistency(statement),
    rowOrder(statement),
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

type ChainRow = BancoomevaMovement | BancoomevaAnomaly;

const chainRows = (s: BancoomevaStatement): ChainRow[] => [...s.movements, ...s.anomalies].sort((a, b) => a.index - b.index);

/**
 * Orden de lectura: cada fila ocupa una posición propia (página + línea) y
 * las filas avanzan de página en página y de arriba hacia abajo. Descarta
 * filas leídas dos veces o fuera del orden visual.
 */
function rowOrder(s: BancoomevaStatement): BancoomevaCheck {
  const rows = chainRows(s);
  const bad = rows.findIndex((r, i) => i > 0 && !(r.page > rows[i - 1].page || (r.page === rows[i - 1].page && r.y < rows[i - 1].y)));
  const label = "Orden visual de las filas (página y posición)";
  if (bad < 0) return { id: "order", label, status: "ok" };
  return { id: "order", label, status: "failed", detail: `La fila de la página ${rows[bad].page} (${rows[bad].date} ${rows[bad].description}) está repetida o fuera del orden del extracto.` };
}

const sameMovement = (a: ChainRow, b: ChainRow) => a.date === b.date && a.description === b.description && a.debitCents === b.debitCents && a.creditCents === b.creditCents;

/**
 * El banco a veces imprime, entre movimientos idénticos (misma fecha,
 * descripción y valores), los saldos en un orden distinto al de aplicación:
 * «34,589,798 → 34,389,798 → 34,489,798» con débitos de 100,000. Si desde
 * `start` hay filas idénticas cuyos saldos impresos son exactamente los que
 * la secuencia espera (ni uno más ni uno menos), las filas están completas y
 * solo difiere el orden del saldo impreso. Devuelve la última fila de ese
 * tramo, o -1. Las filas y los importes no se modifican.
 */
function permutedRunEnd(rows: ChainRow[], start: number, previous: number): number {
  const step = rows[start].creditCents - rows[start].debitCents;
  if (step === 0) return -1;
  const seen = new Set<number>();
  let max = 0;
  for (let k = start; k < rows.length && sameMovement(rows[k], rows[start]); k++) {
    const position = (rows[k].balanceCents! - previous) / step;
    if (!Number.isInteger(position) || position < 1 || seen.has(position)) return -1;
    seen.add(position);
    max = Math.max(max, position);
    // Posiciones distintas entre 1 y n, con la mayor igual a n: son exactamente 1…n.
    if (max === k - start + 1) return k > start ? k : -1;
  }
  return -1;
}

/** Saldo anterior − débito + crédito = saldo de cada fila (detecta filas omitidas, duplicadas o columnas mal leídas). */
function balanceChain(s: BancoomevaStatement): BancoomevaCheck {
  const label = "Secuencia de saldos";
  const rows = chainRows(s);
  if (rows.length === 0 || rows.some((r) => r.balanceCents === undefined)) {
    return { id: "balances", label, status: "unavailable", detail: "No todas las filas incluyen el saldo." };
  }
  const breaks: string[] = [];
  const reordered: { page: number; rows: number }[] = [];
  let previous = s.totals.openingBalanceCents;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const expected = previous === undefined ? undefined : previous - r.debitCents + r.creditCents;
    if (expected !== undefined && expected !== r.balanceCents) {
      const end = permutedRunEnd(rows, i, previous!);
      if (end >= 0) {
        reordered.push({ page: r.page, rows: end - i + 1 });
        previous = previous! + (end - i + 1) * (r.creditCents - r.debitCents);
        i = end;
        continue;
      }
      breaks.push(`Página ${r.page}, ${r.date} ${r.description}: se esperaba saldo ${formatMoneyCents(expected)} y el extracto muestra ${formatMoneyCents(r.balanceCents!)}.`);
      if (import.meta.env.DEV) {
        console.debug("[bancoomeva] saldo", { page: r.page, rowY: r.y, previousBalance: previous, debit: r.debitCents, credit: r.creditCents, expectedBalance: expected, actualBalance: r.balanceCents });
      }
    }
    previous = r.balanceCents;
  }
  const closing = s.totals.closingBalanceCents;
  if (closing !== undefined && previous !== closing) {
    breaks.push(`El saldo de la última fila (${formatMoneyCents(previous!)}) no coincide con SALDO FINAL (${formatMoneyCents(closing)}).`);
  }
  const pages = [...new Set(reordered.map((r) => r.page))].join(", ");
  const note =
    reordered.length === 0
      ? ""
      : `En ${reordered.length} tramo(s) de movimientos idénticos (misma fecha, descripción y valor; ${reordered.reduce((n, r) => n + r.rows, 0)} filas, página(s) ${pages}) el extracto imprime los saldos en otro orden. Están todos los saldos esperados, así que no falta ni sobra ninguna fila; los datos no se modificaron.`;
  if (breaks.length === 0) return { id: "balances", label, status: "ok", detail: note || undefined };
  const listed = breaks.slice(0, MAX_LISTED).join(" ");
  const more = breaks.length > MAX_LISTED ? ` (y ${breaks.length - MAX_LISTED} más)` : "";
  return { id: "balances", label, status: "failed", detail: `Se detectaron ${breaks.length} inconsistencia(s) en la secuencia de saldos. ${listed}${more}${note ? ` ${note}` : ""}` };
}
