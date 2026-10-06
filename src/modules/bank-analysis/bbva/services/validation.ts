import { formatMoneyCents } from "../../../../utils/format";
import type { BbvaAnomaly, BbvaCheck, BbvaGroup, BbvaMovement, BbvaStatement, BbvaSummary, BbvaSummaryLine, BbvaValidation } from "../types";

const MAX_LISTED = 5;

export const RECONCILIATION_WARNING = "Advertencia: los movimientos extraídos no concilian con el resumen del extracto.";

/**
 * Controles sobre lo extraído. Nunca modifican movimientos: si algo no
 * cuadra, solo se informa. El análisis queda validado únicamente si el neto
 * de los movimientos coincide con el del «Resumen de movimientos», saldo
 * cierre mes anterior + abonos − cargos = saldo final, la secuencia de
 * saldos cuadra fila por fila y no hay filas anómalas ni sin interpretar.
 *
 * El resumen separa los abonos en ABONOS e INTERESES RECIBIDOS y los cargos
 * en CARGOS, IVA, 4 POR MIL y RETENCIONES, y sus líneas son NETAS: cuando el
 * banco devuelve un cobro («CORRECCION IMPTO DECRETO», «ANU. COM DECRETO»),
 * la tabla lo trae como una fila de Abonos pero el resumen lo descuenta de
 * la línea de cargos correspondiente. Por eso el total de cada columna puede
 * superar al del resumen en ese mismo valor, y lo que se compara es el neto
 * (abonos − cargos) y la cantidad total de filas, sin clasificar los
 * movimientos por el texto del concepto.
 */
export function validateBbva(statement: BbvaStatement, groups: BbvaGroup[], summary: BbvaSummary): BbvaValidation {
  const checks: BbvaCheck[] = [
    grouping(statement, groups),
    net(statement, summary),
    counts(statement),
    reconciliation(statement, summary),
    summaryConsistency(statement),
    rowOrder(statement),
    balanceChain(statement),
  ];
  if (statement.anomalies.length > 0) {
    checks.push({
      id: "anomalies",
      label: "Filas con valor en Cargos y en Abonos",
      status: "failed",
      detail: `${statement.anomalies.length} fila(s) traen valor en ambas columnas; no se clasificaron ni se sumaron. Revísalas en el extracto.`,
    });
  }
  if (statement.issues.length > 0) {
    checks.push({ id: "issues", label: "Filas sin interpretar", status: "failed", detail: `Se encontraron ${statement.issues.length} fila(s) en la tabla cuyo contenido no pudo interpretarse.` });
  }
  const confirmed = ["net", "reconciliation", "balances"].every((id) => checks.find((c) => c.id === id)?.status === "ok");
  return { validated: confirmed && checks.every((c) => c.status !== "failed"), checks };
}

/** Suma de las líneas del resumen; undefined si falta alguna. La cantidad vacía de una línea en 0.00 cuenta como 0. */
function sumLines(lines: (BbvaSummaryLine | undefined)[], field: "cents" | "count"): number | undefined {
  let sum = 0;
  for (const line of lines) {
    const value = field === "cents" ? line?.cents : (line?.count ?? (line?.cents === 0 ? 0 : undefined));
    if (value === undefined) return undefined;
    sum += value;
  }
  return sum;
}

const CREDIT_LINES = (t: BbvaStatement["totals"]) => [t.credits, t.interest];
const CHARGE_LINES = (t: BbvaStatement["totals"]) => [t.charges, t.vat, t.fourPerThousand, t.withholdings];

