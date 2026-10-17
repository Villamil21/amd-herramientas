import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../../../components/ui";
import { fsService } from "../../../services/fsService";
import { errorMessage } from "../../../services/tauri";
import type { BatchSummary } from "../../../types/fs";
import type { CryptoModel } from "./domain/model";
import { blocking } from "./domain/problems";
import { buildEeffBatch, eeffSyncState, latestEeffBatch, type EeffSyncState } from "./eeffBatch";

/**
 * Mantiene al día el efecto de Transacciones Cripto en Estados Financieros. Tras el primer envío manual, cualquier cambio de
 * origen (cargas, decisiones, corte, presentación, cuentas PUC) reemplaza el lote anual sin pedir otro envío.
 */
export function useEeffAutoSync(companyId: number | null, model: CryptoModel | null) {
  const toast = useToast();
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);
  const [updating, setUpdating] = useState(false);
  const attempted = useRef<string>("");

  const reload = useCallback(async () => {
    if (companyId === null) return setBatches(null);
    try {
      setBatches(await fsService.batches(companyId));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);
  useEffect(() => {
    setBatches(null);
    void reload();
  }, [reload]);

  const built = useMemo(() => (companyId !== null && model ? buildEeffBatch(companyId, model) : null), [companyId, model]);
  const latest = useMemo(() => (batches && model ? latestEeffBatch(batches, model.year) : undefined), [batches, model]);
  const state: EeffSyncState = batches && model ? eeffSyncState(latest, built) : "none";

  useEffect(() => {
    if ((state !== "update" && state !== "retire") || updating || !model) return;
    // Un mismo contenido no se reintenta en bucle si el envío falla (p. ej. periodo cerrado).
    const key = state + JSON.stringify(built?.metadata ?? blocking(model.problems.eeff).map((p) => p.message));
    if (attempted.current === key) return;
    attempted.current = key;
    setUpdating(true);
    const run =
      state === "update" && built
        ? fsService.send({ ...built, replace: true }).then((outcome) => {
            if (outcome.kind === "sent") toast("Estados Financieros se actualizó con el nuevo cálculo de Transacciones Cripto.");
          })
        : fsService.voidCryptoBatch(latest!.id, blocking(model.problems.eeff).map((p) => p.message).join(" · ")).then(() => toast("El efecto en Estados Financieros se retiró del cálculo: hay pendientes que impiden recalcularlo.", "error"));
    run
      .then(() => reload())
      .catch((e) => toast(errorMessage(e), "error"))
      .finally(() => setUpdating(false));
  }, [state, built, updating, latest, model, reload, toast]);

  return { state, updating, batch: latest, reload };
}
