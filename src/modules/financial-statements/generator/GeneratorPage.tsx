import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Eye, FileDown, Lock, Pencil, Plus, Settings2, Unlock, XCircle } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Button, Card, ConfirmDialog, DateInput, Field, Modal, PageHeader, Select, useToast } from "../../../components/ui";
import { fileService } from "../../../services/fileService";
import { fsService } from "../../../services/fsService";
import { signerService } from "../../../services/signerService";
import { errorMessage } from "../../../services/tauri";
import {
  PERIOD_STATUS_LABEL,
  PRESENTATION_LABEL,
  type Adjustment,
  type BankAccountLifecycle,
  type BankBalance,
  type BatchSummary,
  type Employee,
  type Movement,
  type PayrollRow,
  type Period,
  type PeriodKey,
  type Presentation,
} from "../../../types/fs";
import type { CertificateSigner } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { areaFor } from "../payroll/calc";
import { ClassifyPucModal } from "../shared/components/ClassifyPucModal";
import { CompanySelect } from "../shared/components/CompanySelect";
import { fingerprint, formatExactCents, formatIsoDate, formatStatementPesos, isIsoDate, roundThousands } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { taxService } from "../tax-obligations/services/taxService";
import { CAPITAL_RECEIVABLE_KEY, type TaxType } from "../tax-obligations/types";
import { taxPucItems } from "../tax-obligations/services/pucItems";
import { ExcessReviewModal } from "../tax-obligations/ExcessReviewModal";
import { PucSettingsModal } from "../shared/components/PucSettingsModal";
import type { TaxEmptyPeriod, TaxReturn, VatPeriodicity } from "../tax-obligations/types";
import { activeDuplicates, checklist, coverage, monthText, payrollAbsences, pendingBalanceText, taxCoverage } from "./checks";
import { AdjustmentModal, BatchTable, CoverageTable, PdfPages, StatementView } from "./components";
import { buildStatements, eerrRows, esfRows, isBalanced, pendingBankBalances, type LineValue, type StatementRow } from "./engine";
import { withNoteNumbers } from "../notes/model";
import { renderStatementsPdf } from "./pdf";
import { buildSnapshot, pdfModel, type StatementsSnapshot } from "./snapshot";
import { formatDateTimeForDisplay } from "../../../utils/dates";

interface Ledger {
  movements: Movement[];
  balances: BankBalance[];
  batches: BatchSummary[];
  adjustments: Adjustment[];
  employees: Employee[];
  payrollRows: PayrollRow[];
  periods: Period[];
  taxReturns: TaxReturn[];
  /** Periodos registrados «sin obligación». */
  taxEmpty: TaxEmptyPeriod[];
  vatPeriodicity: VatPeriodicity | null;
  bankLifecycles: BankAccountLifecycle[];
}

const REVIEW_CHANGED = "Los valores cambiaron después de la última validación (movimientos, catálogo, mapeos o datos de la empresa).";

/**
 * Generador de Estados Financieros: empresa + rango + presentación → ESF
 * (saldos a la fecha final) y EERR (movimientos del rango), validación,
 * ajustes, previsualización, PDF de exactamente dos páginas, versiones y cierre.
 */
