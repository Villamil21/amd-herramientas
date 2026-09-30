import personal from "./assets/MembretePersonal.png";
import corporate from "./assets/MembreteCorporativo.png";
import type { Background } from "./model";

/**
 * Membretes de página completa (proporción A4). Ya incluyen el logo AMD y los
 * datos de contacto del pie: no se dibuja nada encima de esas zonas.
 * Viven en assets/ del proyecto: se empaquetan con la app y sobreviven a cierres y actualizaciones.
 */
export const BACKGROUNDS: Record<Background, { label: string; url: string }> = {
  personal: { label: "Personal", url: personal },
  corporate: { label: "Corporativo", url: corporate },
};
