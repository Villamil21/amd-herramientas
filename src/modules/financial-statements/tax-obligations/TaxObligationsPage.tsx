import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarX2, Eye, FileUp, Settings2, Undo2 } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, DateInput, EmptyState, Field, MetricBar, Modal, PageHeader, Select, useToast } from "../../../components/ui";
import { SearchBox, SegmentedFilter } from "../../bank-analysis/shared/components/tableControls";
import { normalizeKey } from "../../../utils/text";
import { formatDateForDisplay } from "../../../utils/dates";
import { extractPdfText } from "../../bank-analysis/shared/pdf/pdfExtractor";
import { statementService } from "../../bank-analysis/shared/statementService";
import { errorMessage } from "../../../services/tauri";
import { formatInteger } from "../../../utils/format";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucSettingsModal } from "../shared/components/PucSettingsModal";
import { formatAccountingCents, formatExactCents, formatIsoDate, isIsoDate } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { ImportModal, ReturnDetailModal, StatusBadge } from "./components";
import { periodicityOf, taxPeriodCoverage, type TaxPeriodCell } from "./services/coverage";
import { parseTaxReturn, TAX_FORM_LABEL, TaxReturnError } from "./parser/taxReturnParser";
import { anomalies, effectiveValues, paidCents, pendingCents, periodName, taxEffects, taxStatus } from "./services/effects";
import { buildDraft, type ImportDraft } from "./services/importDraft";
import { taxService } from "./services/taxService";
import { PERIODICITY_LABEL, PUC_KEYS_BY_TAX, TAX_LABEL, TAX_PUC_ITEMS, type TaxEmptyPeriod, type TaxReturn, type TaxType, type VatPeriodicity } from "./types";
import type { TaxStatus } from "./services/effects";

const DESCRIPTION: Record<TaxType, string> = {
  withholding: "Declaraciones mensuales (Formulario 350). El valor es «Total retenciones más sanciones»: es cuenta por pagar desde el fin del mes declarado por el saldo que siga pendiente (admite pagos parciales).",
  vat: "Declaraciones bimestrales o cuatrimestrales (Formulario 300). El saldo a pagar es cuenta por pagar por lo que siga pendiente (admite pagos parciales); el saldo a favor es una foto del último periodo terminado (nunca se suman periodos).",
  income: "Declaraciones anuales (Formulario 110). Saldo a pagar y a favor, anticipo para el año siguiente y resultado fiscal para «Resultados de ejercicios anteriores». El patrimonio declarado es solo informativo.",
};

