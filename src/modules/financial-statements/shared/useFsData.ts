import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../../components/ui";
import { companyService } from "../../../services/companyService";
import { fsService } from "../../../services/fsService";
import { pucService } from "../../../services/pucService";
import { errorMessage } from "../../../services/tauri";
import type { FsCatalog, FsPucMapping, PucSetting } from "../../../types/fs";
import type { Company, PucCode } from "../../../types/models";
import { buildPucIndex } from "../puc-codes/services/pucCatalog";

/**
 * Datos maestros que usan todos los submódulos de Estados Financieros:
 * empresas, Tabla de Códigos PUC (oficial + personalizados), catálogo de
 * cuentas, mapeos PUC → línea y cuentas PUC globales.
 */
export function useFsData() {
  const toast = useToast();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [codes, setCodes] = useState<PucCode[]>([]);
  const [catalog, setCatalog] = useState<FsCatalog | null>(null);
  const [mappings, setMappings] = useState<FsPucMapping[]>([]);
  const [settings, setSettings] = useState<PucSetting[]>([]);

  const fail = useCallback((e: unknown) => toast(errorMessage(e), "error"), [toast]);
  const reloadCompanies = useCallback(() => companyService.list().then(setCompanies, fail), [fail]);
  const reloadCodes = useCallback(() => pucService.listCodes().then(setCodes, fail), [fail]);
  const reloadCatalog = useCallback(() => fsService.catalog().then(setCatalog, fail), [fail]);
  const reloadMappings = useCallback(() => fsService.mappings().then(setMappings, fail), [fail]);
  const reloadSettings = useCallback(() => fsService.pucSettings().then(setSettings, fail), [fail]);

  useEffect(() => {
    void reloadCompanies();
    void reloadCodes();
    void reloadCatalog();
    void reloadMappings();
    void reloadSettings();
  }, [reloadCompanies, reloadCodes, reloadCatalog, reloadMappings, reloadSettings]);

  const index = useMemo(() => buildPucIndex(codes), [codes]);
  const settingsMap = useMemo(() => new Map(settings.map((s) => [s.key, s.pucCode])), [settings]);
  const mappingMap = useMemo(() => new Map(mappings.map((m) => [m.pucCode, m])), [mappings]);

  return { companies, index, codes, catalog, mappings, mappingMap, settings, settingsMap, reloadCompanies, reloadCodes, reloadCatalog, reloadMappings, reloadSettings };
}

export type FsData = ReturnType<typeof useFsData>;
