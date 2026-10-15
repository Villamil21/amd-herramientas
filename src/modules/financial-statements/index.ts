import { lazy } from "react";
import { BookCheck, ChartNoAxesCombined, ClipboardList, FileChartColumn, Landmark, ListTree, Receipt, Scale, ScrollText, ShoppingBag, UsersRound } from "lucide-react";
import type { ModuleDef } from "../../types/modules";
import { bankAnalysisModule } from "../bank-analysis";

/**
 * Preparación de estados financieros por empresa: cada fuente (compras,
 * bancos, nómina, ventas, saldos iniciales) envía sus movimientos contables,
 * y el Generador consolida por PUC y Catálogo de cuentas.
 */
export const financialStatementsModule: ModuleDef = {
  id: "estados-financieros",
  name: "Estados Financieros",
  description: "Prepara y genera estados financieros por empresa a partir de compras, bancos, nómina y ventas.",
  icon: ChartNoAxesCombined,
  accent: "green",
  submoduleCards: "name",
  submodules: [
    {
      // El id se conserva (rutas y accesos guardados); el nombre visible cambió.
      id: "codigos-puc-por-factura",
      name: "Clasificación contable de compras",
      description: "Asigna códigos PUC a las facturas de compra de una carpeta y envíalas a Estados Financieros.",
      icon: ListTree,
      component: lazy(() => import("./puc-codes/PucCodesPage")),
    },
    {
      // Extractos bancarios se movió aquí: los mismos lectores de cada banco, con la capa contable.
      id: bankAnalysisModule.id,
      name: "Extractos bancarios",
      description: "Analiza extractos bancarios y envía sus conceptos y saldos a Estados Financieros.",
      icon: FileChartColumn,
      providers: bankAnalysisModule.submodules,
      providersDescription: "Selecciona el banco del extracto.",
    },
    {
      id: "nomina",
      name: "Nómina",
      description: "Importa la planilla de seguridad social y causa salarios, aportes y prestaciones por empleado.",
      icon: UsersRound,
      providersDescription: "Selecciona el operador de la planilla.",
      providers: [
        { id: "aportes-en-linea", name: "Aportes en Línea", description: "Planilla de Aportes en Línea.", icon: ClipboardList, logo: "Aportes.png", component: lazy(() => import("./payroll/PayrollPage")) },
        // Sin componente = no disponible (punto gris). La arquitectura queda lista para otros operadores.
        { id: "soi", name: "SOI", description: "", icon: ClipboardList },
        { id: "mi-planilla", name: "Mi Planilla", description: "", icon: ClipboardList },
      ],
    },
    {
      id: "ventas",
      name: "Ventas",
      description: "Facturación electrónica y Reporte de operaciones (cripto).",
      icon: ShoppingBag,
      providersDescription: "Selecciona la fuente de ventas.",
      providers: [
        { id: "facturacion-electronica", name: "Facturación electrónica", description: "Excel de facturación electrónica (DIAN).", icon: Receipt, component: lazy(() => import("./sales/EInvoiceSalesPage")) },
        { id: "reporte-de-operaciones", name: "Reporte de operaciones", description: "Reporte de operaciones TPSV (compra y venta de cripto).", icon: Landmark, component: lazy(() => import("./sales/TpsvSalesPage")) },
      ],
    },
    {
      id: "obligaciones-tributarias",
      name: "Obligaciones tributarias",
      description: "Declaraciones DIAN de Retención en la fuente, IVA y Renta por empresa, con su fecha de pago y su efecto en los Estados Financieros.",
      icon: Scale,
      providersDescription: "Selecciona el impuesto.",
      providers: [
        { id: "retencion-en-la-fuente", name: "Retención en la fuente", description: "Formulario 350 (mensual).", icon: Scale, component: lazy(() => import("./tax-obligations/TaxObligationsPage").then((m) => ({ default: m.WithholdingReturnsPage }))) },
        { id: "iva", name: "IVA", description: "Formulario 300 (bimestral o cuatrimestral).", icon: Scale, component: lazy(() => import("./tax-obligations/TaxObligationsPage").then((m) => ({ default: m.VatReturnsPage }))) },
        { id: "renta", name: "Renta", description: "Formulario 110 (anual).", icon: Scale, component: lazy(() => import("./tax-obligations/TaxObligationsPage").then((m) => ({ default: m.IncomeReturnsPage }))) },
      ],
    },
    {
      id: "saldos-iniciales",
      name: "Saldos iniciales",
      description: "Saldos iniciales por empresa y fecha, por código PUC.",
      icon: ScrollText,
      component: lazy(() => import("./opening/OpeningBalancesPage")),
    },
    {
      id: "generador",
      name: "Generador de Estados Financieros",
      // Siempre la primera tarjeta, sin importar cuántos submódulos haya ni su nombre u orden.
      priority: 0,
      description: "Estado de Situación Financiera y Estado de Resultados: validación, previsualización, PDF y cierre.",
      icon: ChartNoAxesCombined,
      component: lazy(() => import("./generator/GeneratorPage")),
    },
    {
      id: "movimientos-contables",
      name: "Movimientos contables",
      description: "Auditoría de los movimientos enviados: filtros, origen y trazabilidad.",
      icon: BookCheck,
      component: lazy(() => import("./movements/MovementsPage")),
    },
  ],
};
