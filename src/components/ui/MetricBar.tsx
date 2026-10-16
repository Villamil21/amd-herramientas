import type { ReactNode } from "react";

export interface Metric {
  key: string;
  label: string;
  value: ReactNode;
  /** Color solo para lo relevante: pendientes (attention), clasificados (positive), negativos (negative). */
  tone?: "attention" | "positive" | "negative";
  /** Con onClick la métrica filtra (p. ej. la tabla); active la marca. */
  onClick?: () => void;
  active?: boolean;
  title?: string;
}

/**
 * Resumen horizontal compacto: «18 PDF · 16 Facturas · 2 Notas crédito · 14
 * Clasificadas · 2 Pendientes». Reemplaza filas de tarjetas estadísticas
 * grandes. Los valores monetarios no se parten en varias líneas.
 */
export function MetricBar({ metrics, label, extra }: { metrics: Metric[]; label: string; extra?: ReactNode }) {
  return (
    <div className="card metric-bar" role="group" aria-label={label}>
      <ul className="metric-bar__list">
        {metrics.map((m) => {
          const body = (
            <>
              <strong className="metric-bar__value">{m.value}</strong> <span className="metric-bar__label">{m.label}</span>
            </>
          );
          return (
            <li key={m.key} className={["metric-bar__item", m.tone && `metric-bar__item--${m.tone}`].filter(Boolean).join(" ")}>
              {m.onClick ? (
                <button type="button" className={`metric-bar__button${m.active ? " is-active" : ""}`} onClick={m.onClick} aria-pressed={m.active} title={m.title}>
                  {body}
                </button>
              ) : (
                <span title={m.title}>{body}</span>
              )}
            </li>
          );
        })}
      </ul>
      {extra && <div className="metric-bar__extra">{extra}</div>}
    </div>
  );
}
