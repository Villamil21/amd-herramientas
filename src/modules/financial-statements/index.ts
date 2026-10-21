import { lazy } from "react";
import { BookCheck, Bitcoin, ChartNoAxesCombined, Contact, FileChartColumn, FileSpreadsheet, Landmark, ListTree, NotebookText, Receipt, Scale, ScrollText, ShoppingBag, UsersRound } from "lucide-react";
import type { ModuleDef } from "../../types/modules";
import { bankAnalysisModule } from "../bank-analysis";
import { BANK_EXO_PROVIDER_ID } from "./bank/exogena/paths";

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
      id: "transacciones-cripto",
      name: "Transacciones Cripto",
      // Al inicio de Estados Financieros, antes del Generador.
      priority: -1,
      description: "Cargas acumulativas de Excel de compras y ventas cripto: Estados Financieros y formatos 1007 y 1647 de Exógena.",
      icon: Bitcoin,
      providersDescription: "Selecciona el submódulo.",
      providers: [
        { id: "reporte-de-operaciones", name: "Reporte de operaciones", description: "Importa los Excel de Compras y Ventas por empresa y año, revisa duplicados y prepara EEFF, 1007 y 1647.", icon: Landmark, component: lazy(() => import("./crypto/CryptoOperationsPage")) },
        // Sin componente = «Próximamente»: el Certificado Cripto no se implementa en esta entrega.
        { id: "certificado-cripto", name: "Certificado Cripto", description: "", icon: ScrollText },
      ],
    },
    {
      // El id se conserva (rutas y accesos guardados); el nombre visible cambió.
      id: "codigos-puc-por-factura",
      name: "Compras, costos y exógena",
      description: "Importa facturas y notas crédito electrónicas, clasifica cada línea y prepara Estados Financieros y los formatos 1001, 1005 y 1006.",
      icon: ListTree,
      component: lazy(() => import("./purchases/PurchasesPage")),
    },
    {
      // Extractos bancarios se movió aquí: los mismos lectores de cada banco, con la capa contable.
      id: bankAnalysisModule.id,
      name: "Extractos bancarios",
      description: "Analiza extractos bancarios y envía sus conceptos y saldos a Estados Financieros.",
      icon: FileChartColumn,
      providers: [
        // Primero: qué se ha importado por banco y cuenta, las fichas de los bancos y lo que los extractos aportan a Exógena.
        { id: BANK_EXO_PROVIDER_ID, name: "Cobertura y Exógena", description: "Extractos por empresa, banco, cuenta y mes, fichas de bancos y formatos 1012, 1007 y 1011.", icon: FileSpreadsheet, component: lazy(() => import("./bank/exogena/BankExoPage")) },
        ...bankAnalysisModule.submodules,
      ],
      providersDescription: "Selecciona el banco del extracto, o abre la cobertura y lo que los extractos aportan a Exógena.",
    },
    {
      // Un solo submódulo visible: el operador (Aportes en Línea, MiPlanilla…) se detecta desde el PDF.
      id: "nomina",
      name: "Nómina y seguridad social",
      description: "Importa la planilla PDF una sola vez: causa la nómina en Estados Financieros y alimenta los formatos 1001, 1011 y 2276 de Exógena.",
      icon: UsersRound,
      component: lazy(() => import("./payroll/NominaPage")),
    },
    {
      id: "empleados",
      name: "Empleados",
      description: "Historial de empleados por empresa: áreas, vinculaciones y planillas procesadas.",
      icon: Contact,
      component: lazy(() => import("./payroll/EmployeesPage")),
    },
    {
      id: "ventas",
      name: "Ventas",
      description: "Facturación electrónica y Reportes UIAF (cripto).",
      icon: ShoppingBag,
      providersDescription: "Selecciona la fuente de ventas.",
      providers: [
        { id: "facturacion-electronica", name: "Facturación electrónica", description: "Excel de facturación electrónica (DIAN).", icon: Receipt, component: lazy(() => import("./sales/EInvoiceSalesPage")) },
        { id: "reporte-de-operaciones", name: "Reportes UIAF", description: "Reporte UIAF (TPSV) de compra y venta de cripto.", icon: Landmark, component: lazy(() => import("./sales/TpsvSalesPage")) },
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
      id: "notas-financieras",
      name: "Notas Financieras",
      // Junto al Generador: justo después de su tarjeta.
      priority: 0.5,
      description: "Notas a los estados financieros del mismo período: datos de Empresas, políticas fijas y notas específicas numeradas.",
      icon: NotebookText,
      component: lazy(() => import("./notes/NotesPage")),
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