type ReturnFilter = "all" | "pending" | "partial" | "paid" | "favor" | "superseded";

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
  const [coverageYear, setCoverageYear] = useState(() => new Date().getFullYear());
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

  const own = useMemo(() => returns.filter((r) => r.taxType === taxType).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.id - a.id), [returns, taxType]);
  const pucKeys = PUC_KEYS_BY_TAX[taxType];
  const missingPuc = pucKeys.filter((k) => !data.settingsMap.get(k));
  const effects = useMemo(() => (isIsoDate(cut) ? taxEffects({ returns, puc: data.settingsMap, vatPeriodicity }, cut) : null), [returns, data.settingsMap, vatPeriodicity, cut]);
  const ownEffects = effects?.effects.filter((e) => pucKeys.includes(e.pucKey)) ?? [];
  const ownIssues = effects?.issues.filter((i) => i.taxType === taxType) ?? [];
  const company = data.companies?.find((c) => c.id === companyId);
  const fresh = (id: number) => returns.find((r) => r.id === id) ?? null;
  const statusOf = (r: TaxReturn) => taxStatus(r, vatPeriodicity);
  const live = own.filter((r) => r.supersededBy === null);
  const counts = {
    pending: live.filter((r) => ["pending", "review"].includes(statusOf(r))).length,
    partial: live.filter((r) => statusOf(r) === "partial").length,
    paid: live.filter((r) => statusOf(r) === "paid").length,
    favor: live.filter((r) => statusOf(r) === "favor").length,
    superseded: own.length - live.length,
  };
  const pendingTotal = live.reduce((n, r) => n + (effectiveValues(r).payable > 0 ? pendingCents(r) : 0), 0);
  const paidTotal = live.reduce((n, r) => n + paidCents(r), 0);
  const visible = own.filter((r) => (filter === "all" || FILTER_STATUS[filter].includes(statusOf(r))) && (!query || normalizeKey(`${periodName(r)} ${r.formNumber} ${r.year}`).includes(normalizeKey(query))));
  const FILTERS: { id: ReturnFilter; label: string }[] = [
    { id: "all", label: "Todas" },
    { id: "pending", label: `Pendientes (${counts.pending})` },
    { id: "partial", label: "Pago parcial" },
    { id: "paid", label: "Pagadas" },
    ...(taxType === "withholding" ? [] : [{ id: "favor" as const, label: "Saldo a favor" }]),
    { id: "superseded", label: "Reemplazadas" },
  ];
  const periodicity = periodicityOf(taxType, vatPeriodicity);
  const coverageYears = taxType === "income" ? [coverageYear - 3, coverageYear - 2, coverageYear - 1, coverageYear] : [coverageYear];
  const cells = taxPeriodCoverage(taxType, periodicity, coverageYears, returns, empties);
  const latest = live[0];

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

  async function changePeriodicity(value: VatPeriodicity | null) {
    if (companyId === null) return;
    try {
      await taxService.saveSettings({ companyId, vatPeriodicity: value });
      toast("Periodicidad de IVA guardada.");
      await load(companyId);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Estados Financieros · Obligaciones tributarias"
        title={TAX_LABEL[taxType]}
        description={DESCRIPTION[taxType]}
        actions={
          <>
            <Button icon={<Settings2 size={15} />} onClick={() => setSettingsOpen(true)}>
              Cuentas PUC
            </Button>
            <Button
              icon={<CalendarX2 size={15} />}
              disabled={companyId === null || !cells.some((c) => c.state === "missing")}
              title={companyId === null ? "Selecciona la empresa" : undefined}
              onClick={() => {
                const first = cells.find((c) => c.state === "missing");
                if (first) {
                  setEmptyConfirmed(false);
                  setEmptyCell(first);
                }
              }}
            >
              Registrar periodo sin obligación
            </Button>
            <Button variant="primary" icon={<FileUp size={15} />} loading={picking} onClick={() => void importReturn()}>
              Importar declaración
            </Button>
          </>
        }
      />
      <Card className="fs-opening-head">
        <div className="fs-opening-head__row">
          <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          {taxType === "vat" && companyId !== null && (
            <Field label="Periodicidad de IVA de la empresa" hint="Define cómo se interpreta el periodo de cada declaración.">
              {(id) => (
                <Select id={id} value={vatPeriodicity ?? ""} onChange={(e) => void changePeriodicity((e.target.value || null) as VatPeriodicity | null)}>
                  <option value="">Sin configurar</option>
                  <option value="bimonthly">Bimestral (6 periodos)</option>
                  <option value="four_monthly">Cuatrimestral (3 periodos)</option>
                </Select>
              )}
            </Field>
          )}
          {companyId !== null && (
            <dl className="context-bar__items fs-opening-head__stats">
              <div className="context-bar__item">
                <dt>Último periodo</dt>
                <dd>{latest ? periodName(latest) : "—"}</dd>
              </div>
              {taxType === "vat" && (
                <div className="context-bar__item">
                  <dt>Periodicidad</dt>
                  <dd>{vatPeriodicity ? PERIODICITY_LABEL[vatPeriodicity] : "Sin configurar"}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </Card>
      {error && <Alert tone="danger">{error}</Alert>}
      {missingPuc.length > 0 && (
        <Alert tone="warning" title="Faltan cuentas PUC de este impuesto">
          <div className="row row--between" style={{ flexWrap: "wrap" }}>
            <span>
              {TAX_PUC_ITEMS.filter((i) => missingPuc.includes(i.key))
                .map((i) => i.label)
                .join(" · ")}
              . Sin ellas el Generador no puede incluir estos valores.
            </span>
            <Button size="sm" onClick={() => setSettingsOpen(true)}>
              Configurar
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
          <MetricBar
            label="Resumen de declaraciones"
            metrics={[
              { key: "returns", label: live.length === 1 ? "declaración vigente" : "declaraciones vigentes", value: formatInteger(live.length), onClick: () => setFilter("all"), active: filter === "all" },
              { key: "pending", label: counts.pending === 1 ? "pendiente" : "pendientes", value: formatInteger(counts.pending), tone: counts.pending ? "attention" : undefined, onClick: () => setFilter("pending"), active: filter === "pending" },
              { key: "pendingTotal", label: "saldo pendiente", value: formatExactCents(pendingTotal), tone: pendingTotal ? "negative" : undefined },
              { key: "partial", label: "con pago parcial", value: formatInteger(counts.partial), onClick: () => setFilter("partial"), active: filter === "partial" },
              { key: "paid", label: "pagado", value: formatExactCents(paidTotal), tone: "positive", onClick: () => setFilter("paid"), active: filter === "paid" },
              ...(taxType === "withholding" ? [] : [{ key: "favor", label: "con saldo a favor", value: formatInteger(counts.favor), onClick: () => setFilter("favor"), active: filter === "favor" }]),
              ...(counts.superseded ? [{ key: "superseded", label: counts.superseded === 1 ? "reemplazada" : "reemplazadas", value: formatInteger(counts.superseded), onClick: () => setFilter("superseded"), active: filter === "superseded" }] : []),
            ]}
          />

          <Card
            flush
            title="Cobertura por periodo"
            description={periodicity ? "Declarado, sin obligación o faltante. Haz clic en un periodo faltante para registrarlo sin obligación." : "Configura la periodicidad de IVA de la empresa para ver la cobertura."}
            actions={
              <Select aria-label="Año de la cobertura" value={coverageYear} onChange={(e) => setCoverageYear(Number(e.target.value))} style={{ width: "auto" }}>
                {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                  <option key={y} value={y}>
                    {taxType === "income" ? `${y - 3}–${y}` : y}
                  </option>
                ))}
              </Select>
            }
          >
            {cells.length > 0 && (
              <ol className="tax-coverage">
                {cells.map((c) => (
                  <li key={`${c.year}-${c.period}`} className={`tax-coverage__cell is-${c.state}`}>
                    <span className="tax-coverage__label">{c.label}</span>
                    {c.state === "declared" ? (
                      <button type="button" className="link-button" onClick={() => setDetail(c.returns[0])}>
                        ✓ <StatusBadge status={taxStatus(c.returns[0], vatPeriodicity)} />
                      </button>
                    ) : c.state === "empty" ? (
                      <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                        <strong>✓ Sin obligación</strong>
                        <Button size="sm" variant="ghost" iconOnly icon={<Undo2 size={12} />} aria-label={`Anular «sin obligación» de ${c.label}`} title="Anular registro" onClick={() => setVoiding(c.empty)} />
                      </span>
                    ) : (
                      <button type="button" className="link-button" onClick={() => (setEmptyConfirmed(false), setEmptyCell(c))} title="Registrar este periodo sin obligación">
                        — Falta
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card flush title="Declaraciones" description="Historial completo: las pagadas y las reemplazadas por una corrección siguen visibles. «Ver» reúne el detalle y los pagos.">
            <div className="toolbar row--between">
              <SegmentedFilter label="Filtrar declaraciones" options={FILTERS} value={filter} onChange={setFilter} />
              <SearchBox placeholder="Periodo o formulario" value={query} onChange={setQuery} />
            </div>
            {visible.length === 0 ? (
              <p className="muted" style={{ padding: 16 }}>
                {own.length === 0 ? `No hay declaraciones de ${TAX_LABEL[taxType]} para ${company?.razonSocial ?? "esta empresa"}.` : "Ninguna declaración coincide con el filtro."}
              </p>
            ) : (
              <div className="table-wrap table-wrap--scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Periodo</th>
                      <th>Formulario</th>
                      <th className="num">Saldo a pagar</th>
                      {taxType !== "withholding" && <th className="num">Saldo a favor</th>}
                      {taxType === "income" && <th className="num">Resultado fiscal</th>}
                      <th className="num">Pagado</th>
                      <th className="num">Saldo pendiente</th>
                      <th>Estado</th>
                      <th className="actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const status = statusOf(r);
                      const payable = effectiveValues(r).payable;
                      return (
                        <tr key={r.id} className={["is-clickable", status === "superseded" ? "muted" : status === "review" ? "row-attention--blocking" : ""].filter(Boolean).join(" ")} onClick={() => setDetail(r)}>
                          <td className="nowrap">
                            {periodName(r)}
                            {r.taxType === "vat" && <div className="table__secondary">{PERIODICITY_LABEL[r.periodicity]}</div>}
                          </td>
                          <td className="mono">
                            {r.formNumber || "—"}
                            {r.isCorrection && <div className="table__secondary">Corrección{r.previousFormNumber ? ` de ${r.previousFormNumber}` : ""}</div>}
                          </td>
                          <td className="num">{formatExactCents(r.payableCents)}</td>
                          {taxType !== "withholding" && <td className="num">{formatExactCents(r.favorCents)}</td>}
                          {taxType === "income" && (
                            <td className={(r.incomeLossCents ?? 0) > 0 ? "num amount--negative" : "num"}>{formatAccountingCents((r.incomeOrdinaryCents ?? 0) - (r.incomeLossCents ?? 0))}</td>
                          )}
                          <td className="num">
                            {payable > 0 ? formatExactCents(paidCents(r)) : "—"}
                            {r.payments.length > 0 && <div className="table__secondary">{r.payments.length === 1 ? `1 pago · ${formatIsoDate(r.payments[0].paymentDate)}` : `${r.payments.length} pagos · último ${formatIsoDate(r.payments[r.payments.length - 1].paymentDate)}`}</div>}
                          </td>
                          <td className="num">{payable > 0 ? formatExactCents(pendingCents(r)) : "—"}</td>
                          <td>
                            <StatusBadge status={status} />
                            {status === "review" && <div className="table__secondary">{anomalies(r, vatPeriodicity)[0]}</div>}
                          </td>
                          <td className="actions" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" icon={<Eye size={14} />} onClick={() => setDetail(r)}>
                              Ver
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            flush
            title="Efecto en Estados Financieros"
            description="Lo que el Generador incluye de este impuesto a la fecha de corte (ESF). Se recalcula siempre desde las declaraciones guardadas."
            actions={<Field label="Fecha de corte">{(id) => <DateInput id={id} value={cut} onChange={setCut} />}</Field>}
          >
            <div className="stack stack--sm" style={{ padding: "var(--space-3) var(--space-5)" }}>
              {ownIssues.map((i, n) => (
                <Alert key={n} tone={i.level === "blocking" ? "danger" : "warning"}>
                  {i.message}
                </Alert>
              ))}
              {ownEffects.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Ningún valor de {TAX_LABEL[taxType]} a esta fecha de corte.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table table--dense">
                    <thead>
                      <tr>
                        <th>Concepto</th>
                        <th>Código PUC</th>
                        <th className="num">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ownEffects.map((e, n) => (
                        <tr key={n}>
                          <td>{e.label}</td>
                          <td className="mono">{e.pucCode ?? <Badge tone="danger">Sin configurar</Badge>}</td>
                          <td className={e.cents < 0 ? "num amount--negative" : "num"}>{formatExactCents(e.cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {taxType === "income" && <span className="field__hint">El patrimonio declarado se consulta en «Ver» y nunca se envía al Estado de Situación Financiera.</span>}
            </div>
          </Card>
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
      <ReturnDetailModal
        item={detail && fresh(detail.id)}
        vatPeriodicity={vatPeriodicity}
        onClose={() => setDetail(null)}
        onChanged={() => load(companyId)}
        onPeriodicity={(p) => void changePeriodicity(p)}
      />
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
                <Select id={id} value={`${emptyCell.year}-${emptyCell.period}`} onChange={(e) => setEmptyCell(cells.find((c) => `${c.year}-${c.period}` === e.target.value) ?? emptyCell)}>
                  {cells
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
        title="Cuentas PUC de obligaciones tributarias"
        description="Configuración global: aplica a todas las empresas. La ubicación en el ESF sigue dependiendo del catálogo PUC → Estados Financieros."
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
