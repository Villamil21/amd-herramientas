/**
 * Números de Información Exógena. Los montos y porcentajes del archivo son ENTEROS sin separadores; la interfaz, en cambio,
 * los muestra con separadores de miles colombianos. Todo el redondeo vive aquí para que pantalla y exportación coincidan.
 */

/**
 * Redondeo convencional al entero más cercano (la mitad se aleja de cero): 1.000.000,5 → 1.000.001 · −2,5 → −3.
 * `Math.round` redondea la mitad hacia +∞ (−2,5 → −2): por eso se redondea el valor absoluto.
 */
export function roundPesos(value: number): number {
  if (!Number.isFinite(value)) throw new Error("El valor no es un número.");
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded;
}

/** Centavos exactos → pesos enteros (redondeo convencional). */
export const centsToPesos = (cents: number): number => roundPesos(cents / 100);

/** 1000001 → «1.000.001» (interfaz). */
export function formatPesosPlain(value: number): string {
  const n = roundPesos(value);
  return `${n < 0 ? "-" : ""}${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** Pesos enteros para mostrar o imprimir: «$ 1.000.001» · «-$ 5». Sin decimales en ninguna parte de Exógena. */
export function formatExoPesos(value: number): string {
  const n = roundPesos(value);
  return `${n < 0 ? "-" : ""}$ ${formatPesosPlain(Math.abs(n))}`;
}

/** Centavos exactos → «$ 1.000.001» (redondeo convencional a pesos). */
export const formatExoCents = (cents: number): string => formatExoPesos(centsToPesos(cents));

/** Entero tal como se exporta: sin puntos, comas, símbolo de moneda ni decimales. */
export const exportInteger = (value: number): number => roundPesos(value);

/**
 * Porcentaje de participación en dos columnas: entero y posición decimal (dos dígitos).
 * 50,20 → 50 y 20 · 50 → 50 y 0 · 33,33 → 33 y 33 · 0,05 → 0 y 5.
 */
export function splitPercentage(percentage: number): { integer: number; decimal: number } {
  const hundredths = Math.round(percentage * 100);
  return { integer: Math.floor(hundredths / 100), decimal: hundredths % 100 };
}

/** Centésimas de punto (entero) para sumar porcentajes sin error de coma flotante: 50,20 → 5020. */
export const percentageHundredths = (percentage: number): number => Math.round(percentage * 100);

/** El porcentaje tiene a lo sumo dos decimales y está entre 0 (excluido) y 100. */
export function isValidPercentage(percentage: number): boolean {
  return Number.isFinite(percentage) && percentage > 0 && percentage <= 100 && Math.abs(percentage * 100 - Math.round(percentage * 100)) < 1e-6;
}
