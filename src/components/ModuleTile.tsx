import { ArrowRight, Clock } from "lucide-react";
import { StatusDot } from "./ui";

interface Props {
  title: string;
  description: string;
  meta?: string;
  available: boolean;
  onOpen: () => void;
}

export function ModuleTile({ title, description, meta, available, onOpen }: Props) {
  return (
    <button className="card tile" onClick={onOpen}>
      <StatusDot available={available} />
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
