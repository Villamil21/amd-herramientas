import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../../../components/ui";
import { exogenaService } from "../../../services/exogenaService";
import { fsService } from "../../../services/fsService";
import { catalogExtrasService, purchasesService } from "../../../services/purchasesService";
import { supplierService } from "../../../services/supplierService";
import { withholdingService } from "../../../services/withholdingService";
import { errorMessage } from "../../../services/tauri";
import type { ExoCatalogs } from "../../../types/exogena";
import type { BatchSummary } from "../../../types/fs";
import type { Supplier, UvtValue, WithholdingRate } from "../../../types/models";
import type { CompanyVatEntry, ExoAlias, PucConcept1001, RateVersion, PurchaseRule, PurchaseScope, PurchasesState, SupplierFiscalEntry, TitleType, YearConcept } from "../../../types/purchases";
import { useFsData } from "../shared/useFsData";
import { findCompanyByNit } from "../shared/companyMatch";
import { buildPurchasesModel, type PurchasesModel } from "./domain/model";
import { buildEeffBatch, eeffSyncState, latestEeffBatch, type EeffSyncState } from "./eeff";
import { usePurchasesSelection } from "./selection";

/**
 * Datos de Compras, costos y exógena para una empresa (NIT comprador) y un año: lo guardado, los datos maestros y el modelo
 * calculado. El modelo se recalcula siempre desde el origen; nada calculado se guarda.
 */
export function usePurchasesData(scope?: { buyerNit: string | null; year: number | null }) {
  const toast = useToast();
  const fs = useFsData();
  const [globalSelection, select] = usePurchasesSelection();
  // Exógena trabaja con su propia empresa y año: ahí el alcance se pasa explícito y no depende de la selección de Compras.
  const selection = scope ?? globalSelection;
  const { buyerNit, year } = selection;

  const [scopes, setScopes] = useState<PurchaseScope[] | null>(null);
  const [state, setState] = useState<PurchasesState | null>(null);
  const [titleTypes, setTitleTypes] = useState<TitleType[]>([]);
  const [rules, setRules] = useState<PurchaseRule[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierFiscal, setSupplierFiscal] = useState<SupplierFiscalEntry[]>([]);
  const [companyVat, setCompanyVat] = useState<CompanyVatEntry[]>([]);
  const [pucConceptRows, setPucConceptRows] = useState<PucConcept1001[]>([]);
  const [concepts1001, setConcepts1001] = useState<YearConcept[]>([]);
  const [rates, setRates] = useState<WithholdingRate[]>([]);
  const [uvts, setUvts] = useState<UvtValue[]>([]);
  const [rateVersions, setRateVersions] = useState<RateVersion[]>([]);
  const [aliases, setAliases] = useState<ExoAlias[]>([]);
  const [catalogs, setCatalogs] = useState<ExoCatalogs | null>(null);
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);

  const fail = useCallback((e: unknown) => toast(errorMessage(e), "error"), [toast]);

  const company = useMemo(() => (buyerNit && fs.companies ? findCompanyByNit(fs.companies, buyerNit) ?? undefined : undefined), [fs.companies, buyerNit]);

  const reloadScopes = useCallback(() => purchasesService.scopes().then(setScopes, fail), [fail]);
  const reloadState = useCallback(async () => {
    if (!buyerNit) return setState(null);
    try {
      setState(await purchasesService.state(buyerNit, year));
    } catch (e) {
      fail(e);
    }
  }, [buyerNit, year, fail]);
  const reloadTitleTypes = useCallback(() => purchasesService.titleTypes().then(setTitleTypes, fail), [fail]);
  const reloadRules = useCallback(() => purchasesService.rules().then(setRules, fail), [fail]);
  const reloadSuppliers = useCallback(
    () => Promise.all([supplierService.list(), purchasesService.supplierFiscalHistory()]).then(([s, h]) => { setSuppliers(s); setSupplierFiscal(h); }, fail),
    [fail],
  );
  const reloadCompanyVat = useCallback(() => (company ? purchasesService.companyVatHistory(company.id).then(setCompanyVat, fail) : Promise.resolve(setCompanyVat([]))), [company, fail]);
  const reloadConcepts = useCallback(() => (year === null ? Promise.resolve(setConcepts1001([])) : purchasesService.yearConcepts("1001", year).then(setConcepts1001, fail)), [year, fail]);
  const reloadBatches = useCallback(async () => {
    if (!company) return setBatches(null);
    try {
      setBatches(await fsService.batches(company.id));
    } catch (e) {
      fail(e);
    }
  }, [company, fail]);

  useEffect(() => void reloadScopes(), [reloadScopes]);
  useEffect(() => {
    setState(null);
    void reloadState();
  }, [reloadState]);
  useEffect(() => {
    void reloadTitleTypes();
    void reloadRules();
    void reloadSuppliers();
    purchasesService.pucConcepts1001().then(setPucConceptRows, fail);
    withholdingService.listRates().then(setRates, fail);
    withholdingService.listUvt().then(setUvts, fail);
    catalogExtrasService.rateVersions().then(setRateVersions, fail);
    catalogExtrasService.aliases().then(setAliases, fail);
    exogenaService.catalogs().then(setCatalogs, fail);
  }, [reloadTitleTypes, reloadRules, reloadSuppliers, fail]);
  useEffect(() => void reloadCompanyVat(), [reloadCompanyVat]);
  useEffect(() => void reloadConcepts(), [reloadConcepts]);
  useEffect(() => {
    setBatches(null);
    void reloadBatches();
  }, [reloadBatches]);

  const pucConcepts = useMemo(() => new Map(pucConceptRows.map((r) => [r.pucCode, r.conceptCode])), [pucConceptRows]);

  const model: PurchasesModel | null = useMemo(() => {
    if (!buyerNit || !state || !catalogs) return null;
    return buildPurchasesModel({ buyerNit, year, state, company, companyVat, titleTypes, rules, suppliers, supplierFiscal, pucIndex: fs.index, pucConcepts, concepts1001, rates, rateVersions, aliases, uvts, catalogs });
  }, [buyerNit, year, state, company, companyVat, titleTypes, rules, suppliers, supplierFiscal, fs.index, pucConcepts, concepts1001, rates, rateVersions, aliases, uvts, catalogs]);

  const reloadAll = useCallback(async () => {
    await Promise.all([reloadScopes(), reloadState(), reloadRules(), reloadTitleTypes(), reloadSuppliers(), reloadCompanyVat(), reloadConcepts()]);
  }, [reloadScopes, reloadState, reloadRules, reloadTitleTypes, reloadSuppliers, reloadCompanyVat, reloadConcepts]);

  // --- Estados Financieros: el lote anual se mantiene al día solo ---
  const sync = useEeffAutoSync(company?.id ?? null, model, batches, reloadBatches);

  return { fs, selection, select, scopes, state, model, company, pucConceptMap: pucConcepts, batches, rateVersions, titleTypes, rules, suppliers, supplierFiscal, companyVat, concepts1001, rates, uvts, catalogs, sync, reloadAll, reloadScopes, reloadState, reloadRules, reloadTitleTypes, reloadSuppliers, reloadCompanyVat, reloadConcepts };
}

