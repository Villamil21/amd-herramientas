import { Fragment } from "react";
import { Check } from "lucide-react";

interface Props {
  steps: string[];
  current: number; // índice
  /** Pasos a los que se puede saltar (ya completados o el siguiente disponible). */
  canGoTo: (index: number) => boolean;
  onChange: (index: number) => void;
}

export function Stepper({ steps, current, canGoTo, onChange }: Props) {
  return (
    <div className="card stepper" role="list">
      {steps.map((label, i) => {
        const state = i === current ? "is-active" : i < current ? "is-done" : "";
        return (
          <Fragment key={label}>
            <button role="listitem" className={`step ${state}`} disabled={i === current || !canGoTo(i)} onClick={() => onChange(i)} aria-current={i === current ? "step" : undefined}>
              <span className="step__num">{i < current ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
              {label}
            </button>
            {i < steps.length - 1 && <span className="step__line" />}
          </Fragment>
        );
      })}
    </div>
  );
}
