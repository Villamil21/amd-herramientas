import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { navigate } from "../../../app/router";
import { Button } from "../../../components/ui";
import { blocking, type Problem } from "../domain/problems";

interface Props {
  problems: Problem[];
  /** Texto cuando no queda nada pendiente. */
  okText?: string;
  title?: string;
}

/** Lista de pendientes accionables: cada uno dice qué falta y lleva a donde se resuelve. */
export function ProblemsPanel({ problems, okText = "Sin pendientes: el formato se puede marcar como listo.", title = "Pendientes por resolver" }: Props) {
  const [expanded, setExpanded] = useState(true);
  const stoppers = blocking(problems);
  if (problems.length === 0) {
    return (
      <section className="card pending-panel pending-panel--ready" aria-label="Estado del formato">
        <header className="pending-panel__header">
          <CheckCircle2 size={20} className="pending-panel__icon" aria-hidden />
          <div className="pending-panel__heading">
            <h2>
              Sin pendientes
              <span className="pending-panel__count">0</span>
            </h2>
            <p>{okText}</p>
          </div>
        </header>
      </section>
    );
  }
  return (
    <section className={`card pending-panel ${stoppers.length ? "pending-panel--blocking" : "pending-panel--warning"}`} aria-label={title}>
      <header className="pending-panel__header">
        <AlertTriangle size={20} className="pending-panel__icon" aria-hidden />
        <div className="pending-panel__heading">
          <h2>
            {title}
            <span className="pending-panel__count">{problems.length}</span>
          </h2>
          <p>{stoppers.length ? "Mientras haya pendientes bloqueantes el formato no puede quedar «listo» ni exportarse." : "Solo hay avisos: el formato se puede marcar como listo."}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Ocultar" : "Ver pendientes"}
        </Button>
      </header>
      {expanded && (
        <div className="pending-panel__details">
          <ul className="pending-list">
            {problems.slice(0, 200).map((p, i) => (
              <li key={`${p.recordKey ?? "x"}-${p.field ?? ""}-${i}`} className={`pending-item pending-item--${p.level}`}>
                <XCircle size={15} className="pending-item__icon" aria-label={p.level === "blocking" ? "Bloquea" : "Aviso"} />
                <div className="pending-item__text">
                  <strong className="selectable">{p.message}</strong>
                </div>
                {p.action && (
                  <div className="pending-item__actions">
                    <Button size="sm" onClick={() => navigate(p.action!.path)}>
                      {p.action.label}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {problems.length > 200 && <span className="muted">Se muestran los primeros 200 de {problems.length} pendientes.</span>}
        </div>
      )}
    </section>
  );
}
