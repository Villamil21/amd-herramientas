import type { Sign } from "./types";

/**
 * Importe escrito con coma de miles y punto decimal, como en los extractos
 * ("3,791,445.00", "-126,530.60", ".00", "-.04"). Siempre con dos decimales.
 */
const STATEMENT_AMOUNT = /^(-)?(\d{1,3}(?:,\d{3})*|\d+)?\.(\d{2})$/;

export function isStatementAmount(text: string): boolean {
  return STATEMENT_AMOUNT.test(text);
}

/** "3,791,445.00" → 379144500 centavos. null si el texto no tiene ese formato exacto. */
export function parseStatementAmount(text: string): number | null {
  const m = STATEMENT_AMOUNT.exec(text.trim());
  if (!m) return null;
  const [, minus, int = "", dec] = m;
  const cents = Number(int.replace(/,/g, "") || "0") * 100 + Number(dec);
  if (!Number.isSafeInteger(cents)) return null;
  return minus && cents !== 0 ? -cents : cents;
}

export function signOf(cents: number): Sign {
  return cents > 0 ? "positive" : cents < 0 ? "negative" : "zero";
}

export const SIGN_LABEL: Record<Sign, string> = { positive: "Positivo", negative: "Negativo", zero: "Cero" };

/** Orden estable de los signos cuando una descripción tiene varios grupos. */
export const SIGN_ORDER: Record<Sign, number> = { positive: 0, negative: 1, zero: 2 };
