import type { ReactNode } from "react";

export interface ContextItem {
  label: string;
  value: ReactNode;
  /** Texto pequeño bajo el valor (p. ej. el NIT). */
  hint?: ReactNode;
  /** Valor que se puede seleccionar y copiar (NIT, número de cuenta, archivo). */
  selectable?: boolean;
}

interface Props {
  items: ContextItem[];
  /** Acciones de la cabecera (cambiar archivo, registrar periodo sin…). */
  actions?: ReactNode;
  /** Contenido debajo (progreso, avisos breves). */
  children?: ReactNode;
}

/**
 * Cabecera compacta de contexto: empresa, periodo, archivo… en una sola franja,
 * con las acciones del archivo a la derecha. Reemplaza tarjetas grandes cuando
 * basta con saber «sobre qué se está trabajando».
 */
export function ContextBar({ items, actions, children }: Props) {
  return (
    <div className="card context-bar">
      <div className="context-bar__main">
        <dl className="context-bar__items">
          {items.map((i) => (
            <div key={i.label} className="context-bar__item">
              <dt>{i.label}</dt>
              <dd className={i.selectable ? "selectable" : undefined}>
                {i.value}
                {i.hint && <span className="context-bar__hint">{i.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
        {actions && <div className="context-bar__actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
