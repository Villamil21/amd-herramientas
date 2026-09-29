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
  /**
   * Tercer nivel: pantalla para escoger proveedor (ej. Resumen de planilla →
   * Aportes en Línea / Mi Planilla). Se muestran como tarjetas con logo.
   */
  providers?: SubmoduleDef[];
  /** Texto de la pantalla de selección de proveedores (por defecto, el de planillas). */
  providersDescription?: string;
}

export interface ModuleDef {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Color del marcador en la pantalla Herramientas (refuerzo semántico). */
  accent?: "blue" | "teal" | "violet" | "amber" | "rose" | "orange";
  /** "logo": los submódulos se muestran con su logo (ej. selección de banco). */
  submoduleCards?: "logo";
  submodules: SubmoduleDef[];
}
