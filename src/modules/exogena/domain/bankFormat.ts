import type { BankExoContribution, BankExoFormat } from "../../financial-statements/bank/exogena/model";
import type { ExoRecord, SyncProposal } from "../../../types/exogena";
import { pendingChanges, type PendingChange } from "./pending";
import type { Problem } from "./problems";

export const BANK_EXO_SYNC_SOURCE = "Estados Financieros";

export interface BankFormatState {
  proposals: SyncProposal[];
  changes: PendingChange[];
  problems: Problem[];
}

/**
 * Pendientes de un formato que se arma solo desde Extractos bancarios (1012) frente a lo guardado: los de los extractos que lo
 * afectan más «desactualizado» si lo calculado hoy difiere. Cualquier cambio de origen —un extracto, una ficha, una decisión— se
 * refleja en alguno de los dos.
 */
export function bankFormatState(code: BankExoFormat, bank: BankExoContribution, stored: ExoRecord[]): BankFormatState {
  const proposals = bank.proposals[code];
  const changes = pendingChanges(stored, proposals);
  const problems = [...bank.problems[code]];
  if (changes.length) problems.push({ level: "blocking", message: `${changes.length} ${changes.length === 1 ? "registro está desactualizado" : "registros están desactualizados"} frente a Extractos bancarios: actualiza el formato.` });
  return { proposals, changes, problems };
}
