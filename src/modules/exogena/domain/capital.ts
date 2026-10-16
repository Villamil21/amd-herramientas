/**
 * Capital asignado a cada socio: capital suscrito (acciones × valor nominal) × su participación.
 *
 * El capital se reparte en pesos ENTEROS y la suma de los socios coincide EXACTAMENTE con el capital total. Regla de
 * redondeo determinista (mayores restos): cada socio recibe el piso de su parte exacta y los pesos que sobran se
 * entregan de a uno a quienes tienen el mayor resto; ante un empate, al socio que aparece primero. Se calcula con enteros
 * grandes (BigInt) porque capital × porcentaje en puntos básicos puede superar el entero seguro de JavaScript.
 */

export interface CapitalShare {
  /** Participación con hasta dos decimales (50,20). */
  percentage: number;
}

/** Capital suscrito en pesos enteros; null si la empresa aún no lo tiene configurado. */
export function subscribedCapitalPesos(company: { subscribedTotalShares: number | null; subscribedNominalValue: number | null }): number | null {
  const { subscribedTotalShares: shares, subscribedNominalValue: nominal } = company;
  if (!shares || !nominal || shares <= 0 || nominal <= 0) return null;
  const total = BigInt(shares) * BigInt(nominal);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

/**
 * Reparte `totalPesos` entre los socios. Devuelve un arreglo del mismo orden. Si las participaciones no suman 100,00 %
 * (dato inválido que otra validación bloquea) cada socio recibe solo el piso de su parte: nunca se inventa un reparto.
 */
export function allocateCapital(totalPesos: number, shares: CapitalShare[]): number[] {
  if (!Number.isSafeInteger(totalPesos) || totalPesos < 0) throw new Error("El capital debe ser un entero de pesos.");
  const total = BigInt(totalPesos);
  const basisPoints = shares.map((s) => BigInt(Math.round(s.percentage * 100)));
  const exact = basisPoints.map((bp) => total * bp);
  const floors = exact.map((e) => e / 10000n);
  const remainders = exact.map((e) => e % 10000n);
  const complete = basisPoints.reduce((a, b) => a + b, 0n) === 10000n;
  let left = complete ? total - floors.reduce((a, b) => a + b, 0n) : 0n;
  const order = shares.map((_, i) => i).sort((a, b) => (remainders[a] === remainders[b] ? a - b : remainders[a] > remainders[b] ? -1 : 1));
  const result = floors.map((f) => f);
  for (const i of order) {
    if (left <= 0n) break;
    result[i] += 1n;
    left -= 1n;
  }
  return result.map(Number);
}
