/** Importe de planilla: "$1,750,905", "$0", "-$1,200". Sin decimales. */
const PESO_AMOUNT = /^(-)?\$(-)?(\d{1,3}(?:,\d{3})*|\d+)$/;

export function isPesoAmount(text: string): boolean {
  return PESO_AMOUNT.test(text.trim());
}

/** "$1,750,905" → 1750905. null si el texto no tiene ese formato exacto. */
export function parsePesoAmount(text: string): number | null {
  const m = PESO_AMOUNT.exec(text.trim());
  if (!m) return null;
  const value = Number(m[3].replace(/,/g, ""));
  if (!Number.isSafeInteger(value)) return null;
  return (m[1] || m[2]) && value !== 0 ? -value : value;
}
