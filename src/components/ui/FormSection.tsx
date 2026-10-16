import type { ReactNode } from "react";

interface Props {
  /** Número del bloque dentro del formulario (opcional). */
  step?: number;
  title: string;
  /** Acción del bloque (ej. «Agregar socio»), a la derecha del título. */
  actions?: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Bloque titulado de un formulario largo: separa Identificación, Contacto, Capital… en vez de una sola lista. */
export function FormSection({ step, title, actions, hint, className, children }: Props) {
  return (
    <section className={`form-section ${className ?? ""}`}>
      <header className="form-section__head">
        <h4 className="form-section__title">
          {step !== undefined && <span className="form-section__step">{step}</span>}
          {title}
        </h4>
        {actions && <div className="form-section__actions">{actions}</div>}
      </header>
      {hint && <p className="form-section__hint">{hint}</p>}
      <div className="form-section__body">{children}</div>
    </section>
  );
}
