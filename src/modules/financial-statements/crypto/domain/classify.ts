import { findDuplicateGroups, type DuplicateGroup } from "./duplicates";
import { decisionMap, type Operation } from "./operations";
import type { CryptoDecision } from "./types";

/**
 * Estado de cada operación: excluida (decisión del usuario), pendiente (fecha o valor ilegibles, fuera del año o posible
 * duplicado sin decidir) o aceptada. Solo las aceptadas alimentan Estados Financieros y Exógena.
 */
export interface Classified {
  operations: Operation[];
  groups: DuplicateGroup[];
}

export function classifyOperations(operations: readonly Operation[], decisions: readonly CryptoDecision[]): Classified {
  const rowExcludes = decisionMap(decisions, "row_exclude");
  const dupDecisions = decisionMap(decisions, "duplicate");
  const state = new Map<string, Operation>();
  for (const op of operations) {
    if (rowExcludes.get(op.identity)?.value === "exclude") state.set(op.id, { ...op, status: "excluded", excludedBy: "user" });
    else if (op.issues.length) state.set(op.id, { ...op, status: "pending" });
    else state.set(op.id, { ...op, status: "accepted" });
  }
  const candidates = [...state.values()].filter((o) => o.status === "accepted");
  const groups = findDuplicateGroups(candidates, decisions);
  for (const group of groups) {
    for (const member of group.members) {
      if (dupDecisions.get(member.identity)?.value === "exclude") {
        state.set(member.id, { ...member, status: "excluded", excludedBy: "duplicate" });
      } else if (!group.resolved) {
        state.set(member.id, {
          ...member,
          status: "pending",
          issues: [...member.issues, { code: "duplicate", message: group.level === "exact" ? "Posible duplicado exacto sin revisar." : "Posible duplicado (coincide casi todo) sin revisar." }],
        });
      }
    }
  }
  return { operations: operations.map((o) => state.get(o.id)!), groups };
}
