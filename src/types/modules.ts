import type { ComponentType, LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";

export interface SubmoduleDef {
  id: string; // segmento de URL
  name: string;
  description: string;
  icon: LucideIcon;
  /** Sin componente = "Próximamente". Se carga de forma diferida (lazy). */
  component?: LazyExoticComponent<ComponentType>;
}

export interface ModuleDef {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  submodules: SubmoduleDef[];
}