/** Abonos − cargos extraídos = (ABONOS + INTERESES RECIBIDOS) − (CARGOS + IVA + 4 POR MIL + RETENCIONES). */
function net({ totals: t }: BbvaStatement, summary: BbvaSummary): BbvaCheck {
  const id = "net";
  const label = "Abonos − cargos = movimiento neto del resumen";
  const credits = sumLines(CREDIT_LINES(t), "cents");
  const charges = sumLines(CHARGE_LINES(t), "cents");
  if (credits === undefined || charges === undefined) return { id, label, status: "unavailable", detail: "No se pudieron leer todos los valores del resumen." };
  const extraCredits = summary.totalCreditsCents - credits;
  const extraCharges = summary.totalChargesCents - charges;
  if (extraCredits !== extraCharges) {
    return {
      id,
      label,
      status: "failed",
      detail: `${RECONCILIATION_WARNING} El resumen indica abonos por ${formatMoneyCents(credits)} y cargos por ${formatMoneyCents(charges)} (neto ${formatMoneyCents(credits - charges)}); los movimientos suman abonos por ${formatMoneyCents(summary.totalCreditsCents)} y cargos por ${formatMoneyCents(summary.totalChargesCents)} (neto ${formatMoneyCents(summary.netCents)}; diferencia ${formatMoneyCents(extraCredits - extraCharges)}).`,
    };
  }
  if (extraCredits === 0) return { id, label, status: "ok" };
  return {
    id,
    label,
    status: "ok",
    detail: `La tabla trae ${formatMoneyCents(Math.abs(extraCredits))} ${extraCredits > 0 ? "más" : "menos"} en Abonos y en Cargos que el resumen (abonos ${formatMoneyCents(credits)}, cargos ${formatMoneyCents(charges)}): el extracto presenta sus líneas netas de devoluciones o correcciones, que en la tabla son filas propias. El neto coincide y los datos no se modificaron.`,
  };
}

/** Suma de los grupos = suma de los movimientos, por tipo (error interno si no). */
function grouping({ movements }: BbvaStatement, groups: BbvaGroup[]): BbvaCheck {
  const sum = (type: "credit" | "debit") => groups.filter((g) => g.transactionType === type).reduce((s, g) => s + g.totalCents, 0);
  const credits = movements.reduce((s, m) => s + m.creditCents, 0);
  const charges = movements.reduce((s, m) => s + m.chargeCents, 0);
  const count = groups.reduce((s, g) => s + g.count, 0);
  const ok = sum("credit") === credits && sum("debit") === charges && count === movements.length;
  return {
    id: "grouping",
    label: "Suma de grupos igual a la suma de movimientos",
    status: ok ? "ok" : "failed",
    detail: ok ? undefined : "Error interno de agrupación: los totales de los grupos no coinciden con los movimientos.",
  };
}

/** Filas extraídas = suma de las cantidades (No.) del resumen. Detecta filas perdidas o duplicadas aunque los valores sumen igual. */
function counts({ movements, anomalies, totals: t }: BbvaStatement): BbvaCheck {
  const id = "counts";
  const label = "Cantidad de movimientos = cantidades del resumen";
  const expected = sumLines([...CREDIT_LINES(t), ...CHARGE_LINES(t)], "count");
  if (expected === undefined) return { id, label, status: "unavailable", detail: "No se pudieron leer todas las cantidades (No.) del resumen." };
  const found = movements.length + anomalies.length;
  if (expected === found) return { id, label, status: "ok" };
  return { id, label, status: "failed", detail: `El resumen indica ${expected} movimiento(s) y se extrajeron ${found}.` };
}

/** SALDO CIERRE MES ANTERIOR + abonos extraídos − cargos extraídos = SALDO FINAL. */
function reconciliation({ totals: t }: BbvaStatement, summary: BbvaSummary): BbvaCheck {
  const id = "reconciliation";
  const label = "Saldo cierre mes anterior + abonos − cargos = saldo final";
  if (t.openingBalanceCents === undefined || t.closingBalanceCents === undefined) {
    const missing = [t.openingBalanceCents === undefined && "SALDO CIERRE MES ANTERIOR", t.closingBalanceCents === undefined && "SALDO FINAL"].filter(Boolean).join(" ni ");
    return { id, label, status: "unavailable", detail: `No se encontró ${missing} en el extracto.` };
  }
  const expected = t.openingBalanceCents + summary.totalCreditsCents - summary.totalChargesCents;
  if (expected === t.closingBalanceCents) return { id, label, status: "ok" };
  return {
    id,
    label,
    status: "failed",
    detail: `${RECONCILIATION_WARNING} Con los movimientos el saldo final sería ${formatMoneyCents(expected)} y el extracto indica ${formatMoneyCents(t.closingBalanceCents)} (diferencia ${formatMoneyCents(expected - t.closingBalanceCents)}).`,
  };
}

