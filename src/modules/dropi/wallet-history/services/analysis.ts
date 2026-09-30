import type { AnalyzedMovement, Incident, WalletAnalysis, WalletMovement } from "../types";

/** Valor canónico de DESCRIPCIÓN para un retiro de cartera. */
export const EXPECTED_DESCRIPTION = "SALIDA POR PETICION DE RETIRO DE SALDO EN CARTERA";
export const EXPECTED_TYPE = "SALIDA";

export const INCIDENT_LABEL: Record<Incident, string> = {
  description: "Descripción inesperada",
  type: "Tipo inesperado",
  duplicate: "Posible duplicado",
  invalid_amount: "Valor inválido",
};

export const INCIDENTS = Object.keys(INCIDENT_LABEL) as Incident[];

/** Solo se normalizan los espacios (repetidos, al inicio y al final): cualquier otro cambio es una diferencia real. */
const collapseSpaces = (text: string) => text.replace(/\s+/g, " ").trim();

export const isExpectedDescription = (text: string) => collapseSpaces(text) === EXPECTED_DESCRIPTION;
export const isExpectedType = (text: string) => collapseSpaces(text) === EXPECTED_TYPE;

/**
 * El MONTO ya incluye el 4x1000: MONTO = Valor pagado × 1,004.
 * Valor pagado = MONTO / 1,004 (redondeado al centavo, mitades hacia arriba)
 * y 4x1000 = MONTO − Valor pagado, así que ambos suman exactamente el MONTO.
 * Se calcula con enteros (BigInt) para no depender de la coma flotante.
 */
export function splitGmf(amountCents: number): { paidCents: number; gmfCents: number } {
  const paidCents = Number((BigInt(amountCents) * 2000n + 1004n) / 2008n);
  return { paidCents, gmfCents: amountCents - paidCents };
}

function amountProblem(m: WalletMovement): string | undefined {
  if (m.amountCents === null) return m.amountText ? `MONTO no numérico: «${m.amountText}»` : "MONTO vacío";
  if (m.amountCents < 0) return "MONTO negativo";
  if (m.amountCents === 0) return "MONTO en cero";
  return undefined;
}

/**
 * Valida cada movimiento y calcula valor pagado y 4x1000. Las filas con
 * alguna incidencia requieren revisión y no se suman a los totales; un ID
 * repetido marca todas sus filas (no se elige cuál es la buena).
 */
export function analyzeWallet(movements: WalletMovement[], opts: { checkType: boolean }): WalletAnalysis {
  const idCount = new Map<string, number>();
  for (const m of movements) if (m.id) idCount.set(m.id, (idCount.get(m.id) ?? 0) + 1);

  const analyzed: AnalyzedMovement[] = movements.map((m) => {
    const problem = amountProblem(m);
    const incidents: Incident[] = [];
    if (!isExpectedDescription(m.description)) incidents.push("description");
    if (opts.checkType && !isExpectedType(m.type)) incidents.push("type");
    if (m.id && idCount.get(m.id)! > 1) incidents.push("duplicate");
    if (problem) incidents.push("invalid_amount");
    const split = problem ? null : splitGmf(m.amountCents!);
    return { ...m, paidCents: split?.paidCents ?? null, gmfCents: split?.gmfCents ?? null, incidents, amountProblem: problem };
  });

  const totals = { count: 0, amountCents: 0, paidCents: 0, gmfCents: 0 };
  const review = { count: 0, amountCents: 0 };
  const incidentCounts = Object.fromEntries(INCIDENTS.map((i) => [i, 0])) as Record<Incident, number>;
  for (const m of analyzed) {
    if (m.incidents.length === 0) {
      totals.count++;
      totals.amountCents += m.amountCents!;
      totals.paidCents += m.paidCents!;
      totals.gmfCents += m.gmfCents!;
    } else {
      review.count++;
      if (m.paidCents !== null) review.amountCents += m.amountCents!;
      for (const i of m.incidents) incidentCounts[i]++;
    }
  }

  return { movements: analyzed, totals, review, incidentCounts };
}
