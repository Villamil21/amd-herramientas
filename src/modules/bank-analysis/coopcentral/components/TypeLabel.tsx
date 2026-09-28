import { DotLabel } from "../../shared/components/tableControls";
import { TYPE_LABEL, type TransactionType } from "../types";

/** ● Crédito (verde suave) / ● Débito (rojo suave). */
export function TypeLabel({ type }: { type: TransactionType }) {
  return <DotLabel tone={type === "credit" ? "positive" : "negative"}>{TYPE_LABEL[type]}</DotLabel>;
}

/** Clase de color del importe según el tipo. */
export const amountClass = (type: TransactionType) => (type === "credit" ? "amount--positive" : "amount--negative");
