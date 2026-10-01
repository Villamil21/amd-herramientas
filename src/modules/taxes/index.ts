import { lazy } from "react";
import { HandCoins, Landmark, ReceiptText } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

/**
 * Procesos tributarios. Cada herramienta es un submódulo; las futuras
 * (información exógena…) se agregan a `submodules`.
 */
export const taxesModule: ModuleDef = {
  id: "impuestos",
  name: "Impuestos",
  description: "Analiza facturas y prepara información tributaria.",
  icon: Landmark,
  accent: "rose",
  submoduleCards: "name",
  submodules: [
    {
      id: "analisis-iva-facturas",
      name: "IVA",
      description: "Resume bases e IVA por tarifa, tipo de proveedor y tipo de documento a partir de una carpeta de facturas PDF.",
      icon: ReceiptText,
      component: lazy(() => import("./invoice-vat/InvoiceVatPage")),
    },
    {
      id: "retencion-en-la-fuente",
      name: "Retención en la fuente",
      description: "Prepara, valida y resume por PJ / PN las bases y retenciones de la declaración a partir de una carpeta de facturas PDF.",
      icon: HandCoins,
      component: lazy(() => import("./withholding/WithholdingPage")),
    },
  ],
};
