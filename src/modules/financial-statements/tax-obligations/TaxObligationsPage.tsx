import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarX2, FileUp, Settings2 } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Button, Card, ConfirmDialog, DateInput, EmptyState, Field, MetricBar, Modal, PageHeader, Select, Tabs, useToast } from "../../../components/ui";
import { SearchBox, SegmentedFilter } from "../../bank-analysis/shared/components/tableControls";
import { normalizeKey } from "../../../utils/text";
import { formatDateForDisplay } from "../../../utils/dates";
import { extractPdfText } from "../../bank-analysis/shared/pdf/pdfExtractor";
import { statementService } from "../../bank-analysis/shared/statementService";
import { errorMessage } from "../../../services/tauri";
import { formatInteger } from "../../../utils/format";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucSettingsModal } from "../shared/components/PucSettingsModal";
import { formatExactCents, isIsoDate } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { ImportModal, ReturnDetailModal } from "./components";
import { CoverageGrid, EmptyReturns, ReconciliationTab, ReturnsTable } from "./sections";
import { coverageYears, periodicityOf, taxPeriodCoverage, type TaxPeriodCell } from "./services/coverage";
import { parseTaxReturn, TAX_FORM_LABEL, TaxReturnError } from "./parser/taxReturnParser";
import { fiscalResult, periodName, taxEffects, type TaxStatus } from "./services/effects";
import { buildDraft, type ImportDraft } from "./services/importDraft";
import { taxService } from "./services/taxService";
import { periodsAffectedByPuc, returnView, versionsOf } from "./services/view";
import { PERIODICITY_LABEL, PUC_KEYS_BY_TAX, TAX_LABEL, TAX_PUC_ITEMS, type TaxEmptyPeriod, type TaxReturn, type TaxType, type VatPeriodicity } from "./types";

const DESCRIPTION: Record<TaxType, string> = {
  withholding: "Formulario 350: el total declarado (retenciones más sanciones) es cuenta por pagar hasta su fecha de pago.",
  vat: "Formulario 300: IVA por pagar hasta su fecha de pago y saldo a favor del último periodo terminado y declarado.",
  income: "Formulario 110: renta por pagar, saldo a favor, anticipo del año siguiente y resultado fiscal.",
};

type ReturnFilter = "all" | "pending" | "partial" | "paid" | "favor" | "superseded";
type PageTab = "returns" | "reconciliation";

/** Estados de cada filtro (Pendientes incluye «Requiere revisión»). */
const FILTER_STATUS: Record<Exclude<ReturnFilter, "all">, TaxStatus[]> = {
  pending: ["pending", "review"],
  partial: ["partial"],
  paid: ["paid"],
  favor: ["favor"],
  superseded: ["superseded"],
};

