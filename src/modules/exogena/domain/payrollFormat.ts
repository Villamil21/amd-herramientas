import type { ExoRecord, SyncProposal } from "../../../types/exogena";
import type { PayrollAlert, PayrollDest } from "../../financial-statements/payroll/social/alerts";
import { pendingChanges, type PendingChange } from "./pending";
import type { Problem } from "./problems";

export type PayrollExoFormat = "1011" | "2276";
export const PAYROLL_EXO_FORMATS: PayrollExoFormat[] = ["1011", "2276"];
export const PAYROLL_EXO_SOURCE = "Estados Financieros";

/**
 * Un pendiente de Exógena por cada alerta de Nómina que afecta al formato. «Bloquea» y «Pendiente de confirmar» impiden dejar
 * el formato listo (hay datos sin definir o sin confirmar); «Requiere revisión» solo advierte.
 */
export function problemsFromPayrollAlerts(alerts: readonly PayrollAlert[], dest: PayrollDest): Problem[] {
  return alerts
    .filter((a) => a.severity !== "info" && a.dests.includes(dest))
    .map((a) => ({ level: a.severity === "review" ? ("warning" as const) : ("blocking" as const), message: `${a.title}: ${a.why} ${a.how}`, ...(a.action ? { action: a.action } : {}) }));
}

export interface PayrollFormatState {
  proposals: SyncProposal[];
  changes: PendingChange[];
  problems: Problem[];
}

/** Pendientes del formato frente a lo guardado: los de Nómina que lo afectan más «desactualizado» si lo calculado hoy difiere. */
export function payrollFormatState(dest: PayrollExoFormat, proposals: SyncProposal[], alerts: readonly PayrollAlert[], stored: ExoRecord[]): PayrollFormatState {
  const changes = pendingChanges(stored, proposals);
  const problems = problemsFromPayrollAlerts(alerts, dest);
  if (changes.length) problems.push({ level: "blocking", message: `${changes.length} ${changes.length === 1 ? "registro está desactualizado" : "registros están desactualizados"} frente a Nómina: actualiza el formato.` });
  return { proposals, changes, problems };
}
