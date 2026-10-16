import type { LucideIcon } from "lucide-react";
import { StatusDot } from "./ui";

interface Props {
  title: string;
  icon: LucideIcon;
  accent?: "blue" | "teal" | "violet" | "amber" | "rose" | "orange" | "green" | "indigo";
  /** Tiene alguna herramienta disponible (punto verde). */
  available: boolean;
  onOpen: () => void;
}

/** Tarjeta de módulo de la pantalla Herramientas: tinte del color del módulo, ícono, título y estado abajo a la derecha. */
export function ModuleCard({ title, icon: Icon, accent = "blue", available, onOpen }: Props) {
  return (
    <button className={`card module-card module-card--${accent}`} onClick={onOpen} title={title}>
      <Icon className="module-card__icon" size={34} strokeWidth={1.6} aria-hidden />
      <h3>{title}</h3>
      <span className="module-card__status">
        <StatusDot available={available} pulse />
      </span>
    </button>
  );
}
