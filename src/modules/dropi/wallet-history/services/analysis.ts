import type { AnalyzedMovement, Incident, ManualEdit, WalletAnalysis, WalletMovement } from "../types";

/** DESCRIPCIÓN de un retiro de cartera: el único concepto que se procesa. */
export const EXPECTED_DESCRIPTION = "SALIDA POR PETICION DE RETIRO DE SALDO EN CARTERA";
export const EXPECTED_TYPE = "SALIDA";

export const INCIDENT_LABEL: Record<Incident, string> = {
  type: "Tipo inesperado",
  duplicate: "Posible duplicado",
  invalid_amount: "Valor inválido",
  gmf_review: "Requiere revisión (4x1000)",
};

export const METHOD_LABEL = { direct: "Campo directo", calculated: "Base identificada", manual: "Revisión manual" } as const;

export const METHOD_DETAIL = {
  direct: "Valor pagado y 4x1000 tomados de columnas del archivo",
  calculated: "Base cerrada identificada: MONTO = valor pagado / 0,996 (regla de Dropi)",
  manual: "Valor pagado escrito a mano; el cargo es la diferencia con el MONTO",
} as const;

export const INCIDENTS = Object.keys(INCIDENT_LABEL) as Incident[];

const collapseSpaces = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Concepto completo, sin coincidencias parciales: solo se normalizan mayúsculas
 * y espacios (repetidos, al inicio y al final).
 */
export const isExpectedDescription = (text: string) => collapseSpaces(text).toUpperCase() === EXPECTED_DESCRIPTION;
export const isExpectedType = (text: string) => collapseSpaces(text) === EXPECTED_TYPE;

/** MONTO con centavos: el valor pagado (en pesos enteros) reproduce el MONTO con menos de $0,10 de diferencia. */
const FRACTIONAL_TOLERANCE_CENTS = 10n;

/**
 * El MONTO ya incluye el 4x1000 y Dropi lo cobra sobre el MONTO:
 * MONTO = Valor pagado / 0,996. Se busca el valor pagado B en pesos enteros:
 * - MONTO entero: redondeo(B / 0,996) = MONTO (al peso, mitades hacia arriba);
 *   4.016.064 → 4.000.000 + 16.064. El intervalo de B mide 0,996, así que la
 *   solución es única o no existe.
 * - MONTO con centavos (Dropi lo redondea a 1 o 2 decimales sin una regla fija):
 *   el B entero más cercano a MONTO × 0,996, si B / 0,996 queda a menos de
 *   $0,10 del MONTO; 10.040.160,60 → 10.000.000 + 40.160,60. B / 0,996 avanza
 *   1,004 por peso, así que tampoco puede haber dos soluciones.
 * Sin solución devuelve null y el retiro queda por revisar (edición manual).
 * Con enteros (BigInt) para no depender de la coma flotante.
 */
export function splitGmf(amountCents: number): { paidCents: number; gmfCents: number } | null {
  const cents = BigInt(amountCents);
  let pesos: bigint;
  if (cents % 100n === 0n) {
    const m = cents / 100n;
    // redondeo(B × 1000 / 996) = M  ⇔  996 (2M − 1) ≤ 2000 B < 996 (2M + 1)
    pesos = (996n * (2n * m - 1n) + 1999n) / 2000n;
    if (pesos < 0n || 2000n * pesos >= 996n * (2n * m + 1n)) return null;
  } else {
    // B = redondeo(MONTO × 0,996) en pesos; válido si |B × 100 × 1000 / 996 − MONTO| < 10 centavos.
    pesos = (996n * cents + 50_000n) / 100_000n;
    const diff = 100_000n * pesos - 996n * cents; // = 996 × (B / 0,996 − MONTO) en centavos
    if (pesos <= 0n || (diff < 0n ? -diff : diff) >= 996n * FRACTIONAL_TOLERANCE_CENTS) return null;
  }
  const paidCents = Number(pesos * 100n);
  return { paidCents, gmfCents: amountCents - paidCents };
}

/** Valor pagado + 4x1000 de una edición manual: siempre suman el MONTO (el MONTO original no cambia). */
export function manualSplit(amountCents: number, paidCents: number): { paidCents: number; gmfCents: number } | string {
  if (!Number.isInteger(paidCents) || paidCents <= 0) return "El valor pagado debe ser mayor que cero.";
  if (paidCents > amountCents) return "El valor pagado no puede superar el MONTO.";
  return { paidCents, gmfCents: amountCents - paidCents };
}

function amountProblem(m: WalletMovement): string | undefined {
  if (m.amountCents === null) return m.amountText ? `MONTO no numérico: «${m.amountText}»` : "MONTO vacío";
  if (m.amountCents < 0) return "MONTO negativo";
  if (m.amountCents === 0) return "MONTO en cero";
  return undefined;
}

/**
 * Primero filtra los retiros de saldo en cartera por DESCRIPCIÓN: el resto de
 * movimientos del archivo se ignora (no es un error ni requiere revisión).
 * Después valida cada retiro y calcula valor pagado y 4x1000. Las filas con
 * alguna incidencia requieren revisión y no se suman a los totales; un ID
 * repetido marca todas sus filas (no se elige cuál es la buena).
 */
export function analyzeWallet(allMovements: WalletMovement[], opts: { checkType: boolean; manual?: ReadonlyMap<number, number | ManualEdit> }): WalletAnalysis {
  const movements = allMovements.filter((m) => isExpectedDescription(m.description));
  const idCount = new Map<string, number>();
  for (const m of movements) if (m.id) idCount.set(m.id, (idCount.get(m.id) ?? 0) + 1);

  const analyzed: AnalyzedMovement[] = movements.map((m) => {
    const problem = amountProblem(m);
    const incidents: Incident[] = [];
    if (opts.checkType && !isExpectedType(m.type)) incidents.push("type");
    if (m.id && idCount.get(m.id)! > 1) incidents.push("duplicate");
    if (problem) incidents.push("invalid_amount");
    // Campos separados del archivo: se usan solo si suman exactamente el MONTO.
    const direct = !problem && m.direct && m.direct.paidCents + m.direct.gmfCents === m.amountCents ? m.direct : null;
    const calculated = problem ? null : (direct ?? splitGmf(m.amountCents!));
    // Edición manual (Valor pagado; el 4x1000 es la diferencia con el MONTO).
    const edit = problem ? undefined : opts.manual?.get(m.rowNumber);
    const manualPaid = typeof edit === "object" ? edit.paidCents : edit;
    const manual = manualPaid === undefined ? null : manualSplit(m.amountCents!, manualPaid);
    const split = manual && typeof manual !== "string" ? manual : calculated;
    if (!problem && !split) incidents.push("gmf_review");
    return {
      ...m,
      paidCents: split?.paidCents ?? null,
      gmfCents: split?.gmfCents ?? null,
      calculatedPaidCents: calculated?.paidCents ?? null,
      method: split === null ? null : split !== calculated ? "manual" : direct ? "direct" : "calculated",
      incidents,
      amountProblem: problem,
      ...(typeof edit === "object" && split !== calculated ? { manualEdit: edit } : {}),
    };
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
