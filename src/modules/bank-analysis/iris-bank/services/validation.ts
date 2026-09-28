import { formatMoneyCents } from "../../../../utils/format";
import { balanceChain, groupingCheck } from "../../shared/movementValidator";
import type { MovementGroup, ParsedStatement, StatementSummary, StatementValidation, ValidationCheck } from "../../shared/types";

/**
 * Controles sobre lo extraído del extracto Iris Bank. Nunca modifican
 * movimientos: si algo no cuadra, solo se informa. El análisis queda
 * validado únicamente si los totales positivo y negativo coinciden con
 * «Total Abonos» y «Total Cargos», ningún otro control falla y no hay filas
 * sin interpretar.
 */
export function validateIrisBank(statement: ParsedStatement, groups: MovementGroup[], summary: StatementSummary): StatementValidation {
  const t = statement.totals;
  const checks: ValidationCheck[] = [
    groupingCheck(statement, groups),
    balanceChain(statement),
    compare("credits", "Total positivo = Total Abonos", t.totalCreditsCents, summary.totalPositiveCents),
    compare("debits", "Total negativo = Total Cargos", t.totalDebitsCents, -summary.totalNegativeCents),
    summaryConsistency(statement),
  ];
  if (t.previousBalanceCents !== undefined && t.currentBalanceCents !== undefined) {
    checks.push(compare("net", "Saldo Mes Anterior + neto = Saldo Actual", t.currentBalanceCents, t.previousBalanceCents + summary.netCents));
  }
  const last = statement.movements[statement.movements.length - 1];
  if (last?.balanceCents !== undefined && t.currentBalanceCents !== undefined) {
    checks.push(compare("last-balance", "Saldo del último movimiento = Saldo Actual", t.currentBalanceCents, last.balanceCents));
  }
  if (statement.issues.length > 0) {
    checks.push({ id: "issues", label: "Filas sin interpretar", status: "failed", detail: `Se encontraron ${statement.issues.length} fila(s) en la tabla cuyo contenido no pudo interpretarse.` });
  }
  const confirmed = ["credits", "debits"].every((id) => checks.find((c) => c.id === id)?.status === "ok");
  return { validated: confirmed && checks.every((c) => c.status !== "failed"), checks };
}

function compare(id: string, label: string, expected: number | undefined, actual: number): ValidationCheck {
  if (expected === undefined) return { id, label, status: "unavailable", detail: "No se encontró este dato en el resumen del extracto." };
  if (expected === actual) return { id, label, status: "ok" };
  return {
    id,
    label,
    status: "failed",
    detail: `El resumen del extracto indica ${formatMoneyCents(expected)} y los movimientos suman ${formatMoneyCents(actual)} (diferencia ${formatMoneyCents(actual - expected)}).`,
  };
}

/** Coherencia del propio resumen: Saldo Mes Anterior + Total Abonos − Total Cargos = Saldo Actual. */
function summaryConsistency({ totals: t }: ParsedStatement): ValidationCheck {
  const id = "summary";
  const label = "Saldo Mes Anterior + Total Abonos − Total Cargos = Saldo Actual";
  const { previousBalanceCents: prev, totalCreditsCents: credits, totalDebitsCents: debits, currentBalanceCents: current } = t;
  if (prev === undefined || credits === undefined || debits === undefined || current === undefined) {
    return { id, label, status: "unavailable", detail: "No se pudieron leer todos los valores del resumen del extracto." };
  }
  const expected = prev + credits - debits;
  if (expected === current) return { id, label, status: "ok" };
  return { id, label, status: "failed", detail: `El resumen da ${formatMoneyCents(expected)} y el extracto indica ${formatMoneyCents(current)} (diferencia ${formatMoneyCents(expected - current)}).` };
}
