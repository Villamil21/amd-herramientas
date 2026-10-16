import { capitalTotal } from "./normalize";

export interface CapitalInput {
  subscribedTotalShares: number | null;
  subscribedNominalValue: number | null;
  paidTotalShares: number | null;
  paidNominalValue: number | null;
}

export interface CapitalSummary {
  /** Capital suscrito = acciones × valor nominal (null si falta alguno). */
  subscribed: number | null;
  paid: number | null;
  /** Saldo por cobrar a socios = suscrito − pagado (cuenta 132505). Null si no hay capital suscrito. */
  receivable: number | null;
  /** Inconsistencias visibles; ninguna impide corregir a mano. */
  warnings: string[];
}

/** Resumen de capital y sus validaciones. Un pagado sin definir cuenta como cero (todo el suscrito está por cobrar). */
export function capitalSummary(c: CapitalInput): CapitalSummary {
  const subscribed = capitalTotal(c.subscribedTotalShares, c.subscribedNominalValue);
  const paid = capitalTotal(c.paidTotalShares, c.paidNominalValue);
  const warnings: string[] = [];
  const half = (shares: number | null, nominal: number | null, label: string) => {
    if ((shares === null) !== (nominal === null)) warnings.push(`${label}: completa acciones y valor nominal (hoy solo hay uno).`);
  };
  half(c.subscribedTotalShares, c.subscribedNominalValue, "Capital suscrito");
  half(c.paidTotalShares, c.paidNominalValue, "Capital pagado");
  if (subscribed === null && paid !== null) warnings.push("Hay capital pagado pero no suscrito.");
  if (subscribed !== null && paid !== null && paid > subscribed) warnings.push("El capital pagado supera al suscrito.");
  if (subscribed !== null && paid !== null && c.subscribedNominalValue !== c.paidNominalValue) warnings.push("El valor nominal del capital pagado difiere del suscrito; revisa los datos.");
  return { subscribed, paid, receivable: subscribed === null ? null : subscribed - (paid ?? 0), warnings };
}
