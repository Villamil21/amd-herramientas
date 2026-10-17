import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../../components/ui";
import { cryptoService } from "../../../services/cryptoService";
import { exogenaService } from "../../../services/exogenaService";
import { errorMessage } from "../../../services/tauri";
import type { ExoCatalogs } from "../../../types/exogena";
import { useFsData } from "../shared/useFsData";
import { buildModel, type CryptoModel } from "./domain/model";
import { makePucChecker } from "./domain/pucCheck";
import type { CryptoState, DecisionKind, Homologation } from "./domain/types";

/**
 * Datos de Transacciones Cripto para una empresa y un año: lo guardado (cargas, filas, decisiones, homologaciones), los datos
 * maestros de Estados Financieros y el modelo calculado. El modelo se recalcula siempre desde el origen.
 */
export function useCryptoData(companyId: number | null, year: number) {
  const toast = useToast();
  const fs = useFsData();
  const [state, setState] = useState<CryptoState | null>(null);
  const [homologations, setHomologations] = useState<Homologation[] | null>(null);
  const [catalogs, setCatalogs] = useState<ExoCatalogs | null>(null);

  const company = useMemo(() => fs.companies?.find((c) => c.id === companyId) ?? null, [fs.companies, companyId]);

  const reloadState = useCallback(async () => {
    if (companyId === null) return setState(null);
    try {
      setState(await cryptoService.state(companyId, year));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, year, toast]);
  const reloadHomologations = useCallback(() => cryptoService.homologations().then(setHomologations, (e) => toast(errorMessage(e), "error")), [toast]);

  useEffect(() => {
    setState(null);
    void reloadState();
  }, [reloadState]);
  useEffect(() => {
    void reloadHomologations();
    exogenaService.catalogs().then(setCatalogs, (e) => toast(errorMessage(e), "error"));
  }, [reloadHomologations, toast]);

  const model: CryptoModel | null = useMemo(() => {
    if (!state || !homologations || !catalogs || !company) return null;
    return buildModel({ year, state, homologations, catalogs, companyAddress: company.direccion ?? "", puc: makePucChecker(fs.settingsMap, fs.index, fs.catalog, fs.mappingMap) });
  }, [state, homologations, catalogs, company, year, fs.settingsMap, fs.index, fs.catalog, fs.mappingMap]);

  /** Guarda una decisión del usuario y recalcula. */
  const decide = useCallback(
    async (kind: DecisionKind, key: string, value: string) => {
      if (companyId === null) return;
      await cryptoService.decide(companyId, year, kind, key, value);
      await reloadState();
    },
    [companyId, year, reloadState],
  );
  /** Varias decisiones del mismo tipo (p. ej. excluir todas las filas fuera del año) con una sola recarga. */
  const decideMany = useCallback(
    async (kind: DecisionKind, entries: { key: string; value: string }[]) => {
      if (companyId === null) return;
      for (const e of entries) await cryptoService.decide(companyId, year, kind, e.key, e.value);
      await reloadState();
    },
    [companyId, year, reloadState],
  );
  const undecide = useCallback(
    async (kind: DecisionKind, key: string) => {
      if (companyId === null) return;
      await cryptoService.undecide(companyId, year, kind, key);
      await reloadState();
    },
    [companyId, year, reloadState],
  );
  const saveHomologation = useCallback(
    async (kind: Homologation["kind"], sourceKey: string, value: string) => {
      await cryptoService.saveHomologation(kind, sourceKey, value);
      await reloadHomologations();
    },
    [reloadHomologations],
  );

  return { fs, company, state, model, catalogs, homologations, reloadState, decide, decideMany, undecide, saveHomologation };
}

export type CryptoData = ReturnType<typeof useCryptoData>;
