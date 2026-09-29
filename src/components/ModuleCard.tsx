import { ArrowRight, type LucideIcon } from "lucide-react";

interface Props {
  title: string;
  description: string;
  icon: LucideIcon;
  accent?: "blue" | "teal" | "violet" | "amber";
  onOpen: () => void;
}

/** Tarjeta de módulo de la pantalla Herramientas: tinte del color del módulo, icono, texto y acceso. */
export function ModuleCard({ title, description, icon: Icon, accent = "blue", onOpen }: Props) {
  return (
    <button className={`card module-card module-card--${accent}`} onClick={onOpen}>
      <Icon className="module-card__icon" size={40} strokeWidth={1.6} aria-hidden />
      <span className="module-card__body">
        <h3>{title}</h3>
        <p>{description}</p>
      </span>
      <span className="module-card__arrow" aria-hidden>
        <ArrowRight size={18} />
      </span>
    </button>
  );
}
