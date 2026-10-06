import { DotLabel } from "../../shared/components/tableControls";
import type { TransactionType } from "../../shared/types";
import { BBVA_TYPE_LABEL } from "../types";

/** ● Abono (verde suave) / ● Cargo (rojo suave). */
export function BbvaTypeLabel({ type }: { type: TransactionType }) {
  return <DotLabel tone={type === "credit" ? "positive" : "negative"}>{BBVA_TYPE_LABEL[type]}</DotLabel>;
}
