import { SIGN_LABEL } from "../money";
import type { Sign } from "../types";

/** Indicador discreto del tipo de grupo: ● Positivo / ● Negativo / ● Cero. */
export function SignLabel({ sign }: { sign: Sign }) {
  return (
    <span className={`sign-label sign-label--${sign}`}>
      <span className="sign-label__dot" aria-hidden />
      {SIGN_LABEL[sign]}
    </span>
  );
}