const NO_OBLIGATION: Record<TaxType, string> = {
  withholding: "Confirmo que la empresa no tuvo retenciones por declarar en este periodo.",
  vat: "Confirmo que la empresa no tuvo obligación de declarar IVA en este periodo.",
  income: "Confirmo que la empresa no tuvo obligación de declarar renta en este año gravable.",
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Estados Financieros → Obligaciones tributarias → un impuesto. Las
 * declaraciones se guardan una vez por empresa; el Generador calcula su efecto
 * a cada fecha de corte sin volver a importarlas.
 */
export function TaxObligationsPage({ taxType }: { taxType: TaxType }) {
  const toast = useToast();
  const data = useFsData();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [returns, setReturns] = useState<TaxReturn[]>([]);
  const [vatPeriodicity, setVatPeriodicity] = useState<VatPeriodicity | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detail, setDetail] = useState<TaxReturn | null>(null);
  const [cut, setCut] = useState(todayIso);
  const [empties, setEmpties] = useState<TaxEmptyPeriod[]>([]);
  const [filter, setFilter] = useState<ReturnFilter>("all");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PageTab>("returns");
  const currentYear = new Date().getFullYear();
  const [coverageYear, setCoverageYear] = useState(currentYear);
  const [emptyCell, setEmptyCell] = useState<TaxPeriodCell | null>(null);
  const [emptyConfirmed, setEmptyConfirmed] = useState(false);
  const [voiding, setVoiding] = useState<TaxEmptyPeriod | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (id: number | null) => {
      if (id === null) {
        setReturns([]);
        setVatPeriodicity(null);
        setEmpties([]);
        return;
      }
      try {
        const [list, settings, empty] = await Promise.all([taxService.list(id), taxService.settings(id), taxService.emptyPeriods(id)]);
        setReturns(list);
        setVatPeriodicity(settings.vatPeriodicity);
        setEmpties(empty);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(companyId);
  }, [companyId, load]);

  const company = data.companies?.find((c) => c.id === companyId);
  const constitution = company?.constitutionDate || null;
  const years = useMemo(() => coverageYears(constitution, currentYear), [constitution, currentYear]);
  const own = useMemo(() => returns.filter((r) => r.taxType === taxType).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.id - a.id), [returns, taxType]);
  const pucKeys = PUC_KEYS_BY_TAX[taxType];
  const missingPuc = pucKeys.filter((k) => !data.settingsMap.get(k));
  const effects = useMemo(() => (isIsoDate(cut) ? taxEffects({ returns, puc: data.settingsMap, vatPeriodicity }, cut) : null), [returns, data.settingsMap, vatPeriodicity, cut]);
  const ownEffects = useMemo(() => effects?.effects.filter((e) => (taxType === "withholding" ? e.kind === "withholding_payable" : taxType === "vat" ? e.kind.startsWith("vat") : e.kind.startsWith("income"))) ?? [], [effects, taxType]);
  const ownIssues = effects?.issues.filter((i) => i.taxType === taxType) ?? [];
  const fresh = (id: number) => returns.find((r) => r.id === id) ?? null;
  const allEffects = effects?.effects ?? [];
  const views = useMemo(() => own.map((r) => returnView(r, cut, vatPeriodicity, allEffects)), [own, cut, vatPeriodicity, allEffects]);
  const live = views.filter((v) => v.r.supersededBy === null);
  const sum = (kind: string) => ownEffects.filter((e) => e.kind === kind).reduce((n, e) => n + e.cents, 0);
  const latestIncome = taxType === "income" ? live.map((v) => v.r).sort((a, b) => b.year - a.year)[0] : undefined;
  const counts = {
    pending: live.filter((v) => v.status === "pending" || v.status === "review").length,
    partial: live.filter((v) => v.status === "partial").length,
    favor: live.filter((v) => v.status === "favor").length,
    superseded: views.length - live.length,
  };
  const paidTotal = live.reduce((n, v) => n + v.paidCents, 0);
  const metrics =
    taxType === "withholding"
      ? [
          { key: "returns", label: live.length === 1 ? "declaración vigente" : "declaraciones vigentes", value: formatInteger(live.length), onClick: () => setFilter("all"), active: filter === "all" },
          { key: "pending", label: "saldo pendiente", value: formatExactCents(sum("withholding_payable")), tone: sum("withholding_payable") ? ("negative" as const) : undefined, onClick: () => setFilter("pending"), active: filter === "pending" },
          { key: "paid", label: "pagado", value: formatExactCents(paidTotal), tone: "positive" as const, onClick: () => setFilter("paid"), active: filter === "paid" },
          { key: "partial", label: "con pago parcial", value: formatInteger(counts.partial), onClick: () => setFilter("partial"), active: filter === "partial" },
        ]
      : taxType === "vat"
        ? [
            { key: "returns", label: live.length === 1 ? "declaración vigente" : "declaraciones vigentes", value: formatInteger(live.length), onClick: () => setFilter("all"), active: filter === "all" },
            { key: "pending", label: "IVA por pagar pendiente", value: formatExactCents(sum("vat_payable")), tone: sum("vat_payable") ? ("negative" as const) : undefined, onClick: () => setFilter("pending"), active: filter === "pending" },
            { key: "favor", label: "saldo a favor vigente", value: formatExactCents(sum("vat_favor")), onClick: () => setFilter("favor"), active: filter === "favor" },
            { key: "paid", label: "pagado", value: formatExactCents(paidTotal), tone: "positive" as const, onClick: () => setFilter("paid"), active: filter === "paid" },
          ]
        : [
            { key: "pending", label: "renta por pagar pendiente", value: formatExactCents(sum("income_payable")), tone: sum("income_payable") ? ("negative" as const) : undefined, onClick: () => setFilter("pending"), active: filter === "pending" },
            { key: "favor", label: "saldo a favor de renta", value: formatExactCents(sum("income_favor")), onClick: () => setFilter("favor"), active: filter === "favor" },
            { key: "advance", label: latestIncome?.advanceTargetYear ? `anticipo para ${latestIncome.advanceTargetYear}` : "anticipo año siguiente", value: formatExactCents(latestIncome?.advanceNextCents ?? 0), title: "El anticipo es un activo temporal del año siguiente; se consume el 31/12 de ese año." },
            { key: "result", label: "resultado fiscal acumulado", value: formatExactCents(live.reduce((n, v) => n + fiscalResult(v.r), 0)), title: "Renta líquida menos pérdida líquida de las declaraciones vigentes." },
          ];
  const FILTERS: { id: ReturnFilter; label: string }[] = [
    { id: "all", label: "Todas" },
    { id: "pending", label: `Pendientes (${counts.pending})` },
    { id: "partial", label: "Pago parcial" },
    { id: "paid", label: "Pagadas" },
    ...(taxType === "withholding" ? [] : [{ id: "favor" as const, label: "Saldo a favor" }]),
    ...(counts.superseded ? [{ id: "superseded" as const, label: `Reemplazadas (${counts.superseded})` }] : []),
  ];
  const q = normalizeKey(query);
  const visible = views
    .filter((v) => (filter === "superseded" ? v.status === "superseded" : v.r.supersededBy === null && (filter === "all" || FILTER_STATUS[filter].includes(v.status))))
    .filter((v) => !q || normalizeKey(`${periodName(v.r)} ${v.r.formNumber} ${v.r.year}`).includes(q))
    .map((v) => v.r);

  const periodicity = periodicityOf(taxType, vatPeriodicity);
  const today = todayIso();
  const allCells = useMemo(
    () => (constitution ? taxPeriodCoverage(taxType, periodicity, years, returns, empties, { constitutionDate: constitution, today }) : []),
    [constitution, taxType, periodicity, years, returns, empties, today],
  );
  const cells = taxType === "income" ? allCells : allCells.filter((c) => c.year === coverageYear);
  const missingCount = allCells.filter((c) => c.state === "missing").length;
  const range = years.length ? `${years[0]}–${years[years.length - 1]}` : null;
  const coverageYearOptions = years.length ? years : [currentYear];

  async function registerEmpty() {
    if (!emptyCell || companyId === null || !periodicity) return;
    setBusy(true);
    try {
      await taxService.registerEmptyPeriod({ companyId, taxType, year: emptyCell.year, period: emptyCell.period, periodicity, confirmation: NO_OBLIGATION[taxType] });
      toast(`${emptyCell.label} registrado sin obligación.`);
      setEmptyCell(null);
      await load(companyId);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function voidEmpty() {
    if (!voiding) return;
    setBusy(true);
    try {
      await taxService.voidEmptyPeriod(voiding.id);
      toast("Registro anulado.");
      setVoiding(null);
      await load(companyId);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function importReturn() {
    setError(null);
    setPicking(true);
    try {
      const picked = await statementService.pickPdf(`Seleccionar declaración de ${TAX_LABEL[taxType]} (PDF)`);
      if (!picked) return;
      const parsed = parseTaxReturn(await extractPdfText(picked.data));
      if (parsed.taxType !== taxType) throw new TaxReturnError(`El archivo es un ${TAX_FORM_LABEL[parsed.taxType]}. Impórtalo desde Obligaciones tributarias → ${TAX_LABEL[parsed.taxType]}.`);
      const match = data.companies?.find((c) => c.nit.split("-")[0].replace(/\D/g, "") === parsed.nit);
      // La declaración se relaciona por NIT: se trabaja sobre esa empresa.
      let list = returns;
      let periodicity = vatPeriodicity;
      if (match && match.id !== companyId) {
        [list, periodicity] = await Promise.all([taxService.list(match.id), taxService.settings(match.id).then((s) => s.vatPeriodicity)]);
        setCompanyId(match.id);
      }
      setDraft(buildDraft(parsed, picked.fileName, data.companies ?? [], list, periodicity));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPicking(false);
    }
  }

  const noRange = companyId !== null && !!company && !constitution;

  return (
    <>
      <PageHeader eyebrow="Estados Financieros · Obligaciones tributarias" title={TAX_LABEL[taxType]} description={DESCRIPTION[taxType]} />
      <Card className="tax-bar">
        <div className="tax-bar__row">
          <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          <Field label="Fecha de corte" hint="Pagos hasta esta fecha reducen el saldo.">
            {(id) => <DateInput id={id} value={cut} onChange={setCut} />}
          </Field>
          {companyId !== null && (
            <dl className="context-bar__items tax-bar__context">
              <div className="context-bar__item">
                <dt>Cobertura</dt>
                <dd>{range ?? "Pendiente"}</dd>
              </div>
              {taxType === "vat" && (
                <div className="context-bar__item">
                  <dt>Periodicidad (Empresas)</dt>
                  <dd>
                    {vatPeriodicity ? PERIODICITY_LABEL[vatPeriodicity] : "Sin configurar"}{" "}
                    <button type="button" className="link-button" onClick={() => navigate(paths.companies)}>
                      Configurar en Empresas
                    </button>
                  </dd>
                </div>
              )}
            </dl>
          )}
          <div className="tax-bar__actions">
            <Button icon={<Settings2 size={15} />} onClick={() => setSettingsOpen(true)}>
              Configuración PUC
            </Button>
            <Button
              icon={<CalendarX2 size={15} />}
              disabled={companyId === null || !allCells.some((c) => c.state === "missing")}
              title={companyId === null ? "Selecciona la empresa" : !allCells.some((c) => c.state === "missing") ? "No hay periodos faltantes" : undefined}
              onClick={() => {
                const first = cells.find((c) => c.state === "missing") ?? allCells.find((c) => c.state === "missing");
                if (first) {
                  setEmptyConfirmed(false);
                  setEmptyCell(first);
                }
              }}
            >
              Registrar sin obligación
            </Button>
            <Button variant="primary" icon={<FileUp size={15} />} loading={picking} onClick={() => void importReturn()}>
              Importar declaración
            </Button>
          </div>
        </div>
      </Card>
      {error && <Alert tone="danger">{error}</Alert>}
      {missingPuc.length > 0 && (
        <Alert tone="warning" title="Falta configurar cuentas PUC">
          <div className="row row--between" style={{ flexWrap: "wrap" }}>
            <ul className="tax-puc-missing">
              {TAX_PUC_ITEMS.filter((i) => missingPuc.includes(i.key)).map((i) => {
                const n = periodsAffectedByPuc(returns.filter((r) => r.taxType === taxType), i.key);
                return (
                  <li key={i.key}>
                    {i.label}
                    {n > 0 && <span className="muted"> · {n} {n === 1 ? "periodo afectado" : "periodos afectados"}</span>}
                  </li>
                );
              })}
            </ul>
            <Button size="sm" onClick={() => setSettingsOpen(true)}>
              Configurar
            </Button>
          </div>
        </Alert>
      )}
      {noRange && (
        <Alert tone="warning" title="Falta la fecha de constitución">
          <div className="row row--between" style={{ flexWrap: "wrap" }}>
            <span>La cobertura va desde el año de constitución. Complétala en Empresas (Cámara de Comercio) para ver qué periodos faltan; no se infiere.</span>
            <Button size="sm" onClick={() => navigate(paths.companies)}>
              Ir a Empresas
            </Button>
          </div>
        </Alert>
      )}

      {companyId === null ? (
        <Card>
          <EmptyState icon={<FileUp size={20} />} title="Selecciona la empresa o importa una declaración" description="La declaración se relaciona con la empresa guardada que tenga su mismo NIT." />
        </Card>
      ) : (
        <>
          <Tabs
            label="Secciones"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "returns", label: "Declaraciones" },
              { id: "reconciliation", label: "Conciliación y reportes", badge: ownIssues.length ? ownIssues.length : undefined },
            ]}
          />
          {tab === "reconciliation" ? (
            <div role="tabpanel" id="panel-reconciliation" aria-labelledby="tab-reconciliation">
              <ReconciliationTab taxType={taxType} companyId={companyId} cut={cut} effects={allEffects} issues={ownIssues} />
            </div>
          ) : (
            <div role="tabpanel" id="panel-returns" aria-labelledby="tab-returns" className="stack">
              <MetricBar label="Resumen" metrics={metrics} />

              <Card
                flush
                title="Cobertura por periodo"
                description={
                  noRange
                    ? "Se necesita la fecha de constitución de la empresa."
                    : !periodicity
                      ? "Configura la periodicidad de IVA en Empresas para ver la cobertura."
                      : `Desde ${years[0] ?? "—"} hasta ${currentYear}. ${missingCount ? `${missingCount} ${missingCount === 1 ? "periodo falta" : "periodos faltan"} en total.` : "Sin periodos faltantes."} Pulsa un periodo para ver su detalle o registrarlo sin obligación.`
                }
                actions={
                  taxType !== "income" && years.length > 1 ? (
                    <Select aria-label="Año de la cobertura" value={coverageYear} onChange={(e) => setCoverageYear(Number(e.target.value))} style={{ width: "auto" }}>
                      {coverageYearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </Select>
                  ) : undefined
                }
              >
                {cells.length > 0 && (
                  <CoverageGrid
                    cells={cells}
                    cut={cut}
                    vatPeriodicity={vatPeriodicity}
                    onOpen={setDetail}
                    onEmpty={(c) => (setEmptyConfirmed(false), setEmptyCell(c))}
                    onVoid={(c) => setVoiding(c.empty)}
                  />
                )}
              </Card>

              <Card flush title="Declaraciones" description="Las correcciones se agrupan bajo la declaración vigente; las versiones anteriores siguen disponibles.">
                <div className="toolbar row--between">
                  <SegmentedFilter label="Filtrar declaraciones" options={FILTERS} value={filter} onChange={setFilter} />
                  <SearchBox placeholder="Periodo o formulario" value={query} onChange={setQuery} />
                </div>
                {visible.length === 0 ? (
                  own.length === 0 ? (
                    <EmptyReturns taxType={taxType} company={company?.razonSocial ?? "esta empresa"} />
                  ) : (
                    <p className="muted" style={{ padding: 16 }}>
                      Ninguna declaración coincide con el filtro.
                    </p>
                  )
                ) : (
                  <ReturnsTable taxType={taxType} returns={visible} all={own} cut={cut} vatPeriodicity={vatPeriodicity} effects={allEffects} onOpen={setDetail} />
                )}
              </Card>
            </div>
          )}
        </>
      )}

      <ImportModal
        draft={draft}
        vatPeriodicity={vatPeriodicity}
        onClose={() => setDraft(null)}
        onChange={setDraft}
        returns={returns}
        onSaved={async (id) => {
          setDraft(null);
          await load(id);
        }}
      />
      <ReturnDetailModal item={detail && fresh(detail.id)} vatPeriodicity={vatPeriodicity} versions={detail ? versionsOf(detail, returns) : []} cut={cut} onClose={() => setDetail(null)} onChanged={() => load(companyId)} onOpenVersion={setDetail} />
      <Modal
        open={emptyCell !== null}
        title="Registrar periodo sin obligación"
        description="Cubre el periodo sin crear una declaración ni valores en los Estados Financieros."
        onClose={() => setEmptyCell(null)}
        locked={busy}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEmptyCell(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" icon={<CalendarX2 size={15} />} disabled={!emptyConfirmed} loading={busy} onClick={() => void registerEmpty()}>
              Registrar
            </Button>
          </>
        }
      >
        {emptyCell && (
          <div className="stack">
            <p style={{ margin: 0 }}>
              <strong>{company?.razonSocial}</strong> · {TAX_LABEL[taxType]}
            </p>
            <Field label="Periodo">
              {(id) => (
                <Select id={id} value={`${emptyCell.year}-${emptyCell.period}`} onChange={(e) => setEmptyCell(allCells.find((c) => `${c.year}-${c.period}` === e.target.value) ?? emptyCell)}>
                  {allCells
                    .filter((c) => c.state === "missing")
                    .map((c) => (
                      <option key={`${c.year}-${c.period}`} value={`${c.year}-${c.period}`}>
                        {c.label}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={emptyConfirmed} onChange={(e) => setEmptyConfirmed(e.target.checked)} />
              <span>{NO_OBLIGATION[taxType]}</span>
            </label>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={voiding !== null}
        danger
        title="Anular registro"
        confirmLabel="Anular"
        loading={busy}
        message={voiding ? <>El periodo dejará de estar cubierto como «sin obligación» (registrado el {formatDateForDisplay(voiding.createdAt)}). El registro queda anulado, no se borra.</> : null}
        onCancel={() => setVoiding(null)}
        onConfirm={() => void voidEmpty()}
      />
      <PucSettingsModal
        open={settingsOpen}
        title="Configuración PUC de obligaciones tributarias"
        description="Una cuenta por concepto, global para todas las empresas. Al cambiarla se recalculan los efectos sin borrar declaraciones ni pagos."
        items={TAX_PUC_ITEMS}
        index={data.index}
        settings={data.settingsMap}
        mappings={data.mappingMap}
        required={missingPuc}
        onClose={() => setSettingsOpen(false)}
        onSaved={data.reloadSettings}
        onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
      />
    </>
  );
}

export const WithholdingReturnsPage = () => <TaxObligationsPage taxType="withholding" />;
export const VatReturnsPage = () => <TaxObligationsPage taxType="vat" />;
export const IncomeReturnsPage = () => <TaxObligationsPage taxType="income" />;
