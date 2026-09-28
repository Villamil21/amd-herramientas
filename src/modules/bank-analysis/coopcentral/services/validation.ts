import { formatMoneyCents } from "../../../../utils/format";
import type { CoopcentralCheck, CoopcentralGroup, CoopcentralStatement, CoopcentralSummary, CoopcentralValidation } from "../types";

const MAX_LISTED = 5;

export const RECONCILIATION_WARNING = "Advertencia: los movimientos extraídos no concilian con el saldo final del extracto.";

/**
 * Controles sobre lo extraído. Nunca modifican movimientos: si algo no
 * cuadra, solo se informa. El análisis queda validado únicamente si
 * saldo inicial + créditos − débitos = saldo final, la secuencia de saldos
 * cuadra y no hay filas anómalas ni sin interpretar.
 */
export function validateCoopcentral(statement: CoopcentralStatement, groups: CoopcentralGroup[], summary: CoopcentralSummary): CoopcentralValidation {
  const checks: CoopcentralCheck[] = [grouping(statement, groups), reconciliation(statement, summary), balanceChain(statement), ...periodTotals(statement, summary)];
  if (statement.anomalies.length > 0) {
    checks.push({
      id: "anomalies",
      label: "Filas con valor en CREDITOS y DEBITOS",
      status: "failed",
      detail: `${statement.anomalies.length} fila(s) traen valor en ambas columnas; no se clasificaron ni se sumaron. Revísalas en el extracto.`,
    });
  }
  if (statement.issues.length > 0) {
    checks.push({ id: "issues", label: "Filas sin interpretar", status: "failed", detail: `Se encontraron ${statement.issues.length} fila(s) en la tabla cuyo contenido no pudo interpretarse.` });
  }
  const required = checks.filter((c) => !c.informative);
  const validated = required.some((c) => c.id === "reconciliation" && c.status === "ok") && required.every((c) => c.status !== "failed");
  return { validated, checks };
}

/** Suma de los grupos = suma de los movimientos, por tipo (error interno si no). */
function grouping({ movements }: CoopcentralStatement, groups: CoopcentralGroup[]): CoopcentralCheck {
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

/** Saldo inicial + total créditos − total débitos = saldo final. */
function reconciliation(s: CoopcentralStatement, summary: CoopcentralSummary): CoopcentralCheck {
  const label = "Saldo inicial + créditos − débitos = saldo final";
  if (s.openingBalanceCents === undefined || s.closingBalanceCents === undefined) {
    const missing = [s.openingBalanceCents === undefined && "SALDO INICIAL", s.closingBalanceCents === undefined && "SALDO FINAL"].filter(Boolean).join(" ni ");
    return { id: "reconciliation", label, status: "unavailable", detail: `No se encontró ${missing} en el extracto.` };
  }
  const expected = s.openingBalanceCents + summary.totalCreditsCents - summary.totalDebitsCents;
  if (expected === s.closingBalanceCents) return { id: "reconciliation", label, status: "ok" };
  return {
    id: "reconciliation",
    label,
    status: "failed",
    detail: `${RECONCILIATION_WARNING} Con los movimientos el saldo final sería ${formatMoneyCents(expected)} y el extracto indica ${formatMoneyCents(s.closingBalanceCents)} (diferencia ${formatMoneyCents(expected - s.closingBalanceCents)}).`,
  };
}

/** Saldo anterior + crédito − débito = saldo de cada fila (detecta filas omitidas o mal leídas). */
function balanceChain(s: CoopcentralStatement): CoopcentralCheck {
  const label = "Secuencia de saldos";
  const rows = [...s.movements, ...s.anomalies].sort((a, b) => a.index - b.index);
  if (rows.length === 0 || rows.some((r) => r.balanceCents === undefined)) {
    return { id: "balances", label, status: "unavailable", detail: "No todas las filas incluyen el saldo." };
  }
  const breaks: string[] = [];
  let previous = s.openingBalanceCents;
  for (const r of rows) {
    const expected = previous === undefined ? undefined : previous + r.creditCents - r.debitCents;
    if (expected !== undefined && expected !== r.balanceCents) {
      breaks.push(`Página ${r.page}, ${r.concept}: se esperaba saldo ${formatMoneyCents(expected)} y el extracto muestra ${formatMoneyCents(r.balanceCents!)}.`);
    }
    previous = r.balanceCents;
  }
  if (s.closingBalanceCents !== undefined && previous !== s.closingBalanceCents) {
    breaks.push(`El saldo de la última fila (${formatMoneyCents(previous!)}) no coincide con SALDO FINAL (${formatMoneyCents(s.closingBalanceCents)}).`);
  }
  if (breaks.length === 0) return { id: "balances", label, status: "ok" };
  const listed = breaks.slice(0, MAX_LISTED).join(" ");
  const more = breaks.length > MAX_LISTED ? ` (y ${breaks.length - MAX_LISTED} más)` : "";
  return { id: "balances", label, status: "failed", detail: `${breaks.length} fila(s) no cuadran con el saldo. ${listed}${more}` };
}

/**
 * Comparación informativa con «TOTALES DEL PERIODO»: las categorías de
 * entrada (Consignaciones, Notas Crédito, Intereses Recibidos) contra el total
 * de créditos y las de salida (Retiros, Notas Débito, Retención, GMF) contra
 * el de débitos. No bloquea la validación ni cambia el análisis.
 */
function periodTotals({ periodTotals: t }: CoopcentralStatement, summary: CoopcentralSummary): CoopcentralCheck[] {
  const compare = (id: string, label: string, parts: (number | undefined)[], actual: number): CoopcentralCheck => {
    if (parts.some((p) => p === undefined)) {
      return { id, label, status: "unavailable", informative: true, detail: "No se encontró el bloque TOTALES DEL PERIODO completo." };
    }
    const expected = parts.reduce<number>((sum, p) => sum + p!, 0);
    if (expected === actual) return { id, label, status: "ok", informative: true };
    return {
      id,
      label,
      status: "failed",
      informative: true,
      detail: `El bloque de totales suma ${formatMoneyCents(expected)} y los movimientos ${formatMoneyCents(actual)} (diferencia ${formatMoneyCents(actual - expected)}).`,
    };
  };
  return [
    compare("period-credits", "Total créditos = Consignaciones + Notas Crédito + Intereses Recibidos", [t.consignacionesCents, t.notasCreditoCents, t.interesesRecibidosCents], summary.totalCreditsCents),
    compare("period-debits", "Total débitos = Retiros + Notas Débito + Retención + GMF", [t.retirosCents, t.notasDebitoCents, t.retencionCents, t.gmfCents], summary.totalDebitsCents),
  ];
}
