import type { ComponentType, LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";

export interface SubmoduleDef {
  id: string; // segmento de URL
  name: string;
  description: string;
  icon: LucideIcon;
  /** Archivo dentro de Logos/ (ej. "Bancolombia.png") para módulos con tarjetas de logo. */
  logo?: string;
  /** Sin componente = "Próximamente". Se carga de forma diferida (lazy). */
  component?: LazyExoticComponent<ComponentType>;
}

export interface ModuleDef {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** "logo": los submódulos se muestran con su logo (ej. selección de banco). */
  submoduleCards?: "logo";
  submodules: SubmoduleDef[];
}
