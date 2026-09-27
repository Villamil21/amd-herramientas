import { ArrowRight, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "./ui";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  meta?: string;
  available: boolean;
  /** Oculta la etiqueta Disponible/Próximamente (accesos directos). */
  hideStatus?: boolean;
  onOpen: () => void;
}

export function ModuleTile({ icon: Icon, title, description, meta, available, hideStatus, onOpen }: Props) {
  return (
    <button className="card tile" onClick={onOpen}>
      <div className="tile__top">
        <div className="tile__icon">
          <Icon size={18} strokeWidth={1.8} />
        </div>
        {!hideStatus && (available ? <Badge tone="gold">Disponible</Badge> : <Badge>Próximamente</Badge>)}
      </div>
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
