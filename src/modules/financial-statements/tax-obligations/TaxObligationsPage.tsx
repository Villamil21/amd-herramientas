import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Eye, FileUp, Settings2 } from "lucide-react";
import { Alert, Badge, Button, Card, DateInput, EmptyState, Field, PageHeader, Select, useToast } from "../../../components/ui";
import { extractPdfText } from "../../bank-analysis/shared/pdf/pdfExtractor";
import { statementService } from "../../bank-analysis/shared/statementService";
import { errorMessage } from "../../../services/tauri";
import { formatInteger } from "../../../utils/format";
import { CompanySelect } from "../shared/components/CompanySelect";
import { PucSettingsModal } from "../shared/components/PucSettingsModal";
import { formatAccountingCents, formatExactCents, formatIsoDate, isIsoDate } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { ImportModal, PaymentsModal, ReturnDetailModal, StatusBadge } from "./components";
import { parseTaxReturn, TAX_FORM_LABEL, TaxReturnError } from "./parser/taxReturnParser";
import { anomalies, effectiveValues, paidCents, pendingCents, periodName, taxEffects, taxStatus } from "./services/effects";
import { buildDraft, type ImportDraft } from "./services/importDraft";
import { taxService } from "./services/taxService";
import { PERIODICITY_LABEL, PUC_KEYS_BY_TAX, TAX_LABEL, TAX_PUC_ITEMS, type TaxReturn, type TaxType, type VatPeriodicity } from "./types";

