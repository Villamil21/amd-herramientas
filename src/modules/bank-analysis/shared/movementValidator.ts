import { formatMoneyCents } from "../../../utils/format";
import type { MovementGroup, ParsedStatement, StatementSummary, StatementValidation, ValidationCheck } from "./types";

const MAX_LISTED = 5;

/**
 * Controles sobre lo extraído. Nunca modifican movimientos: si algo no
 * cuadra, solo se informa para que el usuario revise.
 */
export function validateStatement(statement: ParsedStatement, groups: MovementGroup[], summary: StatementSummary): StatementValidation {
  const checks: ValidationCheck[] = [grouping(statement, groups), balanceChain(statement), ...totals(statement, summary)];
  if (statement.issues.length > 0) {
    checks.push({
      id: "issues",
      label: "Filas sin interpretar",
      status: "failed",
      detail: `Se encontraron ${statement.issues.length} fila(s) en la tabla cuyo contenido no pudo interpretarse.`,
    });
  }
  // Además de no tener fallas, debe haber al menos un control independiente que confirme la lectura.
  const confirmed = checks.some((c) => (c.id === "credits" || c.id === "balances") && c.status === "ok");
  const validated = confirmed && checks.every((c) => c.status !== "failed");
  return { validated, checks };
}

/** Suma de los grupos = suma de los movimientos individuales (error interno si no). */
function grouping(statement: ParsedStatement, groups: MovementGroup[]): ValidationCheck {
  const movementsTotal = statement.movements.reduce((s, m) => s + m.valueCents, 0);
  const groupsTotal = groups.reduce((s, g) => s + g.totalCents, 0);
  const groupsCount = groups.reduce((s, g) => s + g.count, 0);
  const ok = movementsTotal === groupsTotal && groupsCount === statement.movements.length;
  return {
    id: "grouping",
    label: "Suma de grupos igual a la suma de movimientos",
    status: ok ? "ok" : "failed",
    detail: ok ? undefined : "Error interno de agrupación: los totales de los grupos no coinciden con los movimientos.",
  };
}

/** Saldo anterior + valor = saldo de cada fila (detecta filas omitidas o mal leídas). */
function balanceChain({ movements, totals }: ParsedStatement): ValidationCheck {
  const label = "Secuencia de saldos";
  if (movements.length === 0 || movements.some((m) => m.balanceCents === undefined)) {
    return { id: "balances", label, status: "unavailable", detail: "El extracto no incluye el saldo de cada movimiento." };
  }
  const breaks: string[] = [];
  movements.forEach((m, i) => {
    const previous = i === 0 ? totals.previousBalanceCents : movements[i - 1].balanceCents;
    if (previous === undefined) return;
    if (previous + m.valueCents !== m.balanceCents) {
      breaks.push(`Página ${m.page}, ${m.date} ${m.description}: se esperaba saldo ${formatMoneyCents(previous + m.valueCents)} y el extracto muestra ${formatMoneyCents(m.balanceCents!)}.`);
    }
  });
  if (breaks.length === 0) return { id: "balances", label, status: "ok" };
  const listed = breaks.slice(0, MAX_LISTED).join(" ");
  const more = breaks.length > MAX_LISTED ? ` (y ${breaks.length - MAX_LISTED} más)` : "";
  return { id: "balances", label, status: "failed", detail: `${breaks.length} movimiento(s) no cuadran con el saldo. ${listed}${more}` };
}

/** Comparación contra el bloque RESUMEN del extracto. */
function totals({ totals: t, movements }: ParsedStatement, summary: StatementSummary): ValidationCheck[] {
  const compare = (id: string, label: string, expected: number | undefined, actual: number): ValidationCheck => {
    if (expected === undefined) return { id, label, status: "unavailable", detail: "No se encontró este dato en el resumen del extracto." };
    if (expected === actual) return { id, label, status: "ok" };
    return {
      id,
      label,
      status: "failed",
      detail: `El resumen del extracto indica ${formatMoneyCents(expected)} y los movimientos suman ${formatMoneyCents(actual)} (diferencia ${formatMoneyCents(actual - expected)}).`,
    };
  };
  const checks = [
    compare("credits", "Total positivo = TOTAL ABONOS", t.totalCreditsCents, summary.totalPositiveCents),
    compare("debits", "Total negativo = TOTAL CARGOS", t.totalDebitsCents, -summary.totalNegativeCents),
  ];
  if (t.previousBalanceCents !== undefined && t.currentBalanceCents !== undefined) {
    checks.push(compare("net", "Saldo anterior + neto = SALDO ACTUAL", t.currentBalanceCents, t.previousBalanceCents + summary.netCents));
  }
  const last = movements[movements.length - 1];
  if (last?.balanceCents !== undefined && t.currentBalanceCents !== undefined) {
    checks.push(compare("last-balance", "Saldo del último movimiento = SALDO ACTUAL", t.currentBalanceCents, last.balanceCents));
  }
  return checks;
}
