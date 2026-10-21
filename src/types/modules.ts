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
  /** Sigue siendo una ruta válida, pero no aparece como tarjeta en la lista de proveedores ni en la búsqueda. */
  hidden?: boolean;
  /** Prioridad de la tarjeta: menor va primero (0 = siempre primera). Sin definir = orden declarado, después de las prioritarias. */
  priority?: number;
}

export interface ModuleDef {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Color del marcador en la pantalla Herramientas (refuerzo semántico). */
  accent?: "blue" | "teal" | "violet" | "amber" | "rose" | "orange" | "green" | "indigo";
  /** "logo": logo + nombre (ej. selección de banco). "name": la misma tarjeta, solo con el nombre. */
  submoduleCards?: "logo" | "name";
  /** Pantalla propia del módulo (en lugar de las tarjetas de sus submódulos), por ejemplo para elegir empresa y año antes. */
  landing?: LazyExoticComponent<ComponentType>;
  submodules: SubmoduleDef[];
}
