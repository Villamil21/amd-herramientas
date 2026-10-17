import { lazy } from "react";
import { Bitcoin, FileSpreadsheet, HandCoins, Landmark, ShieldCheck, Users } from "lucide-react";
import type { ModuleDef } from "../../types/modules";

/**
 * Información Exógena (medios magnéticos de la DIAN). Es anual por empresa: el corte va del 01/01 al 31/12 del año a informar.
 * Formatos 1010 (socios), 1009 (cuentas por pagar) y 1008 (cuentas por cobrar a socios) con Control y exportación. Los demás formatos están registrados en
 * `domain/formats.ts` para agregarlos después; aquí solo hay pantallas de los implementados.
 */
export const exogenaModule: ModuleDef = {
  id: "informacion-exogena",
  name: "Información Exógena",
  description: "Prepara los formatos anuales de la DIAN por empresa: socios, cuentas por pagar y más.",
  icon: FileSpreadsheet,
  accent: "blue",
  submoduleCards: "name",
  landing: lazy(() => import("./pages/ExogenaHome")),
  submodules: [
    { id: "1010", name: "1010 · Socios, accionistas y similares", description: "Socios y su participación, desde Empresas.", icon: Users, priority: 0, component: lazy(() => import("./pages/Format1010Page")) },
    { id: "1009", name: "1009 · Saldos de cuentas por pagar al 31 de diciembre", description: "Saldo por tercero al cierre anual, conciliado con el ESF.", icon: Landmark, priority: 1, component: lazy(() => import("./pages/Format1009Page")) },
    { id: "1008", name: "1008 · Saldo de cuentas por cobrar al 31 de diciembre", description: "CxC a socios (suscrito − pagado) por tercero, desde Empresas.", icon: HandCoins, priority: 2, component: lazy(() => import("./pages/Format1008Page")) },
    { id: "1007", name: "1007 · Ingresos recibidos", description: "Ventas por cliente, desde Transacciones Cripto.", icon: Bitcoin, priority: 3, component: lazy(() => import("./pages/Format1007Page")) },
    { id: "1647", name: "1647 · Ingresos recibidos para terceros", description: "Compras por tercero asignadas a un pagador, desde Transacciones Cripto.", icon: Bitcoin, priority: 4, component: lazy(() => import("./pages/Format1647Page")) },
    { id: "control", name: "Control y exportación", description: "Auditoría de los formatos y exportación a Excel.", icon: ShieldCheck, priority: 5, component: lazy(() => import("./pages/ControlPage")) },
  ],
};
