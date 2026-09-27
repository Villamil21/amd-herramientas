import { ArrowRight, Clock } from "lucide-react";
import { StatusDot } from "./ui";

interface Props {
  title: string;
  description: string;
  meta?: string;
  available: boolean;
  /** Oculta el indicador de estado (accesos directos). */
  hideStatus?: boolean;
  onOpen: () => void;
}

export function ModuleTile({ title, description, meta, available, hideStatus, onOpen }: Props) {
  return (
    <button className="card tile" onClick={onOpen}>
      {!hideStatus && <StatusDot available={available} />}
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="tile__meta">
        {available ? <ArrowRight size={13} /> : <Clock size={13} />}
        {meta ?? (available ? "Abrir" : "En preparación")}
      </div>
    </button>
  );
}
