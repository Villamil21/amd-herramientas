import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eye, FileDown, Lock, Pencil, Plus, Unlock, XCircle } from "lucide-react";
import { navigate, paths } from "../../../app/router";
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, Modal, PageHeader, Select, useToast } from "../../../components/ui";
import { fileService } from "../../../services/fileService";
import { fsService } from "../../../services/fsService";
import { signerService } from "../../../services/signerService";
import { errorMessage } from "../../../services/tauri";
import { PERIOD_STATUS_LABEL, PRESENTATION_LABEL, type Adjustment, type BankBalance, type BatchSummary, type Employee, type Movement, type PayrollRow, type Period, type PeriodKey, type Presentation } from "../../../types/fs";
import type { CertificateSigner } from "../../../types/models";
import { formatInteger } from "../../../utils/format";
import { areaFor } from "../payroll/calc";
import { ClassifyPucModal } from "../shared/components/ClassifyPucModal";
import { CompanySelect } from "../shared/components/CompanySelect";
import { fingerprint, formatExactCents, formatIsoDate, formatStatementPesos, isIsoDate, roundThousands } from "../shared/money";
import { useFsData } from "../shared/useFsData";
import { activeDuplicates, checklist, coverage, payrollAbsences } from "./checks";
import { AdjustmentModal, BatchTable, CoverageTable, PdfPages, StatementView } from "./components";
import { buildStatements, eerrRows, esfRows, isBalanced, type LineValue, type StatementRow } from "./engine";
import { renderStatementsPdf } from "./pdf";
import { buildSnapshot, pdfModel, type StatementsSnapshot } from "./snapshot";

interface Ledger {
  movements: Movement[];
  balances: BankBalance[];
  batches: BatchSummary[];
  adjustments: Adjustment[];
  employees: Employee[];
  payrollRows: PayrollRow[];
  periods: Period[];
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
  const reviewing = useRef<string | null>(null);

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
      const [movements, balances, batches, adjustments, employees, payrollRows, periods] = await Promise.all([
        fsService.movements(companyId),
        fsService.bankBalances(companyId),
        fsService.batches(companyId),
        fsService.adjustments(companyId),
        fsService.employees(companyId),
        fsService.payrollRows(companyId),
        fsService.periods(companyId),
      ]);
      setLedger({ movements, balances, batches, adjustments, employees, payrollRows, periods });
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
    const input = { company, catalog: data.catalog, mappings: data.mappings, movements: ledger.movements, bankBalances: ledger.balances, pucConcepts: data.index.concepts, start, end };
    return { current: buildStatements({ ...input, presentation }), other: buildStatements({ ...input, presentation: presentation === "bank" ? "otc" : "bank" }) };
  }, [ledger, data.catalog, data.mappings, data.index, company, start, end, rangeOk, presentation]);

  const s = statements?.current ?? null;
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
    return { coverage: coverage(start, end, ledger.movements, ledger.balances, ledger.batches), duplicates: activeDuplicates(ledger.movements), absences, withoutArea };
  }, [ledger, start, end, rangeOk]);

  const checks = useMemo(() => (statements && review ? checklist(statements.current, statements.other, review.duplicates, review.absences, review.withoutArea) : []), [statements, review]);
  const allOk = checks.length > 0 && checks.every((c) => c.ok);
  const closed = period?.status === "closed";
  const closedSnapshot = closed ? (period?.closedSnapshot as StatementsSnapshot | null) : null;
  const accountant = signers.find((x) => x.id === accountantId) ?? null;
  const validAccountants = signers.filter((x) => x.signatureAvailable && x.accountantTitle);
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

  const shownRows: { esf: StatementRow[]; eerr: StatementRow[] } | null = closedSnapshot ? { esf: closedSnapshot.esfRows, eerr: closedSnapshot.eerrRows } : rows;
  const otherPeriods = (ledger?.periods ?? []).filter((p) => p.id !== period?.id).slice(0, 6);

  return (
    <>
      <PageHeader eyebrow="Estados Financieros" title="Generador de Estados Financieros" description="Estado de Situación Financiera (saldos a la fecha final) y Estado de Resultados (movimientos del rango) por empresa." />
      <Card>
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
          <CompanySelect companies={data.companies} value={companyId} onChange={setCompanyId} />
          <Field label="Fecha inicial" required>{(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Fecha final" required error={start && end && start > end ? "Debe ser posterior a la inicial." : null}>
            {(id) => <Input id={id} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />}
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

      {key && s && shownRows && review && (
        <>
          <Card
            title={`Periodo ${formatIsoDate(start)} a ${formatIsoDate(end)} · ${PRESENTATION_LABEL[presentation as Presentation]}`}
            actions={<Badge tone={closed ? "dark" : period?.status === "ready" || period?.status === "pdf_generated" ? "success" : period?.status === "needs_review" ? "warning" : undefined}>{PERIOD_STATUS_LABEL[period?.status ?? "preparing"]}</Badge>}
          >
            <div className="stack">
              {period && period.status !== "preparing" && <Alert tone="info">Este periodo ya había sido preparado. Estado: {PERIOD_STATUS_LABEL[period.status]}.</Alert>}
              {period?.status === "needs_review" && period.reviewReason && <Alert tone="warning">{period.reviewReason}</Alert>}
              {closed && <Alert tone="info" title="Periodo cerrado / bloqueado">Se muestran los valores aprobados al cerrar. No se pueden enviar movimientos, reemplazarlos ni crear ajustes en este rango sin desbloquearlo.</Alert>}
              {!isBalanced(s) && !closed && (
                <Alert tone="danger" title={`Diferencia: ${formatExactCents(Math.abs(s.esf.differenceCents))}`}>
                  {s.esf.differenceCents > 0 ? "Activo es mayor" : "Pasivo + Patrimonio es mayor"}. El estado no puede marcarse «Cuadrado» ni generar PDF.
                </Alert>
              )}
              <div className="row" style={{ flexWrap: "wrap" }}>
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
              </div>
              {pdfMissing.length > 0 && !closed && <span className="field__hint">Para el PDF: {pdfMissing.join(" · ")}.</span>}
            </div>
          </Card>

          <div className="fs-grid">
            <Card title="Lista de verificación">
              <ul className="fs-checklist">
                {checks.map((c) => (
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
            <Card title="Firmas del PDF">
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
                    </Select>
                  )}
                </Field>
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
                        <td className="mono">{u.pucCode}</td>
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
          {review.absences.length > 0 && (
            <Alert tone="danger" title="Empleados pendientes de liquidación" items={review.absences.map((a) => `${a.employee.name}: no aparece en la planilla de ${a.period} (última: ${a.lastSeen}).`)}>
              Resuélvelo en Estados Financieros → Nómina.
            </Alert>
          )}

          <div className="fs-grid">
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

          <Card title="Fuentes del periodo y cobertura mensual" description="✓ con información · — sin información. Clic en un mes para ver sus importaciones y reemplazos.">
            <CoverageTable months={review.coverage.months} rows={review.coverage.rows} />
          </Card>

          <Card
            flush
            title="Ajustes"
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
                        <td>{v.generatedAt.replace("T", " ").slice(0, 16)}</td>
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
                      <tr key={p.id} className="is-clickable" onClick={() => { setStart(p.startDate); setEnd(p.endDate); setPresentation(p.presentation); }}>
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