export default function GeneratorPage() {
  const toast = useToast();
  const data = useFsData();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [presentation, setPresentation] = useState<Presentation | "">("");
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [signers, setSigners] = useState<CertificateSigner[]>([]);
  const [accountantId, setAccountantId] = useState<number | null>(null);
  const [classifying, setClassifying] = useState<{ code: string; concept: string } | null>(null);
  const [adjusting, setAdjusting] = useState<{ editing: Adjustment | null } | null>(null);
  const [preview, setPreview] = useState<{ snapshot: StatementsSnapshot; bytes: Uint8Array | null; regenerate?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"close" | "unlock" | null>(null);
  /** Configuración desplegada; ya configurada se compacta en un resumen con «Cambiar configuración». */
  const [configOpen, setConfigOpen] = useState(true);
  /** Verificación: los puntos ya cumplidos se ven solo al pedir el detalle. */
  const [checksDetail, setChecksDetail] = useState(false);
  const reviewing = useRef<string | null>(null);
  const [pucOpen, setPucOpen] = useState(false);
  const [excessOpen, setExcessOpen] = useState(false);
  /** Excedentes a favor de DIAN ya ofrecidos en esta sesión (el modal se abre una vez por conjunto pendiente). */
  const askedExcess = useRef<string>("");

  const company = data.companies?.find((c) => c.id === companyId) ?? null;
  const rangeOk = isIsoDate(start) && isIsoDate(end) && start <= end;
  const key: PeriodKey | null = companyId !== null && rangeOk && presentation ? { companyId, startDate: start, endDate: end, presentation } : null;
  const keyId = key ? `${key.companyId}|${key.startDate}|${key.endDate}|${key.presentation}` : "";

  useEffect(() => {
    signerService.list().then(setSigners, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  const loadLedger = useCallback(async () => {
    if (companyId === null) return setLedger(null);
    try {
      const [movements, balances, batches, adjustments, employees, payrollRows, periods, taxReturns, taxSettings, bankLifecycles, taxEmpty] = await Promise.all([
        fsService.movements(companyId),
        fsService.bankBalances(companyId),
        fsService.batches(companyId),
        fsService.adjustments(companyId),
        fsService.employees(companyId),
        fsService.payrollRows(companyId),
        fsService.periods(companyId),
        taxService.list(companyId),
        taxService.settings(companyId),
        fsService.bankLifecycles(companyId),
        taxService.emptyPeriods(companyId),
      ]);
      setLedger({ movements, balances, batches, adjustments, employees, payrollRows, periods, taxReturns, vatPeriodicity: taxSettings.vatPeriodicity, bankLifecycles, taxEmpty });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [companyId, toast]);

  useEffect(() => {
    setLedger(null);
    void loadLedger();
  }, [loadLedger]);

  const loadPeriod = useCallback(async () => {
    if (!key) return setPeriod(null);
    try {
      setPeriod(await fsService.period(key));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyId, toast]);

  useEffect(() => {
    void loadPeriod();
  }, [loadPeriod]);

  const statements = useMemo(() => {
    if (!ledger || !data.catalog || !company || !rangeOk || !presentation) return null;
    const tax = { returns: ledger.taxReturns, puc: data.settingsMap, vatPeriodicity: ledger.vatPeriodicity };
    const input = {
      company,
      catalog: data.catalog,
      mappings: data.mappings,
      movements: ledger.movements,
      bankBalances: ledger.balances,
      bankLifecycles: ledger.bankLifecycles,
      pucConcepts: data.index.concepts,
      start,
      end,
      tax,
      capitalReceivablePuc: data.settingsMap.get(CAPITAL_RECEIVABLE_KEY) ?? null,
    };
    return { current: buildStatements({ ...input, presentation }), other: buildStatements({ ...input, presentation: presentation === "bank" ? "otc" : "bank" }) };
  }, [ledger, data.catalog, data.mappings, data.index, data.settingsMap, company, start, end, rangeOk, presentation]);

  const s = statements?.current ?? null;

  // Cuentas PUC que se configuran desde el Generador: las de los tres impuestos (Retefuente por concepto incluida) y la CxC a socios.
  const pucItems = useMemo(() => {
    const returns = ledger?.taxReturns ?? [];
    const byKey = new Map<string, ReturnType<typeof taxPucItems>[number]>();
    for (const t of ["withholding", "vat", "income"] as TaxType[]) for (const i of taxPucItems(t, returns)) byKey.set(i.key, i);
    byKey.set(CAPITAL_RECEIVABLE_KEY, { key: CAPITAL_RECEIVABLE_KEY, label: "Cuenta por cobrar a socios (capital suscrito − pagado)", group: "Capital" });
    return [...byKey.values()];
  }, [ledger?.taxReturns]);

  // Al preparar los EEFF, los excedentes a favor de DIAN pendientes de decisión se muestran en un modal (una vez por conjunto pendiente).
  const pendingExcess = s?.tax.excessReviews.filter((x) => x.needsReview) ?? [];
  const pendingExcessKey = pendingExcess.map((x) => x.fingerprint).join(",");
  useEffect(() => {
    if (!pendingExcessKey || period?.status === "closed" || askedExcess.current === pendingExcessKey) return;
    askedExcess.current = pendingExcessKey;
    setExcessOpen(true);
  }, [pendingExcessKey, period?.status]);
  const rows = useMemo(() => (s ? { esf: esfRows(s), eerr: eerrRows(s) } : null), [s]);
  const hash = useMemo(() => (s && rows ? fingerprint(JSON.stringify({ esf: rows.esf.map((r) => [r.label, r.cents]), eerr: rows.eerr.map((r) => [r.label, r.cents]), u: s.unclassified.map((u) => [u.pucCode, u.cents]), p: presentation })) : null), [s, rows, presentation]);
  const lines = useMemo(() => {
    const map = new Map<number, LineValue>();
    if (s) for (const sec of Object.values(s.sections)) for (const l of sec.lines) map.set(l.line.id, l);
    return map;
  }, [s]);

  const review = useMemo(() => {
    if (!ledger || !rangeOk) return null;
    const absences = payrollAbsences(start, end, ledger.employees, ledger.payrollRows);
    const inRange = ledger.payrollRows.filter((r) => r.period >= start.slice(0, 7) && r.period <= end.slice(0, 7));
    const withoutArea = inRange.filter((r) => {
      const e = ledger.employees.find((x) => x.id === r.employeeId);
      return !e || !areaFor(e, r.period);
    }).length;
    const cov = coverage(start, end, ledger.movements, ledger.balances, ledger.batches, ledger.bankLifecycles);
    return { coverage: cov, tax: taxCoverage(cov.months, ledger.taxReturns, ledger.vatPeriodicity, end, ledger.taxEmpty), duplicates: activeDuplicates(ledger.movements), absences, withoutArea };
  }, [ledger, start, end, rangeOk]);

  const checks = useMemo(() => (statements && review ? checklist(statements.current, statements.other, review.duplicates, review.absences, review.withoutArea) : []), [statements, review]);
  const allOk = checks.length > 0 && checks.every((c) => c.ok);
  const pendingChecks = checks.filter((c) => !c.ok).length;
  const closed = period?.status === "closed";
  const closedSnapshot = closed ? (period?.closedSnapshot as StatementsSnapshot | null) : null;
  const accountant = signers.find((x) => x.id === accountantId) ?? null;
  const validAccountants = signers.filter((x) => x.signatureAvailable && x.accountantTitle && !x.fsExcluded);
  /** Firmas sin «Contador Público» / «Contadora Pública» ni «No usar»: se listan bloqueadas hasta definirlas en Firmas. */
  const pendingAccountants = signers.filter((x) => !x.accountantTitle && !x.fsExcluded);
  const hashMatches = period?.validationHash !== null && period?.validationHash === hash;
  const pdfReady = !closed && period && (period.status === "ready" || period.status === "pdf_generated") && hashMatches;
  const pdfMissing = [!company?.legalRepName && "Falta el representante legal en Empresas", !accountant && "Elige el contador (con firma PNG y «Contador Público» / «Contadora Pública» definido en Firmas)"].filter(Boolean) as string[];

  // Un periodo validado cuyos valores cambiaron pasa a «Requiere nueva revisión».
  useEffect(() => {
    if (!key || !period || !hash || !s || !(period.status === "ready" || period.status === "pdf_generated")) return;
    if (period.validationHash === hash || reviewing.current === `${keyId}|${hash}`) return;
    reviewing.current = `${keyId}|${hash}`;
    void fsService.markNeedsReview(key, REVIEW_CHANGED).then(loadPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, hash, keyId]);

  const balanceOf = useCallback((code: string) => s?.pucBalances.get(code) ?? 0, [s]);

  async function act(label: string, action: () => Promise<unknown>, message: string) {
    setBusy(label);
    try {
      await action();
      toast(message);
      await Promise.all([loadPeriod(), loadLedger()]);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  function liveSnapshot(): StatementsSnapshot | null {
    if (!s || !company || !data.catalog || !presentation) return null;
    return buildSnapshot(s, { company, accountant, start, end, presentation, catalog: data.catalog, mappings: data.mappings });
  }

  async function openPreview(snapshot: StatementsSnapshot, regenerate = false) {
    setPreview({ snapshot, bytes: null, regenerate });
    try {
      const { bytes } = await renderStatementsPdf(await pdfModel(snapshot));
      setPreview({ snapshot, bytes, regenerate });
    } catch (e) {
      setPreview(null);
      toast(errorMessage(e), "error");
    }
  }

  async function generate() {
    if (!preview?.bytes || !key) return;
    setBusy("pdf");
    try {
      const { pages } = await renderStatementsPdf(await pdfModel(preview.snapshot));
      if (pages !== 2) throw new Error("El PDF debe tener exactamente 2 páginas.");
      const path = await fileService.savePdf(preview.bytes, preview.snapshot.fileName);
      if (!path) return;
      if (!preview.regenerate) await fsService.recordVersion(key, preview.snapshot.fileName, preview.snapshot);
      toast(preview.regenerate ? "PDF regenerado desde la versión guardada." : "PDF generado y versión guardada.");
      setPreview(null);
      await loadPeriod();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const shownRows: { esf: StatementRow[]; eerr: StatementRow[] } | null = closedSnapshot ? withNoteNumbers(closedSnapshot.esfRows, closedSnapshot.eerrRows) : rows ? withNoteNumbers(rows.esf, rows.eerr) : null;
  const otherPeriods = (ledger?.periods ?? []).filter((p) => p.id !== period?.id).slice(0, 6);

  return (
    <>
      <PageHeader eyebrow="Estados Financieros" title="Generador de Estados Financieros" description="Estado de Situación Financiera (saldos a la fecha final) y Estado de Resultados (movimientos del rango) por empresa." />
      {companyId !== null && rangeOk && presentation && !configOpen ? (
        <Card className="fs-config-summary">
          <div className="context-bar__main">
            <dl className="context-bar__items">
              <div className="context-bar__item">
                <dt>1 · Empresa</dt>
                <dd>{data.companies?.find((c) => c.id === companyId)?.razonSocial ?? "—"}</dd>
              </div>
              <div className="context-bar__item">
                <dt>Periodo</dt>
                <dd className="nowrap">
                  {formatIsoDate(start)} a {formatIsoDate(end)}
                </dd>
              </div>
              <div className="context-bar__item">
                <dt>Presentación</dt>
                <dd>{PRESENTATION_LABEL[presentation as Presentation]} (interna)</dd>
              </div>
            </dl>
            <div className="context-bar__actions">
              <Button size="sm" icon={<Settings2 size={14} />} onClick={() => setConfigOpen(true)}>
                Cambiar configuración
              </Button>
            </div>
          </div>
        </Card>
      ) : (
      <Card
        title={<StepTitle n={1}>Configuración del periodo</StepTitle>}
        actions={
          companyId !== null && rangeOk && presentation ? (
            <Button size="sm" variant="primary" onClick={() => setConfigOpen(false)}>
              Listo
            </Button>
          ) : undefined
        }
      >
        <div className="param-bar fs-period-config">
          <div className="fs-period-config__company">
            <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          </div>
          <Field label="Fecha inicial" required>{(id) => <DateInput id={id} value={start} onChange={setStart} />}</Field>
          <Field label="Fecha final" required error={start && end && start > end ? "Debe ser posterior a la inicial." : null}>
            {(id) => <DateInput id={id} value={end} onChange={setEnd} />}
          </Field>
          <Field label="Presentación" required hint="Solo interna: no aparece en el PDF.">
            {(id) => (
              <Select id={id} value={presentation} onChange={(e) => setPresentation(e.target.value as Presentation | "")}>
                <option value="">Seleccionar…</option>
                <option value="bank">Banco</option>
                <option value="otc">OTC</option>
              </Select>
            )}
          </Field>
        </div>
      </Card>
      )}

      {key && s && shownRows && review && (
        <>
          <Card
            className="fs-period-status"
            title={<StepTitle n={2}>Estado del periodo</StepTitle>}
            description={`${formatIsoDate(start)} a ${formatIsoDate(end)} · Presentación ${PRESENTATION_LABEL[presentation as Presentation]} (interna)`}
            actions={<span className={`period-pill period-pill--${closed ? "closed" : (period?.status ?? "preparing")}`}>{PERIOD_STATUS_LABEL[period?.status ?? "preparing"]}</span>}
          >
            <div className="stack">
              <div className="fs-kpis">
                <div className="fs-kpi">
                  <span>Total activo</span>
                  <strong>{formatStatementPesos(roundThousands(s.esf.assets))}</strong>
                </div>
                <div className="fs-kpi">
                  <span>Pasivo + patrimonio</span>
                  <strong>{formatStatementPesos(roundThousands(s.esf.liabilitiesAndEquity))}</strong>
                </div>
                <div className={`fs-kpi ${isBalanced(s) ? "is-ok" : "is-bad"}`}>
                  <span>Diferencia</span>
                  <strong>{isBalanced(s) ? "Cuadra" : formatExactCents(Math.abs(s.esf.differenceCents))}</strong>
                  {!isBalanced(s) && <em>{s.esf.differenceCents > 0 ? "Activo es mayor" : "Pasivo + Patrimonio es mayor"}</em>}
                </div>
                <div className={`fs-kpi ${pendingChecks === 0 ? "is-ok" : "is-bad"}`}>
                  <span>Verificación</span>
                  <strong>{pendingChecks === 0 ? "Completa" : `${pendingChecks} pendiente${pendingChecks === 1 ? "" : "s"}`}</strong>
                  <em>
                    {checks.length - pendingChecks} de {checks.length} puntos
                  </em>
                </div>
              </div>
              {period?.status === "needs_review" && period.reviewReason && <Alert tone="warning">{period.reviewReason}</Alert>}
              {closed && <Alert tone="info" title="Periodo cerrado / bloqueado">Se muestran los valores aprobados al cerrar. No se pueden enviar movimientos, reemplazarlos ni crear ajustes en este rango sin desbloquearlo.</Alert>}
              {!isBalanced(s) && !closed && (
                <Alert tone="danger" title={`Diferencia: ${formatExactCents(Math.abs(s.esf.differenceCents))}`}>
                  {s.esf.differenceCents > 0 ? "Activo es mayor" : "Pasivo + Patrimonio es mayor"}. El estado no puede marcarse «Cuadrado», generar PDF ni cerrarse.
                </Alert>
              )}
              <div className="fs-period-actions">
                {!closed && (
                  <Button variant="primary" icon={<CheckCircle2 size={15} />} disabled={!allOk || busy !== null || (hashMatches && (period?.status === "ready" || period?.status === "pdf_generated"))} loading={busy === "ready"} onClick={() => void act("ready", () => fsService.markReady(key, hash!), "Periodo cuadrado / listo para generar.")}>
                    Marcar cuadrado / listo
                  </Button>
                )}
                {!closed && (
                  <Button icon={<Eye size={15} />} disabled={!pdfReady || pdfMissing.length > 0} onClick={() => { const snap = liveSnapshot(); if (snap) void openPreview(snap); }} title={!pdfReady ? "Primero marca el periodo como cuadrado." : pdfMissing[0]}>
                    Previsualizar y generar PDF
                  </Button>
                )}
                {!closed && (
                  <Button icon={<Lock size={15} />} disabled={!allOk || !hashMatches || !(period?.status === "ready" || period?.status === "pdf_generated")} onClick={() => setConfirm("close")}>
                    Cerrar / bloquear periodo
                  </Button>
                )}
                {closed && (
                  <Button icon={<Unlock size={15} />} onClick={() => setConfirm("unlock")}>
                    Desbloquear
                  </Button>
                )}
                {pdfMissing.length > 0 && !closed && <span className="field__hint">Para el PDF: {pdfMissing.join(" · ")}.</span>}
              </div>
            </div>
          </Card>

          <div className="fs-grid fs-grid--check">
            <Card
              title={<StepTitle n={3}>Verificación</StepTitle>}
              description={pendingChecks === 0 ? `Completa · ${checks.length} de ${checks.length} puntos` : `${pendingChecks} pendiente${pendingChecks === 1 ? "" : "s"} · ${checks.length - pendingChecks} de ${checks.length} puntos cumplidos`}
              actions={
                checks.length > pendingChecks ? (
                  <Button size="sm" variant="ghost" icon={checksDetail ? <ChevronDown size={14} /> : <ChevronRight size={14} />} aria-expanded={checksDetail} onClick={() => setChecksDetail((v) => !v)}>
                    {checksDetail ? "Ocultar cumplidos" : "Ver detalle"}
                  </Button>
                ) : undefined
              }
            >
              {/* Primero lo que falta (críticos visibles); los cumplidos, solo en el detalle. */}
              {pendingChecks === 0 && !checksDetail && <p className="muted" style={{ margin: 0 }}>Todas las validaciones se cumplen.</p>}
              <ul className="fs-checklist">
                {[...checks.filter((c) => !c.ok), ...(checksDetail ? checks.filter((c) => c.ok) : [])].map((c) => (
                  <li key={c.id} className={c.ok ? "is-ok" : "is-pending"}>
                    {c.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                    <span>
                      {c.label}
                      {c.detail && <span className="field__hint"> · {c.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={<StepTitle n={4}>Firmas del PDF</StepTitle>}>
              <div className="stack">
                <div>
                  <div className="field__label">Representante legal</div>
                  {company?.legalRepName ? (
                    <span>
                      {company.legalRepName} · Representante Legal {company.legalRepDocument && `· ${company.legalRepDocument}`}
                    </span>
                  ) : (
                    <Button size="sm" onClick={() => navigate(paths.companies)}>
                      Completar en Empresas
                    </Button>
                  )}
                </div>
                <Field label="Contador / Contadora" hint={validAccountants.length === 0 ? "En Firmas, define «Contador Público» o «Contadora Pública» y carga la firma PNG." : undefined}>
                  {(id) => (
                    <Select id={id} value={accountantId ?? ""} onChange={(e) => setAccountantId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Seleccionar…</option>
                      {validAccountants.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} · {x.accountantTitle} · {x.professionalDocument}
                        </option>
                      ))}
                      {pendingAccountants.map((x) => (
                        <option key={x.id} value="" disabled>
                          {x.name} · Pendiente EEFF (defínelo en Firmas)
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {pendingAccountants.length > 0 && !accountant && (
                  <Alert tone="warning" title="Rol EEFF sin definir">
                    {pendingAccountants.map((x) => x.name).join(", ")}: elige «Contador Público», «Contadora Pública» o «No usar como contador en EEFF» en Datos → Firmas. Sin rol definido la firma no se puede usar y el PDF queda bloqueado.
                    <div className="row" style={{ marginTop: 8 }}>
                      <Button size="sm" onClick={() => navigate(paths.signers)}>
                        Ir a Firmas
                      </Button>
                    </div>
                  </Alert>
                )}
              </div>
            </Card>
          </div>

          {s.unclassified.length > 0 && !closed && (
            <Card flush title="Códigos PUC sin clasificar" description="Bloquean el estado «Listo». Asígnalos a una línea del ESF / EERR o márcalos «No afecta Estados Financieros».">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código PUC</th>
                      <th>Concepto</th>
                      <th style={{ textAlign: "right" }}>Movimientos</th>
                      <th style={{ textAlign: "right" }}>Valor</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.unclassified.map((u) => (
                      <tr key={u.pucCode} className="row-attention--blocking">
                        <td className="mono">
                          {u.pucCode}
                          {u.pucCode.length === 4 && <div className="table__secondary">Familia: se clasifica una vez para todas sus subcuentas</div>}
                        </td>
                        <td>
                          {u.concept}
                          {u.inactiveLine && <div className="table__secondary">Su línea «{u.inactiveLine}» está desactivada.</div>}
                        </td>
                        <td style={{ textAlign: "right" }}>{formatInteger(u.count)}</td>
                        <td style={{ textAlign: "right" }}>{formatExactCents(u.cents)}</td>
                        <td className="actions">
                          <Button size="sm" variant="primary" onClick={() => setClassifying({ code: u.pucCode, concept: u.concept })}>
                            Clasificar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {pendingBankBalances(s).length > 0 && !closed && (
            <Alert
              tone="danger"
              title="Saldo bancario pendiente"
              items={pendingBankBalances(s).map((b) => pendingBalanceText(b) + (b.lastKnown ? ` Último saldo conocido: ${formatExactCents(b.lastKnown.balanceCents)} (solo referencia).` : ""))}
            >
              El ESF usa el saldo del mes de la fecha final. Estas cuentas no suman al Disponible hasta enviar su extracto de {monthText(end.slice(0, 7))}; el saldo de un mes anterior no se usa como saldo vigente.
            </Alert>
          )}
          {s.tax.issues.length > 0 && !closed && (
            <Alert
              tone={s.tax.issues.some((i) => i.level === "blocking") ? "danger" : "warning"}
              title="Obligaciones tributarias"
              items={s.tax.issues.map((i) => i.message)}
            >
              <div className="stack stack--sm">
                <span>Resuélvelo en Estados Financieros → Obligaciones tributarias.</span>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {s.tax.issues.some((i) => i.code === "puc_missing") && (
                    <Button size="sm" onClick={() => setPucOpen(true)}>
                      Configurar PUC pendiente
                    </Button>
                  )}
                  {s.tax.excessReviews.length > 0 && (
                    <Button size="sm" onClick={() => setExcessOpen(true)}>
                      Excedentes a favor de DIAN
                    </Button>
                  )}
                </div>
              </div>
            </Alert>
          )}
          {review.absences.length > 0 && (
            <Alert tone="danger" title="Empleados pendientes de liquidación" items={review.absences.map((a) => `${a.employee.name}: no aparece en la planilla de ${a.period} (última: ${a.lastSeen}).`)}>
              Resuélvelo en Estados Financieros → Nómina.
            </Alert>
          )}

          <h3 className="fs-section-title">
            <StepTitle n={5}>Estados financieros</StepTitle>
          </h3>
          <div className="fs-grid fs-grid--statements">
            <Card title="Estado de Situación Financiera" description="Saldos acumulados hasta la fecha final. Clic en una línea para ver su origen.">
              <StatementView title="" rows={shownRows.esf} lines={closed ? new Map() : lines} />
            </Card>
            <Card title="Estado de Resultados" description="Movimientos entre la fecha inicial y la final.">
              <StatementView title="" rows={shownRows.eerr} lines={closed ? new Map() : lines} />
              <div className="fs-tax">
                <span>Impuesto de renta estimado (solo en la app, no va en el PDF)</span>
                <strong>{formatStatementPesos(closedSnapshot ? closedSnapshot.totals.incomeTaxPesos : s.incomeTaxPesos)}</strong>
              </div>
            </Card>
          </div>

          {(s.crypto.sellsCents !== 0 || s.crypto.buysCents !== 0) && (
            <Card title="Reporte de operaciones (cripto)" description="El resultado propio se conserva en ambas presentaciones.">
              <div className="summary-grid">
                <Item label="Ventas de cripto" value={formatExactCents(s.crypto.sellsCents)} />
                <Item label="Compras de cripto" value={formatExactCents(s.crypto.buysCents)} />
                <Item label="Resultado propio" value={formatExactCents(s.crypto.ownResultCents)} />
                <Item label={`Promedio mensual de ventas (${s.crypto.months.length} meses)`} value={formatExactCents(s.crypto.monthlyAverageCents)} />
                <Item label="Resultado antes de impuestos Banco" value={formatStatementPesos(roundThousands(presentation === "bank" ? s.eerr.beforeTax : statements!.other.eerr.beforeTax))} />
                <Item label="Resultado antes de impuestos OTC" value={formatStatementPesos(roundThousands(presentation === "otc" ? s.eerr.beforeTax : statements!.other.eerr.beforeTax))} />
              </div>
            </Card>
          )}

          <Card
            title={<StepTitle n={6}>Fuentes del periodo y cobertura mensual</StepTitle>}
            description="✓ con información · — sin información · 1/2 cuentas con extracto · N/A cuenta aún no abierta o ya cerrada. Los extractos se despliegan por banco y cuenta. Clic en un mes para ver sus importaciones y reemplazos."
          >
            <CoverageTable
              months={review.coverage.months}
              rows={review.coverage.rows}
              companyName={company?.razonSocial ?? ""}
              tax={review.tax}
              cut={end}
              companyId={companyId}
              onLifecycleChanged={loadLedger}
            />
          </Card>

          <Card
            flush
            title={<StepTitle n={7}>Ajustes</StepTitle>}
            description="Cambios manuales con trazabilidad (motivo, valor anterior, valor final e historial de ediciones)."
            actions={
              !closed && (
                <Button icon={<Plus size={14} />} onClick={() => setAdjusting({ editing: null })}>
                  Nuevo ajuste
                </Button>
              )
            }
          >
            {ledger!.adjustments.filter((a) => a.accountingDate >= start && a.accountingDate <= end).length === 0 ? (
              <p className="muted" style={{ padding: "0 var(--space-5) var(--space-5)" }}>
                Sin ajustes en este rango.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>PUC</th>
                      <th>Motivo</th>
                      <th>Tipo</th>
                      <th style={{ textAlign: "right" }}>Anterior</th>
                      <th style={{ textAlign: "right" }}>Final</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {ledger!.adjustments
                      .filter((a) => a.accountingDate >= start && a.accountingDate <= end)
                      .map((a) => (
                        <tr key={a.id}>
                          <td>{formatIsoDate(a.accountingDate)}</td>
                          <td>
                            <span className="mono">{a.pucCode}</span>
                            <div className="table__secondary">{a.concept}</div>
                          </td>
                          <td>
                            {a.reason}
                            {a.history.length > 0 && <div className="table__secondary">Editado {a.history.length} veces</div>}
                          </td>
                          <td>{a.adjustmentType === "replace" ? "Reemplazar valor" : "Sumar / restar"}</td>
                          <td style={{ textAlign: "right" }}>{formatExactCents(a.previousCents)}</td>
                          <td style={{ textAlign: "right" }}>{formatExactCents(a.finalCents)}</td>
                          <td className="actions">{!closed && <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={14} />} aria-label="Editar ajuste" onClick={() => setAdjusting({ editing: a })} />}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {period && period.versions.length > 0 && (
            <Card flush title="Versiones generadas" description="Cada PDF generado queda como versión con su snapshot exacto; nunca se sobrescribe.">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Versión</th>
                      <th>Archivo</th>
                      <th>Generado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {[...period.versions].reverse().map((v) => (
                      <tr key={v.id}>
                        <td>Versión {v.version}</td>
                        <td>{v.fileName}</td>
                        <td>{formatDateTimeForDisplay(v.generatedAt)}</td>
                        <td className="actions">
                          <Button size="sm" icon={<FileDown size={14} />} onClick={() => void openPreview(v.snapshot as StatementsSnapshot, true)}>
                            Regenerar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {otherPeriods.length > 0 && (
            <Card flush title="Otros periodos preparados de la empresa">
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {otherPeriods.map((p) => (
                      <tr key={p.id} className="is-clickable" onClick={() => { setStart(p.startDate); setEnd(p.endDate); setPresentation(p.presentation); setConfigOpen(false); }}>
                        <td>
                          {formatIsoDate(p.startDate)} a {formatIsoDate(p.endDate)}
                        </td>
                        <td>{PRESENTATION_LABEL[p.presentation]}</td>
                        <td>{PERIOD_STATUS_LABEL[p.status]}</td>
                        <td>{p.versions.length ? `${p.versions.length} versiones` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {review.duplicates.length > 0 && (
            <Card flush title="Duplicados activos">
              <BatchTable batches={ledger!.batches.filter((b) => review.duplicates.some((d) => d.batchIds.includes(b.id)))} />
            </Card>
          )}
        </>
      )}

      {companyId !== null && rangeOk && presentation && !s && <Card><span className="muted">Cargando información de la empresa…</span></Card>}
      {companyId !== null && company && (!rangeOk || !presentation) && <Alert tone="info">Elige el rango de fechas y la presentación para preparar los estados. Los datos fuera del rango se conservan.</Alert>}

      <PucSettingsModal
        open={pucOpen}
        title="Cuentas PUC de impuestos y capital"
        description="Ningún valor llega a los Estados Financieros sin su cuenta PUC. La ubicación en EEFF (y si es corriente o no corriente) se elige una sola vez por familia de cuatro dígitos."
        items={pucItems}
        index={data.index}
        settings={data.settingsMap}
        mappings={data.mappingMap}
        catalog={data.catalog}
        onClassify={(code, concept) => setClassifying({ code, concept })}
        required={(statements?.current.tax.issues ?? []).flatMap((i) => (i.code === "puc_missing" && i.pucKey ? [i.pucKey] : []))}
        onClose={() => setPucOpen(false)}
        onSaved={data.reloadSettings}
        onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
      />
      <ExcessReviewModal open={excessOpen} items={statements?.current.tax.excessReviews ?? []} onClose={() => setExcessOpen(false)} onChanged={loadLedger} onConfigurePuc={() => (setExcessOpen(false), setPucOpen(true))} />
      <ClassifyPucModal open={classifying !== null} pucCode={classifying?.code ?? ""} concept={classifying?.concept ?? ""} catalog={data.catalog} mappings={data.mappingMap} onClose={() => setClassifying(null)} onSaved={data.reloadMappings} />
      {companyId !== null && (
        <AdjustmentModal
          open={adjusting !== null}
          companyId={companyId}
          editing={adjusting?.editing ?? null}
          defaultDate={end}
          index={data.index}
          mappings={data.mappingMap}
          balanceOf={balanceOf}
          onClose={() => setAdjusting(null)}
          onSaved={() => Promise.all([loadLedger(), loadPeriod()])}
          onCodesChanged={() => Promise.all([data.reloadCodes(), data.reloadMappings()])}
        />
      )}
      <Modal
        open={preview !== null}
        size="xl"
        title={preview?.regenerate ? "Versión guardada" : "Previsualizador"}
        description="Página 1: Estado de Situación Financiera · Página 2: Estado de Resultados. Revisa antes de generar."
        onClose={() => setPreview(null)}
        locked={busy === "pdf"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy === "pdf"}>
              Volver y corregir
            </Button>
            <Button variant="primary" icon={<FileDown size={15} />} onClick={() => void generate()} loading={busy === "pdf"} disabled={!preview?.bytes}>
              {preview?.regenerate ? "Guardar PDF" : "Generar PDF"}
            </Button>
          </>
        }
      >
        {preview && (
          <div className="stack">
            <span className="field__hint">Archivo: {preview.snapshot.fileName}</span>
            <PdfPages bytes={preview.bytes} />
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirm === "close"}
        title="Cerrar / bloquear periodo"
        confirmLabel="Cerrar periodo"
        message="Se guardan los valores aprobados. Mientras esté cerrado no se pueden modificar, reemplazar ni enviar movimientos, ni crear ajustes en el rango."
        loading={busy === "close"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const snap = liveSnapshot();
          setConfirm(null);
          if (snap && key) void act("close", () => fsService.close(key, snap), "Periodo cerrado.");
        }}
      />
      <ConfirmDialog
        open={confirm === "unlock"}
        danger
        title="Desbloquear periodo"
        confirmLabel="Desbloquear"
        message="El periodo pierde el estado de cerrado y su aprobación previa: queda en «Requiere nueva revisión» y debe volver a cuadrarse antes de cerrarse otra vez."
        loading={busy === "unlock"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          if (key) void act("unlock", () => fsService.unlock(key, ""), "Periodo desbloqueado: requiere nueva revisión.");
        }}
      />
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span className="summary-item__label">{label}</span>
      <span className="summary-item__value">{value}</span>
    </div>
  );
}


/** Título de sección numerada del Generador (1 · Configuración, 2 · Estado del periodo…). */
function StepTitle({ n, children }: { n: number; children: string }) {
  return (
    <span className="step-title">
      <span className="form-section__step">{n}</span>
      {children}
    </span>
  );
}
