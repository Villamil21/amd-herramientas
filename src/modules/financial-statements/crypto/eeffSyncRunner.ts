import type { BatchInput, BatchSummary, SendOutcome } from "../../../types/fs";
import type { EeffSyncState } from "./eeffBatch";

/** Lo que el sincronizador necesita del servicio (inyectable para probar el comportamiento sin la app). */
export interface EeffSyncApi {
  send: (input: BatchInput & { replace: true }) => Promise<SendOutcome>;
  void: (batchId: number, reason: string) => Promise<unknown>;
  markOutdated: (batchId: number, reason: string) => Promise<unknown>;
}

export type EeffSyncResult = { kind: "updated" } | { kind: "retired" } | { kind: "outdated"; reason: string } | { kind: "nothing" };

const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : (e as { message?: string } | null)?.message ?? String(e));

/**
 * Aplica el efecto de Transacciones Cripto en Estados Financieros según su estado.
 *  - `update`: reemplaza el lote con el cálculo vigente. Si falla (p. ej. periodo cerrado) el lote previo NO se deja como si
 *    siguiera vigente: se marca desactualizado (solo auditoría), sale del cálculo y se bloquea generar, marcar listo, cerrar y exportar.
 *  - `retire`: no se puede calcular con las fuentes actuales; se anula el lote y, si no se puede anular (periodo cerrado),
 *    se marca desactualizado igual.
 */
export async function runEeffSync(state: EeffSyncState, built: BatchInput | null, latest: Pick<BatchSummary, "id"> | undefined, blockers: string[], api: EeffSyncApi): Promise<EeffSyncResult> {
  if (state === "update" && built) {
    try {
      const outcome = await api.send({ ...built, replace: true });
      return outcome.kind === "sent" ? { kind: "updated" } : { kind: "nothing" };
    } catch (e) {
      if (!latest) throw e;
      const reason = `No se pudo actualizar con el cálculo vigente: ${message(e)}`;
      await api.markOutdated(latest.id, reason);
      return { kind: "outdated", reason };
    }
  }
  if (state === "retire" && latest) {
    const reason = blockers.join(" · ");
    try {
      await api.void(latest.id, reason);
      return { kind: "retired" };
    } catch (e) {
      const why = `${reason ? `${reason} · ` : ""}No se pudo retirar: ${message(e)}`;
      await api.markOutdated(latest.id, why);
      return { kind: "outdated", reason: why };
    }
  }
  return { kind: "nothing" };
}
