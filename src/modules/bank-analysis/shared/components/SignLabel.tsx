import { SIGN_LABEL } from "../money";
import type { Sign } from "../types";
import { DotLabel } from "./tableControls";

/** Indicador discreto del tipo de grupo: ● Positivo / ● Negativo / ● Cero. */
export function SignLabel({ sign }: { sign: Sign }) {
  return <DotLabel tone={sign}>{SIGN_LABEL[sign]}</DotLabel>;
}