export type PurchasesData = ReturnType<typeof usePurchasesData>;

/**
 * Mantiene al día el efecto de las compras en Estados Financieros. Cada cambio de origen (importación, clasificación, regla,
 * PUC, perfil de IVA) reemplaza el lote anual sin pedir otro envío. Si no se puede (p. ej. periodo cerrado) se informa y el
 * destino queda con alerta: el lote previo no se presenta como vigente sin decirlo.
 */
function useEeffAutoSync(companyId: number | null, model: PurchasesModel | null, batches: BatchSummary[] | null, reload: () => Promise<void>) {
  const toast = useToast();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cuántas veces se reemplazó el lote en Estados Financieros (para que otras pantallas recarguen su libro). */
  const [sent, setSent] = useState(0);
  const attempted = useRef("");

  const built = useMemo(() => (companyId !== null && model ? buildEeffBatch(companyId, model) : null), [companyId, model]);
  const latest = useMemo(() => (batches && model && model.year !== null ? latestEeffBatch(batches, model.year) : undefined), [batches, model]);
  const state: EeffSyncState = batches && model ? eeffSyncState(latest, built) : "none";

  useEffect(() => {
    if (state !== "update" || !built || updating) return;
    const key = JSON.stringify((built.metadata as { fingerprint?: string }).fingerprint);
    if (attempted.current === key) return;
    attempted.current = key;
    setUpdating(true);
    fsService
      .send({ ...built, replace: true })
      .then(() => {
        setError(null);
        setSent((n) => n + 1);
        return reload();
      })
      .catch((e) => {
        const message = errorMessage(e);
        setError(message);
        toast(`Estados Financieros no se actualizó: ${message}`, "error");
      })
      .finally(() => setUpdating(false));
  }, [state, built, updating, reload, toast]);

  const retry = useCallback(() => {
    attempted.current = "";
    setError(null);
    void reload();
  }, [reload]);

  return { state, updating, error, batch: latest, retry, sent };
}
