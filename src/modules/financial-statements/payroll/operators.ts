import type { PdfDocumentText } from "../../bank-analysis/shared/pdf/pdfTypes";
import type { PlanillaEntity } from "../../exogena/domain/planillaEntities";
import type { PlanillaEmployee } from "./calc";
import type { NormalizedPlanilla } from "./social/types";

/** Lo que el flujo de Nómina necesita de una planilla, venga del operador que venga. Importes en pesos enteros. */
export interface PlanillaView {
  /** Operador detectado en el PDF («Aportes en Línea», «MiPlanilla»…): se guarda en el lote. */
  provider: string;
  /** Planilla normalizada completa (se guarda en los metadatos del lote v2 para los formatos de Exógena). */
  planilla?: NormalizedPlanilla;
  /** Período de PENSIÓN (AAAA-MM): el único período de nómina. */
  period: string;
  /** Fecha de pago en ISO; `null` si no se identificó. */
  paymentDate: string | null;
  employees: PlanillaEmployee[];
  /** Intereses de mora de la planilla (global; no se reparten entre empleados). */
  lateInterest: number;
  /** Filas sin interpretar o controles que no cuadran: bloquean el envío. */
  issues: { page: number; text: string; reason: string }[];
  /** Lo que no se pudo verificar: se muestra pero no bloquea. */
  warnings: string[];
  employerNit?: string;
  /** Identificador de la planilla en el operador (para distinguir planillas del mismo período). */
  planillaId?: string;
  /**
   * Resumen de pago por entidad (AFP, EPS, ARL, CCF): a quién se le debe cada aporte, con su valor liquidado. Se guarda con
   * el lote para Información Exógena; vacío si la planilla no lo trae o no cuadra con sus totales.
   */
  entities: PlanillaEntity[];
}

/**
 * Un operador de planillas de seguridad social (Aportes en Línea, MiPlanilla…). El flujo de Nómina de Estados
 * Financieros es el mismo para todos: cada operador solo aporta su lector del PDF y sus textos.
 */
export interface PayrollOperator<A> {
  id: string;
  title: string;
  description: string;
  labels: { pick: string; pickAnother: string; analyzing: string };
  pickTitle: string;
  logTag: string;
  fallbackError: string;
  /** El PDF trae encabezados de columna girados 90°. */
  keepRotatedText?: boolean;
  analyze: (text: PdfDocumentText) => A;
  view: (analysis: A) => PlanillaView;
  /** Cómo se llama el total de pensión + salud + riesgos + CCF de un empleado en esta vista. */
  socialLabel: string;
  /** Prefijo del nombre del Excel exportado. */
  exportPrefix: string;
  /** Agrega la columna «Cotización» al Excel exportado. */
  cotizacionColumn?: boolean;
  /** Llave de deduplicación del envío: el mismo envío reemplaza al anterior, otra planilla convive. */
  dedupeKey: (view: PlanillaView) => string;
  /** Documento del movimiento de mora: distinto por operador/planilla para que dos lotes del mismo periodo no choquen. */
  moraDocumentId: (view: PlanillaView) => string;
  /** Texto del bloqueo cuando hay filas sin interpretar o totales que no cuadran. */
  issuesBlocking: string;
  /** Pista debajo de la alerta de filas sin interpretar. */
  issuesHint?: string;
}
