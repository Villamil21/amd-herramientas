import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../components/ui";
import { companyService } from "../../services/companyService";
import { exogenaService } from "../../services/exogenaService";
import { errorMessage } from "../../services/tauri";
import type { ExoCatalogs, ExoOverview, ExoRecord, FormatStatus, FormatStatusRow } from "../../types/exogena";
import type { Company } from "../../types/models";
import { buildCatalogIndex, type CatalogIndex } from "./domain/catalogIndex";

/** Catálogos Exógena (tipos de documento, países, departamentos, municipios) y su índice de búsqueda. */
export function useCatalogs() {
  const toast = useToast();
  const [catalogs, setCatalogs] = useState<ExoCatalogs | null>(null);
  const reload = useCallback(() => exogenaService.catalogs().then(setCatalogs, (e) => toast(errorMessage(e), "error")), [toast]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const index = useMemo<CatalogIndex | null>(() => (catalogs ? buildCatalogIndex(catalogs) : null), [catalogs]);
  return { catalogs, index, reload };
}

/** Empresas con sus socios (fuente de verdad del 1010). */
export function useCompanies() {
  const toast = useToast();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const reload = useCallback(() => companyService.list().then(setCompanies, (e) => toast(errorMessage(e), "error")), [toast]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { companies, reload };
}

const DEFAULT_STATUS = (formatCode: string): FormatStatusRow => ({ formatCode, status: "en_preparacion", notApplicableReason: "", lastSyncedAt: null, sourceFingerprint: "", updatedAt: "", recordCount: 0 });

/** Estado anual de todos los formatos de una empresa (tarjetas de la pantalla de inicio y Control). */
export function useOverview(companyId: number | null, year: number) {
  const toast = useToast();
  const [overview, setOverview] = useState<ExoOverview | null>(null);
  const reload = useCallback(async () => {
    if (companyId === null) return setOverview(null);
    try {
      setOverview(await exogenaService.overview(companyId, year));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, year, toast]);
  useEffect(() => {
    setOverview(null);
    void reload();
  }, [reload]);
  const statusOf = useCallback((formatCode: string): FormatStatusRow => {
    const row = overview?.statuses.find((s) => s.formatCode === formatCode);
    const count = overview?.recordCounts.find(([code]) => code === formatCode)?.[1] ?? 0;
    return { ...(row ?? DEFAULT_STATUS(formatCode)), recordCount: count };
  }, [overview]);
  return { overview, statusOf, reload };
}

/** Registros guardados de un formato para la empresa y el año seleccionados, junto con su estado. */
export function useFormatRecords(companyId: number | null, year: number, formatCode: string) {
  const toast = useToast();
  const [records, setRecords] = useState<ExoRecord[] | null>(null);
  const { overview, statusOf, reload: reloadOverview } = useOverview(companyId, year);
  const reloadRecords = useCallback(async () => {
    if (companyId === null) return setRecords(null);
    try {
      setRecords(await exogenaService.records(companyId, year, formatCode));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, year, formatCode, toast]);
  useEffect(() => {
    setRecords(null);
    void reloadRecords();
  }, [reloadRecords]);
  const reload = useCallback(async () => {
    await Promise.all([reloadRecords(), reloadOverview()]);
  }, [reloadRecords, reloadOverview]);
  const setStatus = useCallback(
    async (status: FormatStatus, reason?: string) => {
      if (companyId === null) return;
      try {
        await exogenaService.setStatus(companyId, year, formatCode, status, reason);
        await reloadOverview();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [companyId, year, formatCode, reloadOverview, toast],
  );
  return { records, overview, status: statusOf(formatCode), reload, setStatus };
}