const DESCRIPTION: Record<TaxType, string> = {
  withholding: "Declaraciones mensuales (Formulario 350). El valor es «Total retenciones más sanciones»: es cuenta por pagar desde el fin del mes declarado por el saldo que siga pendiente (admite pagos parciales).",
  vat: "Declaraciones bimestrales o cuatrimestrales (Formulario 300). El saldo a pagar es cuenta por pagar por lo que siga pendiente (admite pagos parciales); el saldo a favor es una foto del último periodo terminado (nunca se suman periodos).",
  income: "Declaraciones anuales (Formulario 110). Saldo a pagar y a favor, anticipo para el año siguiente y resultado fiscal para «Resultados de ejercicios anteriores». El patrimonio declarado es solo informativo.",
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
  const [paying, setPaying] = useState<TaxReturn | null>(null);
  const [cut, setCut] = useState(todayIso);

  const load = useCallback(
    async (id: number | null) => {
      if (id === null) {
        setReturns([]);
        setVatPeriodicity(null);
        return;
      }
      try {
        const [list, settings] = await Promise.all([taxService.list(id), taxService.settings(id)]);
        setReturns(list);
        setVatPeriodicity(settings.vatPeriodicity);
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
            <Button variant="primary" icon={<FileUp size={15} />} loading={picking} onClick={() => void importReturn()}>
              Importar declaración
            </Button>
          </>
        }
      />
      <Card>
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
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
          <Card flush title="Declaraciones" description="Historial completo: las pagadas y las reemplazadas por una corrección siguen visibles.">
            {own.length === 0 ? (
              <p className="muted" style={{ padding: 16 }}>
                No hay declaraciones de {TAX_LABEL[taxType]} para {company?.razonSocial ?? "esta empresa"}.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Periodo</th>
                      <th>Formulario</th>
                      <th className="nowrap" style={{ textAlign: "right" }}>
                        Saldo a pagar
                      </th>
                      <th className="nowrap" style={{ textAlign: "right" }}>
                        Saldo a favor
                      </th>
                      {taxType === "income" && (
                        <th className="nowrap" style={{ textAlign: "right" }}>
                          Resultado fiscal
                        </th>
                      )}
                      <th className="nowrap" style={{ textAlign: "right" }}>
                        Pagado
                      </th>
                      <th className="nowrap" style={{ textAlign: "right" }}>
                        Saldo pendiente
                      </th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {own.map((r) => {
                      const status = taxStatus(r, vatPeriodicity);
                      const payable = effectiveValues(r).payable;
                      return (
                        <tr key={r.id} className={status === "superseded" ? "muted" : status === "review" ? "row-attention--blocking" : undefined}>
                          <td className="nowrap">
                            {periodName(r)}
                            {r.taxType === "vat" && <div className="table__secondary">{PERIODICITY_LABEL[r.periodicity]}</div>}
                          </td>
                          <td className="mono">
                            {r.formNumber || "—"}
                            {r.isCorrection && <div className="table__secondary">Corrección{r.previousFormNumber ? ` de ${r.previousFormNumber}` : ""}</div>}
                          </td>
                          <td className="nowrap" style={{ textAlign: "right" }}>{formatExactCents(r.payableCents)}</td>
                          <td className="nowrap" style={{ textAlign: "right" }}>{formatExactCents(r.favorCents)}</td>
                          {taxType === "income" && (
                            <td style={{ textAlign: "right" }} className={(r.incomeLossCents ?? 0) > 0 ? "nowrap amount--negative" : "nowrap"}>
                              {formatAccountingCents((r.incomeOrdinaryCents ?? 0) - (r.incomeLossCents ?? 0))}
                            </td>
                          )}
                          <td className="nowrap" style={{ textAlign: "right" }}>
                            {payable > 0 ? formatExactCents(paidCents(r)) : "—"}
                            {r.payments.length > 0 && <div className="table__secondary">{r.payments.length === 1 ? `1 pago · ${formatIsoDate(r.payments[0].paymentDate)}` : `${r.payments.length} pagos · último ${formatIsoDate(r.payments[r.payments.length - 1].paymentDate)}`}</div>}
                          </td>
                          <td className="nowrap" style={{ textAlign: "right" }}>
                            {payable > 0 ? formatExactCents(pendingCents(r)) : "—"}
                          </td>
                          <td>
                            <StatusBadge status={status} />
                            {status === "review" && <div className="table__secondary">{anomalies(r, vatPeriodicity)[0]}</div>}
                          </td>
                          <td className="actions nowrap">
                            <Button size="sm" icon={<Eye size={14} />} onClick={() => setDetail(r)}>
                              Detalle
                            </Button>
                            {payable > 0 && r.supersededBy === null && (
                              <Button size="sm" icon={<CalendarCheck size={14} />} onClick={() => setPaying(r)}>
                                Pagos
                              </Button>
                            )}
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
            title="Efecto en Estados Financieros"
            description="Lo que el Generador incluye de este impuesto con esa fecha de corte (ESF). Se recalcula siempre desde las declaraciones guardadas."
            actions={<Field label="Fecha de corte">{(id) => <DateInput id={id} value={cut} onChange={setCut} />}</Field>}
          >
            <div className="stack">
              {ownIssues.map((i, n) => (
                <Alert key={n} tone={i.level === "blocking" ? "danger" : "warning"}>
                  {i.message}
                </Alert>
              ))}
              {ownEffects.length === 0 ? (
                <p className="muted">Ningún valor de {TAX_LABEL[taxType]} a esta fecha de corte.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Concepto</th>
                        <th>Código PUC</th>
                        <th style={{ textAlign: "right" }}>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ownEffects.map((e, n) => (
                        <tr key={n}>
                          <td>{e.label}</td>
                          <td className="mono">{e.pucCode ?? <Badge tone="danger">Sin configurar</Badge>}</td>
                          <td style={{ textAlign: "right" }} className={e.cents < 0 ? "nowrap amount--negative" : "nowrap"}>
                            {formatExactCents(e.cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {taxType === "income" && <span className="field__hint">El patrimonio declarado se consulta en «Detalle» y nunca se envía al Estado de Situación Financiera.</span>}
              <span className="field__hint">{formatInteger(own.filter((r) => r.supersededBy === null).length)} declaraciones vigentes. La ubicación en el ESF depende del catálogo PUC → Estados Financieros.</span>
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
      <PaymentsModal item={paying && fresh(paying.id)} onClose={() => setPaying(null)} onChanged={() => load(companyId)} />
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
