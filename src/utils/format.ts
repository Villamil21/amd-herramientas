function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Centavos → "$ 3.906.000,00" (estilo colombiano). */
export function formatMoneyCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const pesos = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$ ${groupThousands(String(pesos))},${dec}`;
}

/** Tarifa con coma decimal y sin ceros sobrantes: 9,66 · 4 · 0,414 */
export function formatRate(rate: number): string {
  const fixed = rate.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  const [int, dec] = fixed.split(".");
  return dec ? `${groupThousands(int)},${dec}` : groupThousands(int);
}

export function formatInteger(n: number): string {
  return groupThousands(String(Math.trunc(n)));
}
