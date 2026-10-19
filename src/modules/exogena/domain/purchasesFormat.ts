import type { ExoRecord, FormatStatus, SyncProposal } from "../../../types/exogena";
import type { PurchasesModel } from "../../financial-statements/purchases/domain/model";
import type { Alert } from "../../financial-statements/purchases/domain/status";
import { mergePayroll1001 } from "../../financial-statements/payroll/social/exo1001";
import { pendingChanges, type PendingChange } from "./pending";
import { blocking, type Problem } from "./problems";

export type PurchasesExoFormat = "1001" | "1005" | "1006";

export const PURCHASES_FORMATS: PurchasesExoFormat[] = ["1001", "1005", "1006"];

export const PURCHASES_PATH = "/herramientas/estados-financieros/codigos-puc-por-factura";

export const PURCHASES_EXO_SOURCE = "Estados Financieros";

/** Hasta esta cantidad las alertas repetidas se listan una a una; desde ahí se agrupan en un solo pendiente con su cantidad. */
const LIST_LIMIT = 3;

const levelOf = (a: Alert): Problem["level"] => (a.severity === "review" ? "warning" : "blocking");

/**
 * Un pendiente de Exógena por cada alerta de Compras que afecta al formato. «Bloquea» y «Pendiente de confirmar» impiden dejar
 * el formato listo (hay datos sin definir); «Requiere revisión» solo advierte. Las alertas repetidas (p. ej. 400 líneas por
 * confirmar) se agrupan para que el panel siga siendo legible.
 */
export function problemsFromAlerts(alerts: readonly Alert[], format: PurchasesExoFormat): Problem[] {
  const own = alerts.filter((a) => a.severity !== "info" && a.dests.includes(format));
  const groups = new Map<string, Alert[]>();
  for (const a of own) groups.set(`${a.severity}|${a.code}`, [...(groups.get(`${a.severity}|${a.code}`) ?? []), a]);
  const out: Problem[] = [];
  const action = { label: "Resolver en Compras", path: PURCHASES_PATH };
  for (const items of groups.values()) {
    if (items.length <= LIST_LIMIT) {
      for (const a of items) out.push({ level: levelOf(a), message: `${a.title}: ${a.why} ${a.how}`, action });
    } else {
      const first = items[0];
      out.push({ level: levelOf(first), message: `${items.length} pendientes del mismo tipo (${first.title}…): ${first.why} ${first.how}`, action });
    }
  }
  return out;
}

/** Lo que Nómina y seguridad social aporta al 1001: filas por entidad + concepto y sus pendientes (solo bloquean el 1001). */
export interface PayrollContribution {
  proposals: SyncProposal[];
  problems: Problem[];
}

export interface PurchasesFormatState {
  proposals: SyncProposal[];
  changes: PendingChange[];
  problems: Problem[];
  /** Justificación cuando el formato «No aplica» (1005 y 1006 con empresa no responsable de IVA). */
  notApplicableReason: string | null;
}

/**
 * Pendientes de 1001 / 1005 / 1006 frente a lo guardado en Exógena: los de Compras que afectan a ese destino más
 * «desactualizado» cuando lo que Compras propone hoy difiere de lo sincronizado. Un bloqueo de otro destino (p. ej. EEFF) no
 * detiene este formato. Si el formato no aplica, no se exige nada más que la justificación.
 */
export function purchasesFormatState(model: PurchasesModel, format: PurchasesExoFormat, stored: ExoRecord[], payroll?: PayrollContribution): PurchasesFormatState {
  const notApplicableReason = model.notApplicable[format] ?? null;
  const proposals = notApplicableReason ? [] : payroll ? mergePayroll1001(model.proposals[format], payroll.proposals) : model.proposals[format];
  const changes = notApplicableReason ? [] : pendingChanges(stored, proposals);
  if (notApplicableReason) return { proposals, changes, problems: [], notApplicableReason };
  const problems = [...problemsFromAlerts(model.alerts, format), ...(payroll?.problems ?? [])];
  if (changes.length) problems.push({ level: "blocking", message: `${changes.length} ${changes.length === 1 ? "registro está desactualizado" : "registros están desactualizados"} frente a ${payroll ? "Compras o Nómina" : "Compras"}: actualiza el formato.` });
  return { proposals, changes, problems, notApplicableReason };
}

/** Un formato «listo» se reabre (nunca se reescribe en silencio) en cuanto aparece cualquier pendiente bloqueante. */
export const shouldReopenPurchases = (status: FormatStatus, problems: Problem[]): boolean => status === "listo" && blocking(problems).length > 0;
