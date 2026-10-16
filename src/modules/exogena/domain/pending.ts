import type { ExoRecord, SyncProposal } from "../../../types/exogena";

export interface PendingChange {
  sourceKey: string;
  kind: "new" | "changed" | "removed";
  fields: string[];
}

/**
 * Qué cambió en la fuente (Empresas o Estados Financieros) desde la última sincronización: sirve para ofrecer «Actualizar» y
 * para reabrir un formato «listo». Los campos corregidos a mano no cuentan como cambio pendiente: se avisan como conflicto al
 * sincronizar. Los registros manuales nunca se retiran.
 */
export function pendingChanges(stored: ExoRecord[], proposals: SyncProposal[]): PendingChange[] {
  const byKey = new Map(stored.map((r) => [r.sourceKey, r]));
  const out: PendingChange[] = [];
  for (const p of proposals) {
    const old = byKey.get(p.sourceKey);
    if (!old) {
      out.push({ sourceKey: p.sourceKey, kind: "new", fields: [] });
      continue;
    }
    const fields = Object.keys(p.data).filter((k) => !old.manualFields.includes(k) && JSON.stringify(old.data[k]) !== JSON.stringify(p.data[k]));
    if (fields.length) out.push({ sourceKey: p.sourceKey, kind: "changed", fields });
  }
  const proposed = new Set(proposals.map((p) => p.sourceKey));
  for (const r of stored) if (r.origin !== "manual" && !proposed.has(r.sourceKey)) out.push({ sourceKey: r.sourceKey, kind: "removed", fields: [] });
  return out;
}
