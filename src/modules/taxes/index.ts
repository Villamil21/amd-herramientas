import { lazy } from "react";
import { BadgePercent, HandCoins, Landmark, ReceiptText } from "lucide-react";
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
      name: "IVA de compras",
      description: "Prepara y revisa la información de la declaración de IVA de compras a partir de una carpeta de facturas PDF.",
      icon: ReceiptText,
      component: lazy(() => import("./invoice-vat/InvoiceVatPage")),
    },
    {
      id: "retencion-en-la-fuente",
      name: "Retención en la fuente compras",
      description: "Prepara, valida y resume por PJ / PN las bases y retenciones de la declaración a partir de una carpeta de facturas PDF.",
      icon: HandCoins,
      component: lazy(() => import("./withholding/WithholdingPage")),
    },
    {
      id: "retencion-en-la-fuente-ventas",
      name: "Retención en la fuente ventas",
      description: "Calcula la autorretención en la fuente sobre las ventas a partir del Excel de facturación DIAN y el Código CIIU de la empresa.",
      icon: BadgePercent,
      component: lazy(() => import("./sales-withholding/SalesWithholdingPage")),
    },
  ],
};
