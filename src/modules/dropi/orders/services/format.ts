import { formatMoneyCents } from "../../../../utils/format";

/** Centavos → "$ 99.900" o "$ 14.505,50": los decimales solo se muestran si existen. */
export function formatCop(cents: number): string {
  const text = formatMoneyCents(cents);
  return Math.round(cents) % 100 === 0 ? text.slice(0, -3) : text;
}