/** Coherencia del propio resumen: saldo anterior + ABONOS + INTERESES − CARGOS − IVA − 4 POR MIL − RETENCIONES = SALDO FINAL. */
function summaryConsistency({ totals: t }: BbvaStatement): BbvaCheck {
  const id = "summary";
  const label = "Resumen: saldo anterior + abonos + intereses − cargos − IVA − 4 por mil − retenciones = saldo final";
  const credits = sumLines(CREDIT_LINES(t), "cents");
  const charges = sumLines(CHARGE_LINES(t), "cents");
  if (t.openingBalanceCents === undefined || t.closingBalanceCents === undefined || credits === undefined || charges === undefined) {
    return { id, label, status: "unavailable", detail: "No se pudieron leer todos los valores del resumen." };
  }
  const expected = t.openingBalanceCents + credits - charges;
  if (expected === t.closingBalanceCents) return { id, label, status: "ok" };
  return { id, label, status: "failed", detail: `El resumen da ${formatMoneyCents(expected)} y el extracto indica ${formatMoneyCents(t.closingBalanceCents)} (diferencia ${formatMoneyCents(expected - t.closingBalanceCents)}).` };
}

type ChainRow = BbvaMovement | BbvaAnomaly;

const chainRows = (s: BbvaStatement): ChainRow[] => [...s.movements, ...s.anomalies].sort((a, b) => a.index - b.index);

/** "Página 2, fila 14 (movimiento 1028), 12-08-2026 «PAGO POR PSE A Davivienda»" */
const describeRow = (r: ChainRow) => `Página ${r.page}, fila ${r.row}${r.movementNumber ? ` (movimiento ${r.movementNumber})` : ""}, ${r.operationDate} «${r.concept}»`;

/**
 * Orden de lectura: cada fila ocupa una posición propia (página + línea) y
 * las filas avanzan de página en página y de arriba hacia abajo. Descarta
 * filas leídas dos veces o fuera del orden visual.
 */
function rowOrder(s: BbvaStatement): BbvaCheck {
  const rows = chainRows(s);
  const bad = rows.findIndex((r, i) => i > 0 && !(r.page > rows[i - 1].page || (r.page === rows[i - 1].page && r.y < rows[i - 1].y)));
  const label = "Orden visual de las filas (página y posición)";
  if (bad < 0) return { id: "order", label, status: "ok" };
  return { id: "order", label, status: "failed", detail: `${describeRow(rows[bad])} está repetida o fuera del orden del extracto.` };
}

/** Saldo anterior − cargo + abono = saldo de cada fila (detecta filas omitidas, duplicadas o columnas mal leídas). */
function balanceChain(s: BbvaStatement): BbvaCheck {
  const id = "balances";
  const label = "Secuencia de saldos";
  const rows = chainRows(s);
  if (rows.length === 0 || rows.some((r) => r.balanceCents === undefined)) {
    return { id, label, status: "unavailable", detail: "No todas las filas incluyen el saldo." };
  }
  const breaks: string[] = [];
  let previous = s.totals.openingBalanceCents;
  for (const r of rows) {
    const expected = previous === undefined ? undefined : previous - r.chargeCents + r.creditCents;
    if (expected !== undefined && expected !== r.balanceCents) {
      const value = [r.chargeCents > 0 && `cargo ${formatMoneyCents(r.chargeCents)}`, r.creditCents > 0 && `abono ${formatMoneyCents(r.creditCents)}`].filter(Boolean).join(" y ") || formatMoneyCents(0);
      breaks.push(
        `${describeRow(r)}: valor interpretado ${value}; saldo esperado ${formatMoneyCents(expected)}; saldo encontrado ${formatMoneyCents(r.balanceCents!)}; diferencia ${formatMoneyCents(r.balanceCents! - expected)}.`,
      );
    }
    previous = r.balanceCents;
  }
  const closing = s.totals.closingBalanceCents;
  if (closing !== undefined && previous !== closing) {
    breaks.push(`El saldo de la última fila (${formatMoneyCents(previous!)}) no coincide con SALDO FINAL (${formatMoneyCents(closing)}); diferencia ${formatMoneyCents(previous! - closing)}.`);
  }
  if (breaks.length === 0) return { id, label, status: "ok" };
  const listed = breaks.slice(0, MAX_LISTED).join(" ");
  const more = breaks.length > MAX_LISTED ? ` (y ${breaks.length - MAX_LISTED} más)` : "";
  return { id, label, status: "failed", detail: `Se detectaron ${breaks.length} inconsistencia(s) en la secuencia de saldos. ${listed}${more}` };
}
