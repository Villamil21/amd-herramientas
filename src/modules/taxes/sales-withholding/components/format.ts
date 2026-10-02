import { formatMoneyCents } from "../../../../utils/format";
import { microToCents } from "../services/decimal";

/** Centavos → "$31.355.919,00" (siempre con centavos, como en la declaración). */
export const formatCents = (cents: number) => formatMoneyCents(cents).replace("$ ", "$");

/** Millonésimas de peso → "$31.355.919,00". Solo para mostrar: los cálculos no se redondean. */
export const formatMicro = (micro: bigint) => formatCents(microToCents(micro));
